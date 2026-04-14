use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::core::ssh::{ExecCommandResult, SshSession};
use crate::core::store::{Database, WorkflowRecipe, WorkflowRunRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRecipeParam {
    pub key: String,
    pub label: String,
    pub default_value: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRecipeStep {
    pub id: String,
    pub title: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunStepResult {
    pub step_id: String,
    pub title: String,
    pub command: String,
    pub rendered_command: String,
    pub state: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: String,
    pub recipe_id: String,
    pub recipe_title: String,
    pub host_id: String,
    pub state: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub params: HashMap<String, String>,
    pub steps: Vec<WorkflowRunStepResult>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct WorkflowRunManager {
    runs: Arc<Mutex<HashMap<String, WorkflowRun>>>,
}

impl WorkflowRunManager {
    pub fn new() -> Self {
        Self {
            runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert(&self, run: WorkflowRun) {
        self.runs.lock().insert(run.id.clone(), run);
    }

    pub fn update(&self, run: WorkflowRun) {
        self.runs.lock().insert(run.id.clone(), run);
    }

    pub fn get(&self, run_id: &str) -> Option<WorkflowRun> {
        self.runs.lock().get(run_id).cloned()
    }
}

pub fn parse_recipe_params(recipe: &WorkflowRecipe) -> anyhow::Result<Vec<WorkflowRecipeParam>> {
    Ok(serde_json::from_str(&recipe.params_json)?)
}

pub fn parse_recipe_steps(recipe: &WorkflowRecipe) -> anyhow::Result<Vec<WorkflowRecipeStep>> {
    Ok(serde_json::from_str(&recipe.steps_json)?)
}

pub async fn resolve_host_and_password(
    db: &Database,
    host_id: &str,
) -> anyhow::Result<(String, String, String, u16, String)> {
    let host = db
        .get_host(host_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Host not found"))?;
    let encrypted = host
        .secret_ref
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No saved password"))?;
    let password = crate::core::secret::decrypt(&encrypted)?;
    Ok((host.id, host.host, host.username, host.port as u16, password))
}

pub fn interpolate_command(command: &str, values: &HashMap<String, String>) -> String {
    let mut rendered = command.to_string();
    for (key, value) in values {
        let token = format!("{{{{{}}}}}", key);
        rendered = rendered.replace(&token, value);
        let token_spaced = format!("{{{{ {} }}}}", key);
        rendered = rendered.replace(&token_spaced, value);
    }
    rendered
}

pub fn resolve_param_values(
    params: &[WorkflowRecipeParam],
    overrides: &HashMap<String, String>,
) -> anyhow::Result<HashMap<String, String>> {
    let mut values = HashMap::new();
    for param in params {
        let key = param.key.trim().to_string();
        let value = overrides
            .get(&key)
            .cloned()
            .unwrap_or_else(|| param.default_value.clone().unwrap_or_default());
        if param.required && value.trim().is_empty() {
            anyhow::bail!("Required workflow param missing: {}", key);
        }
        values.insert(key, value);
    }
    Ok(values)
}

pub async fn execute_step(session: &SshSession, command: &str) -> anyhow::Result<ExecCommandResult> {
    session.exec_command_detailed(command).await
}

pub fn create_run(
    recipe: &WorkflowRecipe,
    host_id: &str,
    steps: &[WorkflowRecipeStep],
    params: HashMap<String, String>,
) -> WorkflowRun {
    WorkflowRun {
        id: Uuid::new_v4().to_string(),
        recipe_id: recipe.id.clone(),
        recipe_title: recipe.title.clone(),
        host_id: host_id.to_string(),
        state: "running".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        finished_at: None,
        params,
        steps: steps
            .iter()
            .map(|step| WorkflowRunStepResult {
                step_id: step.id.clone(),
                title: step.title.clone(),
                command: step.command.clone(),
                rendered_command: step.command.clone(),
                state: "pending".to_string(),
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                started_at: None,
                finished_at: None,
            })
            .collect(),
        error: None,
    }
}

pub fn run_to_record(run: &WorkflowRun) -> anyhow::Result<WorkflowRunRecord> {
    Ok(WorkflowRunRecord {
        id: run.id.clone(),
        recipe_id: run.recipe_id.clone(),
        recipe_title: run.recipe_title.clone(),
        host_id: run.host_id.clone(),
        state: run.state.clone(),
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        params_json: serde_json::to_string(&run.params)?,
        steps_json: serde_json::to_string(&run.steps)?,
        error: run.error.clone(),
    })
}

pub fn record_to_run(record: WorkflowRunRecord) -> anyhow::Result<WorkflowRun> {
    Ok(WorkflowRun {
        id: record.id,
        recipe_id: record.recipe_id,
        recipe_title: record.recipe_title,
        host_id: record.host_id,
        state: record.state,
        started_at: record.started_at,
        finished_at: record.finished_at,
        params: serde_json::from_str(&record.params_json)?,
        steps: serde_json::from_str(&record.steps_json)?,
        error: record.error,
    })
}
