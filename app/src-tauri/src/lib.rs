mod core;

use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};


use crate::core::command_assist::CommandAssistEngine;
use crate::core::event;
use crate::core::metrics::MetricsManager;
use crate::core::sftp::SftpManager;
use crate::core::ssh::SessionManager;
use crate::core::store::Database;

// ── Request / Response types ──///

/// Deserialize a doubly-optional field:
/// - absent in JSON → None (don't update)
/// - present as null → Some(None) (set to NULL)
/// - present as "value" → Some(Some("value"))
fn deserialize_optional_field<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateHostReq {
    name: String,
    host: String,
    port: i64,
    username: String,
    auth_type: String,
    group_id: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateHostReq {
    id: String,
    name: Option<String>,
    host: Option<String>,
    port: Option<i64>,
    username: Option<String>,
    auth_type: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    group_id: Option<Option<String>>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    secret_ref: Option<Option<String>>,
    password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdResponse {
    id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessResponse {
    success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthPayload {
    status: String,
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionConnectReq {
    host_id: String,
    password: Option<String>,
    cols: Option<u32>,
    rows: Option<u32>,
}

// ── Commands: Health ──

#[tauri::command]
fn app_health() -> HealthPayload {
    HealthPayload {
        status: "ok".to_string(),
        message: "shell core initialized".to_string(),
    }
}

// ── Commands: Connection CRUD ──

#[tauri::command]
async fn connection_create(
    db: tauri::State<'_, Database>,
    req: CreateHostReq,
) -> Result<IdResponse, String> {
    // Encrypt password before storing
    let encrypted = req.password.as_deref()
        .filter(|p| !p.is_empty())
        .map(|p| core::secret::encrypt(p))
        .transpose()
        .map_err(|e| e.to_string())?;

    let id = db
        .create_host(
            &req.name,
            &req.host,
            req.port,
            &req.username,
            &req.auth_type,
            req.group_id.as_deref(),
            encrypted.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(IdResponse { id })
}

#[tauri::command]
async fn connection_update(
    db: tauri::State<'_, Database>,
    req: UpdateHostReq,
) -> Result<SuccessResponse, String> {
    // If password provided, encrypt and store in secret_ref column
    let secret_ref = if let Some(ref pw) = req.password {
        if pw.is_empty() {
            Some(None) // clear password
        } else {
            let encrypted = core::secret::encrypt(pw).map_err(|e| e.to_string())?;
            Some(Some(encrypted))
        }
    } else {
        req.secret_ref.clone()
    };

    db.update_host(
        &req.id,
        req.name.as_deref(),
        req.host.as_deref(),
        req.port,
        req.username.as_deref(),
        req.auth_type.as_deref(),
        req.group_id.as_ref().map(|g| g.as_deref()),
        req.is_favorite,
        req.sort_order,
        secret_ref.as_ref().map(|s| s.as_deref()),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn connection_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_host(&id).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn connection_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::Host>, String> {
    db.list_hosts().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn connection_get(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<core::store::Host, String> {
    db.get_host(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Host not found".to_string())
}

// ── Commands: Group ──

#[tauri::command]
async fn group_create(
    db: tauri::State<'_, Database>,
    name: String,
    parent_id: Option<String>,
) -> Result<IdResponse, String> {
    let id = db
        .create_group(&name, parent_id.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn group_update(
    db: tauri::State<'_, Database>,
    id: String,
    name: String,
) -> Result<SuccessResponse, String> {
    db.update_group(&id, &name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn group_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_group(&id).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn group_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::HostGroup>, String> {
    db.list_groups().await.map_err(|e| e.to_string())
}

// ── Commands: Snippet ──

#[tauri::command]
async fn snippet_create(
    db: tauri::State<'_, Database>,
    title: String,
    command: String,
    description: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<IdResponse, String> {
    let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
    let id = db
        .create_snippet(&title, &command, description.as_deref(), tags_json.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn snippet_update(
    db: tauri::State<'_, Database>,
    id: String,
    title: Option<String>,
    command: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<SuccessResponse, String> {
    let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
    db.update_snippet(
        &id,
        title.as_deref(),
        command.as_deref(),
        Some(description.as_deref()),
        Some(tags_json.as_deref()),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn snippet_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_snippet(&id).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn snippet_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::Snippet>, String> {
    db.list_snippets().await.map_err(|e| e.to_string())
}

// ── Commands: Settings ──

// ── Commands: Command Assist ──

#[tauri::command]
async fn command_assist_search(
    engine: tauri::State<'_, std::sync::Arc<CommandAssistEngine>>,
    query: String,
    os_type: Option<String>,
    page: Option<u32>,
) -> Result<core::command_assist::SearchResult, String> {
    let result = engine
        .search(&query, os_type.as_deref(), page.unwrap_or(0))
        .await;
    Ok(result)
}

#[tauri::command]
async fn command_assist_weight_update(
    engine: tauri::State<'_, std::sync::Arc<CommandAssistEngine>>,
    key: String,
) -> Result<SuccessResponse, String> {
    engine
        .update_weight(&key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn command_assist_weight_reset(
    engine: tauri::State<'_, std::sync::Arc<CommandAssistEngine>>,
) -> Result<SuccessResponse, String> {
    engine
        .reset_weights()
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn command_assist_rebuild_index(
    db: tauri::State<'_, Database>,
    engine: tauri::State<'_, std::sync::Arc<CommandAssistEngine>>,
    locale: String,
    enabled_app_categories: Option<Vec<String>>,
) -> Result<SuccessResponse, String> {
    let snippets = db.list_snippets().await.map_err(|e| e.to_string())?;
    engine
        .rebuild_index(&snippets, &locale, &enabled_app_categories.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn command_assist_get_all(
    engine: tauri::State<'_, std::sync::Arc<CommandAssistEngine>>,
) -> Result<Vec<core::command_assist::CandidateItem>, String> {
    Ok(engine.get_all().await)
}

// ── Commands: Settings ──

#[tauri::command]
async fn setting_get(
    db: tauri::State<'_, Database>,
    key: String,
) -> Result<Option<String>, String> {
    db.get_setting(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn setting_set(
    db: tauri::State<'_, Database>,
    key: String,
    value: String,
) -> Result<SuccessResponse, String> {
    db.set_setting(&key, &value)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

// ── Commands: SSH Session ──

#[tauri::command]
async fn session_connect(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    mgr: tauri::State<'_, SessionManager>,
    req: SessionConnectReq,
) -> Result<IdResponse, String> {
    let cols = req.cols.unwrap_or(120);
    let rows = req.rows.unwrap_or(40);

    // Resolve password: use provided password or decrypt from DB (secret_ref column)
    let password = match req.password {
        Some(pw) if !pw.is_empty() => pw,
        _ => {
            let host = db.get_host(&req.host_id).await.map_err(|e| e.to_string())?
                .ok_or_else(|| "Host not found".to_string())?;
            let encrypted = host.secret_ref
                .ok_or_else(|| "No saved password".to_string())?;
            core::secret::decrypt(&encrypted)
                .map_err(|e| format!("Failed to decrypt password: {}", e))?
        }
    };

    event::emit_session_state(&app, "", "connecting");

    let timeout_secs = db
        .get_setting("session.keepAlive")
        .await
        .unwrap_or(None)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(30);

    let encoding = db
        .get_setting("terminal.encoding")
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| "utf-8".to_string());

    let (session_id, channel, cmd_rx) = mgr
        .connect(&db, &req.host_id, &password, cols, rows, timeout_secs)
        .await
        .map_err(|e| e.to_string())?;

    // Set encoding on the session
    if let Some(session) = mgr.get(&session_id) {
        session.lock().await.encoding = encoding.clone();
    }

    event::emit_session_state(&app, &session_id, "connected");

    // Spawn async output reader loop — channel is owned exclusively by the reader
    let sid = session_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        output_reader_loop(app_handle, channel, cmd_rx, &sid, encoding).await;
    });

    Ok(IdResponse { id: session_id })
}

#[tauri::command]
async fn session_disconnect(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<SuccessResponse, String> {
    mgr.disconnect(&session_id).await.map_err(|e| e.to_string())?;
    event::emit_session_state(&app, &session_id, "disconnected");
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn session_write(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<SuccessResponse, String> {
    let session = mgr
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let session_guard = session.lock().await;
    let encoding_name = session_guard.encoding.clone();

    let write_data = if encoding_name.eq_ignore_ascii_case("utf-8") || encoding_name.eq_ignore_ascii_case("utf8") {
        data
    } else {
        let encoding = encoding_rs::Encoding::for_label(encoding_name.as_bytes())
            .ok_or_else(|| format!("Unsupported encoding: {}", encoding_name))?;
        let utf8_str = String::from_utf8_lossy(&data);
        let (encoded, _, _) = encoding.encode(&utf8_str);
        encoded.into_owned()
    };

    session_guard
        .write_input(&write_data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn session_resize(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<SuccessResponse, String> {
    let session = mgr
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    session
        .lock()
        .await
        .resize(cols, rows)
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

// ── Commands: SFTP ──

#[tauri::command]
async fn sftp_list_dir(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
) -> Result<Vec<core::sftp::FileEntry>, String> {
    // Check if session is still connected
    if !mgr.is_connected(&session_id) {
        return Err("Session disconnected".to_string());
    }
    SftpManager::list_dir(&mgr, &session_id, &remote_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_mkdir(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
) -> Result<SuccessResponse, String> {
    // Check if session is still connected
    if !mgr.is_connected(&session_id) {
        return Err("Session disconnected".to_string());
    }
    SftpManager::mkdir(&mgr, &session_id, &remote_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_remove(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
    is_dir: bool,
) -> Result<SuccessResponse, String> {
    // Check if session is still connected
    if !mgr.is_connected(&session_id) {
        return Err("Session disconnected".to_string());
    }

    if is_dir {
        SftpManager::remove_dir(&mgr, &session_id, &remote_path)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        SftpManager::remove_file(&mgr, &session_id, &remote_path)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_rename(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<SuccessResponse, String> {
    // Check if session is still connected
    if !mgr.is_connected(&session_id) {
        return Err("Session disconnected".to_string());
    }
    SftpManager::rename(&mgr, &session_id, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_transfer_start(
    app: tauri::AppHandle,
    session_mgr: tauri::State<'_, SessionManager>,
    sftp_mgr: tauri::State<'_, SftpManager>,
    db: tauri::State<'_, Database>,
    session_id: String,
    direction: String,
    local_path: String,
    remote_path: String,
    sub_path: Option<String>,
) -> Result<IdResponse, String> {
    // Validate remote_path
    if remote_path.is_empty() {
        return Err("Remote path is empty — please navigate to a directory first".to_string());
    }

    let is_upload = direction == "upload";

    // Resolve local path for download: use setting or system default download dir
    let resolved_local_path = if is_upload || !local_path.is_empty() {
        local_path.clone()
    } else {
        // Get download path from settings or use system default.
        // Empty string is treated as "not set" — fall back to system default.
        let default_download = dirs::download_dir()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|p| p.join("Downloads"))
                    .unwrap_or_default()
            });
        tracing::info!("default_download resolved to: {:?}", default_download);

        let download_dir: PathBuf = db
            .get_setting("transfer.downloadPath")
            .await
            .unwrap_or(None)
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or(default_download);

        if let Some(sub) = sub_path.as_deref().filter(|s| !s.is_empty()) {
            // Directory download: preserve sub-path structure under download_dir
            download_dir.join(sub).to_string_lossy().into_owned()
        } else {
            // Single file download: use remote filename
            let filename = std::path::Path::new(&remote_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("download");
            download_dir.join(filename).to_string_lossy().into_owned()
        }
    };

    tracing::info!("sftp_transfer_start: direction={}, resolved_local_path={}", direction, resolved_local_path);
    let task_id = if is_upload {
        sftp_mgr.start_upload(&session_id, &resolved_local_path, &remote_path)
    } else {
        // Get remote file size for download progress
        let remote_size = SftpManager::stat(&session_mgr, &session_id, &remote_path)
            .await
            .map(|e| e.size)
            .unwrap_or(0);
        sftp_mgr.start_download(&session_id, &remote_path, &resolved_local_path, remote_size)
    };

    // Get chunk size from settings (default 256KB)
    let chunk_size: usize = db
        .get_setting("transfer.chunkSize")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(256))
        .unwrap_or(256)
        * 1024; // Convert KB to bytes

    // Get timeout from settings (default 300 seconds)
    let timeout_secs: u64 = db
        .get_setting("transfer.timeout")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(300))
        .unwrap_or(300);

    // Get retry count from settings (default 3)
    let retry_count: u32 = db
        .get_setting("transfer.retryCount")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(3))
        .unwrap_or(3);

    // Spawn background transfer with semaphore-based concurrency control
    let sem = sftp_mgr.concurrency_semaphore();

    // Spawn background transfer with semaphore-based concurrency control
    let sftp_mgr_clone = sftp_mgr.inner().clone();
    let session_mgr_clone = session_mgr.inner().clone();
    let tid = task_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        // Acquire permit (waits if at max concurrency — enables queuing)
        let _permit = sem.acquire().await.unwrap();

        let mut attempts = 0;
        let mut last_error = None;

        while attempts <= retry_count {
            attempts += 1;

            let result = if is_upload {
                sftp_mgr_clone.execute_upload(&session_mgr_clone, &app_handle, &tid, chunk_size, timeout_secs).await
            } else {
                sftp_mgr_clone.execute_download(&session_mgr_clone, &app_handle, &tid, chunk_size, timeout_secs).await
            };

            match result {
                Ok(()) => {
                    if let Some(task) = sftp_mgr_clone.get_task(&tid) {
                        if task.state == core::sftp::TransferState::Completed {
                            event::emit_transfer_completed(&app_handle, &tid);
                        }
                    }
                    break;
                }
                Err(e) => {
                    last_error = Some(e.to_string());
                    if attempts <= retry_count {
                        sftp_mgr_clone.reset_task_progress(&tid);
                        // Retry after delay
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }

        // If all retries failed, mark as failed
        if let Some(error) = last_error {
            if attempts > retry_count {
                sftp_mgr_clone.mark_failed(&tid, error.clone());
                event::emit_transfer_failed(&app_handle, &tid, &error);
            }
        }
    });

    Ok(IdResponse { id: task_id })
}

#[tauri::command]
async fn sftp_transfer_cancel(
    sftp_mgr: tauri::State<'_, SftpManager>,
    task_id: String,
) -> Result<SuccessResponse, String> {
    sftp_mgr.cancel_task(&task_id);
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_transfer_list(
    sftp_mgr: tauri::State<'_, SftpManager>,
) -> Result<Vec<core::sftp::TransferTask>, String> {
    Ok(sftp_mgr.list_tasks())
}

#[tauri::command]
async fn sftp_transfer_remove(
    sftp_mgr: tauri::State<'_, SftpManager>,
    task_id: String,
) -> Result<SuccessResponse, String> {
    sftp_mgr.remove_task(&task_id);
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_transfer_clear(
    sftp_mgr: tauri::State<'_, SftpManager>,
) -> Result<SuccessResponse, String> {
    sftp_mgr.clear_finished_tasks();
    Ok(SuccessResponse { success: true })
}

// ── Commands: Local filesystem ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileEntry {
    name: String,
    file_type: String,
    size: u64,
    mtime: i64,
}

#[tauri::command]
async fn local_list_dir(path: String) -> Result<Vec<LocalFileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let mut entries = Vec::new();
        let dir = std::fs::read_dir(&path).map_err(|e| e.to_string())?;

        for entry in dir {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();

            let file_type = if metadata.is_dir() {
                "dir"
            } else if metadata.file_type().is_symlink() {
                "symlink"
            } else {
                "file"
            };

            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            entries.push(LocalFileEntry {
                name,
                file_type: file_type.to_string(),
                size: metadata.len(),
                mtime,
            });
        }

        // Sort: dirs first, then by name
        entries.sort_by(|a, b| {
            let dir_a = a.file_type == "dir";
            let dir_b = b.file_type == "dir";
            dir_b
                .cmp(&dir_a)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn local_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

// ── Commands: Open URL ──

#[tauri::command]
async fn open_browser(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ── Commands: System Fonts ──

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let mut families = source.all_families().map_err(|e| e.to_string())?;
    families.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(families)
}

// ── Commands: System Detection ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    os: String,
    distro: Option<String>,
    distro_version: Option<String>,
    shell: Option<String>,
    kernel: Option<String>,
}

#[tauri::command]
async fn system_detect(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<SystemInfo, String> {
    let session = mgr
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let sess = session.lock().await;

    let cmd = "echo '===OS==='; uname -s; echo '===KERNEL==='; uname -r; echo '===DISTRO==='; cat /etc/os-release 2>/dev/null | head -5; echo '===SHELL==='; echo $SHELL; echo '===END==='";
    let output = sess.exec_command(cmd).await.map_err(|e| e.to_string())?;
    drop(sess);

    let mut os = String::new();
    let mut kernel = None;
    let mut distro = None;
    let mut distro_version = None;
    let mut shell = None;

    let mut section: Option<&str> = None;
    for line in output.lines() {
        if line.starts_with("===") && line.ends_with("===") {
            section = Some(line.trim_matches('='));
            continue;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match section {
            Some("OS") => {
                os = line.to_string();
            }
            Some("KERNEL") => {
                kernel = Some(line.to_string());
            }
            Some("DISTRO") => {
                if line.starts_with("PRETTY_NAME=") {
                    distro = Some(line.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string());
                }
                if line.starts_with("VERSION_ID=") {
                    distro_version = Some(line.trim_start_matches("VERSION_ID=").trim_matches('"').to_string());
                }
            }
            Some("SHELL") => {
                shell = Some(line.to_string());
            }
            _ => {}
        }
    }

    Ok(SystemInfo {
        os,
        distro,
        distro_version,
        shell,
        kernel,
    })
}

// ── Commands: SFTP batch upload (drag-drop) ──

#[tauri::command]
async fn sftp_upload_files(
    app: tauri::AppHandle,
    session_mgr: tauri::State<'_, SessionManager>,
    sftp_mgr: tauri::State<'_, SftpManager>,
    db: tauri::State<'_, Database>,
    session_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<Vec<String>, String> {
    tracing::info!("sftp_upload_files: session_id={}, files={}", session_id, local_paths.len());
    let mut task_ids = Vec::new();

    // Get chunk size from settings (default 256KB)
    let chunk_size: usize = db
        .get_setting("transfer.chunkSize")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(256))
        .unwrap_or(256)
        * 1024; // Convert KB to bytes

    // Get timeout from settings (default 300 seconds)
    let timeout_secs: u64 = db
        .get_setting("transfer.timeout")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(300))
        .unwrap_or(300);

    // Get retry count from settings (default 3)
    let retry_count: u32 = db
        .get_setting("transfer.retryCount")
        .await
        .unwrap_or(None)
        .map(|v| v.parse().unwrap_or(3))
        .unwrap_or(3);

    // Use global concurrency semaphore
    let semaphore = sftp_mgr.concurrency_semaphore();
    let mut handles = Vec::new();

    // Ensure the remote directory exists before uploading
    {
        let target_dir = remote_dir.trim_end_matches('/');
        let escaped = target_dir.replace("'", "'\\''");
        let cmd = format!("mkdir -p '{}'", escaped);
        let session = session_mgr
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        let sess = session.lock().await;
        sess.exec_command(&cmd).await.map_err(|e| e.to_string())?;
        drop(sess);
    }

    for local_path in &local_paths {
        let file_name = std::path::Path::new(local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();

        let remote_path = if remote_dir.ends_with('/') {
            format!("{}{}", remote_dir, file_name)
        } else {
            format!("{}/{}", remote_dir, file_name)
        };

        let task_id = sftp_mgr.start_upload(&session_id, local_path, &remote_path);
        tracing::info!("sftp_upload_files: created task {} for session {}", task_id, session_id);
        task_ids.push(task_id.clone());

        // Clone all values needed for the task
        let sftp_mgr_clone = sftp_mgr.inner().clone();
        let session_mgr_clone = session_mgr.inner().clone();
        let app_handle = app.clone();
        let sem_clone = semaphore.clone();
        let task_id_clone = task_id.clone();

        // Spawn background transfer with semaphore control
        let handle = tokio::spawn(async move {
            // Acquire permit (wait if at max concurrency)
            let _permit = sem_clone.acquire().await.unwrap();

            let mut attempts = 0;
            let mut last_error = None;

            while attempts <= retry_count {
                attempts += 1;

                let result = sftp_mgr_clone.execute_upload(&session_mgr_clone, &app_handle, &task_id_clone, chunk_size, timeout_secs).await;

                match result {
                    Ok(()) => {
                        if let Some(task) = sftp_mgr_clone.get_task(&task_id_clone) {
                            if task.state == core::sftp::TransferState::Completed {
                                event::emit_transfer_completed(&app_handle, &task_id_clone);
                            }
                        }
                        break;
                    }
                    Err(e) => {
                        last_error = Some(e.to_string());
                        if attempts <= retry_count {
                            sftp_mgr_clone.reset_task_progress(&task_id_clone);
                            // Retry after delay
                            tokio::time::sleep(Duration::from_secs(2)).await;
                        }
                    }
                }
            }

            // If all retries failed, mark as failed
            if let Some(error) = last_error {
                if attempts > retry_count {
                    sftp_mgr_clone.mark_failed(&task_id_clone, error.clone());
                    event::emit_transfer_failed(&app_handle, &task_id_clone, &error);
                }
            }
            // Permit is automatically released when _permit goes out of scope
        });
        handles.push(handle);
    }

    // Don't wait for uploads to complete - return immediately
    // Frontend will poll for progress via sftp_transfer_list
    Ok(task_ids)
}

// ── Commands: Connection Test ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionTestResult {
    success: bool,
    message: String,
    latency_ms: Option<u64>,
}

#[tauri::command]
async fn ssh_ping(
    ssh_mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<u64, String> {
    ssh_mgr
        .ping_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn connection_test(
    db: tauri::State<'_, Database>,
    host_id: String,
) -> Result<ConnectionTestResult, String> {
    let host = db
        .get_host(&host_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Host not found".to_string())?;

    let host_addr = host.host.clone();
    let port = host.port as u16;
    let username = host.username.clone();

    // Decrypt password from DB
    let encrypted = host.secret_ref.clone()
        .ok_or_else(|| "No saved password".to_string())?;
    let password = core::secret::decrypt(&encrypted)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;

    let start = std::time::Instant::now();

    match core::ssh::SshSession::connect(&host_addr, port, &username, &password, &host_id, 30).await {
        Ok(mut sess) => {
            let latency = start.elapsed().as_millis() as u64;
            sess.disconnect().await;
            Ok(ConnectionTestResult {
                success: true,
                message: format!("Connected successfully ({}ms)", latency),
                latency_ms: Some(latency),
            })
        }
        Err(e) => {
            Ok(ConnectionTestResult {
                success: false,
                message: format!("Connection failed: {}", e),
                latency_ms: None,
            })
        }
    }
}

// ── Commands: Metrics ──

#[tauri::command]
async fn metrics_start(
    app: tauri::AppHandle,
    session_mgr: tauri::State<'_, SessionManager>,
    metrics_mgr: tauri::State<'_, MetricsManager>,
    session_id: String,
    interval_secs: Option<u64>,
) -> Result<IdResponse, String> {
    // Check if there's already a running collector for this session
    if let Some(existing) = metrics_mgr.find_by_session(&session_id) {
        return Ok(IdResponse { id: existing });
    }

    let interval = interval_secs.unwrap_or(2);
    let collector_id = metrics_mgr.start(&session_id, interval);

    event::emit_metrics_collector_state(&app, &collector_id, "running");

    // Spawn the collection loop
    let smgr = session_mgr.inner().clone();
    let mmgr = metrics_mgr.inner().clone();
    let cid = collector_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        loop {
            if !mmgr.should_continue(&cid) {
                break;
            }

            let result = crate::core::metrics::collect_snapshot(
                &smgr,
                &mmgr.get_config(&cid).map(|(s, _)| s).unwrap_or_default(),
                &mmgr,
                &cid,
            )
            .await;

            match result {
                Ok(snapshot) => {
                    mmgr.push_snapshot(&cid, snapshot.clone());
                    event::emit_metrics_updated(&app_handle, &cid, snapshot);
                }
                Err(e) => {
                    tracing::warn!("metrics collection error: {}", e);
                    mmgr.mark_error(&cid);
                    event::emit_metrics_collector_state(&app_handle, &cid, "error");
                    break;
                }
            }

            let secs = mmgr.get_config(&cid).map(|(_, i)| i).unwrap_or(2);
            tokio::time::sleep(Duration::from_secs(secs)).await;
        }
    });

    Ok(IdResponse { id: collector_id })
}

#[tauri::command]
async fn metrics_stop(
    app: tauri::AppHandle,
    metrics_mgr: tauri::State<'_, MetricsManager>,
    collector_id: String,
) -> Result<SuccessResponse, String> {
    metrics_mgr.stop(&collector_id);
    event::emit_metrics_collector_state(&app, &collector_id, "stopped");
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn metrics_snapshot(
    metrics_mgr: tauri::State<'_, MetricsManager>,
    collector_id: String,
) -> Result<Option<core::metrics::MetricsSnapshot>, String> {
    Ok(metrics_mgr.latest_snapshot(&collector_id))
}

#[tauri::command]
async fn metrics_history(
    metrics_mgr: tauri::State<'_, MetricsManager>,
    collector_id: String,
) -> Result<Vec<core::metrics::MetricsSnapshot>, String> {
    Ok(metrics_mgr.all_snapshots(&collector_id))
}

// ── Commands: Keyring ──

#[tauri::command]
async fn command_history_insert(
    app: AppHandle,
    db: tauri::State<'_, Database>,
    session_id: String,
    host_id: String,
    command: String,
) -> Result<IdResponse, String> {
    let id = db
        .insert_command(&session_id, &host_id, &command)
        .await
        .map_err(|e| e.to_string())?;

    // Emit event to notify frontend to refresh history
    event::emit_command_history_updated(&app, &host_id);

    Ok(IdResponse { id })
}

#[tauri::command]
async fn command_history_list(
    db: tauri::State<'_, Database>,
    host_id: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<core::store::CommandHistoryItem>, String> {
    db.list_commands(
        host_id.as_deref(),
        query.as_deref(),
        limit.unwrap_or(200),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn command_history_clear(
    db: tauri::State<'_, Database>,
    host_id: Option<String>,
) -> Result<SuccessResponse, String> {
    db.clear_commands(host_id.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

// ── Commands: Keyring (credentials) ──

#[tauri::command]
async fn password_decrypt(encrypted: String) -> Result<String, String> {
    core::secret::decrypt(&encrypted).map_err(|e| e.to_string())
}

// ── Commands: Favorite & Recent Paths ──

#[tauri::command]
async fn path_add_favorite(
    db: tauri::State<'_, Database>,
    session_id: String,
    path: String,
    label: Option<String>,
) -> Result<IdResponse, String> {
    let id = db
        .add_favorite_path(&session_id, &path, label.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn path_remove_favorite(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.remove_favorite_path(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn path_list_favorites(
    db: tauri::State<'_, Database>,
    session_id: String,
) -> Result<Vec<core::store::FavoritePath>, String> {
    db.list_favorite_paths(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn path_add_recent(
    db: tauri::State<'_, Database>,
    session_id: String,
    path: String,
) -> Result<IdResponse, String> {
    let id = db
        .add_recent_path(&session_id, &path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn path_list_recent(
    db: tauri::State<'_, Database>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<core::store::RecentPath>, String> {
    db.list_recent_paths(&session_id, limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

// ── Commands: SSH Config Import ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshConfigImportResult {
    entries: Vec<core::store::SshConfigEntry>,
    errors: Vec<String>,
}

#[tauri::command]
async fn ssh_config_import() -> Result<SshConfigImportResult, String> {
    let result = tokio::task::spawn_blocking(|| {
        core::store::parse_ssh_config().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(SshConfigImportResult {
        entries: result.0,
        errors: result.1,
    })
}

// ── Commands: Update Check & Download ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    has_update: bool,
    latest_version: String,
    assets: Vec<ReleaseAssetInfo>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[tauri::command]
fn get_install_type() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_lowercase();
            if path_str.contains("program files") {
                return "msi".to_string();
            }
            if path_str.contains(r"appdata\local") {
                return "nsis".to_string();
            }
        }
    }
    "unknown".to_string()
}

#[tauri::command]
async fn check_update(current_version: String) -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    // 1. 通过 releases/latest 重定向获取最新版本号（不走 API，无限流）
    let res = client
        .get("https://github.com/MrHan-Yd/DdShell/releases/latest")
        .header("User-Agent", "DdShell-Updater")
        .send()
        .await
        .map_err(|e| format!("network:{}", e))?;

    let tag = res
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .and_then(|url| url.rsplit('/').next())
        .unwrap_or("")
        .to_string();

    if tag.is_empty() {
        return Err("no_release".to_string());
    }

    let cur = current_version.trim_start_matches('v');
    let lat = tag.trim_start_matches('v');
    let has_update = version_gt(lat, cur);

    if !has_update {
        return Ok(UpdateCheckResult {
            has_update: false,
            latest_version: tag,
            assets: vec![],
            error: None,
        });
    }

    // 2. 有新版本时，尝试获取资源列表（可选，失败也不影响）
    let api_client = reqwest::Client::new();
    let assets = match api_client
        .get("https://api.github.com/repos/MrHan-Yd/DdShell/releases/latest")
        .header("User-Agent", "DdShell-Updater")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(api_res) if api_res.status().is_success() => {
            let data: serde_json::Value = api_res.json().await.unwrap_or_default();
            data["assets"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            Some(ReleaseAssetInfo {
                                name: a["name"].as_str()?.to_string(),
                                browser_download_url: a["browser_download_url"]
                                    .as_str()?
                                    .to_string(),
                                size: a["size"].as_u64().unwrap_or(0),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        _ => vec![],
    };

    Ok(UpdateCheckResult {
        has_update: true,
        latest_version: tag,
        assets,
        error: None,
    })
}

fn version_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse().ok()).collect()
    };
    let va = parse(a);
    let vb = parse(b);
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x > y { return true; }
        if x < y { return false; }
    }
    false
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String, filename: String) -> Result<String, String> {
    let download_dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or_else(|| "Cannot determine download directory".to_string())?;

    let dest = download_dir.join(&filename);
    let dest_str = dest.to_string_lossy().to_string();

    let app_handle = app.clone();
    let dest_clone = dest.clone();
    let dest_str_clone = dest_str.clone();

    tokio::spawn(async move {
        let result: Result<(), String> = async {
            let client = reqwest::Client::new();
            let res = client
                .get(&url)
                .header("User-Agent", "DdShell-Updater")
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !res.status().is_success() {
                return Err(format!("HTTP {}", res.status()));
            }

            let total = res.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;

            let mut file = tokio::fs::File::create(&dest_clone)
                .await
                .map_err(|e| e.to_string())?;

            let mut stream = res.bytes_stream();
            let mut last_emit = std::time::Instant::now();

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| e.to_string())?;
                tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                    .await
                    .map_err(|e| e.to_string())?;
                downloaded += chunk.len() as u64;

                if last_emit.elapsed().as_millis() >= 200 {
                    event::emit_update_download_progress(&app_handle, downloaded, total);
                    last_emit = std::time::Instant::now();
                }
            }

            event::emit_update_download_progress(&app_handle, downloaded, total);
            event::emit_update_download_completed(&app_handle, &dest_str_clone);
            Ok(())
        }
        .await;

        if let Err(e) = result {
            event::emit_update_download_failed(&app_handle, &e);
        }
    });

    Ok(dest_str)
}

/// Normalize \r\r\n -> \r\n in raw SSH output.
/// Some servers/PAM modules send double CR which causes xterm to render
/// the cursor mid-line over MOTD text.
fn normalize_crlf(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        // \r\r\n -> \r\n
        if data[i] == b'\r' && i + 2 < data.len() && data[i + 1] == b'\r' && data[i + 2] == b'\n' {
            out.push(b'\r');
            out.push(b'\n');
            i += 3;
        } else {
            out.push(data[i]);
            i += 1;
        }
    }
    out
}

/// Background async loop that reads SSH output and emits events.
/// Owns the Channel exclusively — write goes through Handle, resize goes through mpsc.
async fn output_reader_loop(
    app: tauri::AppHandle,
    mut channel: russh::Channel<russh::client::Msg>,
    mut cmd_rx: tokio::sync::mpsc::UnboundedReceiver<core::ssh::PtyCommand>,
    session_id: &str,
    encoding: String,
) {
    tracing::info!("[output_reader_loop] started for session {} (encoding: {})", session_id, encoding);

    let is_utf8 = encoding.eq_ignore_ascii_case("utf-8") || encoding.eq_ignore_ascii_case("utf8");
    let mut decoder = if !is_utf8 {
        encoding_rs::Encoding::for_label(encoding.as_bytes()).map(|enc| enc.new_decoder())
    } else {
        None
    };

    // Brief delay so the frontend React component can mount and register its
    // Tauri event listener before we start emitting output data.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        tracing::debug!("[output_reader_loop] received {} bytes for session {}", data.len(), session_id);
                        // Normalize \r\r\n -> \r\n: some servers/PAM send double CR
                        // which causes the cursor to sit mid-line over MOTD text.
                        let normalized: Vec<u8> = normalize_crlf(data);
                        let output_data: &[u8] = &normalized;
                        if let Some(ref mut dec) = decoder {
                            let mut output = String::with_capacity(output_data.len() * 2);
                            let (_result, _read, _had_errors) = dec.decode_to_string(output_data, &mut output, false);
                            event::emit_session_output(&app, session_id, output.into_bytes());
                        } else {
                            event::emit_session_output(&app, session_id, output_data.to_vec());
                        }
                    }
                    Some(ChannelMsg::Eof) => {
                        tracing::info!("[output_reader_loop] EOF for session {}", session_id);
                        event::emit_session_state(&app, session_id, "disconnected");
                        break;
                    }
                    None => {
                        tracing::info!("[output_reader_loop] channel closed for session {}", session_id);
                        event::emit_session_state(&app, session_id, "disconnected");
                        break;
                    }
                    other => {
                        tracing::debug!("[output_reader_loop] other msg: {:?}", other);
                    }
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(core::ssh::PtyCommand::Resize { cols, rows }) => {
                        tracing::debug!("[output_reader_loop] resize {}x{}", cols, rows);
                        if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                            tracing::warn!("window_change failed: {}", e);
                        }
                    }
                    None => {
                        tracing::info!("[output_reader_loop] cmd_rx closed for session {}", session_id);
                        break;
                    }
                }
            }
        }
    }
    tracing::info!("[output_reader_loop] exited for session {}", session_id);
}

// ── App entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "app=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Set window icon (for dev mode)
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
            }

            // Initialize managers immediately (sync)
            app.manage(SessionManager::new());
            app.manage(SftpManager::new(3));
            app.manage(MetricsManager::new());

            // On Windows/Linux, hide native decorations so we use custom titlebar.
            // On macOS, keep decorations + overlay titlebar for native traffic lights.
            #[cfg(not(target_os = "macos"))]
            {
                let window = app.get_webview_window("main").unwrap();
                let _ = window.set_decorations(false);
            }

            // Portable mode (Windows/Linux): store data next to the executable
            // macOS: use standard app data dir (app bundle is read-only)
            #[cfg(target_os = "macos")]
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            #[cfg(not(target_os = "macos"))]
            let app_data_dir = std::env::current_exe()
                .expect("failed to get exe path")
                .parent()
                .expect("failed to get exe directory")
                .to_path_buf();

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match Database::init(&app_data_dir).await {
                    Ok(db) => {
                        // Initialize CommandAssistEngine with the DB pool
                        let engine = CommandAssistEngine::new(db.pool().clone());

                        // Build initial index from user snippets
                        if let Ok(snippets) = db.list_snippets().await {
                            let all_cats: Vec<String> = ["git", "docker", "webServer", "devTools"].iter().map(|s| s.to_string()).collect();
                            if let Err(e) = engine.rebuild_index(&snippets, "zh", &all_cats).await {
                                tracing::warn!("command assist index build failed: {}", e);
                            }
                        }

                        handle.manage(engine);
                        handle.manage(db);
                        tracing::info!("database initialized");
                    }
                    Err(e) => {
                        tracing::error!("database init failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_health,
            connection_create,
            connection_update,
            connection_delete,
            connection_list,
            connection_get,
            group_create,
            group_update,
            group_delete,
            group_list,
            snippet_create,
            snippet_update,
            snippet_delete,
            snippet_list,
            command_assist_search,
            command_assist_weight_update,
            command_assist_weight_reset,
            command_assist_rebuild_index,
            command_assist_get_all,
            setting_get,
            setting_set,
            session_connect,
            session_disconnect,
            session_write,
            session_resize,
            sftp_list_dir,
            sftp_mkdir,
            sftp_remove,
            sftp_rename,
            sftp_transfer_start,
            sftp_transfer_cancel,
            sftp_transfer_remove,
            sftp_transfer_list,
            sftp_transfer_clear,
            sftp_upload_files,
            system_detect,
            connection_test,
            ssh_ping,
            metrics_start,
            metrics_stop,
            metrics_snapshot,
            metrics_history,
            command_history_insert,
            command_history_list,
            command_history_clear,
            password_decrypt,
            local_list_dir,
            local_home_dir,
            path_add_favorite,
            path_remove_favorite,
            path_list_favorites,
            path_add_recent,
            path_list_recent,
            ssh_config_import,
            list_system_fonts,
            download_update,
            check_update,
            get_install_type,
            open_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
