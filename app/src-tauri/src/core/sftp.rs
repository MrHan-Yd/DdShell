use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use russh_sftp::client::error::Error as SftpClientError;
use russh_sftp::protocol::{FileAttributes, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::core::secret;
use crate::core::ssh::SessionManager;
use crate::core::store::Database;
use crate::core::event;

/// Convert russh-sftp FilePermissions to unix permission bits
fn permissions_to_u32(p: &russh_sftp::protocol::FilePermissions) -> u32 {
    let mut bits: u32 = 0;
    if p.owner_read { bits |= 0o400; }
    if p.owner_write { bits |= 0o200; }
    if p.owner_exec { bits |= 0o100; }
    if p.group_read { bits |= 0o040; }
    if p.group_write { bits |= 0o020; }
    if p.group_exec { bits |= 0o010; }
    if p.other_read { bits |= 0o004; }
    if p.other_write { bits |= 0o002; }
    if p.other_exec { bits |= 0o001; }
    bits
}

/// Convert SystemTime to unix epoch i64
fn systemtime_to_epoch(t: std::time::SystemTime) -> i64 {
    t.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    hex
}

fn is_probably_text(bytes: &[u8]) -> bool {
    !bytes.contains(&0)
}

fn is_permission_denied_message(message: &str) -> bool {
    message.to_ascii_lowercase().contains("permission denied")
}

fn is_no_such_file_error(err: &SftpClientError) -> bool {
    matches!(err, SftpClientError::Status(status) if status.status_code == StatusCode::NoSuchFile)
}

fn map_write_error(err: &SftpClientError) -> &'static str {
    if matches!(err, SftpClientError::Status(status) if status.status_code == StatusCode::PermissionDenied)
        || is_permission_denied_message(&err.to_string())
    {
        "FILE_PERMISSION_DENIED"
    } else if is_no_such_file_error(err) {
        "FILE_CHANGED_CONFLICT"
    } else {
        "FILE_WRITE_FAILED"
    }
}

fn map_write_io_error(err: &std::io::Error) -> &'static str {
    if is_permission_denied_message(&err.to_string()) {
        "FILE_PERMISSION_DENIED"
    } else {
        "FILE_WRITE_FAILED"
    }
}

fn split_remote_path(remote_path: &str) -> (&str, &str) {
    match remote_path.rsplit_once('/') {
        Some(("", file_name)) => ("/", file_name),
        Some((parent, file_name)) => (parent, file_name),
        None => (".", remote_path),
    }
}

fn build_sibling_remote_path(parent: &str, file_name: &str, operation_id: &str, suffix: &str) -> String {
    if parent == "/" {
        format!("/.{}.quick-edit-{}.{}", file_name, operation_id, suffix)
    } else {
        format!("{}/.{}.quick-edit-{}.{}", parent, file_name, operation_id, suffix)
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn cleanup_remote_file(sftp: &russh_sftp::client::SftpSession, remote_path: &str) {
    let _ = sftp.remove_file(remote_path).await;
}

async fn validate_write_expectations(
    sftp: &russh_sftp::client::SftpSession,
    remote_path: &str,
    expected_mtime: Option<i64>,
    expected_hash: Option<&str>,
) -> anyhow::Result<FileAttributes> {
    use tokio::io::AsyncReadExt;

    let metadata = sftp
        .metadata(remote_path)
        .await
        .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;

    let current_mtime = metadata.modified().map(systemtime_to_epoch).unwrap_or(0);
    if let Some(expected_mtime) = expected_mtime {
        if expected_mtime != current_mtime {
            anyhow::bail!("FILE_CHANGED_CONFLICT");
        }
    }

    if let Some(expected_hash) = expected_hash {
        let mut current_bytes = Vec::with_capacity(metadata.len() as usize);
        let mut current_file = sftp
            .open(remote_path)
            .await
            .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;
        current_file
            .read_to_end(&mut current_bytes)
            .await
            .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;

        if sha256_hex(&current_bytes) != expected_hash {
            anyhow::bail!("FILE_CHANGED_CONFLICT");
        }
    }

    Ok(metadata)
}

fn is_sudo_auth_error(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    lower.contains("sudo")
        && (lower.contains("password is required")
            || lower.contains("incorrect password")
            || lower.contains("try again")
            || lower.contains("a password is required")
            || lower.contains("authentication"))
}

/// A file entry returned by directory listing
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub file_type: String, // "file" | "dir" | "symlink"
    pub size: u64,
    pub mtime: i64,
    pub permissions: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextResult {
    pub content: String,
    pub size: u64,
    pub mtime: i64,
    pub encoding: String,
    pub readonly: bool,
    pub hash: String,
    pub is_text: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextResult {
    pub success: bool,
    pub size: u64,
    pub mtime: i64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegedWriteTextResult {
    pub success: bool,
    pub size: u64,
    pub mtime: i64,
    pub hash: String,
    pub backup_path: Option<String>,
}

/// Transfer direction
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

/// Transfer task state
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferState {
    Queued,
    Running,
    Completed,
    Failed,
    Canceled,
}

/// A transfer task
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub state: TransferState,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub error: Option<String>,
}

/// Manages SFTP operations and transfer tasks
#[derive(Clone)]
pub struct SftpManager {
    tasks: Arc<Mutex<HashMap<String, TransferTask>>>,
    canceled: Arc<Mutex<std::collections::HashSet<String>>>,
    /// Semaphore to limit concurrent transfers globally (wrapped in Arc for interior mutability)
    concurrency: Arc<tokio::sync::Semaphore>,
}

impl SftpManager {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            canceled: Arc::new(Mutex::new(std::collections::HashSet::new())),
            concurrency: Arc::new(tokio::sync::Semaphore::new(max_concurrent)),
        }
    }

    /// Get a clone of the concurrency semaphore
    pub fn concurrency_semaphore(&self) -> Arc<tokio::sync::Semaphore> {
        self.concurrency.clone()
    }

    pub async fn canonicalize(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<String> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        Ok(sftp.canonicalize(remote_path).await?)
    }

    /// List directory on remote host
    pub async fn list_dir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<Vec<FileEntry>> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        let entries = sftp.read_dir(remote_path).await?;

        let mut result = Vec::new();
        for entry in entries {
            let name = entry.file_name();

            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }

            let metadata = entry.metadata();
            let file_type_val = metadata.file_type();
            let file_type = if file_type_val.is_dir() {
                "dir"
            } else if file_type_val.is_symlink() {
                "symlink"
            } else {
                "file"
            };

            result.push(FileEntry {
                name,
                file_type: file_type.to_string(),
                size: metadata.len(),
                mtime: metadata.modified().map(systemtime_to_epoch).unwrap_or(0),
                permissions: permissions_to_u32(&metadata.permissions()),
            });
        }

        // Sort: dirs first, then by name
        result.sort_by(|a, b| {
            let dir_a = a.file_type == "dir";
            let dir_b = b.file_type == "dir";
            dir_b.cmp(&dir_a).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    }

    /// Create directory on remote host
    pub async fn mkdir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };
        sftp.create_dir(remote_path).await?;
        Ok(())
    }

    /// Remove file on remote host
    pub async fn remove_file(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };
        sftp.remove_file(remote_path).await?;
        Ok(())
    }

    /// Remove directory on remote host (uses rm -rf for recursive delete)
    pub async fn remove_dir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // Use rm -rf to delete directory (handles non-empty directories)
        let cmd = format!("rm -rf '{}'", remote_path.replace("'", "'\\''"));
        let sess = session.lock().await;
        sess.exec_command(&cmd).await?;
        Ok(())
    }

    /// Rename file/dir on remote host
    pub async fn rename(
        session_mgr: &SessionManager,
        session_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };
        sftp.rename(old_path, new_path).await?;
        Ok(())
    }

    /// Get stat info for a remote path
    pub async fn stat(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<FileEntry> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
        let metadata = sftp.metadata(remote_path).await?;

        let name = std::path::Path::new(remote_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.to_string());

        let file_type_val = metadata.file_type();
        let file_type = if file_type_val.is_dir() {
            "dir"
        } else if file_type_val.is_symlink() {
            "symlink"
        } else {
            "file"
        };

        Ok(FileEntry {
            name,
            file_type: file_type.to_string(),
            size: metadata.len(),
            mtime: metadata.modified().map(systemtime_to_epoch).unwrap_or(0),
            permissions: permissions_to_u32(&metadata.permissions()),
        })
    }

    pub async fn read_text(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
        max_bytes: Option<u64>,
    ) -> anyhow::Result<ReadTextResult> {
        use tokio::io::AsyncReadExt;

        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        let metadata = sftp
            .metadata(remote_path)
            .await
            .map_err(|err| anyhow::anyhow!(if is_permission_denied_message(&err.to_string()) { "FILE_PERMISSION_DENIED" } else { "FILE_READ_FAILED" }))?;

        if metadata.file_type().is_dir() {
            anyhow::bail!("FILE_NOT_TEXT");
        }

        let size = metadata.len();
        let limit = max_bytes.unwrap_or(1024 * 1024);
        if size > limit {
            anyhow::bail!("FILE_TOO_LARGE");
        }

        let mut remote_file = sftp
            .open(remote_path)
            .await
            .map_err(|err| anyhow::anyhow!(if is_permission_denied_message(&err.to_string()) { "FILE_PERMISSION_DENIED" } else { "FILE_READ_FAILED" }))?;

        let mut bytes = Vec::with_capacity(size as usize);
        remote_file
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| anyhow::anyhow!("FILE_READ_FAILED"))?;

        if !is_probably_text(&bytes) {
            anyhow::bail!("FILE_NOT_TEXT");
        }

        let content = String::from_utf8(bytes.clone())
            .map_err(|_| anyhow::anyhow!("FILE_ENCODING_UNSUPPORTED"))?;

        Ok(ReadTextResult {
            content,
            size,
            mtime: metadata.modified().map(systemtime_to_epoch).unwrap_or(0),
            encoding: "utf-8".to_string(),
            readonly: permissions_to_u32(&metadata.permissions()) & 0o222 == 0,
            hash: sha256_hex(&bytes),
            is_text: true,
        })
    }

    pub async fn write_text(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
        content: &str,
        expected_mtime: Option<i64>,
        expected_hash: Option<&str>,
    ) -> anyhow::Result<WriteTextResult> {
        use tokio::io::AsyncWriteExt;

        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        let metadata = validate_write_expectations(&sftp, remote_path, expected_mtime, expected_hash).await?;
        let current_mtime = metadata.modified().map(systemtime_to_epoch).unwrap_or(0);

        let preserve_path_identity = sftp
            .symlink_metadata(remote_path)
            .await
            .map(|path_meta| path_meta.file_type().is_symlink())
            .unwrap_or(false);

        if preserve_path_identity {
            let mut remote_file = sftp
                .create(remote_path)
                .await
                .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;
            remote_file
                .write_all(content.as_bytes())
                .await
                .map_err(|err| anyhow::anyhow!(map_write_io_error(&err)))?;
            remote_file
                .flush()
                .await
                .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
            remote_file
                .sync_all()
                .await
                .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
        } else {
            let operation_id = Uuid::new_v4().simple().to_string();
            let (parent_dir, file_name) = split_remote_path(remote_path);
            let temp_path = build_sibling_remote_path(parent_dir, file_name, &operation_id, "tmp");
            let backup_path = build_sibling_remote_path(parent_dir, file_name, &operation_id, "bak");

            let write_result = async {
                let mut temp_file = sftp
                    .create(&temp_path)
                    .await
                    .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;
                temp_file
                    .write_all(content.as_bytes())
                    .await
                    .map_err(|err| anyhow::anyhow!(map_write_io_error(&err)))?;
                temp_file
                    .flush()
                    .await
                    .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
                temp_file
                    .sync_all()
                    .await
                    .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;

                if let Some(permissions) = metadata.permissions {
                    let mut attrs = FileAttributes::empty();
                    attrs.permissions = Some(permissions);
                    sftp
                        .set_metadata(&temp_path, attrs)
                        .await
                        .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;
                }

                drop(temp_file);

                validate_write_expectations(&sftp, remote_path, expected_mtime, expected_hash).await?;

                sftp
                    .rename(remote_path, &backup_path)
                    .await
                    .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;

                if let Err(err) = sftp.rename(&temp_path, remote_path).await {
                    let _ = sftp.rename(&backup_path, remote_path).await;
                    cleanup_remote_file(&sftp, &temp_path).await;
                    return Err(anyhow::anyhow!(map_write_error(&err)));
                }

                if let Err(err) = sftp.remove_file(&backup_path).await {
                    tracing::warn!(
                        remote_path = remote_path,
                        backup_path = backup_path,
                        error = %err,
                        "quick edit save left backup file after rename"
                    );
                }

                Ok::<(), anyhow::Error>(())
            }.await;

            if write_result.is_err() {
                cleanup_remote_file(&sftp, &temp_path).await;
            }

            write_result?;
        }

        let updated = sftp
            .metadata(remote_path)
            .await
            .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;

        Ok(WriteTextResult {
            success: true,
            size: updated.len(),
            mtime: updated.modified().map(systemtime_to_epoch).unwrap_or(current_mtime),
            hash: sha256_hex(content.as_bytes()),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn write_text_privileged(
        db: &Database,
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
        content: &str,
        expected_mtime: Option<i64>,
        expected_hash: Option<&str>,
        sudo_password: Option<&str>,
        create_backup: bool,
    ) -> anyhow::Result<PrivilegedWriteTextResult> {
        use tokio::io::AsyncWriteExt;

        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let host_id = {
            let sess = session.lock().await;
            sess.host_id.clone()
        };

        let resolved_sudo_password = if let Some(password) = sudo_password.filter(|password| !password.is_empty()) {
            password.to_string()
        } else {
            match db.get_host(&host_id).await.ok().flatten() {
                Some(host) => match host.secret_ref {
                    Some(reference) => match secret::decrypt(&reference) {
                        Ok(password) => {
                            if let Some(next_ref) = secret::try_migrate_to_keyring(&reference, &password) {
                                if let Err(err) = db.update_host_secret_ref(&host_id, Some(&next_ref)).await {
                                    tracing::warn!("failed to update migrated SFTP host secret ref: {}", err);
                                }
                            }
                            password
                        }
                        Err(_) => String::new(),
                    },
                    None => String::new(),
                },
                None => String::new(),
            }
        };

        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        let metadata = validate_write_expectations(&sftp, remote_path, expected_mtime, expected_hash).await?;
        let current_mtime = metadata.modified().map(systemtime_to_epoch).unwrap_or(0);

        let temp_path = {
            let sess = session.lock().await;
            let output = sess
                .exec_command("mktemp /tmp/quick-edit.XXXXXXXXXX")
                .await
                .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
            let path = output.lines().next().unwrap_or("").trim().to_string();
            if path.is_empty() {
                anyhow::bail!("FILE_WRITE_FAILED");
            }
            path
        };

        let write_result = async {
            let mut temp_file = sftp
                .create(&temp_path)
                .await
                .map_err(|err| anyhow::anyhow!(map_write_error(&err)))?;
            temp_file
                .write_all(content.as_bytes())
                .await
                .map_err(|err| anyhow::anyhow!(map_write_io_error(&err)))?;
            temp_file
                .flush()
                .await
                .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
            temp_file
                .sync_all()
                .await
                .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;
            drop(temp_file);

            validate_write_expectations(&sftp, remote_path, expected_mtime, expected_hash).await?;

            let operation_id = Uuid::new_v4().simple().to_string();
            let (parent_dir, file_name) = split_remote_path(remote_path);
            let root_temp_template = build_sibling_remote_path(parent_dir, file_name, &operation_id, "root.XXXXXX");
            let backup_path = create_backup.then(|| {
                build_sibling_remote_path(parent_dir, file_name, &operation_id, "backup")
            });
            let backup_clause = if let Some(backup_path) = backup_path.as_deref() {
                format!(
                    "if [ -e \"$target\" ]; then cp -p -- \"$target\" {}; fi;",
                    shell_single_quote(backup_path),
                )
            } else {
                String::new()
            };

            // 脚本说明：
            // - `set -o pipefail` 不是 POSIX，老 dash 不支持，靠 `2>/dev/null || true` 兜底，不影响 set -eu。
            // - `chmod/chown --reference` 是 GNU 扩展，BSD/macOS 远端不支持。
            //   改用 `stat` 拿数字模式与 uid:gid，GNU 用 `-c`，BSD 用 `-f`，互为 fallback。
            //   两个 stat 都失败时返回空串，跳过权限同步而不是中断脚本。
            let script = format!(
                "set -o pipefail 2>/dev/null || true; \
                 set -eu; \
                 target={target}; user_temp={user_temp}; \
                 if [ -L \"$target\" ]; then resolved=$(readlink -f -- \"$target\" 2>/dev/null || true); if [ -n \"$resolved\" ]; then target=\"$resolved\"; fi; fi; \
                 staged=$(mktemp {root_temp}); \
                 cleanup() {{ rm -f -- \"$staged\" \"$user_temp\"; }}; trap cleanup EXIT; \
                 {backup_clause} \
                 cat -- \"$user_temp\" > \"$staged\"; \
                 if [ -e \"$target\" ]; then \
                   perm_mode=$(stat -c '%a' -- \"$target\" 2>/dev/null || stat -f '%Lp' -- \"$target\" 2>/dev/null || true); \
                   perm_owner=$(stat -c '%u:%g' -- \"$target\" 2>/dev/null || stat -f '%u:%g' -- \"$target\" 2>/dev/null || true); \
                   if [ -n \"$perm_mode\" ]; then chmod -- \"$perm_mode\" \"$staged\" 2>/dev/null || true; fi; \
                   if [ -n \"$perm_owner\" ]; then chown -- \"$perm_owner\" \"$staged\" 2>/dev/null || true; fi; \
                 fi; \
                 mv -f -- \"$staged\" \"$target\"",
                target = shell_single_quote(remote_path),
                user_temp = shell_single_quote(&temp_path),
                root_temp = shell_single_quote(&root_temp_template),
                backup_clause = backup_clause,
            );
            // LC_ALL=C 让 sudo 自身的提示信息走英文，is_sudo_auth_error 字符串匹配才能稳定命中。
            // sudo 默认会 reset env，所以 LC_ALL=C 只作用于 sudo 进程本身（这正是我们想要的）。
            let command = format!("LC_ALL=C sudo -S -p '' sh -c {}", shell_single_quote(&script));
            let stdin_bytes = format!("{}\n", resolved_sudo_password).into_bytes();

            let exec_result = {
                let sess = session.lock().await;
                sess.exec_command_with_stdin_detailed(&command, Some(stdin_bytes.as_slice()))
                    .await
                    .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?
            };

            let combined_output = format!("{}\n{}", exec_result.stderr, exec_result.stdout);
            if exec_result.exit_code.unwrap_or(1) != 0 {
                if is_sudo_auth_error(&combined_output) {
                    anyhow::bail!("SUDO_AUTH_FAILED");
                }
                anyhow::bail!("FILE_WRITE_FAILED");
            }

            Ok::<Option<String>, anyhow::Error>(backup_path)
        }
        .await;

        cleanup_remote_file(&sftp, &temp_path).await;

        let backup_path = write_result?;

        let updated = sftp
            .metadata(remote_path)
            .await
            .map_err(|_| anyhow::anyhow!("FILE_WRITE_FAILED"))?;

        Ok(PrivilegedWriteTextResult {
            success: true,
            size: updated.len(),
            mtime: updated.modified().map(systemtime_to_epoch).unwrap_or(current_mtime),
            hash: sha256_hex(content.as_bytes()),
            backup_path,
        })
    }

    /// Start an upload task (returns task ID immediately, runs in background)
    pub fn start_upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> String {
        let task_id = Uuid::new_v4().to_string();

        // Get local file size
        let total_bytes = match std::fs::metadata(local_path) {
            Ok(m) => m.len(),
            Err(e) => {
                tracing::warn!("start_upload: std::fs::metadata failed for '{}': {}", local_path, e);
                0
            }
        };

        let task = TransferTask {
            id: task_id.clone(),
            session_id: session_id.to_string(),
            direction: TransferDirection::Upload,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            state: TransferState::Queued,
            total_bytes,
            transferred_bytes: 0,
            speed_bytes_per_sec: 0,
            error: None,
        };

        self.tasks.lock().insert(task_id.clone(), task);
        task_id
    }

    /// Start a download task (returns task ID immediately, runs in background)
    pub fn start_download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        remote_size: u64,
    ) -> String {
        let task_id = Uuid::new_v4().to_string();

        let task = TransferTask {
            id: task_id.clone(),
            session_id: session_id.to_string(),
            direction: TransferDirection::Download,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            state: TransferState::Queued,
            total_bytes: remote_size,
            transferred_bytes: 0,
            speed_bytes_per_sec: 0,
            error: None,
        };

        self.tasks.lock().insert(task_id.clone(), task);
        task_id
    }

    /// Execute an upload: reads local file, writes to SFTP remote
    pub async fn execute_upload(
        &self,
        session_mgr: &SessionManager,
        app: &tauri::AppHandle,
        task_id: &str,
        chunk_size: usize,
        timeout_secs: u64,
    ) -> anyhow::Result<()> {
        tracing::info!("execute_upload: timeout_secs={}, chunk_size={}", timeout_secs, chunk_size);
        // Mark as running
        {
            let mut tasks = self.tasks.lock();
            if let Some(task) = tasks.get_mut(task_id) {
                task.state = TransferState::Running;
            }
        }

        let (session_id, local_path, remote_path) = {
            let tasks = self.tasks.lock();
            let task = tasks
                .get(task_id)
                .ok_or_else(|| anyhow::anyhow!("Task not found"))?;
            (
                task.session_id.clone(),
                task.local_path.clone(),
                task.remote_path.clone(),
            )
        };

        tracing::info!("execute_upload: session_id={}, is_connected={}", session_id, session_mgr.is_connected(&session_id));
        session_mgr.touch_activity(&session_id);

        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // Get file size without reading the entire file into memory
        let file_metadata = tokio::fs::metadata(&local_path).await?;
        let total = file_metadata.len();
        tracing::info!("execute_upload: file size={}", total);

        // Update total_bytes and emit initial progress event
        {
            let mut tasks = self.tasks.lock();
            if let Some(task) = tasks.get_mut(task_id) {
                task.total_bytes = total;
            }
        }
        event::emit_transfer_progress(app, task_id, 0, total, 0);

        // Track start time for speed calculation
        let start_time = std::time::Instant::now();

        // Init SFTP session (short lock)
        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };

        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut local_file = tokio::fs::File::open(&local_path).await?;
        let mut remote_file = sftp.create(&remote_path).await?;

        // Stream in chunks — symmetric with download logic
        let mut buf = vec![0u8; chunk_size];
        let mut transferred: u64 = 0;
        let mut last_emit_time = std::time::Instant::now();

        loop {
            // Check for cancellation (single lock)
            let was_canceled = {
                let mut set = self.canceled.lock();
                set.remove(task_id)
            };
            if was_canceled {
                self.update_task_state(task_id, TransferState::Canceled, None);
                return Ok(());
            }

            // Read a chunk from local file
            let n = if timeout_secs > 0 {
                match tokio::time::timeout(
                    Duration::from_secs(timeout_secs),
                    local_file.read(&mut buf),
                ).await {
                    Ok(Ok(n)) => n,
                    Ok(Err(e)) => return Err(anyhow::anyhow!("Local read failed: {}", e)),
                    Err(_) => {
                        self.update_task_state(task_id, TransferState::Failed, Some("Transfer timeout".to_string()));
                        return Err(anyhow::anyhow!("Transfer timeout after {} seconds", timeout_secs));
                    }
                }
            } else {
                local_file.read(&mut buf).await?
            };

            if n == 0 {
                break;
            }

            // Write chunk to remote file
            let write_result = if timeout_secs > 0 {
                tokio::time::timeout(
                    Duration::from_secs(timeout_secs),
                    remote_file.write_all(&buf[..n]),
                ).await
            } else {
                Ok(remote_file.write_all(&buf[..n]).await)
            };

            match write_result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(anyhow::anyhow!("Write failed: {}", e)),
                Err(_) => {
                    self.update_task_state(task_id, TransferState::Failed, Some("Transfer timeout".to_string()));
                    return Err(anyhow::anyhow!("Transfer timeout after {} seconds", timeout_secs));
                }
            }

            transferred += n as u64;
            session_mgr.touch_activity(&session_id);

            // Emit progress every ~200ms for smooth UI, plus first and last chunk
            if transferred >= total || last_emit_time.elapsed() >= Duration::from_millis(200) {
                last_emit_time = std::time::Instant::now();
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    (transferred as f64 / elapsed) as u64
                } else {
                    0
                };
                event::emit_transfer_progress(app, task_id, transferred, total, speed);
                tracing::debug!("[PROGRESS] transferred={}, total={}, speed={}", transferred, total, speed);
                {
                    let mut tasks = self.tasks.lock();
                    if let Some(task) = tasks.get_mut(task_id) {
                        task.transferred_bytes = transferred;
                        task.total_bytes = total;
                        task.speed_bytes_per_sec = speed;
                    }
                }
            }
        }

        remote_file.shutdown().await?;

        self.update_task_state(task_id, TransferState::Completed, None);
        Ok(())
    }

    /// Execute a download: reads from SFTP remote, writes to local file
    pub async fn execute_download(
        &self,
        session_mgr: &SessionManager,
        app: &tauri::AppHandle,
        task_id: &str,
        chunk_size: usize,
        timeout_secs: u64,
    ) -> anyhow::Result<()> {
        // Mark as running
        {
            let mut tasks = self.tasks.lock();
            if let Some(task) = tasks.get_mut(task_id) {
                task.state = TransferState::Running;
            }
        }

        let (session_id, local_path, remote_path) = {
            let tasks = self.tasks.lock();
            let task = tasks
                .get(task_id)
                .ok_or_else(|| anyhow::anyhow!("Task not found"))?;
            (
                task.session_id.clone(),
                task.local_path.clone(),
                task.remote_path.clone(),
            )
        };

        // Defensive: reject empty remote paths
        if remote_path.is_empty() {
            self.update_task_state(task_id, TransferState::Failed, Some("Remote path is empty — please try again".to_string()));
            return Err(anyhow::anyhow!("Remote path is empty"));
        }

        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        session_mgr.touch_activity(&session_id);

        // Init SFTP session (short lock)
        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };
        // Lock released here — sftp is an independent session

        let metadata = sftp.metadata(&remote_path).await?;

        // Directories cannot be downloaded as single files — they must use batch download
        if metadata.file_type().is_dir() {
            self.update_task_state(task_id, TransferState::Failed, Some("Cannot download directory as file".to_string()));
            return Err(anyhow::anyhow!("Cannot download directory '{}' as a single file — use batch download", remote_path));
        }

        let total = metadata.len();

        // Verify the local parent directory is writable before attempting download.
        let parent: std::path::PathBuf = PathBuf::from(&local_path).parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        if !parent.exists() {
            if let Err(e) = tokio::fs::create_dir_all(&parent).await {
                let msg = format!("Cannot create local directory '{}': {}", parent.display(), e);
                self.update_task_state(task_id, TransferState::Failed, Some(msg.clone()));
                return Err(anyhow::anyhow!("{}", msg));
            }
        }
        // Try to write a zero-byte probe file to verify writability.
        let probe_path = parent.join(".write_probe_tmp");
        if tokio::fs::write(&probe_path, b"").await.is_err() {
            let msg = format!(
                "Local directory '{}' is not writable. Please check your transfer.downloadPath setting.",
                parent.display()
            );
            self.update_task_state(task_id, TransferState::Failed, Some(msg.clone()));
            return Err(anyhow::anyhow!("{}", msg));
        }
        let _ = tokio::fs::remove_file(&probe_path).await;

        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut remote_file = sftp.open(&remote_path).await?;

        tracing::info!("execute_download: local_path={}", local_path);
        // Use configurable buffer size for streaming transfer
        let mut buf = vec![0u8; chunk_size];
        let mut local_file = tokio::fs::File::create(&local_path).await?;
        let mut transferred: u64 = 0;

        // Track start time for speed calculation
        let start_time = std::time::Instant::now();
        let mut last_emit_time = std::time::Instant::now();

        loop {
            // Check for cancellation (single lock)
            let was_canceled = {
                let mut set = self.canceled.lock();
                set.remove(task_id)
            };
            if was_canceled {
                self.update_task_state(task_id, TransferState::Canceled, None);
                let _ = tokio::fs::remove_file(&local_path).await;
                return Ok(());
            }

            // Apply timeout to read operation
            let n = if timeout_secs > 0 {
                match tokio::time::timeout(
                    Duration::from_secs(timeout_secs),
                    remote_file.read(&mut buf)
                ).await {
                    Ok(Ok(n)) => n,
                    Ok(Err(e)) => return Err(anyhow::anyhow!("Read failed: {}", e)),
                    Err(_) => {
                        self.update_task_state(task_id, TransferState::Failed, Some("Transfer timeout".to_string()));
                        let _ = tokio::fs::remove_file(&local_path).await;
                        return Err(anyhow::anyhow!("Transfer timeout after {} seconds", timeout_secs));
                    }
                }
            } else {
                remote_file.read(&mut buf).await?
            };

            if n == 0 {
                break;
            }

            // Write directly to file (streaming) - no additional timeout per write
            local_file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            session_mgr.touch_activity(&session_id);

            // Emit progress every ~200ms for smooth UI, plus last chunk
            if transferred >= total || last_emit_time.elapsed() >= Duration::from_millis(200) {
                last_emit_time = std::time::Instant::now();
                // Calculate speed and update progress
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    (transferred as f64 / elapsed) as u64
                } else {
                    0
                };
                event::emit_transfer_progress(app, task_id, transferred, total, speed);
                tracing::debug!("[DOWNLOAD PROGRESS] transferred={}, total={}, speed={}", transferred, total, speed);
                {
                    let mut tasks = self.tasks.lock();
                    if let Some(task) = tasks.get_mut(task_id) {
                        task.transferred_bytes = transferred;
                        task.total_bytes = total;
                        task.speed_bytes_per_sec = speed;
                    }
                }
            }
        }

        // Flush the file to ensure all data is written
        local_file.flush().await?;
        drop(local_file);

        self.update_task_state(task_id, TransferState::Completed, None);
        Ok(())
    }

    /// Cancel a transfer task
    pub fn cancel_task(&self, task_id: &str) {
        self.canceled.lock().insert(task_id.to_string());
    }

    /// Get the current state of a transfer task
    pub fn get_task(&self, task_id: &str) -> Option<TransferTask> {
        self.tasks.lock().get(task_id).cloned()
    }

    /// List all transfer tasks
    pub fn list_tasks(&self) -> Vec<TransferTask> {
        self.tasks.lock().values().cloned().collect()
    }

    /// Remove completed/failed/canceled tasks from the list
    pub fn clear_finished_tasks(&self) {
        let mut tasks = self.tasks.lock();
        tasks.retain(|_, t| {
            t.state != TransferState::Completed
                && t.state != TransferState::Failed
                && t.state != TransferState::Canceled
        });
    }

    /// Remove a single task by id
    pub fn remove_task(&self, task_id: &str) {
        self.tasks.lock().remove(task_id);
    }

    fn update_task_state(
        &self,
        task_id: &str,
        state: TransferState,
        error: Option<String>,
    ) {
        let mut tasks = self.tasks.lock();
        if let Some(task) = tasks.get_mut(task_id) {
            task.state = state;
            task.error = error;
        }
    }

    /// Mark a task as failed
    pub fn mark_failed(&self, task_id: &str, error: String) {
        self.update_task_state(task_id, TransferState::Failed, Some(error));
    }

    /// Reset transferred bytes to 0 for retry
    pub fn reset_task_progress(&self, task_id: &str) {
        let mut tasks = self.tasks.lock();
        if let Some(task) = tasks.get_mut(task_id) {
            task.transferred_bytes = 0;
            task.speed_bytes_per_sec = 0;
            task.state = TransferState::Queued;
            task.error = None;
        }
    }
}
