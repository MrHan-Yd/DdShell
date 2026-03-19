use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use uuid::Uuid;

use crate::core::ssh::SessionManager;
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

        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        // Read local file
        tracing::info!("execute_upload: reading local file: {}", local_path);
        let local_data = tokio::fs::read(&local_path).await?;
        let total = local_data.len() as u64;
        tracing::info!("execute_upload: file read, size={}", total);

        // Update total_bytes BEFORE releasing the lock — progress reporter reads from
        // this map and must see the correct value before any event is emitted.
        {
            let mut tasks = self.tasks.lock();
            if let Some(task) = tasks.get_mut(task_id) {
                task.total_bytes = total;
            }
        }

        // Track start time for speed calculation
        let start_time = std::time::Instant::now();

        // Init SFTP session (short lock)
        tracing::info!("execute_upload: initializing SFTP");
        let sftp = {
            let sess = session.lock().await;
            sess.init_sftp().await?
        };
        // Lock released here — sftp is an independent session
        tracing::info!("execute_upload: SFTP initialized, creating remote file");

        use tokio::io::AsyncWriteExt;
        let mut remote_file = sftp.create(&remote_path).await?;
        tracing::info!("execute_upload: remote file created, starting upload");

        // Transfer in chunks with configurable size and timeout
        let mut transferred: u64 = 0;

        for (chunk_idx, chunk) in local_data.chunks(chunk_size).enumerate() {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
                return Ok(());
            }

            // Log first few chunks only
            if chunk_idx < 3 {
                tracing::info!("execute_upload: writing chunk {}, size={}", chunk_idx, chunk.len());
            }

            // Apply timeout to each chunk write
            let write_result = if timeout_secs > 0 {
                tokio::time::timeout(
                    Duration::from_secs(timeout_secs),
                    remote_file.write_all(chunk)
                ).await
            } else {
                match remote_file.write_all(chunk).await {
                    Ok(()) => Ok(Ok(())),
                    Err(e) => Ok(Err(e)),
                }
            };

            match write_result {
                Ok(Ok(())) => {
                    if chunk_idx < 3 {
                        tracing::info!("execute_upload: chunk {} done", chunk_idx);
                    }
                }
                Ok(Err(e)) => return Err(anyhow::anyhow!("Write failed: {}", e)),
                Err(_) => {
                    self.update_task_state(task_id, TransferState::Failed, Some("Transfer timeout".to_string()));
                    return Err(anyhow::anyhow!("Transfer timeout after {} seconds", timeout_secs));
                }
            }

            transferred += chunk.len() as u64;

            // Update progress and emit event
            let chunk_len = chunk.len() as u64;
            let should_emit = transferred == chunk_len || transferred == total || transferred % (1024 * 1024) < chunk_len;
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                (transferred as f64 / elapsed) as u64
            } else {
                0
            };
            if should_emit {
                event::emit_transfer_progress(app, task_id, transferred, total, speed);
            }
            {
                let mut tasks = self.tasks.lock();
                if let Some(task) = tasks.get_mut(task_id) {
                    task.transferred_bytes = transferred;
                    task.total_bytes = total;
                    task.speed_bytes_per_sec = speed;
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

        loop {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
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

            // Calculate speed and update progress
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                (transferred as f64 / elapsed) as u64
            } else {
                0
            };

            // Emit progress event periodically (every 1MB)
            if transferred == n as u64 || transferred >= total || transferred % (1024 * 1024) < buf.len() as u64 {
                event::emit_transfer_progress(app, task_id, transferred, total, speed);
            }

            {
                let mut tasks = self.tasks.lock();
                if let Some(task) = tasks.get_mut(task_id) {
                    task.transferred_bytes = transferred;
                    task.total_bytes = total;
                    task.speed_bytes_per_sec = speed;
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
