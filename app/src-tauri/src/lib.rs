mod core;

use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;

use crate::core::ai_agent::{
    AiAgentConfig, AiAgentConfigSaveReq, AiAgentSendReq, AiAgentSendResponse,
};
use crate::core::command_assist::CommandAssistEngine;
use crate::core::event;
use crate::core::metrics::MetricsManager;
use crate::core::sftp::SftpManager;
use crate::core::ssh::SessionManager;
use crate::core::store::{Database, SettingWrite};
use crate::core::workflow::WorkflowRunManager;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkflowRecipeReq {
    title: String,
    description: Option<String>,
    group_id: Option<String>,
    params_json: String,
    steps_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkflowRecipeReq {
    id: String,
    title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    group_id: Option<Option<String>>,
    params_json: Option<String>,
    steps_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowRunStartReq {
    recipe_id: String,
    host_id: String,
    params: Option<std::collections::HashMap<String, String>>,
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

fn spawn_session_idle_watchdog(
    app: tauri::AppHandle,
    session_mgr: SessionManager,
    session_id: String,
) {
    if session_mgr.idle_timeout(&session_id).is_none() {
        return;
    }

    tokio::spawn(async move {
        loop {
            let Some(timeout) = session_mgr.idle_timeout(&session_id) else {
                break;
            };
            let Some(elapsed) = session_mgr.idle_elapsed(&session_id) else {
                break;
            };

            if elapsed >= timeout {
                tracing::info!(
                    "session {} idle timeout reached after {}s",
                    session_id,
                    timeout.as_secs()
                );
                match session_mgr.disconnect(&session_id).await {
                    Ok(()) => event::emit_session_state(&app, &session_id, "disconnected"),
                    Err(e) => tracing::debug!(
                        "idle timeout disconnect skipped for session {}: {}",
                        session_id,
                        e
                    ),
                }
                break;
            }

            let remaining = timeout.saturating_sub(elapsed);
            tokio::time::sleep(if remaining.is_zero() {
                Duration::from_millis(100)
            } else {
                remaining
            })
            .await;
        }
    });
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalImportBackgroundImageReq {
    source_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalImportBackgroundImageResponse {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthPayload {
    status: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    os: String,
    arch: String,
    label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionConnectReq {
    host_id: String,
    password: Option<String>,
    cols: Option<u32>,
    rows: Option<u32>,
}

const TERMINAL_BACKGROUND_DIR: &str = "terminal-backgrounds";

fn terminal_background_extension(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("png"),
        "jpg" => Some("jpg"),
        "jpeg" => Some("jpeg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        "bmp" => Some("bmp"),
        _ => None,
    }
}

fn terminal_background_file_name(hash_hex: &str, extension: &str) -> String {
    let prefix_len = hash_hex.len().min(32);
    format!("{}.{}", &hash_hex[..prefix_len], extension)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

async fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Failed to open image: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 16 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Failed to read image: {}", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex_encode(&hasher.finalize()))
}

// ── Commands: Health ──

#[tauri::command]
fn app_health() -> HealthPayload {
    HealthPayload {
        status: "ok".to_string(),
        message: "shell core initialized".to_string(),
    }
}

#[tauri::command]
fn app_platform_info() -> PlatformInfo {
    let os = match std::env::consts::OS {
        "macos" => "macOS",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        other => other,
    };

    PlatformInfo {
        os: os.to_string(),
        arch: arch.to_string(),
        label: format!("{} {}", os, arch),
    }
}

async fn decrypt_host_secret_with_lazy_migration(
    db: &Database,
    host_id: &str,
    secret_ref: &str,
) -> Result<String, String> {
    let password = core::secret::decrypt(secret_ref)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;
    if let Some(next_ref) = core::secret::try_migrate_to_keyring(secret_ref, &password) {
        if let Err(err) = db.update_host_secret_ref(host_id, Some(&next_ref)).await {
            tracing::warn!("failed to update migrated host secret ref: {}", err);
        }
    }
    Ok(password)
}

// ── Commands: Connection CRUD ──

#[tauri::command]
async fn connection_create(
    db: tauri::State<'_, Database>,
    req: CreateHostReq,
) -> Result<IdResponse, String> {
    // Encrypt password before storing
    let encrypted = req
        .password
        .as_deref()
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
    let old_secret_ref = if req.password.is_some() {
        db.get_host(&req.id)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|host| host.secret_ref)
    } else {
        None
    };

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

    if let Some(old_ref) = old_secret_ref {
        let new_ref = secret_ref
            .as_ref()
            .and_then(|value| value.as_ref())
            .map(String::as_str);
        if Some(old_ref.as_str()) != new_ref {
            if let Err(err) = core::secret::delete(&old_ref) {
                tracing::warn!("failed to delete replaced host keyring credential: {}", err);
            }
        }
    }

    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn connection_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    let old_secret_ref = db
        .get_host(&id)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|host| host.secret_ref);
    db.delete_host(&id).await.map_err(|e| e.to_string())?;
    if let Some(old_ref) = old_secret_ref {
        if let Err(err) = core::secret::delete(&old_ref) {
            tracing::warn!("failed to delete removed host keyring credential: {}", err);
        }
    }
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn connection_list(db: tauri::State<'_, Database>) -> Result<Vec<core::store::Host>, String> {
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
async fn group_list(db: tauri::State<'_, Database>) -> Result<Vec<core::store::HostGroup>, String> {
    db.list_groups().await.map_err(|e| e.to_string())
}

// ── Commands: Snippet Groups ──

#[tauri::command]
async fn snippet_group_create(
    db: tauri::State<'_, Database>,
    name: String,
) -> Result<IdResponse, String> {
    let id = db
        .create_snippet_group(&name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn snippet_group_update(
    db: tauri::State<'_, Database>,
    id: String,
    name: String,
) -> Result<SuccessResponse, String> {
    db.update_snippet_group(&id, &name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn snippet_group_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_snippet_group(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn snippet_group_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::SnippetGroup>, String> {
    db.list_snippet_groups().await.map_err(|e| e.to_string())
}

// ── Commands: Snippets ──

#[tauri::command]
async fn snippet_create(
    db: tauri::State<'_, Database>,
    title: String,
    command: String,
    description: Option<String>,
    tags: Option<Vec<String>>,
    group_id: Option<String>,
) -> Result<IdResponse, String> {
    let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
    let id = db
        .create_snippet(
            &title,
            &command,
            description.as_deref(),
            tags_json.as_deref(),
            group_id.as_deref(),
        )
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
    group_id: Option<String>,
) -> Result<SuccessResponse, String> {
    let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
    db.update_snippet(
        &id,
        title.as_deref(),
        command.as_deref(),
        Some(description.as_deref()),
        Some(tags_json.as_deref()),
        Some(group_id.as_deref()),
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
async fn snippet_list(db: tauri::State<'_, Database>) -> Result<Vec<core::store::Snippet>, String> {
    db.list_snippets().await.map_err(|e| e.to_string())
}

// ── Commands: Workflow Groups ──

#[tauri::command]
async fn workflow_group_create(
    db: tauri::State<'_, Database>,
    name: String,
) -> Result<IdResponse, String> {
    let id = db
        .create_workflow_group(&name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn workflow_group_update(
    db: tauri::State<'_, Database>,
    id: String,
    name: String,
) -> Result<SuccessResponse, String> {
    db.update_workflow_group(&id, &name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn workflow_group_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_workflow_group(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn workflow_group_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::WorkflowGroup>, String> {
    db.list_workflow_groups().await.map_err(|e| e.to_string())
}

// ── Commands: Workflow Recipes ──

#[tauri::command]
async fn workflow_recipe_create(
    db: tauri::State<'_, Database>,
    req: CreateWorkflowRecipeReq,
) -> Result<IdResponse, String> {
    let id = db
        .create_workflow_recipe(
            &req.title,
            req.description.as_deref(),
            &req.params_json,
            &req.steps_json,
            req.group_id.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn workflow_recipe_update(
    db: tauri::State<'_, Database>,
    req: UpdateWorkflowRecipeReq,
) -> Result<SuccessResponse, String> {
    db.update_workflow_recipe(
        &req.id,
        req.title.as_deref(),
        req.description.as_ref().map(|value| value.as_deref()),
        req.group_id.as_ref().map(|value| value.as_deref()),
        req.params_json.as_deref(),
        req.steps_json.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn workflow_recipe_delete(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.delete_workflow_recipe(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn workflow_recipe_get(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<core::store::WorkflowRecipe, String> {
    db.get_workflow_recipe(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Workflow recipe not found".to_string())
}

#[tauri::command]
async fn workflow_recipe_list(
    db: tauri::State<'_, Database>,
) -> Result<Vec<core::store::WorkflowRecipe>, String> {
    db.list_workflow_recipes().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn workflow_run_start(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    run_mgr: tauri::State<'_, WorkflowRunManager>,
    req: WorkflowRunStartReq,
) -> Result<IdResponse, String> {
    let recipe = db
        .get_workflow_recipe(&req.recipe_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Workflow recipe not found".to_string())?;
    let params = core::workflow::parse_recipe_params(&recipe).map_err(|e| e.to_string())?;
    let steps = core::workflow::parse_recipe_steps(&recipe).map_err(|e| e.to_string())?;
    if steps.is_empty() {
        return Err("Workflow recipe has no steps".to_string());
    }

    let (host_id, host_addr, username, port, password) =
        core::workflow::resolve_host_and_password(&db, &req.host_id)
            .await
            .map_err(|e| e.to_string())?;
    let timeout_secs = db
        .get_setting("session.keepAlive")
        .await
        .unwrap_or(None)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(30);

    let resolved_param_values =
        core::workflow::resolve_param_values(&params, &req.params.unwrap_or_default())
            .map_err(|e| e.to_string())?;

    let secret_keys = core::workflow::collect_secret_keys(&params);

    let mut run =
        core::workflow::create_run(&recipe, &host_id, &steps, resolved_param_values.clone());
    run_mgr.insert(run.clone());
    let run_record =
        core::workflow::run_to_masked_record(&run, &secret_keys).map_err(|e| e.to_string())?;
    db.insert_workflow_run(
        &run_record.id,
        &run_record.recipe_id,
        &run_record.recipe_title,
        &run_record.host_id,
        &run_record.state,
        &run_record.started_at,
        run_record.finished_at.as_deref(),
        &run_record.params_json,
        &run_record.steps_json,
        run_record.error.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let masked_run = core::workflow::mask_run_for_event(&run, &secret_keys);
    event::emit_workflow_run_updated(&app, masked_run);

    let run_id = run.id.clone();
    let run_id_for_task = run_id.clone();
    let run_mgr_clone = run_mgr.inner().clone();
    let app_handle = app.clone();
    let db_handle = db.inner().clone();
    let secret_keys_clone = secret_keys.clone();

    tokio::spawn(async move {
        let result: anyhow::Result<()> = async {
            let mut session = core::ssh::SshSession::connect(
                &host_addr,
                port,
                &username,
                &password,
                &host_id,
                timeout_secs,
            )
            .await?;

            let values = resolved_param_values;
            for (index, step) in steps.iter().enumerate() {
                run.steps[index].state = "running".to_string();
                run.steps[index].started_at = Some(chrono::Utc::now().to_rfc3339());
                run.steps[index].rendered_command =
                    core::workflow::interpolate_command(&step.command, &values);
                run_mgr_clone.update(run.clone());
                let run_record = core::workflow::run_to_masked_record(&run, &secret_keys_clone)?;
                db_handle
                    .update_workflow_run(
                        &run_record.id,
                        &run_record.state,
                        run_record.finished_at.as_deref(),
                        &run_record.params_json,
                        &run_record.steps_json,
                        run_record.error.as_deref(),
                    )
                    .await?;
                event::emit_workflow_run_updated(
                    &app_handle,
                    core::workflow::mask_run_for_event(&run, &secret_keys_clone),
                );

                let exec =
                    core::workflow::execute_step(&session, &run.steps[index].rendered_command)
                        .await?;
                run.steps[index].stdout = exec.stdout;
                run.steps[index].stderr = exec.stderr;
                run.steps[index].exit_code = exec.exit_code;
                run.steps[index].finished_at = Some(chrono::Utc::now().to_rfc3339());

                if exec.exit_code.unwrap_or(0) == 0 {
                    run.steps[index].state = "completed".to_string();
                } else {
                    run.steps[index].state = "failed".to_string();
                    run.state = "failed".to_string();
                    run.error = Some(format!("Step '{}' failed", step.title));
                    run.finished_at = Some(chrono::Utc::now().to_rfc3339());
                    run_mgr_clone.update(run.clone());
                    let run_record =
                        core::workflow::run_to_masked_record(&run, &secret_keys_clone)?;
                    db_handle
                        .update_workflow_run(
                            &run_record.id,
                            &run_record.state,
                            run_record.finished_at.as_deref(),
                            &run_record.params_json,
                            &run_record.steps_json,
                            run_record.error.as_deref(),
                        )
                        .await?;
                    event::emit_workflow_run_updated(
                        &app_handle,
                        core::workflow::mask_run_for_event(&run, &secret_keys_clone),
                    );
                    session.disconnect().await;
                    return Ok(());
                }

                run_mgr_clone.update(run.clone());
                let run_record = core::workflow::run_to_masked_record(&run, &secret_keys_clone)?;
                db_handle
                    .update_workflow_run(
                        &run_record.id,
                        &run_record.state,
                        run_record.finished_at.as_deref(),
                        &run_record.params_json,
                        &run_record.steps_json,
                        run_record.error.as_deref(),
                    )
                    .await?;
                event::emit_workflow_run_updated(
                    &app_handle,
                    core::workflow::mask_run_for_event(&run, &secret_keys_clone),
                );
            }

            run.state = "completed".to_string();
            run.finished_at = Some(chrono::Utc::now().to_rfc3339());
            run_mgr_clone.update(run.clone());
            let run_record = core::workflow::run_to_masked_record(&run, &secret_keys_clone)?;
            db_handle
                .update_workflow_run(
                    &run_record.id,
                    &run_record.state,
                    run_record.finished_at.as_deref(),
                    &run_record.params_json,
                    &run_record.steps_json,
                    run_record.error.as_deref(),
                )
                .await?;
            event::emit_workflow_run_updated(
                &app_handle,
                core::workflow::mask_run_for_event(&run, &secret_keys_clone),
            );
            session.disconnect().await;
            Ok(())
        }
        .await;

        if let Err(error) = result {
            if let Some(mut current) = run_mgr_clone.get(&run_id_for_task) {
                current.state = "failed".to_string();
                current.error = Some(error.to_string());
                current.finished_at = Some(chrono::Utc::now().to_rfc3339());
                run_mgr_clone.update(current.clone());
                if let Ok(run_record) =
                    core::workflow::run_to_masked_record(&current, &secret_keys_clone)
                {
                    let _ = db_handle
                        .update_workflow_run(
                            &run_record.id,
                            &run_record.state,
                            run_record.finished_at.as_deref(),
                            &run_record.params_json,
                            &run_record.steps_json,
                            run_record.error.as_deref(),
                        )
                        .await;
                }
                event::emit_workflow_run_updated(
                    &app_handle,
                    core::workflow::mask_run_for_event(&current, &secret_keys_clone),
                );
            }
        }
    });

    Ok(IdResponse { id: run_id })
}

#[tauri::command]
async fn workflow_run_get(
    db: tauri::State<'_, Database>,
    run_mgr: tauri::State<'_, WorkflowRunManager>,
    run_id: String,
) -> Result<core::workflow::WorkflowRun, String> {
    if let Some(run) = run_mgr.get(&run_id) {
        return Ok(run);
    }

    let record = db
        .get_workflow_run(&run_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Workflow run not found".to_string())?;

    core::workflow::record_to_run(record).map_err(|e| e.to_string())
}

#[tauri::command]
async fn workflow_run_list(
    db: tauri::State<'_, Database>,
    recipe_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<core::workflow::WorkflowRun>, String> {
    let rows = db
        .list_workflow_runs(recipe_id.as_deref(), limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(core::workflow::record_to_run)
        .collect::<anyhow::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
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
    engine.reset_weights().await.map_err(|e| e.to_string())?;
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
        .rebuild_index(
            &snippets,
            &locale,
            &enabled_app_categories.unwrap_or_default(),
        )
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

#[tauri::command]
async fn setting_set_many(
    db: tauri::State<'_, Database>,
    entries: Vec<SettingWrite>,
) -> Result<SuccessResponse, String> {
    db.set_settings(&entries).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn terminal_import_background_image(
    app: AppHandle,
    req: TerminalImportBackgroundImageReq,
) -> Result<TerminalImportBackgroundImageResponse, String> {
    let source_path = req.source_path.trim();
    if source_path.is_empty() {
        return Err("Image path is empty".to_string());
    }

    let source = PathBuf::from(source_path);
    if !source.is_absolute() {
        return Err("Image path must be absolute".to_string());
    }

    let extension = terminal_background_extension(&source)
        .ok_or_else(|| "Unsupported image format".to_string())?;
    let metadata = tokio::fs::metadata(&source)
        .await
        .map_err(|e| format!("Image file is not accessible: {}", e))?;
    if !metadata.is_file() {
        return Err("Image path is not a file".to_string());
    }

    let source = tokio::fs::canonicalize(&source)
        .await
        .map_err(|e| format!("Failed to resolve image path: {}", e))?;
    let target_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join(TERMINAL_BACKGROUND_DIR);

    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Failed to create image directory: {}", e))?;
    let target_dir = tokio::fs::canonicalize(&target_dir)
        .await
        .map_err(|e| format!("Failed to resolve image directory: {}", e))?;

    if source.starts_with(&target_dir) {
        return Ok(TerminalImportBackgroundImageResponse {
            path: source.to_string_lossy().into_owned(),
        });
    }

    let hash = sha256_file_hex(&source).await?;
    let target = target_dir.join(terminal_background_file_name(&hash, extension));

    match tokio::fs::metadata(&target).await {
        Ok(existing) if existing.is_file() => {}
        Ok(_) => return Err("Imported image target is not a file".to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::copy(&source, &target)
                .await
                .map_err(|e| format!("Failed to import image: {}", e))?;
        }
        Err(err) => return Err(format!("Failed to inspect imported image: {}", err)),
    }

    Ok(TerminalImportBackgroundImageResponse {
        path: target.to_string_lossy().into_owned(),
    })
}

// ── Commands: AI Agent ──

#[tauri::command]
async fn ai_agent_config_get(db: tauri::State<'_, Database>) -> Result<AiAgentConfig, String> {
    core::ai_agent::get_config(&db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_agent_config_save(
    db: tauri::State<'_, Database>,
    req: AiAgentConfigSaveReq,
) -> Result<AiAgentConfig, String> {
    core::ai_agent::save_config(&db, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_agent_profile_set_key(
    db: tauri::State<'_, Database>,
    profile_id: String,
    api_key: String,
) -> Result<SuccessResponse, String> {
    core::ai_agent::set_profile_key(&db, &profile_id, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn ai_agent_profile_clear_key(
    db: tauri::State<'_, Database>,
    profile_id: String,
) -> Result<SuccessResponse, String> {
    core::ai_agent::clear_profile_key(&db, &profile_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn ai_agent_send(
    db: tauri::State<'_, Database>,
    req: AiAgentSendReq,
) -> Result<AiAgentSendResponse, String> {
    core::ai_agent::send(&db, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_agent_send_stream(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    req: AiAgentSendReq,
) -> Result<AiAgentSendResponse, String> {
    let request_id = req.request_id.clone().unwrap_or_default();
    core::ai_agent::send_stream(&db, req, |delta| {
        event::emit_ai_agent_stream_delta(
            &app,
            &request_id,
            &delta.text_delta,
            delta.reasoning_delta.as_deref(),
        );
    })
    .await
    .map_err(|e| e.to_string())
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
            let host = db
                .get_host(&req.host_id)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Host not found".to_string())?;
            let encrypted = host
                .secret_ref
                .ok_or_else(|| "No saved password".to_string())?;
            decrypt_host_secret_with_lazy_migration(&db, &req.host_id, &encrypted).await?
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
    let session_mgr = mgr.inner().clone();

    tokio::spawn(async move {
        output_reader_loop(app_handle, session_mgr, channel, cmd_rx, sid, encoding).await;
    });

    spawn_session_idle_watchdog(app.clone(), mgr.inner().clone(), session_id.clone());

    Ok(IdResponse { id: session_id })
}

#[tauri::command]
async fn session_disconnect(
    app: tauri::AppHandle,
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<SuccessResponse, String> {
    mgr.disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    event::emit_session_state(&app, &session_id, "disconnected");
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn session_touch_activity(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<SuccessResponse, String> {
    if mgr.touch_activity(&session_id) {
        Ok(SuccessResponse { success: true })
    } else {
        Err("Session not found".to_string())
    }
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
    mgr.touch_activity(&session_id);
    let session_guard = session.lock().await;
    let encoding_name = session_guard.encoding.clone();

    let write_data = if encoding_name.eq_ignore_ascii_case("utf-8")
        || encoding_name.eq_ignore_ascii_case("utf8")
    {
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
    mgr.touch_activity(&session_id);
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
    mgr.touch_activity(&session_id);
    SftpManager::list_dir(&mgr, &session_id, &remote_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_canonicalize(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
) -> Result<String, String> {
    if !mgr.is_connected(&session_id) {
        return Err("Session disconnected".to_string());
    }
    mgr.touch_activity(&session_id);
    SftpManager::canonicalize(&mgr, &session_id, &remote_path)
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
    mgr.touch_activity(&session_id);
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
    mgr.touch_activity(&session_id);

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
    mgr.touch_activity(&session_id);
    SftpManager::rename(&mgr, &session_id, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn sftp_read_text(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
    max_bytes: Option<u64>,
) -> Result<core::sftp::ReadTextResult, String> {
    if !mgr.is_connected(&session_id) {
        return Err("SESSION_DISCONNECTED".to_string());
    }
    mgr.touch_activity(&session_id);

    SftpManager::read_text(&mgr, &session_id, &remote_path, max_bytes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_write_text(
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
    content: String,
    expected_mtime: Option<i64>,
    expected_hash: Option<String>,
) -> Result<core::sftp::WriteTextResult, String> {
    if !mgr.is_connected(&session_id) {
        return Err("SESSION_DISCONNECTED".to_string());
    }
    mgr.touch_activity(&session_id);

    SftpManager::write_text(
        &mgr,
        &session_id,
        &remote_path,
        &content,
        expected_mtime,
        expected_hash.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn sftp_write_text_privileged(
    db: tauri::State<'_, Database>,
    mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    remote_path: String,
    content: String,
    expected_mtime: Option<i64>,
    expected_hash: Option<String>,
    sudo_password: Option<String>,
    create_backup: Option<bool>,
) -> Result<core::sftp::PrivilegedWriteTextResult, String> {
    if !mgr.is_connected(&session_id) {
        return Err("SESSION_DISCONNECTED".to_string());
    }
    mgr.touch_activity(&session_id);

    SftpManager::write_text_privileged(
        &db,
        &mgr,
        &session_id,
        &remote_path,
        &content,
        expected_mtime,
        expected_hash.as_deref(),
        sudo_password.as_deref(),
        create_backup.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string())
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
    if !session_mgr.is_connected(&session_id) {
        return Err("SESSION_DISCONNECTED".to_string());
    }
    session_mgr.touch_activity(&session_id);

    let is_upload = direction == "upload";

    // Resolve local path for download: use setting or system default download dir
    let resolved_local_path = if is_upload || !local_path.is_empty() {
        local_path.clone()
    } else {
        // Get download path from settings or use system default.
        // Empty string is treated as "not set" — fall back to system default.
        let default_download = dirs::download_dir().unwrap_or_else(|| {
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

    tracing::info!(
        "sftp_transfer_start: direction={}, resolved_local_path={}",
        direction,
        resolved_local_path
    );
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
                sftp_mgr_clone
                    .execute_upload(
                        &session_mgr_clone,
                        &app_handle,
                        &tid,
                        chunk_size,
                        timeout_secs,
                    )
                    .await
            } else {
                sftp_mgr_clone
                    .execute_download(
                        &session_mgr_clone,
                        &app_handle,
                        &tid,
                        chunk_size,
                        timeout_secs,
                    )
                    .await
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
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())
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
    mgr.touch_activity(&session_id);
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
                    distro = Some(
                        line.trim_start_matches("PRETTY_NAME=")
                            .trim_matches('"')
                            .to_string(),
                    );
                }
                if line.starts_with("VERSION_ID=") {
                    distro_version = Some(
                        line.trim_start_matches("VERSION_ID=")
                            .trim_matches('"')
                            .to_string(),
                    );
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
    if !session_mgr.is_connected(&session_id) {
        return Err("SESSION_DISCONNECTED".to_string());
    }
    session_mgr.touch_activity(&session_id);

    tracing::info!(
        "sftp_upload_files: session_id={}, files={}",
        session_id,
        local_paths.len()
    );
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
        tracing::info!(
            "sftp_upload_files: created task {} for session {}",
            task_id,
            session_id
        );
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

                let result = sftp_mgr_clone
                    .execute_upload(
                        &session_mgr_clone,
                        &app_handle,
                        &task_id_clone,
                        chunk_size,
                        timeout_secs,
                    )
                    .await;

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
async fn ssh_env_get(
    ssh_mgr: tauri::State<'_, SessionManager>,
    session_id: String,
    name: String,
) -> Result<Option<String>, String> {
    if !name.chars().enumerate().all(|(idx, ch)| {
        ch == '_' || ch.is_ascii_alphanumeric() && (idx > 0 || !ch.is_ascii_digit())
    }) {
        return Err("Invalid environment variable name".to_string());
    }

    let session = ssh_mgr
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    ssh_mgr.touch_activity(&session_id);
    let output = session
        .lock()
        .await
        .exec_command(&format!("printenv {}", name))
        .await
        .map_err(|e| e.to_string())?;
    let value = output.trim_end_matches(['\r', '\n']).to_string();
    Ok(if value.is_empty() { None } else { Some(value) })
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
    let encrypted = host
        .secret_ref
        .clone()
        .ok_or_else(|| "No saved password".to_string())?;
    let password = decrypt_host_secret_with_lazy_migration(&db, &host_id, &encrypted).await?;

    let start = std::time::Instant::now();

    match core::ssh::SshSession::connect(&host_addr, port, &username, &password, &host_id, 30).await
    {
        Ok(mut sess) => {
            let latency = start.elapsed().as_millis() as u64;
            sess.disconnect().await;
            Ok(ConnectionTestResult {
                success: true,
                message: format!("Connected successfully ({}ms)", latency),
                latency_ms: Some(latency),
            })
        }
        Err(e) => Ok(ConnectionTestResult {
            success: false,
            message: format!("Connection failed: {}", e),
            latency_ms: None,
        }),
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
    session_mgr.touch_activity(&session_id);
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

            if !mmgr.should_continue(&cid) {
                break;
            }

            let secs = mmgr.get_config(&cid).map(|(_, i)| i).unwrap_or(2);
            tokio::time::sleep(Duration::from_secs(secs)).await;
        }

        mmgr.remove(&cid);
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
    db.list_commands(host_id.as_deref(), query.as_deref(), limit.unwrap_or(200))
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

// ── Commands: Terminal Bookmarks ──

#[tauri::command]
async fn terminal_bookmark_add(
    db: tauri::State<'_, Database>,
    host_id: String,
    path: String,
    label: Option<String>,
) -> Result<IdResponse, String> {
    let id = db
        .add_terminal_bookmark(&host_id, &path, label.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(IdResponse { id })
}

#[tauri::command]
async fn terminal_bookmark_remove(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<SuccessResponse, String> {
    db.remove_terminal_bookmark(&id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
async fn terminal_bookmark_list(
    db: tauri::State<'_, Database>,
    host_id: String,
) -> Result<Vec<core::store::TerminalBookmark>, String> {
    db.list_terminal_bookmarks(&host_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn terminal_bookmark_update(
    db: tauri::State<'_, Database>,
    id: String,
    path: String,
    label: Option<String>,
) -> Result<SuccessResponse, String> {
    db.update_terminal_bookmark(&id, &path, label.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
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
    let result =
        tokio::task::spawn_blocking(|| core::store::parse_ssh_config().map_err(|e| e.to_string()))
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
    target_asset: Option<ReleaseAssetInfo>,
    should_fallback_to_browser: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseAssetInfo {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn normalize_package_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "dmg" => Some("dmg"),
        "msi" => Some("msi"),
        "nsis" | "exe" => Some("exe"),
        "deb" => Some("deb"),
        "appimage" => Some("appimage"),
        _ => None,
    }
}

fn injected_package_type() -> Option<&'static str> {
    option_env!("DDSHELL_PACKAGE_TYPE").and_then(normalize_package_type)
}

fn bundled_package_type() -> Option<&'static str> {
    match tauri::utils::platform::bundle_type() {
        Some(tauri::utils::config::BundleType::App) => Some("dmg"),
        Some(tauri::utils::config::BundleType::Msi) => Some("msi"),
        Some(tauri::utils::config::BundleType::Nsis) => Some("exe"),
        Some(tauri::utils::config::BundleType::Deb) => Some("deb"),
        Some(tauri::utils::config::BundleType::AppImage) => Some("appimage"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn fallback_windows_install_type() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_lowercase();
            if path_str.contains("program files") {
                return Some("msi");
            }
            if path_str.contains(r"appdata\local") {
                return Some("exe");
            }
        }
    }
    None
}

fn current_package_type() -> Option<&'static str> {
    if let Some(package_type) = injected_package_type() {
        return Some(package_type);
    }

    if let Some(package_type) = bundled_package_type() {
        return Some(package_type);
    }

    #[cfg(target_os = "macos")]
    {
        return Some("dmg");
    }

    #[cfg(target_os = "windows")]
    {
        return fallback_windows_install_type();
    }

    #[cfg(target_os = "linux")]
    {
        None
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn normalized_msi_install_dir(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('"', "");
    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        value = format!(r"\\{}", stripped);
    } else if let Some(stripped) = value.strip_prefix(r"\\?\") {
        value = stripped.to_string();
    }

    while value.len() > 3 && (value.ends_with('\\') || value.ends_with('/')) {
        value.pop();
    }
    value
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn msi_install_location_args(install_dir: &Path) -> Vec<String> {
    let install_dir = normalized_msi_install_dir(install_dir);
    let quoted = format!("\"{}\"", install_dir);
    vec![
        format!("APPLICATIONFOLDER={quoted}"),
        format!("INSTALLDIR={quoted}"),
    ]
}

#[cfg(target_os = "windows")]
fn configure_windows_updater_builder(
    builder: tauri_plugin_updater::Builder,
) -> tauri_plugin_updater::Builder {
    if tauri::utils::platform::bundle_type() != Some(tauri::utils::config::BundleType::Msi) {
        return builder;
    }

    match std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        Some(install_dir) => builder.installer_args(msi_install_location_args(&install_dir)),
        None => builder,
    }
}

fn select_target_asset(assets: &[ReleaseAssetInfo]) -> Option<ReleaseAssetInfo> {
    #[cfg(target_os = "macos")]
    {
        let suffix = match std::env::consts::ARCH {
            "aarch64" => "-macos-aarch64.dmg",
            "x86_64" => "-macos-x86_64.dmg",
            _ => return None,
        };

        return assets
            .iter()
            .find(|asset| asset.name.ends_with(suffix))
            .cloned();
    }

    #[cfg(target_os = "windows")]
    {
        let package_type = current_package_type()?;
        let suffix = match package_type {
            "msi" => "-windows-x64.msi",
            "exe" => "-windows-x64.exe",
            _ => return None,
        };

        return assets
            .iter()
            .find(|asset| asset.name.ends_with(suffix))
            .cloned();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = assets;
        None
    }
}

#[tauri::command]
fn get_install_type() -> String {
    current_package_type().unwrap_or("unknown").to_string()
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
            target_asset: None,
            should_fallback_to_browser: false,
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

    let target_asset = select_target_asset(&assets);
    let should_fallback_to_browser = target_asset.is_none();

    Ok(UpdateCheckResult {
        has_update: true,
        latest_version: tag,
        assets,
        target_asset,
        should_fallback_to_browser,
        error: None,
    })
}

fn version_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse().ok()).collect() };
    let va = parse(a);
    let vb = parse(b);
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x > y {
            return true;
        }
        if x < y {
            return false;
        }
    }
    false
}

#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
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

            tokio::io::AsyncWriteExt::flush(&mut file)
                .await
                .map_err(|e| e.to_string())?;
            drop(file);
            let metadata = tokio::fs::metadata(&dest_clone)
                .await
                .map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err(format!(
                    "Downloaded installer is not a file: {}",
                    dest_str_clone
                ));
            }
            if total > 0 && metadata.len() != total {
                return Err(format!(
                    "Downloaded installer size mismatch: expected {} bytes, got {} bytes",
                    total,
                    metadata.len()
                ));
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

#[tauri::command]
async fn open_installer(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let installer_path = Path::new(&path);
        if !installer_path.exists() {
            return Err(format!("Installer not found: {}", path));
        }
        if !installer_path.is_file() {
            return Err(format!("Installer path is not a file: {}", path));
        }

        let output = std::process::Command::new("/usr/bin/open")
            .arg(installer_path)
            .output()
            .map_err(|e| format!("Failed to launch macOS installer opener: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let detail = if stderr.is_empty() {
                format!("exit status {}", output.status)
            } else {
                stderr
            };
            return Err(format!("Failed to open installer on macOS: {}", detail));
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let installer_path = Path::new(&path);
        if !installer_path.exists() {
            return Err(format!("Installer not found: {}", path));
        }
        if !installer_path.is_file() {
            return Err(format!("Installer path is not a file: {}", path));
        }

        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Err("open_installer_not_supported".to_string())
    }
}

/// Stream-normalize CRLF in raw SSH output.
/// Some servers/PAM modules send double CR (`\r\r\n`) around login banners,
/// which can make xterm return to the start of the current line and render the
/// shell prompt over MOTD text. SSH may split that sequence across output
/// chunks, so normalization has to keep small cross-chunk state.
#[derive(Default)]
struct CrLfNormalizer {
    pending_crs: usize,
    current_line_has_text: bool,
    post_cr_buffer: Vec<u8>,
}

impl CrLfNormalizer {
    fn normalize(&mut self, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(data.len());
        for &byte in data {
            if self.handle_post_cr_byte(&mut out, byte) {
                continue;
            }

            match byte {
                b'\r' => {
                    self.pending_crs += 1;
                    if self.pending_crs > 2 {
                        out.push(b'\r');
                        self.pending_crs = 2;
                    }
                }
                b'\n' => {
                    if self.pending_crs > 0 {
                        out.push(b'\r');
                        out.push(b'\n');
                        self.pending_crs = 0;
                        self.current_line_has_text = false;
                    } else {
                        out.push(b'\n');
                        self.current_line_has_text = false;
                    }
                }
                _ => {
                    if self.pending_crs == 1 && self.current_line_has_text && byte == b'\x1b' {
                        self.pending_crs = 0;
                        self.post_cr_buffer.push(byte);
                    } else if self.pending_crs == 1 && self.current_line_has_text && byte == b'[' {
                        out.push(b'\r');
                        out.push(b'\n');
                        self.current_line_has_text = false;
                        self.pending_crs = 0;
                        self.push_output_byte(&mut out, byte);
                    } else {
                        out.extend(std::iter::repeat_n(b'\r', self.pending_crs));
                        self.pending_crs = 0;
                        self.push_output_byte(&mut out, byte);
                    }
                }
            }
        }
        out
    }

    fn flush(&mut self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.post_cr_buffer.len() + self.pending_crs + 1);
        if !self.post_cr_buffer.is_empty() {
            out.push(b'\r');
            out.append(&mut self.post_cr_buffer);
        }
        out.extend(std::iter::repeat_n(b'\r', self.pending_crs));
        self.pending_crs = 0;
        out
    }

    fn push_output_byte(&mut self, out: &mut Vec<u8>, byte: u8) {
        out.push(byte);
        if byte >= 0x20 && byte != 0x7f {
            self.current_line_has_text = true;
        }
    }

    fn handle_post_cr_byte(&mut self, out: &mut Vec<u8>, byte: u8) -> bool {
        if self.post_cr_buffer.is_empty() {
            return false;
        }

        if !Self::ansi_chain_complete(&self.post_cr_buffer) {
            self.post_cr_buffer.push(byte);
            return true;
        }

        if byte == b'\x1b' {
            self.post_cr_buffer.push(byte);
            return true;
        }

        out.push(b'\r');
        if byte == b'[' {
            out.push(b'\n');
            self.current_line_has_text = false;
        }
        out.append(&mut self.post_cr_buffer);
        self.push_output_byte(out, byte);
        true
    }

    fn ansi_chain_complete(bytes: &[u8]) -> bool {
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != b'\x1b' {
                return false;
            }
            i += 1;
            if i >= bytes.len() {
                return false;
            }

            if bytes[i] == b'[' {
                i += 1;
                let mut found_final = false;
                while i < bytes.len() {
                    let byte = bytes[i];
                    i += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        found_final = true;
                        break;
                    }
                }
                if !found_final {
                    return false;
                }
            } else {
                i += 1;
            }
        }
        true
    }
}

fn emit_session_output_bytes(
    app: &tauri::AppHandle,
    session_id: &str,
    decoder: &mut Option<encoding_rs::Decoder>,
    output_data: &[u8],
) {
    if output_data.is_empty() {
        return;
    }
    if let Some(dec) = decoder {
        let mut output = String::with_capacity(output_data.len() * 2);
        let (_result, _read, _had_errors) = dec.decode_to_string(output_data, &mut output, false);
        event::emit_session_output(app, session_id, output.into_bytes());
    } else {
        event::emit_session_output(app, session_id, output_data.to_vec());
    }
}

/// Background async loop that reads SSH output and emits events.
/// Owns the Channel exclusively — write goes through Handle, resize goes through mpsc.
async fn output_reader_loop(
    app: tauri::AppHandle,
    session_mgr: SessionManager,
    mut channel: russh::Channel<russh::client::Msg>,
    mut cmd_rx: tokio::sync::mpsc::UnboundedReceiver<core::ssh::PtyCommand>,
    session_id: String,
    encoding: String,
) {
    tracing::info!(
        "[output_reader_loop] started for session {} (encoding: {})",
        session_id,
        encoding
    );

    let is_utf8 = encoding.eq_ignore_ascii_case("utf-8") || encoding.eq_ignore_ascii_case("utf8");
    let mut decoder = if !is_utf8 {
        encoding_rs::Encoding::for_label(encoding.as_bytes()).map(|enc| enc.new_decoder())
    } else {
        None
    };
    let mut crlf_normalizer = CrLfNormalizer::default();

    // Brief delay so the frontend React component can mount and register its
    // Tauri event listener before we start emitting output data.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        tracing::debug!("[output_reader_loop] received {} bytes for session {}", data.len(), session_id);
                        let normalized = crlf_normalizer.normalize(data);
                        emit_session_output_bytes(&app, &session_id, &mut decoder, &normalized);
                    }
                    Some(ChannelMsg::Eof) => {
                        tracing::info!("[output_reader_loop] EOF for session {}", session_id);
                        let trailing = crlf_normalizer.flush();
                        emit_session_output_bytes(&app, &session_id, &mut decoder, &trailing);
                        let _ = session_mgr.disconnect(&session_id).await;
                        event::emit_session_state(&app, &session_id, "disconnected");
                        break;
                    }
                    None => {
                        tracing::info!("[output_reader_loop] channel closed for session {}", session_id);
                        let trailing = crlf_normalizer.flush();
                        emit_session_output_bytes(&app, &session_id, &mut decoder, &trailing);
                        let _ = session_mgr.disconnect(&session_id).await;
                        event::emit_session_state(&app, &session_id, "disconnected");
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
                        let trailing = crlf_normalizer.flush();
                        emit_session_output_bytes(&app, &session_id, &mut decoder, &trailing);
                        break;
                    }
                }
            }
        }
    }
    tracing::info!("[output_reader_loop] exited for session {}", session_id);
}

// ── Quick Edit window ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuickEditOpenPayload {
    session_id: String,
    host_id: Option<String>,
    host_name: String,
    remote_path: String,
}

/// Open the Quick Edit window. Reuses the singleton window if already open,
/// otherwise creates it with the first file's payload encoded in the URL
/// (avoids the create→emit race for the very first tab).
#[tauri::command]
async fn quick_edit_open(app: AppHandle, payload: QuickEditOpenPayload) -> Result<(), String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window("quick-edit") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        window
            .emit("quick-edit:open-file", &payload)
            .map_err(|e| format!("emit open-file failed: {}", e))?;
        return Ok(());
    }

    let json =
        serde_json::to_string(&payload).map_err(|e| format!("serialize payload failed: {}", e))?;
    let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
    let url_path = format!("index.html?window=quick-edit&open={}", encoded);

    let builder = WebviewWindowBuilder::new(&app, "quick-edit", WebviewUrl::App(url_path.into()))
        .title("DdShell · Quick Edit")
        .inner_size(1100.0, 760.0)
        .min_inner_size(700.0, 480.0)
        .center();

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    let window = builder
        .build()
        .map_err(|e| format!("build quick-edit window failed: {}", e))?;

    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
        let _ = window.set_icon(icon);
    }

    Ok(())
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

    let updater_builder = tauri_plugin_updater::Builder::new();
    #[cfg(target_os = "windows")]
    let updater_builder = configure_windows_updater_builder(updater_builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater_builder.build())
        .setup(|app| {
            // Set window icon (for dev mode)
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                {
                    let _ = window.set_icon(icon);
                }
            }

            // Initialize managers immediately (sync)
            app.manage(SessionManager::new());
            app.manage(SftpManager::new(3));
            app.manage(MetricsManager::new());
            app.manage(WorkflowRunManager::new());

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
                            let all_cats: Vec<String> = ["git", "docker", "webServer", "devTools"]
                                .iter()
                                .map(|s| s.to_string())
                                .collect();
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
            app_platform_info,
            connection_create,
            connection_update,
            connection_delete,
            connection_list,
            connection_get,
            group_create,
            group_update,
            group_delete,
            group_list,
            snippet_group_create,
            snippet_group_update,
            snippet_group_delete,
            snippet_group_list,
            snippet_create,
            snippet_update,
            snippet_delete,
            snippet_list,
            workflow_group_create,
            workflow_group_update,
            workflow_group_delete,
            workflow_group_list,
            workflow_recipe_create,
            workflow_recipe_update,
            workflow_recipe_delete,
            workflow_recipe_get,
            workflow_recipe_list,
            workflow_run_start,
            workflow_run_get,
            workflow_run_list,
            command_assist_search,
            command_assist_weight_update,
            command_assist_weight_reset,
            command_assist_rebuild_index,
            command_assist_get_all,
            setting_get,
            setting_set,
            setting_set_many,
            terminal_import_background_image,
            ai_agent_config_get,
            ai_agent_config_save,
            ai_agent_profile_set_key,
            ai_agent_profile_clear_key,
            ai_agent_send,
            ai_agent_send_stream,
            session_connect,
            session_disconnect,
            session_touch_activity,
            session_write,
            session_resize,
            sftp_list_dir,
            sftp_canonicalize,
            sftp_mkdir,
            sftp_remove,
            sftp_rename,
            sftp_read_text,
            sftp_write_text,
            sftp_write_text_privileged,
            sftp_transfer_start,
            sftp_transfer_cancel,
            sftp_transfer_remove,
            sftp_transfer_list,
            sftp_transfer_clear,
            sftp_upload_files,
            system_detect,
            connection_test,
            ssh_ping,
            ssh_env_get,
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
            terminal_bookmark_add,
            terminal_bookmark_remove,
            terminal_bookmark_list,
            terminal_bookmark_update,
            ssh_config_import,
            list_system_fonts,
            download_update,
            check_update,
            get_install_type,
            open_installer,
            open_browser,
            quick_edit_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_background_extension_accepts_supported_images() {
        for (name, expected) in [
            ("wallpaper.PNG", "png"),
            ("photo.jpg", "jpg"),
            ("photo.JPEG", "jpeg"),
            ("image.webp", "webp"),
            ("loop.GIF", "gif"),
            ("bitmap.bmp", "bmp"),
        ] {
            assert_eq!(
                terminal_background_extension(Path::new(name)),
                Some(expected)
            );
        }
    }

    #[test]
    fn terminal_background_extension_rejects_unsupported_paths() {
        assert_eq!(terminal_background_extension(Path::new("secret.txt")), None);
        assert_eq!(
            terminal_background_extension(Path::new("no-extension")),
            None
        );
    }

    #[test]
    fn terminal_background_file_name_uses_hash_prefix_and_extension() {
        assert_eq!(
            terminal_background_file_name(
                "0123456789abcdef0123456789abcdef0123456789abcdef",
                "png"
            ),
            "0123456789abcdef0123456789abcdef.png"
        );
    }

    #[test]
    fn crlf_normalizer_collapses_double_cr_in_one_chunk() {
        let mut normalizer = CrLfNormalizer::default();

        let output = normalizer.normalize(b"Last login\r\r\n[root]# ");

        assert_eq!(output, b"Last login\r\n[root]# ");
        assert!(normalizer.flush().is_empty());
    }

    #[test]
    fn crlf_normalizer_collapses_double_cr_across_chunks() {
        let mut normalizer = CrLfNormalizer::default();

        let first = normalizer.normalize(b"failed login attempt\r");
        let second = normalizer.normalize(b"\r");
        let third = normalizer.normalize(b"\n[root]# ");

        assert_eq!(first, b"failed login attempt");
        assert!(second.is_empty());
        assert_eq!(third, b"\r\n[root]# ");
        assert!(normalizer.flush().is_empty());
    }

    #[test]
    fn crlf_normalizer_preserves_bare_trailing_cr_on_flush() {
        let mut normalizer = CrLfNormalizer::default();

        let output = normalizer.normalize(b"progress\r");

        assert_eq!(output, b"progress");
        assert_eq!(normalizer.flush(), b"\r");
    }

    #[test]
    fn crlf_normalizer_moves_bracket_prompt_after_banner_bare_cr() {
        let mut normalizer = CrLfNormalizer::default();

        let output = normalizer.normalize(
            b"There were 1 failed login attempts since the last successful login.\r[root@host ~]# ",
        );

        assert_eq!(
            output,
            b"There were 1 failed login attempts since the last successful login.\r\n[root@host ~]# "
        );
    }

    #[test]
    fn crlf_normalizer_moves_split_bracket_prompt_after_banner_bare_cr() {
        let mut normalizer = CrLfNormalizer::default();

        let first = normalizer
            .normalize(b"There were 1 failed login attempts since the last successful login.\r");
        let second = normalizer.normalize(b"[root@host ~]# ");

        assert_eq!(
            first,
            b"There were 1 failed login attempts since the last successful login."
        );
        assert_eq!(second, b"\r\n[root@host ~]# ");
    }

    #[test]
    fn crlf_normalizer_preserves_bare_cr_for_non_prompt_rewrite() {
        let mut normalizer = CrLfNormalizer::default();

        let output = normalizer.normalize(b"progress 10%\rprogress 20%");

        assert_eq!(output, b"progress 10%\rprogress 20%");
    }

    #[test]
    fn crlf_normalizer_moves_ansi_bracket_prompt_after_banner_bare_cr() {
        let mut normalizer = CrLfNormalizer::default();

        let output =
            normalizer.normalize(b"Last login: Sun Jun 28 06:21:04\r\x1b[0m[root@host ~]# ");

        assert_eq!(
            output,
            b"Last login: Sun Jun 28 06:21:04\r\n\x1b[0m[root@host ~]# "
        );
    }

    #[test]
    fn crlf_normalizer_moves_split_ansi_bracket_prompt_after_banner_bare_cr() {
        let mut normalizer = CrLfNormalizer::default();

        let first = normalizer.normalize(b"Last login: Sun Jun 28 06:21:04\r");
        let second = normalizer.normalize(b"\x1b[");
        let third = normalizer.normalize(b"0m");
        let fourth = normalizer.normalize(b"[root@host ~]# ");

        assert_eq!(first, b"Last login: Sun Jun 28 06:21:04");
        assert!(second.is_empty());
        assert!(third.is_empty());
        assert_eq!(fourth, b"\r\n\x1b[0m[root@host ~]# ");
    }

    #[test]
    fn crlf_normalizer_flushes_incomplete_post_cr_ansi() {
        let mut normalizer = CrLfNormalizer::default();

        let output = normalizer.normalize(b"Last login\r\x1b[");

        assert_eq!(output, b"Last login");
        assert_eq!(normalizer.flush(), b"\r\x1b[");
    }

    #[test]
    fn msi_install_location_args_quote_paths_with_spaces() {
        let args = msi_install_location_args(Path::new(r"D:\Tools\DdShell App"));

        assert_eq!(
            args,
            vec![
                r#"APPLICATIONFOLDER="D:\Tools\DdShell App""#.to_string(),
                r#"INSTALLDIR="D:\Tools\DdShell App""#.to_string(),
            ]
        );
    }

    #[test]
    fn msi_install_location_args_trim_non_root_trailing_separator() {
        let args = msi_install_location_args(Path::new(r"D:\Tools\DdShell\"));

        assert_eq!(
            args,
            vec![
                r#"APPLICATIONFOLDER="D:\Tools\DdShell""#.to_string(),
                r#"INSTALLDIR="D:\Tools\DdShell""#.to_string(),
            ]
        );
    }

    #[test]
    fn msi_install_location_args_keep_drive_root_separator() {
        let args = msi_install_location_args(Path::new(r"D:\"));

        assert_eq!(
            args,
            vec![
                r#"APPLICATIONFOLDER="D:\""#.to_string(),
                r#"INSTALLDIR="D:\""#.to_string(),
            ]
        );
    }

    #[test]
    fn msi_install_location_args_strip_extended_path_prefix() {
        let args = msi_install_location_args(Path::new(r"\\?\D:\Tools\DdShell App\"));

        assert_eq!(
            args,
            vec![
                r#"APPLICATIONFOLDER="D:\Tools\DdShell App""#.to_string(),
                r#"INSTALLDIR="D:\Tools\DdShell App""#.to_string(),
            ]
        );
    }
}
