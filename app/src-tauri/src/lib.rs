mod core;

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::core::event;
use crate::core::sftp::SftpManager;
use crate::core::ssh::SessionManager;
use crate::core::store::Database;

// ── Request / Response types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateHostReq {
    name: String,
    host: String,
    port: i64,
    username: String,
    auth_type: String,
    group_id: Option<String>,
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
    group_id: Option<String>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
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
    password: String,
    cols: Option<u32>,
    rows: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpTransferReq {
    session_id: String,
    direction: String,
    local_path: String,
    remote_path: String,
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
    let id = db
        .create_host(
            &req.name,
            &req.host,
            req.port,
            &req.username,
            &req.auth_type,
            req.group_id.as_deref(),
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
    db.update_host(
        &req.id,
        req.name.as_deref(),
        req.host.as_deref(),
        req.port,
        req.username.as_deref(),
        req.auth_type.as_deref(),
        Some(req.group_id.as_deref()),
        req.is_favorite,
        req.sort_order,
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

    event::emit_session_state(&app, "", "connecting");

    let session_id = mgr
        .connect(&db, &req.host_id, &req.password, cols, rows)
        .await
        .map_err(|e| e.to_string())?;

    event::emit_session_state(&app, &session_id, "connected");

    // Spawn output reader loop
    let session = mgr
        .get(&session_id)
        .ok_or_else(|| "Session lost".to_string())?;
    let sid = session_id.clone();
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        output_reader_loop(app_handle, session, &sid);
    });

    Ok(IdResponse { id: session_id })
}

#[tauri::command]
async fn session_disconnect(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<SuccessResponse, String> {
    mgr.disconnect(&session_id).map_err(|e| e.to_string())?;
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
    session
        .lock()
        .write_input(&data)
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
    let mgr = mgr.inner().clone();
    let sid = session_id.clone();
    let rp = remote_path.clone();
    tokio::task::spawn_blocking(move || SftpManager::list_dir(&mgr, &sid, &rp))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_mkdir(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
) -> Result<SuccessResponse, String> {
    let mgr = mgr.inner().clone();
    tokio::task::spawn_blocking(move || SftpManager::mkdir(&mgr, &session_id, &remote_path))
        .await
        .map_err(|e| e.to_string())?
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
    let mgr = mgr.inner().clone();
    tokio::task::spawn_blocking(move || {
        if is_dir {
            SftpManager::remove_dir(&mgr, &session_id, &remote_path)
        } else {
            SftpManager::remove_file(&mgr, &session_id, &remote_path)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_rename(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<SuccessResponse, String> {
    let mgr = mgr.inner().clone();
    tokio::task::spawn_blocking(move || SftpManager::rename(&mgr, &session_id, &old_path, &new_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_transfer_start(
    app: tauri::AppHandle,
    session_mgr: tauri::State<'_, SessionManager>,
    sftp_mgr: tauri::State<'_, SftpManager>,
    req: SftpTransferReq,
) -> Result<IdResponse, String> {
    let is_upload = req.direction == "upload";

    let task_id = if is_upload {
        sftp_mgr.start_upload(&req.session_id, &req.local_path, &req.remote_path)
    } else {
        // Get remote file size for download progress
        let session_mgr_clone = session_mgr.inner().clone();
        let sid = req.session_id.clone();
        let rp = req.remote_path.clone();
        let remote_size = tokio::task::spawn_blocking(move || {
            SftpManager::stat(&session_mgr_clone, &sid, &rp)
                .map(|e| e.size)
                .unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        sftp_mgr.start_download(&req.session_id, &req.remote_path, &req.local_path, remote_size)
    };

    // Spawn background transfer
    let sftp_mgr_clone = sftp_mgr.inner().clone();
    let session_mgr_clone = session_mgr.inner().clone();
    let tid = task_id.clone();
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let result = if is_upload {
            sftp_mgr_clone.execute_upload(&session_mgr_clone, &tid)
        } else {
            sftp_mgr_clone.execute_download(&session_mgr_clone, &tid)
        };

        match result {
            Ok(()) => {
                if let Some(task) = sftp_mgr_clone.get_task(&tid) {
                    if task.state == core::sftp::TransferState::Completed {
                        event::emit_transfer_completed(&app_handle, &tid);
                    }
                }
            }
            Err(e) => {
                sftp_mgr_clone.mark_failed(&tid, e.to_string());
                event::emit_transfer_failed(&app_handle, &tid, &e.to_string());
            }
        }
    });

    // Spawn a progress reporter
    let sftp_mgr_progress = sftp_mgr.inner().clone();
    let tid_progress = task_id.clone();
    let app_progress = app.clone();

    tokio::spawn(async move {
        let mut last_bytes: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(task) = sftp_mgr_progress.get_task(&tid_progress) {
                let speed = ((task.transferred_bytes - last_bytes) as f64 / 0.2) as u64;
                last_bytes = task.transferred_bytes;

                event::emit_transfer_progress(
                    &app_progress,
                    &tid_progress,
                    task.transferred_bytes,
                    task.total_bytes,
                    speed,
                );

                if task.state != core::sftp::TransferState::Running
                    && task.state != core::sftp::TransferState::Queued
                {
                    break;
                }
            } else {
                break;
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
async fn sftp_transfer_clear(
    sftp_mgr: tauri::State<'_, SftpManager>,
) -> Result<SuccessResponse, String> {
    sftp_mgr.clear_finished_tasks();
    Ok(SuccessResponse { success: true })
}

/// Background loop that reads SSH output and emits events
fn output_reader_loop(
    app: tauri::AppHandle,
    session: Arc<Mutex<core::ssh::SshSession>>,
    session_id: &str,
) {
    loop {
        {
            let mut sess = session.lock();
            if sess.is_eof() {
                event::emit_session_state(&app, session_id, "disconnected");
                break;
            }
            match sess.read_output() {
                Ok(data) if !data.is_empty() => {
                    event::emit_session_output(&app, session_id, data);
                }
                Err(_) => {
                    event::emit_session_state(&app, session_id, "failed");
                    break;
                }
                _ => {}
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
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
        .setup(|app| {
            // Initialize managers immediately (sync)
            app.manage(SessionManager::new());
            app.manage(SftpManager::new());

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match Database::init(&app_data_dir).await {
                    Ok(db) => {
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
            sftp_transfer_list,
            sftp_transfer_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
