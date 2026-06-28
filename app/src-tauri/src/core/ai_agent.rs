use std::time::Duration;

use futures_util::StreamExt;
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
const KEY_SHOW_REASONING: &str = "aiAgent.showReasoning";
const KEY_TIMEOUT_SEC: &str = "aiAgent.timeoutSec";
const KEY_PROFILES: &str = "aiAgent.profiles";
const DEFAULT_TIMEOUT_SEC: u64 = 60;
const MIN_TIMEOUT_SEC: u64 = 5;
const MAX_TIMEOUT_SEC: u64 = 300;
const DEFAULT_CONTEXT_WINDOW_TOKENS: u32 = 128_000;
const MIN_CONTEXT_WINDOW_TOKENS: u32 = 1_000;
const MAX_CONTEXT_WINDOW_TOKENS: u32 = 10_000_000;
const DEFAULT_TEMPERATURE: f32 = 0.2;
const MIN_TEMPERATURE: f32 = 0.0;
const MAX_TEMPERATURE: f32 = 2.0;
const DEFAULT_OUTPUT_TOKENS: u32 = 1_200;
const MIN_OUTPUT_TOKENS: u32 = 128;
const MAX_OUTPUT_TOKENS: u32 = 200_000;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentResponseMode {
    Auto,
    Stream,
    NonStream,
}

impl Default for AiAgentResponseMode {
    fn default() -> Self {
        Self::NonStream
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentModel {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub context_window_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub response_mode: AiAgentResponseMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentProfile {
    pub id: String,
    pub name: String,
    pub protocol: AiAgentProtocol,
    pub base_url: String,
    #[serde(default)]
    pub default_model_id: Option<String>,
    #[serde(default)]
    pub models: Vec<AiAgentModel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "is_default_response_mode")]
    pub response_mode: AiAgentResponseMode,
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
    pub show_reasoning: bool,
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
    #[serde(default)]
    pub show_reasoning: bool,
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
    #[serde(default)]
    pub request_id: Option<String>,
    pub profile_id: String,
    pub model_id: Option<String>,
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
    pub reasoning: Option<String>,
    pub raw_text: String,
    pub parse_mode: String,
}

#[derive(Debug, Clone)]
struct ProviderTextResponse {
    text: String,
    reasoning: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiAgentStreamDelta {
    pub text_delta: String,
    pub reasoning_delta: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct StreamDeltaParts {
    text: Option<String>,
    reasoning: Option<String>,
}

fn is_default_response_mode(value: &AiAgentResponseMode) -> bool {
    *value == AiAgentResponseMode::NonStream
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfile {
    id: String,
    name: String,
    protocol: AiAgentProtocol,
    base_url: String,
    #[serde(default)]
    default_model_id: Option<String>,
    #[serde(default)]
    models: Vec<AiAgentModel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_window_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "is_default_response_mode")]
    response_mode: AiAgentResponseMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    timeout_sec: Option<u64>,
}

impl From<&AiAgentProfile> for StoredProfile {
    fn from(profile: &AiAgentProfile) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            protocol: profile.protocol.clone(),
            base_url: profile.base_url.clone(),
            default_model_id: profile.default_model_id.clone(),
            models: profile.models.clone(),
            model: None,
            context_window_tokens: None,
            temperature: None,
            max_tokens: None,
            response_mode: AiAgentResponseMode::NonStream,
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
            default_model_id: self.default_model_id,
            models: self.models,
            model: self.model,
            context_window_tokens: self.context_window_tokens,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            response_mode: self.response_mode,
            api_key_set,
        }
    }
}

fn normalize_profile(mut profile: AiAgentProfile) -> AiAgentProfile {
    if profile.id.trim().is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }

    if profile.models.is_empty() {
        if let Some(model) = profile
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            profile.models.push(AiAgentModel {
                id: "default".to_string(),
                name: model.to_string(),
                model: model.to_string(),
                context_window_tokens: profile.context_window_tokens,
                temperature: profile.temperature,
                max_tokens: profile.max_tokens,
                response_mode: profile.response_mode.clone(),
            });
        }
    }

    for model in &mut profile.models {
        if model.id.trim().is_empty() {
            model.id = Uuid::new_v4().to_string();
        }
        if model.name.trim().is_empty() {
            model.name = model.model.clone();
        }
        normalize_model_config(model);
    }

    let default_is_valid = profile
        .default_model_id
        .as_ref()
        .map(|id| profile.models.iter().any(|model| model.id == *id))
        .unwrap_or(false);
    if !default_is_valid {
        profile.default_model_id = profile.models.first().map(|model| model.id.clone());
    }

    profile
}

fn normalize_model_config(model: &mut AiAgentModel) {
    model.context_window_tokens = model
        .context_window_tokens
        .map(|value| value.clamp(MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS));
    model.temperature = model.temperature.and_then(|value| {
        value
            .is_finite()
            .then(|| value.clamp(MIN_TEMPERATURE, MAX_TEMPERATURE))
    });
    model.max_tokens = model
        .max_tokens
        .map(|value| value.clamp(MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS));
}

fn normalize_timeout_sec(value: u64) -> u64 {
    value.clamp(MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC)
}

fn provider_temperature(model: &AiAgentModel) -> f32 {
    model
        .temperature
        .unwrap_or(DEFAULT_TEMPERATURE)
        .clamp(MIN_TEMPERATURE, MAX_TEMPERATURE)
}

fn provider_max_tokens(model: &AiAgentModel) -> u32 {
    model
        .max_tokens
        .unwrap_or(DEFAULT_OUTPUT_TOKENS)
        .clamp(MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)
}

fn selected_model<'a>(
    profile: &'a AiAgentProfile,
    model_id: Option<&str>,
) -> Option<&'a AiAgentModel> {
    model_id
        .and_then(|id| profile.models.iter().find(|model| model.id == id))
        .or_else(|| {
            profile
                .default_model_id
                .as_deref()
                .and_then(|id| profile.models.iter().find(|model| model.id == id))
        })
        .or_else(|| profile.models.first())
}

pub async fn get_config(db: &Database) -> anyhow::Result<AiAgentConfig> {
    let enabled = db
        .get_setting(KEY_ENABLED)
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);
    let default_profile_id = db.get_setting(KEY_DEFAULT_PROFILE).await?.and_then(|v| {
        if v.trim().is_empty() {
            None
        } else {
            Some(v)
        }
    });
    let execution_mode = match db.get_setting(KEY_EXECUTION_MODE).await?.as_deref() {
        Some("insert") => AiAgentExecutionMode::Insert,
        _ => AiAgentExecutionMode::Run,
    };
    let confirm_before_execute = db
        .get_setting(KEY_CONFIRM_BEFORE_EXECUTE)
        .await?
        .map(|v| v != "false")
        .unwrap_or(true);
    let show_reasoning = db
        .get_setting(KEY_SHOW_REASONING)
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);
    let stored_profiles: Vec<StoredProfile> = match db.get_setting(KEY_PROFILES).await? {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).unwrap_or_default(),
        _ => Vec::new(),
    };
    let legacy_timeout_sec = stored_profiles
        .iter()
        .find_map(|profile| profile.timeout_sec);
    let timeout_sec = db
        .get_setting(KEY_TIMEOUT_SEC)
        .await?
        .and_then(|value| value.parse::<u64>().ok())
        .or(legacy_timeout_sec)
        .map(normalize_timeout_sec)
        .or(Some(DEFAULT_TIMEOUT_SEC));

    let mut profiles = Vec::with_capacity(stored_profiles.len());
    for stored in stored_profiles {
        let key_set = db
            .get_setting(&profile_key_setting(&stored.id))
            .await?
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        profiles.push(normalize_profile(stored.into_profile(key_set)));
    }

    Ok(AiAgentConfig {
        enabled,
        default_profile_id,
        execution_mode,
        confirm_before_execute,
        show_reasoning,
        timeout_sec,
        profiles,
    })
}

pub async fn save_config(
    db: &Database,
    req: AiAgentConfigSaveReq,
) -> anyhow::Result<AiAgentConfig> {
    let previous_profiles: Vec<StoredProfile> = match db.get_setting(KEY_PROFILES).await? {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut profiles = Vec::with_capacity(req.profiles.len());
    for profile in req.profiles {
        profiles.push(normalize_profile(profile));
    }
    let next_profile_ids = profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect::<Vec<_>>();

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
        if req.confirm_before_execute {
            "true"
        } else {
            "false"
        },
    )
    .await?;
    db.set_setting(
        KEY_SHOW_REASONING,
        if req.show_reasoning { "true" } else { "false" },
    )
    .await?;
    db.set_setting(
        KEY_DEFAULT_PROFILE,
        req.default_profile_id.as_deref().unwrap_or_default(),
    )
    .await?;
    let timeout_sec = req
        .timeout_sec
        .map(normalize_timeout_sec)
        .unwrap_or(DEFAULT_TIMEOUT_SEC);
    db.set_setting(KEY_TIMEOUT_SEC, &timeout_sec.to_string())
        .await?;
    db.set_setting(KEY_PROFILES, &serde_json::to_string(&stored)?)
        .await?;
    for previous in previous_profiles {
        if !next_profile_ids
            .iter()
            .any(|id| *id == previous.id.as_str())
        {
            clear_profile_key(db, &previous.id).await?;
        }
    }

    get_config(db).await
}

pub async fn set_profile_key(db: &Database, profile_id: &str, api_key: &str) -> anyhow::Result<()> {
    let key = profile_key_setting(profile_id);
    let previous = db.get_setting(&key).await?.filter(|v| !v.is_empty());
    let encrypted = secret::encrypt(api_key)?;
    db.set_setting(&key, &encrypted).await?;
    if let Some(previous_ref) = previous {
        if previous_ref != encrypted {
            if let Err(err) = secret::delete(&previous_ref) {
                tracing::warn!("failed to delete replaced AI profile keyring credential: {}", err);
            }
        }
    }
    Ok(())
}

pub async fn clear_profile_key(db: &Database, profile_id: &str) -> anyhow::Result<()> {
    let key = profile_key_setting(profile_id);
    let previous = db.get_setting(&key).await?.filter(|v| !v.is_empty());
    db.set_setting(&key, "").await?;
    if let Some(previous_ref) = previous {
        if let Err(err) = secret::delete(&previous_ref) {
            tracing::warn!("failed to delete AI profile keyring credential: {}", err);
        }
    }
    Ok(())
}

struct PreparedAiAgentRequest {
    config: AiAgentConfig,
    profile: AiAgentProfile,
    model: AiAgentModel,
    api_key: String,
    preferred_command_mode: Option<&'static str>,
}

async fn prepare_send(
    db: &Database,
    req: &AiAgentSendReq,
) -> anyhow::Result<PreparedAiAgentRequest> {
    let config = get_config(db).await?;
    if !config.enabled {
        anyhow::bail!("AI Agent is disabled");
    }
    let profile = config
        .profiles
        .iter()
        .find(|p| p.id == req.profile_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("AI profile not found"))?;
    if profile.base_url.trim().is_empty() {
        anyhow::bail!("AI profile base URL is empty");
    }
    let model = selected_model(&profile, req.model_id.as_deref())
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("AI profile has no configured models"))?;
    if model.model.trim().is_empty() {
        anyhow::bail!("AI profile model is empty");
    }

    let encrypted = db
        .get_setting(&profile_key_setting(&profile.id))
        .await?
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("AI profile API key is not configured"))?;
    let api_key = secret::decrypt(&encrypted)?;
    if let Some(next_ref) = secret::try_migrate_to_keyring(&encrypted, &api_key) {
        if let Err(err) = db.set_setting(&profile_key_setting(&profile.id), &next_ref).await {
            tracing::warn!("failed to update migrated AI profile key ref: {}", err);
        }
    }
    let preferred_command_mode = infer_command_mode_from_question(&req.question);
    Ok(PreparedAiAgentRequest {
        config,
        profile,
        model,
        api_key,
        preferred_command_mode,
    })
}

pub async fn send(db: &Database, req: AiAgentSendReq) -> anyhow::Result<AiAgentSendResponse> {
    let prepared = prepare_send(db, &req).await?;
    let provider_response = call_provider(
        &prepared.profile,
        &prepared.model,
        prepared.config.timeout_sec,
        &prepared.api_key,
        &req,
    )
    .await?;
    let mut response =
        parse_agent_response(&provider_response.text, prepared.preferred_command_mode);
    let parsed_reasoning = response.reasoning.take();
    if prepared.config.show_reasoning {
        response.reasoning = provider_response.reasoning.or(parsed_reasoning);
    }
    Ok(response)
}

pub async fn send_stream<F>(
    db: &Database,
    req: AiAgentSendReq,
    mut on_delta: F,
) -> anyhow::Result<AiAgentSendResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let prepared = prepare_send(db, &req).await?;
    let provider_response = if prepared.model.response_mode == AiAgentResponseMode::Stream {
        call_provider_stream(
            &prepared.profile,
            &prepared.model,
            prepared.config.timeout_sec,
            &prepared.api_key,
            &req,
            &mut on_delta,
        )
        .await?
    } else {
        call_provider(
            &prepared.profile,
            &prepared.model,
            prepared.config.timeout_sec,
            &prepared.api_key,
            &req,
        )
        .await?
    };
    let mut response =
        parse_agent_response(&provider_response.text, prepared.preferred_command_mode);
    let parsed_reasoning = response.reasoning.take();
    if prepared.config.show_reasoning {
        response.reasoning = provider_response.reasoning.or(parsed_reasoning);
    }
    Ok(response)
}

fn profile_key_setting(profile_id: &str) -> String {
    format!("aiAgent.profile.{}.apiKey", profile_id)
}

async fn call_provider(
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    timeout_sec: Option<u64>,
    api_key: &str,
    req: &AiAgentSendReq,
) -> anyhow::Result<ProviderTextResponse> {
    let timeout = Duration::from_secs(
        timeout_sec
            .map(normalize_timeout_sec)
            .unwrap_or(DEFAULT_TIMEOUT_SEC),
    );
    let client = reqwest::Client::builder().timeout(timeout).build()?;
    let system_prompt = system_prompt();
    let user_prompt = user_prompt(req, model.context_window_tokens);

    match profile.protocol {
        AiAgentProtocol::OpenaiChat => {
            call_openai_chat(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
            )
            .await
        }
        AiAgentProtocol::OpenaiResponses => {
            call_openai_responses(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
            )
            .await
        }
        AiAgentProtocol::ClaudeMessages => {
            call_claude_messages(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
            )
            .await
        }
        AiAgentProtocol::GeminiGenerateContent => {
            call_gemini(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
            )
            .await
        }
    }
}

async fn call_provider_stream<F>(
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    timeout_sec: Option<u64>,
    api_key: &str,
    req: &AiAgentSendReq,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let timeout = Duration::from_secs(
        timeout_sec
            .map(normalize_timeout_sec)
            .unwrap_or(DEFAULT_TIMEOUT_SEC),
    );
    let client = reqwest::Client::builder().timeout(timeout).build()?;
    let system_prompt = system_prompt();
    let user_prompt = user_prompt(req, model.context_window_tokens);

    match profile.protocol {
        AiAgentProtocol::OpenaiChat => {
            call_openai_chat_stream(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
                on_delta,
            )
            .await
        }
        AiAgentProtocol::OpenaiResponses => {
            call_openai_responses_stream(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
                on_delta,
            )
            .await
        }
        AiAgentProtocol::ClaudeMessages => {
            call_claude_messages_stream(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
                on_delta,
            )
            .await
        }
        AiAgentProtocol::GeminiGenerateContent => {
            call_gemini_stream(
                &client,
                profile,
                model,
                api_key,
                system_prompt,
                &user_prompt,
                on_delta,
            )
            .await
        }
    }
}

async fn call_openai_chat(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<ProviderTextResponse> {
    let url = join_url(&profile.base_url, "chat/completions");
    let body = json!({
        "model": model.model,
        "temperature": provider_temperature(model),
        "max_tokens": provider_max_tokens(model),
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ]
    });
    let value = post_json(client, &url, bearer_headers(api_key)?, body).await?;
    let text = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("OpenAI chat response did not include message content"))?;
    let reasoning = value
        .pointer("/choices/0/message/reasoning_content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| extract_reasoning_fields(&value))
        .or_else(|| extract_think_blocks(&text));
    Ok(ProviderTextResponse { text, reasoning })
}

async fn call_openai_chat_stream<F>(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let url = join_url(&profile.base_url, "chat/completions");
    let body = json!({
        "model": model.model,
        "temperature": provider_temperature(model),
        "max_tokens": provider_max_tokens(model),
        "response_format": { "type": "json_object" },
        "stream": true,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ]
    });
    collect_sse_text(
        client,
        &url,
        bearer_headers(api_key)?,
        body,
        extract_openai_chat_stream_delta,
        on_delta,
    )
    .await
}

async fn call_openai_responses(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<ProviderTextResponse> {
    let url = join_url(&profile.base_url, "responses");
    let body = json!({
        "model": model.model,
        "temperature": provider_temperature(model),
        "max_output_tokens": provider_max_tokens(model),
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
    let text = if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        text.to_string()
    } else {
        collect_text_fields(&value)
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("OpenAI responses output did not include text"))?
    };
    let reasoning = extract_reasoning_fields(&value).or_else(|| extract_think_blocks(&text));
    Ok(ProviderTextResponse { text, reasoning })
}

async fn call_openai_responses_stream<F>(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let url = join_url(&profile.base_url, "responses");
    let body = json!({
        "model": model.model,
        "temperature": provider_temperature(model),
        "max_output_tokens": provider_max_tokens(model),
        "instructions": system_prompt,
        "input": user_prompt,
        "stream": true,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "terminal_command_assistant",
                "schema": response_schema()
            }
        }
    });
    collect_sse_text(
        client,
        &url,
        bearer_headers(api_key)?,
        body,
        extract_openai_responses_stream_delta,
        on_delta,
    )
    .await
}

async fn call_claude_messages(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<ProviderTextResponse> {
    let url = join_url(&profile.base_url, "messages");
    let body = json!({
        "model": model.model,
        "system": system_prompt,
        "max_tokens": provider_max_tokens(model),
        "temperature": provider_temperature(model),
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
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect();
    if texts.is_empty() {
        anyhow::bail!("Claude response did not include text content");
    }
    let text = texts.join("\n");
    let reasoning = value
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|part| part.get("thinking").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .map(|items| items.join("\n\n"))
        .or_else(|| extract_reasoning_fields(&value))
        .or_else(|| extract_think_blocks(&text));
    Ok(ProviderTextResponse { text, reasoning })
}

async fn call_claude_messages_stream<F>(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let url = join_url(&profile.base_url, "messages");
    let body = json!({
        "model": model.model,
        "system": system_prompt,
        "max_tokens": provider_max_tokens(model),
        "temperature": provider_temperature(model),
        "stream": true,
        "messages": [
            { "role": "user", "content": user_prompt }
        ]
    });
    let mut headers = json_headers();
    headers.insert("x-api-key", HeaderValue::from_str(api_key)?);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    collect_sse_text(
        client,
        &url,
        headers,
        body,
        extract_claude_stream_delta,
        on_delta,
    )
    .await
}

async fn call_gemini(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<ProviderTextResponse> {
    let path = format!("models/{}:generateContent", model.model);
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
            "temperature": provider_temperature(model),
            "maxOutputTokens": provider_max_tokens(model),
            "responseMimeType": "application/json",
            "responseSchema": response_schema()
        }
    });
    let mut headers = json_headers();
    headers.insert("x-goog-api-key", HeaderValue::from_str(api_key)?);
    let value = post_json(client, &url, headers, body).await?;
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let texts: Vec<String> = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect();
    if texts.is_empty() {
        anyhow::bail!("Gemini response did not include text content");
    }
    let text = texts.join("\n");
    let thought_texts = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) == Some(true))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let reasoning = if thought_texts.is_empty() {
        extract_reasoning_fields(&value).or_else(|| extract_think_blocks(&text))
    } else {
        Some(thought_texts.join("\n\n"))
    };
    Ok(ProviderTextResponse { text, reasoning })
}

async fn call_gemini_stream<F>(
    client: &reqwest::Client,
    profile: &AiAgentProfile,
    model: &AiAgentModel,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
{
    let path = format!("models/{}:streamGenerateContent?alt=sse", model.model);
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
            "temperature": provider_temperature(model),
            "maxOutputTokens": provider_max_tokens(model),
            "responseMimeType": "application/json",
            "responseSchema": response_schema()
        }
    });
    let mut headers = json_headers();
    headers.insert("x-goog-api-key", HeaderValue::from_str(api_key)?);
    collect_sse_text(
        client,
        &url,
        headers,
        body,
        extract_gemini_stream_delta,
        on_delta,
    )
    .await
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
    serde_json::from_str(&text)
        .map_err(|e| anyhow::anyhow!("AI provider returned invalid JSON: {}", e))
}

async fn collect_sse_text<F, E>(
    client: &reqwest::Client,
    url: &str,
    headers: HeaderMap,
    body: Value,
    extract_delta: E,
    on_delta: &mut F,
) -> anyhow::Result<ProviderTextResponse>
where
    F: FnMut(AiAgentStreamDelta) + Send,
    E: Fn(&Value) -> StreamDeltaParts,
{
    let mut text = String::new();
    let mut reasoning = String::new();
    post_sse(client, url, headers, body, |event_data| {
        if event_data.trim() == "[DONE]" {
            return Ok(false);
        }
        let value: Value = serde_json::from_str(event_data)
            .map_err(|e| anyhow::anyhow!("AI provider returned invalid stream JSON: {}", e))?;
        let delta = extract_delta(&value);
        let text_delta = delta.text.unwrap_or_default();
        let reasoning_delta = delta.reasoning;
        if text_delta.is_empty() && reasoning_delta.as_deref().unwrap_or_default().is_empty() {
            return Ok(true);
        }
        if !text_delta.is_empty() {
            text.push_str(&text_delta);
        }
        if let Some(reasoning_delta) = reasoning_delta {
            if !reasoning_delta.is_empty() {
                reasoning.push_str(&reasoning_delta);
                on_delta(AiAgentStreamDelta {
                    text_delta,
                    reasoning_delta: Some(reasoning_delta),
                });
                return Ok(true);
            }
        }
        on_delta(AiAgentStreamDelta {
            text_delta,
            reasoning_delta: None,
        });
        Ok(true)
    })
    .await?;

    if text.trim().is_empty() {
        anyhow::bail!("AI provider stream did not include text content");
    }
    let reasoning = reasoning
        .trim()
        .is_empty()
        .then(|| extract_think_blocks(&text))
        .flatten()
        .or_else(|| {
            let trimmed = reasoning.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
    Ok(ProviderTextResponse { text, reasoning })
}

async fn post_sse<F>(
    client: &reqwest::Client,
    url: &str,
    headers: HeaderMap,
    body: Value,
    mut on_event: F,
) -> anyhow::Result<()>
where
    F: FnMut(&str) -> anyhow::Result<bool>,
{
    let response = client.post(url).headers(headers).json(&body).send().await?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await?;
        let safe = text.chars().take(500).collect::<String>();
        anyhow::bail!("AI provider request failed ({}): {}", status.as_u16(), safe);
    }

    let mut stream = response.bytes_stream();
    let mut line = Vec::new();
    let mut event_data = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        for byte in chunk {
            if byte == b'\n' {
                if !process_sse_line(&line, &mut event_data, &mut on_event)? {
                    return Ok(());
                }
                line.clear();
            } else {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        process_sse_line(&line, &mut event_data, &mut on_event)?;
    }
    if !event_data.trim().is_empty() {
        on_event(event_data.trim())?;
    }
    Ok(())
}

fn process_sse_line<F>(
    line: &[u8],
    event_data: &mut String,
    on_event: &mut F,
) -> anyhow::Result<bool>
where
    F: FnMut(&str) -> anyhow::Result<bool>,
{
    let line = String::from_utf8_lossy(line);
    let line = line.trim_end_matches('\r');
    if line.is_empty() {
        if event_data.trim().is_empty() {
            return Ok(true);
        }
        let should_continue = on_event(event_data.trim())?;
        event_data.clear();
        return Ok(should_continue);
    }
    let Some(data) = line.strip_prefix("data:") else {
        return Ok(true);
    };
    if !event_data.is_empty() {
        event_data.push('\n');
    }
    event_data.push_str(data.trim_start());
    Ok(true)
}

fn extract_openai_chat_stream_delta(value: &Value) -> StreamDeltaParts {
    let Some(delta) = value.pointer("/choices/0/delta") else {
        return StreamDeltaParts::default();
    };
    StreamDeltaParts {
        text: stream_string_field(delta, &["content"]),
        reasoning: stream_string_field(delta, &["reasoning_content", "reasoning"]),
    }
}

fn extract_openai_responses_stream_delta(value: &Value) -> StreamDeltaParts {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type.contains("output_text.delta") {
        return StreamDeltaParts {
            text: stream_string_field(value, &["delta", "text"]),
            reasoning: None,
        };
    }
    if event_type.contains("reasoning") || event_type.contains("thinking") {
        return StreamDeltaParts {
            text: None,
            reasoning: stream_string_field(value, &["delta", "text", "summary"]),
        };
    }
    StreamDeltaParts::default()
}

fn extract_claude_stream_delta(value: &Value) -> StreamDeltaParts {
    if value.get("type").and_then(Value::as_str) != Some("content_block_delta") {
        return StreamDeltaParts::default();
    }
    let Some(delta) = value.get("delta") else {
        return StreamDeltaParts::default();
    };
    let delta_type = delta
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if delta_type == "thinking_delta" {
        return StreamDeltaParts {
            text: None,
            reasoning: stream_string_field(delta, &["thinking", "text"]),
        };
    }
    StreamDeltaParts {
        text: stream_string_field(delta, &["text"]),
        reasoning: None,
    }
}

fn extract_gemini_stream_delta(value: &Value) -> StreamDeltaParts {
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut text = String::new();
    let mut reasoning = String::new();
    for part in parts {
        let Some(part_text) = part.get("text").and_then(Value::as_str) else {
            continue;
        };
        if part.get("thought").and_then(Value::as_bool) == Some(true) {
            reasoning.push_str(part_text);
        } else {
            text.push_str(part_text);
        }
    }
    StreamDeltaParts {
        text: if text.is_empty() { None } else { Some(text) },
        reasoning: if reasoning.is_empty() {
            None
        } else {
            Some(reasoning)
        },
    }
}

fn stream_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            return Some(text.to_string());
        }
    }
    None
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
Use commandMode "alternatives" when the commands are equivalent choices where running one is enough, for example ls vs ls -la.
Use commandMode "steps" when commands should be run in order as a workflow, for example inspect status, then inspect logs, then validate config.
For troubleshooting, diagnosis, "why" questions, "where is space used" questions, or anything that narrows from broad inspection to details, prefer commandMode "steps".
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
                prompt.push_str(&trim_context_text(
                    selected_text.trim(),
                    context_window_tokens,
                ));
            }
        }
    }
    prompt
}

fn trim_context_text(text: &str, context_window_tokens: Option<u32>) -> String {
    let budget_tokens = context_window_tokens
        .unwrap_or(DEFAULT_CONTEXT_WINDOW_TOKENS)
        .clamp(MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS);
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

fn parse_agent_response(
    raw_text: &str,
    preferred_command_mode: Option<&'static str>,
) -> AiAgentSendResponse {
    if let Some(response) = parse_json_response(raw_text, "json", preferred_command_mode) {
        return response;
    }
    if let Some(block) = fenced_block(raw_text, &["json"]) {
        if let Some(response) = parse_json_response(&block, "jsonBlock", preferred_command_mode) {
            return response;
        }
    }
    if let Some(object) = first_json_object(raw_text) {
        if let Some(response) = parse_json_response(&object, "jsonObject", preferred_command_mode) {
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
            reasoning: None,
            raw_text: raw_text.to_string(),
            parse_mode: "shellBlock".to_string(),
        };
    }

    AiAgentSendResponse {
        answer: raw_text.trim().to_string(),
        command_mode: "alternatives".to_string(),
        commands: Vec::new(),
        reasoning: None,
        raw_text: raw_text.to_string(),
        parse_mode: "none".to_string(),
    }
}

fn parse_json_response(
    raw: &str,
    parse_mode: &str,
    preferred_command_mode: Option<&'static str>,
) -> Option<AiAgentSendResponse> {
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
        preferred_command_mode,
        &answer,
        &commands,
    );
    Some(AiAgentSendResponse {
        answer,
        command_mode,
        commands,
        reasoning: extract_reasoning_fields(&value),
        raw_text: raw.to_string(),
        parse_mode: parse_mode.to_string(),
    })
}

fn normalize_command_mode(
    value: Option<&str>,
    preferred_command_mode: Option<&'static str>,
    answer: &str,
    commands: &[AiAgentCommand],
) -> String {
    let explicit_mode = match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "steps" | "step" | "sequence" | "workflow" => Some("steps"),
        "alternatives" | "alternative" | "choices" | "choice" | "options" => Some("alternatives"),
        _ => None,
    };

    if commands.len() > 1 {
        if preferred_command_mode == Some("steps") && !looks_like_alternatives(answer, commands) {
            return "steps".to_string();
        }
        if let Some(mode) = explicit_mode {
            return mode.to_string();
        }
        if preferred_command_mode == Some("alternatives") {
            return "alternatives".to_string();
        }
    }

    if let Some(mode) = explicit_mode {
        return mode.to_string();
    }

    if commands.len() > 1 && looks_like_steps(answer, commands) {
        "steps".to_string()
    } else {
        "alternatives".to_string()
    }
}

fn infer_command_mode_from_question(question: &str) -> Option<&'static str> {
    let question = question.to_ascii_lowercase();
    if contains_any(
        &question,
        &[
            "可选",
            "任选",
            "任意",
            "二选一",
            "选择",
            "方案",
            "或者",
            "alternative",
            "alternatives",
            "option",
            "options",
            "choose",
            "either",
        ],
    ) {
        return Some("alternatives");
    }

    if contains_any(
        &question,
        &[
            "排查",
            "诊断",
            "检查",
            "定位",
            "分析",
            "为什么",
            "哪里",
            "占用",
            "空间",
            "磁盘",
            "大文件",
            "找出",
            "报错",
            "失败",
            "不通",
            "启动不了",
            "troubleshoot",
            "diagnose",
            "investigate",
            "why",
            "where",
            "disk usage",
            "large file",
            "large files",
            "find out",
        ],
    ) {
        return Some("steps");
    }

    None
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn looks_like_alternatives(answer: &str, commands: &[AiAgentCommand]) -> bool {
    let answer = answer.to_ascii_lowercase();
    if contains_any(
        &answer,
        &[
            "alternative",
            "option",
            "choice",
            "choose one",
            "either",
            "pick one",
            "任选",
            "任意一个",
            "可选",
            "选择一个",
            "二选一",
            "其中一个",
            "或者",
        ],
    ) {
        return true;
    }

    commands.iter().any(|command| {
        let description = command.description.to_ascii_lowercase();
        contains_any(
            &description,
            &[
                "alternative",
                "option",
                "choice",
                "choose one",
                "either",
                "pick one",
                "任选",
                "任意一个",
                "可选",
                "选择一个",
                "二选一",
                "其中一个",
                "或者",
            ],
        )
    })
}

fn looks_like_steps(answer: &str, commands: &[AiAgentCommand]) -> bool {
    let answer = answer.to_ascii_lowercase();
    if contains_any(
        &answer,
        &[
            "step", "then", "first", "next", "after", "步骤", "然后", "先", "接着", "再",
        ],
    ) {
        return true;
    }

    commands.iter().any(|command| {
        let description = command.description.to_ascii_lowercase();
        contains_any(
            &description,
            &[
                "step", "then", "first", "next", "after", "步骤", "然后", "先", "接着", "再",
            ],
        )
    })
}

fn normalize_level(value: Option<&str>, fallback: &str) -> String {
    match value
        .unwrap_or(fallback)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
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

fn extract_reasoning_fields(value: &Value) -> Option<String> {
    let mut texts = Vec::new();
    collect_reasoning_fields_inner(value, &mut texts);
    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n\n"))
    }
}

fn collect_reasoning_fields_inner(value: &Value, texts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if map
                .get("type")
                .and_then(Value::as_str)
                .map(|value| value.contains("reasoning") || value.contains("thinking"))
                .unwrap_or(false)
            {
                texts.extend(
                    collect_text_fields(value)
                        .into_iter()
                        .map(|text| text.trim().to_string())
                        .filter(|text| !text.is_empty()),
                );
            }
            for (key, child) in map {
                let key = key.as_str();
                if matches!(
                    key,
                    "reasoning" | "reasoning_content" | "thinking" | "thought"
                ) {
                    collect_reasoning_text(child, texts);
                } else {
                    collect_reasoning_fields_inner(child, texts);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_reasoning_fields_inner(item, texts);
            }
        }
        _ => {}
    }
}

fn collect_reasoning_text(value: &Value, texts: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if !text.is_empty() {
                texts.push(text.to_string());
            }
        }
        Value::Object(map) => {
            for child in map.values() {
                collect_reasoning_text(child, texts);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_reasoning_text(item, texts);
            }
        }
        _ => {}
    }
}

fn extract_think_blocks(text: &str) -> Option<String> {
    let mut blocks = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("<think>") {
        let after_start = &rest[start + "<think>".len()..];
        let Some(end) = after_start.find("</think>") else {
            break;
        };
        let block = after_start[..end].trim();
        if !block.is_empty() {
            blocks.push(block.to_string());
        }
        rest = &after_start[end + "</think>".len()..];
    }
    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n\n"))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn two_command_response(command_mode: &str, answer: &str) -> String {
        format!(
            r#"{{
                "answer": "{answer}",
                "commandMode": "{command_mode}",
                "commands": [
                    {{
                        "command": "du -sh .",
                        "description": "查看当前目录总占用",
                        "risk": "low",
                        "confidence": "high"
                    }},
                    {{
                        "command": "du -sh * | sort -h",
                        "description": "再按子目录排序定位占用来源",
                        "risk": "low",
                        "confidence": "high"
                    }}
                ]
            }}"#
        )
    }

    #[test]
    fn diagnostic_question_prefers_steps_even_if_model_says_alternatives() {
        let question = "帮我看看当前目录哪里占用空间比较大。";
        let raw = two_command_response("alternatives", "查看目录占用并继续定位较大的子目录。");

        let response = parse_agent_response(&raw, infer_command_mode_from_question(question));

        assert_eq!(response.command_mode, "steps");
    }

    #[test]
    fn list_files_question_stays_as_alternatives() {
        let question = "当前目录有哪些文件？";
        let raw = r#"{
            "answer": "可以用简洁或详细方式查看。",
            "commandMode": "alternatives",
            "commands": [
                {
                    "command": "ls",
                    "description": "简洁列出文件名",
                    "risk": "low",
                    "confidence": "high"
                },
                {
                    "command": "ls -la",
                    "description": "查看详细信息和隐藏文件",
                    "risk": "low",
                    "confidence": "high"
                }
            ]
        }"#;

        let response = parse_agent_response(raw, infer_command_mode_from_question(question));

        assert_eq!(response.command_mode, "alternatives");
    }

    #[test]
    fn explicit_choice_language_preserves_alternatives() {
        let question = "帮我看看当前目录哪里占用空间比较大。";
        let raw = two_command_response("alternatives", "下面两个命令任选一个即可。");

        let response = parse_agent_response(&raw, infer_command_mode_from_question(question));

        assert_eq!(response.command_mode, "alternatives");
    }

    #[test]
    fn json_reasoning_field_is_preserved_for_enabled_display() {
        let raw = r#"{
            "answer": "建议先查看当前目录。",
            "reasoning": "用户询问目录内容，使用只读命令即可。",
            "commandMode": "alternatives",
            "commands": [
                {
                    "command": "ls",
                    "description": "列出当前目录文件",
                    "risk": "low",
                    "confidence": "high"
                }
            ]
        }"#;

        let response = parse_agent_response(raw, None);

        assert_eq!(
            response.reasoning.as_deref(),
            Some("用户询问目录内容，使用只读命令即可。")
        );
    }

    #[test]
    fn think_blocks_are_extracted_as_reasoning() {
        let text = "<think>\n先判断问题类型。\n</think>\n{\"answer\":\"ok\",\"commands\":[]}";

        assert_eq!(
            extract_think_blocks(text).as_deref(),
            Some("先判断问题类型。")
        );
    }

    #[test]
    fn typed_reasoning_blocks_are_extracted() {
        let value = json!({
            "output": [
                {
                    "type": "reasoning",
                    "summary": [
                        { "text": "先确认用户需要安全的只读命令。" }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_reasoning_fields(&value).as_deref(),
            Some("先确认用户需要安全的只读命令。")
        );
    }

    #[test]
    fn openai_chat_stream_delta_extracts_text_and_reasoning() {
        let value = json!({
            "choices": [
                {
                    "delta": {
                        "content": "{\"answer\"",
                        "reasoning_content": "先组织 JSON。"
                    }
                }
            ]
        });

        let delta = extract_openai_chat_stream_delta(&value);

        assert_eq!(delta.text.as_deref(), Some("{\"answer\""));
        assert_eq!(delta.reasoning.as_deref(), Some("先组织 JSON。"));
    }

    #[test]
    fn openai_responses_stream_delta_extracts_output_text() {
        let value = json!({
            "type": "response.output_text.delta",
            "delta": ":\"ok\""
        });

        let delta = extract_openai_responses_stream_delta(&value);

        assert_eq!(delta.text.as_deref(), Some(":\"ok\""));
        assert!(delta.reasoning.is_none());
    }

    #[test]
    fn claude_stream_delta_extracts_thinking() {
        let value = json!({
            "type": "content_block_delta",
            "delta": {
                "type": "thinking_delta",
                "thinking": "判断命令风险。"
            }
        });

        let delta = extract_claude_stream_delta(&value);

        assert!(delta.text.is_none());
        assert_eq!(delta.reasoning.as_deref(), Some("判断命令风险。"));
    }

    #[test]
    fn gemini_stream_delta_splits_thought_parts() {
        let value = json!({
            "candidates": [
                {
                    "content": {
                        "parts": [
                            { "text": "思考", "thought": true },
                            { "text": "{\"answer\":\"ok\"}" }
                        ]
                    }
                }
            ]
        });

        let delta = extract_gemini_stream_delta(&value);

        assert_eq!(delta.text.as_deref(), Some("{\"answer\":\"ok\"}"));
        assert_eq!(delta.reasoning.as_deref(), Some("思考"));
    }

    #[test]
    fn sse_line_parser_flushes_data_events() {
        let mut event_data = String::new();
        let mut events = Vec::new();
        {
            let mut on_event = |data: &str| {
                events.push(data.to_string());
                Ok(true)
            };

            process_sse_line(b"data: {\"delta\":\"a\"}\r", &mut event_data, &mut on_event)
                .expect("data line should parse");
            process_sse_line(b"", &mut event_data, &mut on_event).expect("blank line should flush");
        }

        assert_eq!(events, vec!["{\"delta\":\"a\"}".to_string()]);
        assert!(event_data.is_empty());
    }

    #[test]
    fn stored_profile_defaults_to_non_stream_response_mode() {
        let raw = r#"{
            "id": "profile-1",
            "name": "Legacy",
            "protocol": "openaiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "model"
        }"#;

        let profile: StoredProfile =
            serde_json::from_str(raw).expect("legacy profile should deserialize");

        assert_eq!(profile.response_mode, AiAgentResponseMode::NonStream);
    }

    #[test]
    fn legacy_stored_profile_normalizes_to_default_model() {
        let raw = r#"{
            "id": "profile-1",
            "name": "Legacy",
            "protocol": "openaiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "legacy-model",
            "contextWindowTokens": 32000,
            "temperature": 0.4,
            "maxTokens": 900
        }"#;

        let stored: StoredProfile =
            serde_json::from_str(raw).expect("legacy profile should deserialize");
        let profile = normalize_profile(stored.into_profile(true));

        assert_eq!(profile.default_model_id.as_deref(), Some("default"));
        assert_eq!(profile.models.len(), 1);
        assert_eq!(profile.models[0].model, "legacy-model");
        assert_eq!(profile.models[0].context_window_tokens, Some(32000));
        assert_eq!(profile.models[0].temperature, Some(0.4));
        assert_eq!(profile.models[0].max_tokens, Some(900));
        assert!(profile.api_key_set);
    }

    #[test]
    fn selected_model_falls_back_to_first_when_default_is_invalid() {
        let profile = normalize_profile(AiAgentProfile {
            id: "profile-1".to_string(),
            name: "Provider".to_string(),
            protocol: AiAgentProtocol::OpenaiChat,
            base_url: "https://api.example.com/v1".to_string(),
            default_model_id: Some("missing".to_string()),
            models: vec![
                AiAgentModel {
                    id: "fast".to_string(),
                    name: "Fast".to_string(),
                    model: "fast-model".to_string(),
                    context_window_tokens: None,
                    temperature: None,
                    max_tokens: None,
                    response_mode: AiAgentResponseMode::NonStream,
                },
                AiAgentModel {
                    id: "smart".to_string(),
                    name: "Smart".to_string(),
                    model: "smart-model".to_string(),
                    context_window_tokens: None,
                    temperature: None,
                    max_tokens: None,
                    response_mode: AiAgentResponseMode::NonStream,
                },
            ],
            model: None,
            context_window_tokens: None,
            temperature: None,
            max_tokens: None,
            response_mode: AiAgentResponseMode::NonStream,
            api_key_set: false,
        });

        assert_eq!(profile.default_model_id.as_deref(), Some("fast"));
        assert_eq!(
            selected_model(&profile, Some("smart")).map(|model| model.model.as_str()),
            Some("smart-model")
        );
        assert_eq!(
            selected_model(&profile, Some("missing")).map(|model| model.model.as_str()),
            Some("fast-model")
        );
    }

    #[test]
    fn model_numeric_values_are_normalized() {
        let profile = normalize_profile(AiAgentProfile {
            id: "profile-1".to_string(),
            name: "Provider".to_string(),
            protocol: AiAgentProtocol::OpenaiChat,
            base_url: "https://api.example.com/v1".to_string(),
            default_model_id: Some("bad-values".to_string()),
            models: vec![AiAgentModel {
                id: "bad-values".to_string(),
                name: "Bad Values".to_string(),
                model: "bad-model".to_string(),
                context_window_tokens: Some(0),
                temperature: Some(9.0),
                max_tokens: Some(0),
                response_mode: AiAgentResponseMode::NonStream,
            }],
            model: None,
            context_window_tokens: None,
            temperature: None,
            max_tokens: None,
            response_mode: AiAgentResponseMode::NonStream,
            api_key_set: false,
        });

        let model = &profile.models[0];
        assert_eq!(
            model.context_window_tokens,
            Some(MIN_CONTEXT_WINDOW_TOKENS)
        );
        assert_eq!(model.temperature, Some(MAX_TEMPERATURE));
        assert_eq!(model.max_tokens, Some(MIN_OUTPUT_TOKENS));
        assert_eq!(provider_temperature(model), MAX_TEMPERATURE);
        assert_eq!(provider_max_tokens(model), MIN_OUTPUT_TOKENS);
    }

    #[test]
    fn stored_profile_serializes_new_model_shape_without_legacy_model_fields() {
        let profile = normalize_profile(AiAgentProfile {
            id: "profile-1".to_string(),
            name: "Provider".to_string(),
            protocol: AiAgentProtocol::OpenaiChat,
            base_url: "https://api.example.com/v1".to_string(),
            default_model_id: Some("fast".to_string()),
            models: vec![AiAgentModel {
                id: "fast".to_string(),
                name: "Fast".to_string(),
                model: "fast-model".to_string(),
                context_window_tokens: Some(128000),
                temperature: Some(0.2),
                max_tokens: Some(1200),
                response_mode: AiAgentResponseMode::NonStream,
            }],
            model: Some("legacy-model".to_string()),
            context_window_tokens: Some(32000),
            temperature: Some(0.4),
            max_tokens: Some(900),
            response_mode: AiAgentResponseMode::Stream,
            api_key_set: false,
        });

        let value =
            serde_json::to_value(StoredProfile::from(&profile)).expect("profile should serialize");

        assert!(value.get("models").is_some());
        assert!(value.get("model").is_none());
        assert!(value.get("contextWindowTokens").is_none());
        assert!(value.get("temperature").is_none());
        assert!(value.get("maxTokens").is_none());
        assert!(value.get("responseMode").is_none());
    }
}
