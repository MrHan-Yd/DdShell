use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event names — aligned with TECH-SPEC §5
pub const SESSION_STATE_CHANGED: &str = "session:state_changed";
pub const SESSION_OUTPUT: &str = "session:output";
pub const TRANSFER_PROGRESS: &str = "transfer:progress";
pub const TRANSFER_COMPLETED: &str = "transfer:completed";
pub const TRANSFER_FAILED: &str = "transfer:failed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateEvent {
    pub session_id: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputEvent {
    pub session_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub task_id: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCompletedEvent {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFailedEvent {
    pub task_id: String,
    pub error: String,
}

pub fn emit_session_state(app: &AppHandle, session_id: &str, state: &str) {
    let _ = app.emit(
        SESSION_STATE_CHANGED,
        SessionStateEvent {
            session_id: session_id.to_string(),
            state: state.to_string(),
        },
    );
}

pub fn emit_session_output(app: &AppHandle, session_id: &str, data: Vec<u8>) {
    let _ = app.emit(
        SESSION_OUTPUT,
        SessionOutputEvent {
            session_id: session_id.to_string(),
            data,
        },
    );
}

pub fn emit_transfer_progress(
    app: &AppHandle,
    task_id: &str,
    transferred_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_sec: u64,
) {
    let _ = app.emit(
        TRANSFER_PROGRESS,
        TransferProgressEvent {
            task_id: task_id.to_string(),
            transferred_bytes,
            total_bytes,
            speed_bytes_per_sec,
        },
    );
}

pub fn emit_transfer_completed(app: &AppHandle, task_id: &str) {
    let _ = app.emit(
        TRANSFER_COMPLETED,
        TransferCompletedEvent {
            task_id: task_id.to_string(),
        },
    );
}

pub fn emit_transfer_failed(app: &AppHandle, task_id: &str, error: &str) {
    let _ = app.emit(
        TRANSFER_FAILED,
        TransferFailedEvent {
            task_id: task_id.to_string(),
            error: error.to_string(),
        },
    );
}

// ── Metrics events ──

pub const METRICS_UPDATED: &str = "metrics:updated";
pub const METRICS_COLLECTOR_STATE: &str = "metrics:collector_state_changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsUpdatedEvent {
    pub collector_id: String,
    pub snapshot: crate::core::metrics::MetricsSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsCollectorStateEvent {
    pub collector_id: String,
    pub state: String,
}

pub fn emit_metrics_updated(
    app: &AppHandle,
    collector_id: &str,
    snapshot: crate::core::metrics::MetricsSnapshot,
) {
    let _ = app.emit(
        METRICS_UPDATED,
        MetricsUpdatedEvent {
            collector_id: collector_id.to_string(),
            snapshot,
        },
    );
}

pub fn emit_metrics_collector_state(app: &AppHandle, collector_id: &str, state: &str) {
    let _ = app.emit(
        METRICS_COLLECTOR_STATE,
        MetricsCollectorStateEvent {
            collector_id: collector_id.to_string(),
            state: state.to_string(),
        },
    );
}

// ── Update download events ──

pub const UPDATE_DOWNLOAD_PROGRESS: &str = "update:download_progress";
pub const UPDATE_DOWNLOAD_COMPLETED: &str = "update:download_completed";
pub const UPDATE_DOWNLOAD_FAILED: &str = "update:download_failed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgressEvent {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadCompletedEvent {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadFailedEvent {
    pub error: String,
}

pub fn emit_update_download_progress(
    app: &AppHandle,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    let _ = app.emit(
        UPDATE_DOWNLOAD_PROGRESS,
        UpdateDownloadProgressEvent {
            downloaded_bytes,
            total_bytes,
        },
    );
}

pub fn emit_update_download_completed(app: &AppHandle, path: &str) {
    let _ = app.emit(
        UPDATE_DOWNLOAD_COMPLETED,
        UpdateDownloadCompletedEvent {
            path: path.to_string(),
        },
    );
}

pub fn emit_update_download_failed(app: &AppHandle, error: &str) {
    let _ = app.emit(
        UPDATE_DOWNLOAD_FAILED,
        UpdateDownloadFailedEvent {
            error: error.to_string(),
        },
    );
}
