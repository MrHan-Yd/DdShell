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
    #[serde(default)]
    pub secret: bool,
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

pub fn mask_command(command: &str, secret_keys: &std::collections::HashSet<String>, values: &HashMap<String, String>) -> String {
    let mut rendered = command.to_string();
    for key in secret_keys {
        if let Some(value) = values.get(key) {
            if value.is_empty() {
                continue;
            }
            let token = format!("{{{{{}}}}}", key);
            rendered = rendered.replace(&token, "******");
            let token_spaced = format!("{{{{ {} }}}}", key);
            rendered = rendered.replace(&token_spaced, "******");
            rendered = rendered.replace(value, "******");
        }
    }
    rendered
}

pub fn mask_params(values: &HashMap<String, String>, secret_keys: &std::collections::HashSet<String>) -> HashMap<String, String> {
    values
        .iter()
        .map(|(k, v)| {
            if secret_keys.contains(k) {
                (k.clone(), "******".to_string())
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect()
}

pub fn mask_run_for_event(run: &WorkflowRun, secret_keys: &std::collections::HashSet<String>) -> WorkflowRun {
    let masked_params = mask_params(&run.params, secret_keys);
    let masked_steps: Vec<WorkflowRunStepResult> = run.steps.iter().map(|step| {
        let mut s = step.clone();
        s.rendered_command = mask_command(&step.rendered_command, secret_keys, &run.params);
        s
    }).collect();
    WorkflowRun {
        id: run.id.clone(),
        recipe_id: run.recipe_id.clone(),
        recipe_title: run.recipe_title.clone(),
        host_id: run.host_id.clone(),
        state: run.state.clone(),
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        params: masked_params,
        steps: masked_steps,
        error: run.error.clone(),
    }
}

pub fn collect_secret_keys(params: &[WorkflowRecipeParam]) -> std::collections::HashSet<String> {
    params
        .iter()
        .filter(|p| p.secret)
        .map(|p| p.key.trim().to_string())
        .collect()
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

#[allow(dead_code)]
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

pub fn run_to_masked_record(run: &WorkflowRun, secret_keys: &std::collections::HashSet<String>) -> anyhow::Result<WorkflowRunRecord> {
    let masked_params = mask_params(&run.params, secret_keys);
    let masked_steps: Vec<WorkflowRunStepResult> = run.steps.iter().map(|step| {
        let mut s = step.clone();
        s.rendered_command = mask_command(&step.rendered_command, secret_keys, &run.params);
        s
    }).collect();
    Ok(WorkflowRunRecord {
        id: run.id.clone(),
        recipe_id: run.recipe_id.clone(),
        recipe_title: run.recipe_title.clone(),
        host_id: run.host_id.clone(),
        state: run.state.clone(),
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        params_json: serde_json::to_string(&masked_params)?,
        steps_json: serde_json::to_string(&masked_steps)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_interpolate_command_basic() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), "/srv/app".to_string());
        values.insert("service".to_string(), "nginx".to_string());
        let result = interpolate_command("cd {{dir}} && sudo systemctl restart {{service}}", &values);
        assert_eq!(result, "cd /srv/app && sudo systemctl restart nginx");
    }

    #[test]
    fn test_interpolate_command_spaced_tokens() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), "/srv/app".to_string());
        let result = interpolate_command("cd {{ dir }}", &values);
        assert_eq!(result, "cd /srv/app");
    }

    #[test]
    fn test_interpolate_command_missing_param_left_as_is() {
        let values = HashMap::new();
        let result = interpolate_command("echo {{missing}}", &values);
        assert_eq!(result, "echo {{missing}}");
    }

    #[test]
    fn test_interpolate_command_empty_value() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), String::new());
        let result = interpolate_command("cd {{dir}}", &values);
        assert_eq!(result, "cd ");
    }

    #[test]
    fn test_mask_command_masks_secrets() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), "/srv/app".to_string());
        values.insert("password".to_string(), "s3cret!".to_string());
        let mut secret_keys = HashSet::new();
        secret_keys.insert("password".to_string());
        let result = mask_command("cd {{dir}} && echo {{password}}", &secret_keys, &values);
        assert_eq!(result, "cd {{dir}} && echo ******");
    }

    #[test]
    fn test_mask_command_preserves_non_secrets() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), "/srv/app".to_string());
        values.insert("password".to_string(), "s3cret!".to_string());
        let mut secret_keys = HashSet::new();
        secret_keys.insert("password".to_string());
        let result = mask_command("cd {{dir}} && echo {{password}}", &secret_keys, &values);
        assert_eq!(result, "cd {{dir}} && echo ******");
    }

    #[test]
    fn test_mask_command_spaced_tokens() {
        let mut values = HashMap::new();
        values.insert("token".to_string(), "abc123".to_string());
        let mut secret_keys = HashSet::new();
        secret_keys.insert("token".to_string());
        let result = mask_command("curl -H {{ token }}", &secret_keys, &values);
        assert_eq!(result, "curl -H ******");
    }

    #[test]
    fn test_mask_command_empty_secret_value_not_masked() {
        let mut values = HashMap::new();
        values.insert("password".to_string(), String::new());
        let mut secret_keys = HashSet::new();
        secret_keys.insert("password".to_string());
        let result = mask_command("echo {{password}}", &secret_keys, &values);
        assert_eq!(result, "echo {{password}}");
    }

    #[test]
    fn test_mask_params_masks_secrets() {
        let mut values = HashMap::new();
        values.insert("dir".to_string(), "/srv/app".to_string());
        values.insert("password".to_string(), "s3cret!".to_string());
        let mut secret_keys = HashSet::new();
        secret_keys.insert("password".to_string());
        let masked = mask_params(&values, &secret_keys);
        assert_eq!(masked.get("dir").unwrap(), "/srv/app");
        assert_eq!(masked.get("password").unwrap(), "******");
    }

    #[test]
    fn test_collect_secret_keys() {
        let params = vec![
            WorkflowRecipeParam { key: "dir".to_string(), label: "Directory".to_string(), default_value: None, required: true, secret: false },
            WorkflowRecipeParam { key: "password".to_string(), label: "Password".to_string(), default_value: None, required: true, secret: true },
            WorkflowRecipeParam { key: "token".to_string(), label: "Token".to_string(), default_value: None, required: false, secret: true },
        ];
        let keys = collect_secret_keys(&params);
        assert_eq!(keys.len(), 2);
        assert!(keys.contains("password"));
        assert!(keys.contains("token"));
        assert!(!keys.contains("dir"));
    }

    #[test]
    fn test_resolve_param_values_defaults() {
        let params = vec![
            WorkflowRecipeParam { key: "dir".to_string(), label: "Directory".to_string(), default_value: Some("/var".to_string()), required: false, secret: false },
            WorkflowRecipeParam { key: "service".to_string(), label: "Service".to_string(), default_value: Some("nginx".to_string()), required: true, secret: false },
        ];
        let overrides = HashMap::new();
        let values = resolve_param_values(&params, &overrides).unwrap();
        assert_eq!(values.get("dir").unwrap(), "/var");
        assert_eq!(values.get("service").unwrap(), "nginx");
    }

    #[test]
    fn test_resolve_param_values_overrides() {
        let params = vec![
            WorkflowRecipeParam { key: "dir".to_string(), label: "Directory".to_string(), default_value: Some("/var".to_string()), required: false, secret: false },
        ];
        let mut overrides = HashMap::new();
        overrides.insert("dir".to_string(), "/opt".to_string());
        let values = resolve_param_values(&params, &overrides).unwrap();
        assert_eq!(values.get("dir").unwrap(), "/opt");
    }

    #[test]
    fn test_resolve_param_values_missing_required() {
        let params = vec![
            WorkflowRecipeParam { key: "service".to_string(), label: "Service".to_string(), default_value: None, required: true, secret: false },
        ];
        let overrides = HashMap::new();
        let result = resolve_param_values(&params, &overrides);
        assert!(result.is_err());
    }

    #[test]
    fn test_run_to_masked_record_masks_secrets() {
        let mut params = HashMap::new();
        params.insert("dir".to_string(), "/srv/app".to_string());
        params.insert("password".to_string(), "s3cret!".to_string());

        let steps = vec![WorkflowRunStepResult {
            step_id: "step-1".to_string(),
            title: "Deploy".to_string(),
            command: "cd {{dir}} && echo {{password}}".to_string(),
            rendered_command: "cd /srv/app && echo s3cret!".to_string(),
            state: "completed".to_string(),
            stdout: String::new(),
            stderr: String::new(),
            exit_code: Some(0),
            started_at: None,
            finished_at: None,
        }];

        let run = WorkflowRun {
            id: "run-1".to_string(),
            recipe_id: "recipe-1".to_string(),
            recipe_title: "Deploy".to_string(),
            host_id: "host-1".to_string(),
            state: "completed".to_string(),
            started_at: "2026-04-14T10:00:00Z".to_string(),
            finished_at: Some("2026-04-14T10:00:01Z".to_string()),
            params,
            steps,
            error: None,
        };

        let mut secret_keys = HashSet::new();
        secret_keys.insert("password".to_string());

        let record = run_to_masked_record(&run, &secret_keys).unwrap();

        let masked_params: HashMap<String, String> = serde_json::from_str(&record.params_json).unwrap();
        assert_eq!(masked_params.get("dir").unwrap(), "/srv/app");
        assert_eq!(masked_params.get("password").unwrap(), "******");

        let masked_steps: Vec<WorkflowRunStepResult> = serde_json::from_str(&record.steps_json).unwrap();
        assert_eq!(masked_steps[0].rendered_command, "cd /srv/app && echo ******");
        assert_eq!(masked_steps[0].command, "cd {{dir}} && echo {{password}}");
    }

    #[test]
    fn test_mask_run_for_event() {
        let mut params = HashMap::new();
        params.insert("db_password".to_string(), "hunter2".to_string());
        params.insert("port".to_string(), "8080".to_string());

        let run = WorkflowRun {
            id: "run-1".to_string(),
            recipe_id: "recipe-1".to_string(),
            recipe_title: "Test".to_string(),
            host_id: "host-1".to_string(),
            state: "running".to_string(),
            started_at: "2026-04-14T10:00:00Z".to_string(),
            finished_at: None,
            params,
            steps: vec![WorkflowRunStepResult {
                step_id: "s1".to_string(),
                title: "Connect".to_string(),
                command: "psql -p {{port}} -W {{db_password}}".to_string(),
                rendered_command: "psql -p 8080 -W hunter2".to_string(),
                state: "running".to_string(),
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                started_at: None,
                finished_at: None,
            }],
            error: None,
        };

        let mut secret_keys = HashSet::new();
        secret_keys.insert("db_password".to_string());

        let masked = mask_run_for_event(&run, &secret_keys);
        assert_eq!(masked.params.get("db_password").unwrap(), "******");
        assert_eq!(masked.params.get("port").unwrap(), "8080");
        assert_eq!(masked.steps[0].rendered_command, "psql -p 8080 -W ******");
        assert_eq!(masked.steps[0].command, "psql -p {{port}} -W {{db_password}}");
        assert_eq!(run.params.get("db_password").unwrap(), "hunter2");
    }

    #[test]
    fn test_secret_param_deserialization_backward_compat() {
        let json_without_secret = r#"{"key":"dir","label":"Directory","defaultValue":"/var","required":true}"#;
        let param: WorkflowRecipeParam = serde_json::from_str(json_without_secret).unwrap();
        assert_eq!(param.key, "dir");
        assert!(!param.secret);

        let json_with_secret = r#"{"key":"password","label":"Password","defaultValue":null,"required":true,"secret":true}"#;
        let param: WorkflowRecipeParam = serde_json::from_str(json_with_secret).unwrap();
        assert_eq!(param.key, "password");
        assert!(param.secret);
    }
}
