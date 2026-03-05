use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use uuid::Uuid;

use crate::core::ssh::SessionManager;

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
    pub fn list_dir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<Vec<FileEntry>> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        let entries = sftp.readdir(std::path::Path::new(remote_path))?;

        let mut result = Vec::new();
        for (path, stat) in entries {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }

            let file_type = if stat.is_dir() {
                "dir"
            } else if stat.file_type().is_symlink() {
                "symlink"
            } else {
                "file"
            };

            result.push(FileEntry {
                name,
                file_type: file_type.to_string(),
                size: stat.size.unwrap_or(0),
                mtime: stat.mtime.unwrap_or(0) as i64,
                permissions: stat.perm.unwrap_or(0),
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
    pub fn mkdir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        sftp.mkdir(std::path::Path::new(remote_path), 0o755)?;
        Ok(())
    }

    /// Remove file on remote host
    pub fn remove_file(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        sftp.unlink(std::path::Path::new(remote_path))?;
        Ok(())
    }

    /// Remove directory on remote host
    pub fn remove_dir(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        sftp.rmdir(std::path::Path::new(remote_path))?;
        Ok(())
    }

    /// Rename file/dir on remote host
    pub fn rename(
        session_mgr: &SessionManager,
        session_id: &str,
        old_path: &str,
        new_path: &str,
    ) -> anyhow::Result<()> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        sftp.rename(
            std::path::Path::new(old_path),
            std::path::Path::new(new_path),
            None,
        )?;
        Ok(())
    }

    /// Get stat info for a remote path
    pub fn stat(
        session_mgr: &SessionManager,
        session_id: &str,
        remote_path: &str,
    ) -> anyhow::Result<FileEntry> {
        let session = session_mgr
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let sess = session.lock();
        let sftp = sess.sftp()?;
        let stat = sftp.stat(std::path::Path::new(remote_path))?;

        let name = std::path::Path::new(remote_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.to_string());

        let file_type = if stat.is_dir() {
            "dir"
        } else if stat.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };

        Ok(FileEntry {
            name,
            file_type: file_type.to_string(),
            size: stat.size.unwrap_or(0),
            mtime: stat.mtime.unwrap_or(0) as i64,
            permissions: stat.perm.unwrap_or(0),
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
    pub fn execute_upload(
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
        let mut local_file = std::fs::File::open(&local_path)?;
        let metadata = local_file.metadata()?;
        let total = metadata.len();

        // Open remote file for writing
        let sess = session.lock();
        let sftp = sess.sftp()?;
        let mut remote_file = sftp.create(std::path::Path::new(&remote_path))?;

        // Transfer in chunks
        let mut buf = vec![0u8; 32768];
        let mut transferred: u64 = 0;

        loop {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
                return Ok(());
            }

            let n = local_file.read(&mut buf)?;
            if n == 0 {
                break;
            }

            remote_file.write_all(&buf[..n])?;
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

        self.update_task_state(task_id, TransferState::Completed, None);
        Ok(())
    }

    /// Execute a download: reads from SFTP remote, writes to local file
    pub fn execute_download(
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

        // Open remote file
        let sess = session.lock();
        let sftp = sess.sftp()?;
        let stat = sftp.stat(std::path::Path::new(&remote_path))?;
        let total = stat.size.unwrap_or(0);
        let mut remote_file = sftp.open(std::path::Path::new(&remote_path))?;

        // Ensure local parent dir exists
        if let Some(parent) = PathBuf::from(&local_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut local_file = std::fs::File::create(&local_path)?;

        // Transfer in chunks
        let mut buf = vec![0u8; 32768];
        let mut transferred: u64 = 0;

        loop {
            // Check for cancellation
            if self.canceled.lock().contains(task_id) {
                self.update_task_state(task_id, TransferState::Canceled, None);
                self.canceled.lock().remove(task_id);
                // Clean up partial file
                let _ = std::fs::remove_file(&local_path);
                return Ok(());
            }

            let n = remote_file.read(&mut buf)?;
            if n == 0 {
                break;
            }

            local_file.write_all(&buf[..n])?;
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
