# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

### Scenario: Platform Information for Frontend Display

#### 1. Scope / Trigger
- Trigger: frontend UI needs OS/architecture labels that must reflect the actual runtime target.
- Do not use browser compatibility strings such as `navigator.platform` for native app platform labels; Apple Silicon can be reported as `MacIntel`.

#### 2. Signatures
- Rust command: `fn app_platform_info() -> PlatformInfo`
- Tauri command name: `app_platform_info`
- Frontend wrapper: `appPlatformInfo(): Promise<{ os: string; arch: string; label: string }>`

#### 3. Contracts
- `os`: display-safe OS name derived from `std::env::consts::OS`; normalize `macos` to `macOS`.
- `arch`: display-safe architecture derived from `std::env::consts::ARCH`; normalize `aarch64` to `arm64`.
- `label`: `${os} ${arch}` for direct UI display.
- The command has no request payload and should not inspect browser APIs.

#### 4. Validation & Error Matrix
- Backend command unavailable -> frontend should show a neutral fallback such as `Unknown`.
- Unknown OS/arch value -> return the raw Rust constant rather than guessing.

#### 5. Good/Base/Bad Cases
- Good: Apple Silicon macOS returns `macOS arm64`.
- Base: Intel macOS returns `macOS x86_64`.
- Bad: frontend displays `MacIntel` for Apple Silicon.

#### 6. Tests Required
- Type/build check must verify the frontend wrapper and Tauri command registration stay in sync.
- Manual/UI check should confirm the Settings About platform label does not use `navigator.platform`.

#### 7. Wrong vs Correct

Wrong:

```ts
const platform = navigator.platform;
```

Correct:

```ts
const info = await api.appPlatformInfo();
const platform = info.label;
```

### Scenario: Tauri Official Updater Release Contract

#### 1. Scope / Trigger
- Trigger: release workflow, Tauri config, or frontend updater behavior changes for official in-app updates.
- Applies to macOS and Windows official updater support. Linux stays on the GitHub Releases fallback until explicitly implemented.

#### 2. Signatures
- Tauri config: `app/src-tauri/tauri.conf.json` `plugins.updater.pubkey` and `plugins.updater.endpoints`.
- GitHub Actions secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Manifest endpoint: `https://github.com/MrHan-Yd/DdShell/releases/latest/download/latest.json`.
- Frontend APIs: `@tauri-apps/plugin-updater` `check()` / `downloadAndInstall()` and `@tauri-apps/plugin-process` `relaunch()`.

#### 3. Contracts
- `bundle.createUpdaterArtifacts` must be enabled when release builds are expected to produce updater artifacts.
- The updater private key must never be committed; only the public key belongs in `tauri.conf.json`.
- macOS updater assets are `DdShell-{tag}-macos-aarch64.app.tar.gz` and `DdShell-{tag}-macos-x86_64.app.tar.gz`, each with matching `.sig`.
- Windows updater asset is the tauri-bundler generated NSIS installer, `DdShell-{tag}-windows-x64.exe`, with matching `.sig`. Tauri's Windows updater accepts raw `.exe` and `.msi` payloads; do not require a zip unless CI actually generates one.
- `latest.json` must include `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64-nsis`, and a `windows-x86_64` fallback entry.
- Restart is a user-confirmed frontend action. The updater may install silently/passively, but the app must not relaunch without explicit confirmation.

#### 4. Validation & Error Matrix
- Missing updater signing secret -> release workflow must fail before Tauri build with a clear secret name.
- Missing updater artifact or `.sig` -> release workflow must fail before manifest generation.
- Manifest points to an unsigned or mismatched Windows asset -> Windows official updater fails signature verification or install.
- Manifest lacks the bundle-specific key -> updater falls back to `{os}-{arch}`; keep that fallback key present.
- Signature/private key mismatch -> official updater fails verification and UI must expose the GitHub Releases fallback.

#### 5. Good/Base/Bad Cases
- Good: Windows manifest `windows-x86_64-nsis` points to `DdShell-vX.Y.Z-windows-x64.exe` and the signature file signs that exe.
- Base: `windows-x86_64` points to the same NSIS exe as a runtime fallback.
- Bad: workflow expects `*.zip` when the Tauri Windows build only produced `.exe`, `.msi`, and their `.sig` files.

#### 6. Tests Required
- `cd app && pnpm build` verifies frontend updater API types and i18n keys.
- `cd app/src-tauri && cargo check` verifies plugin registration and Rust integration.
- A signed local or CI bundle build must produce `.app.tar.gz` plus `.sig` on macOS and NSIS `.exe` plus `.exe.sig` on Windows.
- Release verification must check `latest.json` platform keys, URLs, and signatures before announcing the release.

#### 7. Wrong vs Correct

Wrong:

```powershell
$updaterZip = Get-ChildItem "$bundleDir/nsis/*.zip" | Select-Object -First 1
if (-not $updaterZip) {
  Write-Error "Windows NSIS updater zip not found"
  exit 1
}
```

Correct:

```json
"windows-x86_64-nsis": {
  "signature": "<signature of DdShell-vX.Y.Z-windows-x64.exe>",
  "url": "https://github.com/MrHan-Yd/DdShell/releases/download/vX.Y.Z/DdShell-vX.Y.Z-windows-x64.exe"
},
"windows-x86_64": {
  "signature": "<signature of DdShell-vX.Y.Z-windows-x64.exe>",
  "url": "https://github.com/MrHan-Yd/DdShell/releases/download/vX.Y.Z/DdShell-vX.Y.Z-windows-x64.exe"
}
```

### Scenario: AI Agent Provider Configuration and Command Suggestions

#### 1. Scope / Trigger
- Trigger: terminal AI features need model provider configuration, encrypted API keys, third-party HTTP calls, and normalized command suggestions for the frontend.
- Applies to Tauri commands and backend modules that read/write `aiAgent.*` settings or call AI provider APIs.

#### 2. Signatures
- `ai_agent_config_get() -> Result<AiAgentConfig, String>`
- `ai_agent_config_save(req: AiAgentConfigSaveReq) -> Result<AiAgentConfig, String>`
- `ai_agent_profile_set_key(profile_id: String, api_key: String) -> Result<SuccessResponse, String>`
- `ai_agent_profile_clear_key(profile_id: String) -> Result<SuccessResponse, String>`
- `ai_agent_send(req: AiAgentSendReq) -> Result<AiAgentSendResponse, String>`
- `ai_agent_send_stream(app: AppHandle, req: AiAgentSendReq) -> Result<AiAgentSendResponse, String>`
- Tauri event `ai-agent:stream_delta` payload: `{ requestId: string, textDelta: string, reasoningDelta?: string | null }`

#### 3. Contracts
- Settings keys:
  - `aiAgent.enabled`: `"true"` / `"false"`
  - `aiAgent.defaultProfileId`: profile id or empty string
  - `aiAgent.executionMode`: `"run"` / `"insert"`
  - `aiAgent.confirmBeforeExecute`: `"true"` / `"false"`, defaulting to `"true"` when missing
  - `aiAgent.showReasoning`: `"true"` / `"false"`, defaulting to `"false"` when missing
  - `aiAgent.timeoutSec`: shared provider request timeout in seconds
  - `aiAgent.profiles`: JSON array of non-secret profile fields
  - `aiAgent.profile.<id>.apiKey`: encrypted API key only
- `AiAgentProfile` response must include `apiKeySet: bool`, but must never include plaintext or encrypted API key.
- Provider profile/site fields are `id`, `name`, `protocol`, `baseUrl`, `defaultModelId`, `models[]`, and `apiKeySet`. API keys remain profile-scoped under `aiAgent.profile.<id>.apiKey`; never copy secrets into a model row.
- `AiAgentModel` fields are `id`, `name`, provider `model`, `contextWindowTokens`, `temperature`, `maxTokens`, and `responseMode`.
- Legacy single-model fields on `AiAgentProfile` (`model`, `contextWindowTokens`, `temperature`, `maxTokens`, `responseMode`) may still appear in persisted JSON. Read paths must normalize them into one `models[]` entry and set a valid `defaultModelId`.
- `AiAgentModel.contextWindowTokens` is the model capacity used for app-side prompt/context budgeting; it is not sent as a universal provider parameter and does not override real model limits.
- `AiAgentModel.responseMode` stores the user's preferred model behavior: `"auto"`, `"stream"`, or `"nonStream"`. Missing legacy values must deserialize as `"nonStream"`. `ai_agent_send` remains a complete-response command. `ai_agent_send_stream` may set provider `stream: true` only when it emits chunks through `ai-agent:stream_delta` and still returns the final normalized `AiAgentSendResponse`.
- `AiAgentSendReq` includes optional `requestId`, `profileId`, optional `modelId`, `question`, and optional terminal context (`tabTitle`, `cwd`, `selectedText`).
- `AiAgentSendReq.modelId` selects a model within the chosen profile. Missing or invalid `modelId` must fall back to the profile default model, then the first model. If the profile has no models, return a validation error before any provider request.
- `AiAgentSendResponse` normalizes all providers to `answer`, `commandMode`, `commands[]`, optional `reasoning`, `rawText`, and `parseMode`.
- Stream mode is per-model. `"stream"` uses provider SSE/streaming endpoints for OpenAI Chat Completions, OpenAI Responses, Claude Messages, and Gemini Generate Content; `"auto"` and `"nonStream"` keep the complete-response path unless a future spec changes auto behavior.
- Stream deltas are display-only progress data. The backend must accumulate the complete streamed text and parse the final command response with the same parser used by `ai_agent_send`; the frontend must not parse commands from partial deltas.
- Removing a profile from `aiAgent.profiles` must clear its encrypted `aiAgent.profile.<id>.apiKey` value during config save, so deleted profiles do not leave orphan secrets.
- `reasoning` may be returned only when `aiAgent.showReasoning` is enabled and the provider/model response actually contains reasoning data. Supported extraction sources include OpenAI-compatible `reasoning_content` / `reasoning`, Claude `thinking` blocks, Gemini `thought` parts, JSON `reasoning` fields, and `<think>...</think>` text blocks.
- `commandMode` must be `"alternatives"` when commands are equivalent choices where one is enough, and `"steps"` when commands should be run in order. Missing/unknown model output should default conservatively to `"alternatives"` unless fallback parsing clearly extracts a shell block workflow or the original user question has diagnostic/triage intent.
- Diagnostic questions such as troubleshooting, "why", "where is space used", disk usage analysis, or broad-to-detail investigation should prefer `"steps"` for multi-command results. This local normalization may override a model's `"alternatives"` value unless the answer/command descriptions explicitly say the commands are optional choices.
- Provider adapters must keep protocol-specific request/response handling in backend code, not in frontend components.
- The AI command second-confirm dialog is a frontend behavior controlled by `AiAgentConfig.confirmBeforeExecute`; backend must persist and return the setting but must not couple provider calls to UI confirmation state.

#### 4. Validation & Error Matrix
- AI disabled -> return error before provider request.
- Profile id not found -> return profile-not-found error.
- Empty base URL, missing model list, or empty selected model id -> return validation error.
- Missing/cleared API key -> return key-not-configured error.
- Provider non-2xx -> return status plus a short bounded provider error body; never include API key.
- Provider invalid JSON wrapper -> return invalid-response error.
- Provider stream returns invalid JSON event -> return invalid-stream-response error and do not guess commands from partial text.
- Provider stream finishes without any text content -> return stream-missing-content error.
- Model output parse failure -> return `parseMode = "none"` with no commands rather than guessing commands from prose.

#### 5. Good/Base/Bad Cases
- Good: OpenAI-compatible profile stores only non-secret fields in `aiAgent.profiles`; key is encrypted under `aiAgent.profile.<id>.apiKey`; frontend receives `apiKeySet: true`.
- Base: Claude output is JSON because system prompt enforces the shared schema; parser returns `parseMode = "json"` and one command.
- Base: A stream-mode OpenAI-compatible model emits `ai-agent:stream_delta` events for UI progress, then the command returns the same normalized response shape as non-stream mode.
- Bad: Frontend calls provider APIs directly with a plaintext key or stores provider key inside `aiAgent.profiles`.
- Bad: Frontend treats a partial stream delta as executable command output before the backend returns the final normalized response.

#### 6. Tests Required
- `cd app && pnpm build` verifies frontend/Tauri type alignment and i18n keys.
- `cd app/src-tauri && cargo check` verifies command registration and backend type alignment.
- When automated tests are added, assert:
  - config read redacts keys and reports `apiKeySet`
  - save config preserves profile/site fields and nested model fields without secrets
  - legacy single-model stored profiles normalize to one model and a valid default model id
  - requested model id selects that model's provider id and parameters; invalid model id falls back to default/first
  - missing key blocks `ai_agent_send`
  - parser handles raw JSON, fenced JSON, JSON object inside text, shell fenced fallback, and no-command prose
  - command mode normalization keeps simple listing commands as alternatives, but maps diagnostic multi-command answers to steps even when the model mislabels them as alternatives
  - legacy stored profiles without `responseMode` deserialize as `nonStream`
  - reasoning extraction handles JSON reasoning fields and `<think>...</think>` blocks, and frontend/build checks verify the optional `reasoning` response field stays typed
  - stream delta extraction handles OpenAI Chat, OpenAI Responses, Claude Messages, Gemini parts, and SSE data-line flushing
  - deleting a profile clears any encrypted key stored under `aiAgent.profile.<id>.apiKey`

#### 7. Wrong vs Correct

Wrong:

```ts
// Frontend owns provider details and sends the API key directly.
await fetch(`${baseUrl}/chat/completions`, {
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(providerSpecificBody),
});
```

Correct:

```ts
// Frontend sends normalized app data; backend decrypts key, calls provider,
// and returns normalized command suggestions.
await api.aiAgentSend({
  profileId,
  modelId,
  question,
  context: { tabTitle, cwd, selectedText: null },
});
```

Wrong:

```ts
// Partial stream text is not a stable command contract.
listen("ai-agent:stream_delta", (event) => runCommand(event.payload.textDelta));
```

Correct:

```ts
// Stream deltas update progress UI; executable commands come from final response.
const response = await api.aiAgentSendStream({ requestId, profileId, modelId, question });
runCommand(response.commands[0].command);
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
