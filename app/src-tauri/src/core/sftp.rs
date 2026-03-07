use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use uuid::Uuid;

use crate::core::ssh::SessionManager;

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
    pub error: Option<String>,
}

/// Manages SFTP operations and transfer tasks
#[derive(Clone)]
pub struct SftpManager {
    tasks: Arc<Mutex<HashMap<String, TransferTask>>>,
    canceled: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            canceled: Arc::new(Mutex::new(std::collections::HashSet::new())),
        }
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

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
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

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
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

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
        sftp.remove_file(remote_path).await?;
        Ok(())
    }

    /// Remove directory on remote host
    pub async fn remove_dir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
        sftp.remove_dir(remote_path).await?;
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

        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;
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

    /// Start an upload task (returns task ID immediately, runs in background)
    pub fn start_upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> String {
        let task_id = Uuid::new_v4().to_string();

        // Get local file size
        let total_bytes = std::fs::metadata(local_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let task = TransferTask {
            id: task_id.clone(),
            session_id: session_id.to_string(),
            direction: TransferDirection::Upload,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            state: TransferState::Queued,
            total_bytes,
            transferred_bytes: 0,
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
            error: None,
        };

        self.tasks.lock().insert(task_id.clone(), task);
        task_id
    }

    /// Execute an upload: reads local file, writes to SFTP remote
    pub async fn execute_upload(
        &self,
        session_mgr: &SessionManager,
        task_id: &str,
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

        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // Read local file
        let local_data = tokio::fs::read(&local_path).await?;
        let total = local_data.len() as u64;

        // Open SFTP and write remote file
        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;

        use tokio::io::AsyncWriteExt;
        let mut remote_file = sftp.create(&remote_path).await?;

        // Transfer in chunks
        let chunk_size = 32768;
        let mut transferred: u64 = 0;

        for chunk in local_data.chunks(chunk_size) {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
                return Ok(());
            }

            remote_file.write_all(chunk).await?;
            transferred += chunk.len() as u64;

            // Update progress
            {
                let mut tasks = self.tasks.lock();
                if let Some(task) = tasks.get_mut(task_id) {
                    task.transferred_bytes = transferred;
                    task.total_bytes = total;
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
        task_id: &str,
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

        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // Open remote file via SFTP
        let sess = session.lock().await;
        let sftp = sess.init_sftp().await?;

        let metadata = sftp.metadata(&remote_path).await?;
        let total = metadata.len();

        use tokio::io::AsyncReadExt;
        let mut remote_file = sftp.open(&remote_path).await?;

        // Ensure local parent dir exists
        if let Some(parent) = PathBuf::from(&local_path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut local_data = Vec::new();
        let mut buf = vec![0u8; 32768];
        let mut transferred: u64 = 0;

        loop {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
                let _ = tokio::fs::remove_file(&local_path).await;
                return Ok(());
            }

            let n = remote_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }

            local_data.extend_from_slice(&buf[..n]);
            transferred += n as u64;

            // Update progress
            {
                let mut tasks = self.tasks.lock();
                if let Some(task) = tasks.get_mut(task_id) {
                    task.transferred_bytes = transferred;
                    task.total_bytes = total;
                }
            }
        }

        tokio::fs::write(&local_path, &local_data).await?;

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
}
