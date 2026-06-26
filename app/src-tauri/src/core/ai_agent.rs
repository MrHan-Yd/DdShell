use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::core::secret;
use crate::core::store::Database;

const KEY_ENABLED: &str = "aiAgent.enabled";
const KEY_DEFAULT_PROFILE: &str = "aiAgent.defaultProfileId";
const KEY_EXECUTION_MODE: &str = "aiAgent.executionMode";
const KEY_CONFIRM_BEFORE_EXECUTE: &str = "aiAgent.confirmBeforeExecute";
const KEY_TIMEOUT_SEC: &str = "aiAgent.timeoutSec";
const KEY_PROFILES: &str = "aiAgent.profiles";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentProtocol {
    OpenaiChat,
    OpenaiResponses,
    ClaudeMessages,
    GeminiGenerateContent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentExecutionMode {
    Run,
    Insert,
}

impl Default for AiAgentExecutionMode {
    fn default() -> Self {
        Self::Run
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentProfile {
    pub id: String,
    pub name: String,
    pub protocol: AiAgentProtocol,
    pub base_url: String,
    pub model: String,
    pub context_window_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub api_key_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentConfig {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub execution_mode: AiAgentExecutionMode,
    pub confirm_before_execute: bool,
    pub timeout_sec: Option<u64>,
    pub profiles: Vec<AiAgentProfile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentConfigSaveReq {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub execution_mode: AiAgentExecutionMode,
    #[serde(default = "default_true")]
    pub confirm_before_execute: bool,
    pub timeout_sec: Option<u64>,
    pub profiles: Vec<AiAgentProfile>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentTerminalContext {
    pub tab_title: Option<String>,
    pub cwd: Option<String>,
    pub selected_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentSendReq {
    pub profile_id: String,
    pub question: String,
    pub context: Option<AiAgentTerminalContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentCommand {
    pub command: String,
    pub description: String,
    pub risk: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentSendResponse {
    pub answer: String,
    pub command_mode: String,
    pub commands: Vec<AiAgentCommand>,
    pub raw_text: String,
    pub parse_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfile {
    id: String,
    name: String,
    protocol: AiAgentProtocol,
    base_url: String,
    model: String,
    #[serde(default)]
    context_window_tokens: Option<u32>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    #[serde(default)]
    timeout_sec: Option<u64>,
}

impl From<&AiAgentProfile> for StoredProfile {
    fn from(profile: &AiAgentProfile) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            protocol: profile.protocol.clone(),
            base_url: profile.base_url.clone(),
            model: profile.model.clone(),
            context_window_tokens: profile.context_window_tokens,
            temperature: profile.temperature,
            max_tokens: profile.max_tokens,
            timeout_sec: None,
        }
    }
}

impl StoredProfile {
    fn into_profile(self, api_key_set: bool) -> AiAgentProfile {
        AiAgentProfile {
            id: self.id,
            name: self.name,
            protocol: self.protocol,
            base_url: self.base_url,
            model: self.model,
            context_window_tokens: self.context_window_tokens,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            api_key_set,
        }
    }
}

pub async fn get_config(db: &Database) -> anyhow::Result<AiAgentConfig> {
    let enabled = db
        .get_setting(KEY_ENABLED)
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);
    let default_profile_id = db
        .get_setting(KEY_DEFAULT_PROFILE)
        .await?
        .and_then(|v| if v.trim().is_empty() { None } else { Some(v) });
    let execution_mode = match db.get_setting(KEY_EXECUTION_MODE).await?.as_deref() {
        Some("insert") => AiAgentExecutionMode::Insert,
        _ => AiAgentExecutionMode::Run,
    };
    let confirm_before_execute = db
        .get_setting(KEY_CONFIRM_BEFORE_EXECUTE)
        .await?
        .map(|v| v != "false")
        .unwrap_or(true);
    let stored_profiles: Vec<StoredProfile> = match db.get_setting(KEY_PROFILES).await? {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).unwrap_or_default(),
        _ => Vec::new(),
    };
    let legacy_timeout_sec = stored_profiles.iter().find_map(|profile| profile.timeout_sec);
    let timeout_sec = db
        .get_setting(KEY_TIMEOUT_SEC)
        .await?
        .and_then(|value| value.parse::<u64>().ok())
        .or(legacy_timeout_sec)
        .or(Some(60));

    let mut profiles = Vec::with_capacity(stored_profiles.len());
    for stored in stored_profiles {
        let key_set = db
            .get_setting(&profile_key_setting(&stored.id))
            .await?
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        profiles.push(stored.into_profile(key_set));
    }

    Ok(AiAgentConfig {
        enabled,
        default_profile_id,
        execution_mode,
        confirm_before_execute,
        timeout_sec,
        profiles,
    })
}

pub async fn save_config(db: &Database, req: AiAgentConfigSaveReq) -> anyhow::Result<AiAgentConfig> {
    let mut profiles = Vec::with_capacity(req.profiles.len());
    for mut profile in req.profiles {
        if profile.id.trim().is_empty() {
            profile.id = Uuid::new_v4().to_string();
        }
        profiles.push(profile);
    }

    let stored: Vec<StoredProfile> = profiles.iter().map(StoredProfile::from).collect();
    db.set_setting(KEY_ENABLED, if req.enabled { "true" } else { "false" })
        .await?;
    db.set_setting(
        KEY_EXECUTION_MODE,
        match req.execution_mode {
            AiAgentExecutionMode::Run => "run",
            AiAgentExecutionMode::Insert => "insert",
        },
    )
    .await?;
    db.set_setting(
        KEY_CONFIRM_BEFORE_EXECUTE,
        if req.confirm_before_execute { "true" } else { "false" },
    )
    .await?;
    db.set_setting(
        KEY_DEFAULT_PROFILE,
        req.default_profile_id.as_deref().unwrap_or_default(),
    )
    .await?;
    db.set_setting(KEY_TIMEOUT_SEC, &req.timeout_sec.unwrap_or(60).to_string())
        .await?;
    db.set_setting(KEY_PROFILES, &serde_json::to_string(&stored)?)
        .await?;

    get_config(db).await
}

pub async fn set_profile_key(db: &Database, profile_id: &str, api_key: &str) -> anyhow::Result<()> {
    let encrypted = secret::encrypt(api_key)?;
    db.set_setting(&profile_key_setting(profile_id), &encrypted).await
}

pub async fn clear_profile_key(db: &Database, profile_id: &str) -> anyhow::Result<()> {
    db.set_setting(&profile_key_setting(profile_id), "").await
}

pub async fn send(db: &Database, req: AiAgentSendReq) -> anyhow::Result<AiAgentSendResponse> {
    let config = get_config(db).await?;
    if !config.enabled {
        anyhow::bail!("AI Agent is disabled");
    }
    let profile = config
        .profiles
        .into_iter()
        .find(|p| p.id == req.profile_id)
        .ok_or_else(|| anyhow::anyhow!("AI profile not found"))?;
    if profile.base_url.trim().is_empty() {
        anyhow::bail!("AI profile base URL is empty");
    }
    if profile.model.trim().is_empty() {
        anyhow::bail!("AI profile model is empty");
    }

    let encrypted = db
        .get_setting(&profile_key_setting(&profile.id))
        .await?
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("AI profile API key is not configured"))?;
    let api_key = secret::decrypt(&encrypted)?;
    let raw_text = call_provider(&profile, config.timeout_sec, &api_key, &req).await?;
    Ok(parse_agent_response(&raw_text))
}

fn profile_key_setting(profile_id: &str) -> String {
    format!("aiAgent.profile.{}.apiKey", profile_id)
}

async fn call_provider(
    profile: &AiAgentProfile,
    timeout_sec: Option<u64>,
    api_key: &str,
    req: &AiAgentSendReq,
) -> anyhow::Result<String> {
    let timeout = Duration::from_secs(timeout_sec.unwrap_or(60).clamp(5, 300));
    let client = reqwest::Client::builder().timeout(timeout).build()?;
    let system_prompt = system_prompt();
    let user_prompt = user_prompt(req, profile.context_window_tokens);

    match profile.protocol {
        AiAgentProtocol::OpenaiChat => call_openai_chat(&client, profile, api_key, system_prompt, &user_prompt).await,
        AiAgentProtocol::OpenaiResponses => call_openai_responses(&client, profile, api_key, system_prompt, &user_prompt).await,
        AiAgentProtocol::ClaudeMessages => call_claude_messages(&client, profile, api_key, system_prompt, &user_prompt).await,
        AiAgentProtocol::GeminiGenerateContent => call_gemini(&client, profile, api_key, system_prompt, &user_prompt).await,
    }
}

async fn call_openai_chat(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let url = join_url(&profile.base_url, "chat/completions");
    let body = json!({
        "model": profile.model,
        "temperature": profile.temperature.unwrap_or(0.2),
        "max_tokens": profile.max_tokens.unwrap_or(1200),
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ]
    });
    let value = post_json(client, &url, bearer_headers(api_key)?, body).await?;
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("OpenAI chat response did not include message content"))
}

async fn call_openai_responses(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let url = join_url(&profile.base_url, "responses");
    let body = json!({
        "model": profile.model,
        "temperature": profile.temperature.unwrap_or(0.2),
        "max_output_tokens": profile.max_tokens.unwrap_or(1200),
        "instructions": system_prompt,
        "input": user_prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "terminal_command_assistant",
                "schema": response_schema()
            }
        }
    });
    let value = post_json(client, &url, bearer_headers(api_key)?, body).await?;
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    collect_text_fields(&value)
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("OpenAI responses output did not include text"))
}

async fn call_claude_messages(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let url = join_url(&profile.base_url, "messages");
    let body = json!({
        "model": profile.model,
        "system": system_prompt,
        "max_tokens": profile.max_tokens.unwrap_or(1200),
        "temperature": profile.temperature.unwrap_or(0.2),
        "messages": [
            { "role": "user", "content": user_prompt }
        ]
    });
    let mut headers = json_headers();
    headers.insert("x-api-key", HeaderValue::from_str(api_key)?);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    let value = post_json(client, &url, headers, body).await?;
    let texts: Vec<String> = value
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str).map(ToOwned::to_owned))
        .collect();
    if texts.is_empty() {
        anyhow::bail!("Claude response did not include text content");
    }
    Ok(texts.join("\n"))
}

async fn call_gemini(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let path = format!("models/{}:generateContent", profile.model);
    let url = join_url(&profile.base_url, &path);
    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": system_prompt }]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{ "text": user_prompt }]
            }
        ],
        "generationConfig": {
            "temperature": profile.temperature.unwrap_or(0.2),
            "maxOutputTokens": profile.max_tokens.unwrap_or(1200),
            "responseMimeType": "application/json",
            "responseSchema": response_schema()
        }
    });
    let mut headers = json_headers();
    headers.insert("x-goog-api-key", HeaderValue::from_str(api_key)?);
    let value = post_json(client, &url, headers, body).await?;
    let texts: Vec<String> = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str).map(ToOwned::to_owned))
        .collect();
    if texts.is_empty() {
        anyhow::bail!("Gemini response did not include text content");
    }
    Ok(texts.join("\n"))
}

async fn post_json(
    client: &reqwest::Client,
    url: &str,
    headers: HeaderMap,
    body: Value,
) -> anyhow::Result<Value> {
    let response = client.post(url).headers(headers).json(&body).send().await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        let safe = text.chars().take(500).collect::<String>();
        anyhow::bail!("AI provider request failed ({}): {}", status.as_u16(), safe);
    }
    serde_json::from_str(&text).map_err(|e| anyhow::anyhow!("AI provider returned invalid JSON: {}", e))
}

fn bearer_headers(api_key: &str) -> anyhow::Result<HeaderMap> {
    let mut headers = json_headers();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key))?,
    );
    Ok(headers)
}

fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
}

fn join_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let path = path.trim_start_matches('/');
    if base.ends_with(path) {
        base.to_string()
    } else {
        format!("{}/{}", base, path)
    }
}

fn system_prompt() -> &'static str {
    r#"You are a terminal command assistant inside an SSH terminal application.
Return ONLY valid JSON. Do not wrap it in markdown. Do not include text outside JSON.
Use this schema:
{
  "answer": "short explanation for the user",
  "commandMode": "alternatives | steps",
  "commands": [
    {
      "command": "single shell command",
      "description": "why this command should be run",
      "risk": "low | medium | high",
      "confidence": "low | medium | high"
    }
  ]
}
Use commandMode "alternatives" when the commands are choices where running one is enough, for example ls vs ls -la.
Use commandMode "steps" when commands should be run in order as a workflow, for example inspect status, then inspect logs, then validate config.
Only suggest shell commands that answer the user's request. Prefer safe diagnostic commands.
Do not suggest destructive commands unless the user explicitly asks for them."#
}

fn user_prompt(req: &AiAgentSendReq, context_window_tokens: Option<u32>) -> String {
    let mut prompt = String::new();
    prompt.push_str("User question:\n");
    prompt.push_str(req.question.trim());
    if let Some(context) = &req.context {
        prompt.push_str("\n\nTerminal context:");
        if let Some(tab_title) = &context.tab_title {
            if !tab_title.trim().is_empty() {
                prompt.push_str("\n- Tab: ");
                prompt.push_str(tab_title.trim());
            }
        }
        if let Some(cwd) = &context.cwd {
            if !cwd.trim().is_empty() {
                prompt.push_str("\n- Current directory: ");
                prompt.push_str(cwd.trim());
            }
        }
        if let Some(selected_text) = &context.selected_text {
            if !selected_text.trim().is_empty() {
                prompt.push_str("\n- Selected terminal text:\n");
                prompt.push_str(&trim_context_text(selected_text.trim(), context_window_tokens));
            }
        }
    }
    prompt
}

fn trim_context_text(text: &str, context_window_tokens: Option<u32>) -> String {
    let budget_tokens = context_window_tokens.unwrap_or(8_000).clamp(1_000, 1_000_000);
    let max_chars = (budget_tokens as usize).saturating_mul(3);
    if text.len() <= max_chars {
        return text.to_string();
    }

    let keep_tail = max_chars.saturating_sub(120);
    let tail_start = text
        .char_indices()
        .rev()
        .nth(keep_tail)
        .map(|(idx, _)| idx)
        .unwrap_or(0);
    format!(
        "[truncated to fit configured context window: last {} chars]\n{}",
        text.len().saturating_sub(tail_start),
        &text[tail_start..]
    )
}

fn response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "answer": { "type": "string" },
            "commandMode": { "type": "string", "enum": ["alternatives", "steps"] },
            "commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "command": { "type": "string" },
                        "description": { "type": "string" },
                        "risk": { "type": "string", "enum": ["low", "medium", "high"] },
                        "confidence": { "type": "string", "enum": ["low", "medium", "high"] }
                    },
                    "required": ["command", "description", "risk", "confidence"]
                }
            }
        },
        "required": ["answer", "commandMode", "commands"]
    })
}

fn parse_agent_response(raw_text: &str) -> AiAgentSendResponse {
    if let Some(response) = parse_json_response(raw_text, "json") {
        return response;
    }
    if let Some(block) = fenced_block(raw_text, &["json"]) {
        if let Some(response) = parse_json_response(&block, "jsonBlock") {
            return response;
        }
    }
    if let Some(object) = first_json_object(raw_text) {
        if let Some(response) = parse_json_response(&object, "jsonObject") {
            return response;
        }
    }
    let shell_commands = shell_blocks(raw_text);
    if !shell_commands.is_empty() {
        return AiAgentSendResponse {
            answer: raw_text.trim().to_string(),
            command_mode: "steps".to_string(),
            commands: shell_commands
                .into_iter()
                .map(|command| AiAgentCommand {
                    command,
                    description: "AI suggested command".to_string(),
                    risk: "medium".to_string(),
                    confidence: "medium".to_string(),
                })
                .collect(),
            raw_text: raw_text.to_string(),
            parse_mode: "shellBlock".to_string(),
        };
    }

    AiAgentSendResponse {
        answer: raw_text.trim().to_string(),
        command_mode: "alternatives".to_string(),
        commands: Vec::new(),
        raw_text: raw_text.to_string(),
        parse_mode: "none".to_string(),
    }
}

fn parse_json_response(raw: &str, parse_mode: &str) -> Option<AiAgentSendResponse> {
    let value: Value = serde_json::from_str(raw.trim()).ok()?;
    let answer = value
        .get("answer")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let commands = value
        .get("commands")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let command = item.get("command")?.as_str()?.trim();
                    if command.is_empty() {
                        return None;
                    }
                    Some(AiAgentCommand {
                        command: command.to_string(),
                        description: item
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("AI suggested command")
                            .trim()
                            .to_string(),
                        risk: normalize_level(item.get("risk").and_then(Value::as_str), "medium"),
                        confidence: normalize_level(
                            item.get("confidence").and_then(Value::as_str),
                            "medium",
                        ),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let command_mode = normalize_command_mode(
        value
            .get("commandMode")
            .or_else(|| value.get("command_mode"))
            .or_else(|| value.get("groupType"))
            .or_else(|| value.get("mode"))
            .and_then(Value::as_str),
        &answer,
        &commands,
    );
    Some(AiAgentSendResponse {
        answer,
        command_mode,
        commands,
        raw_text: raw.to_string(),
        parse_mode: parse_mode.to_string(),
    })
}

fn normalize_command_mode(
    value: Option<&str>,
    answer: &str,
    commands: &[AiAgentCommand],
) -> String {
    match value.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "steps" | "step" | "sequence" | "workflow" => return "steps".to_string(),
        "alternatives" | "alternative" | "choices" | "choice" | "options" => {
            return "alternatives".to_string();
        }
        _ => {}
    }

    if commands.len() > 1 && looks_like_steps(answer, commands) {
        "steps".to_string()
    } else {
        "alternatives".to_string()
    }
}

fn looks_like_steps(answer: &str, commands: &[AiAgentCommand]) -> bool {
    let answer = answer.to_ascii_lowercase();
    if answer.contains("step")
        || answer.contains("then")
        || answer.contains("first")
        || answer.contains("next")
        || answer.contains("步骤")
        || answer.contains("然后")
        || answer.contains("先")
        || answer.contains("接着")
    {
        return true;
    }

    commands.iter().any(|command| {
        let description = command.description.to_ascii_lowercase();
        description.contains("step")
            || description.contains("then")
            || description.contains("first")
            || description.contains("next")
            || description.contains("步骤")
            || description.contains("然后")
            || description.contains("先")
            || description.contains("接着")
    })
}

fn normalize_level(value: Option<&str>, fallback: &str) -> String {
    match value.unwrap_or(fallback).trim().to_ascii_lowercase().as_str() {
        "low" => "low".to_string(),
        "high" => "high".to_string(),
        _ => "medium".to_string(),
    }
}

fn fenced_block(raw: &str, languages: &[&str]) -> Option<String> {
    let blocks = fenced_blocks(raw, languages);
    blocks.into_iter().next()
}

fn shell_blocks(raw: &str) -> Vec<String> {
    fenced_blocks(raw, &["shell", "bash", "sh"])
        .into_iter()
        .flat_map(|block| {
            block
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn fenced_blocks(raw: &str, languages: &[&str]) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut in_block = false;
    let mut capture = false;
    let mut current = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("```") {
            if in_block {
                if capture {
                    blocks.push(current.trim().to_string());
                }
                in_block = false;
                capture = false;
                current.clear();
            } else {
                let lang = rest.trim().to_ascii_lowercase();
                in_block = true;
                capture = languages.iter().any(|candidate| lang == *candidate);
            }
            continue;
        }

        if in_block && capture {
            current.push_str(line);
            current.push('\n');
        }
    }

    blocks
}

fn first_json_object(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end = start + offset + ch.len_utf8();
                    return Some(raw[start..end].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

fn collect_text_fields(value: &Value) -> Vec<String> {
    let mut texts = Vec::new();
    collect_text_fields_inner(value, &mut texts);
    texts
}

fn collect_text_fields_inner(value: &Value, texts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                texts.push(text.to_string());
            }
            for child in map.values() {
                collect_text_fields_inner(child, texts);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_fields_inner(item, texts);
            }
        }
        _ => {}
    }
}
