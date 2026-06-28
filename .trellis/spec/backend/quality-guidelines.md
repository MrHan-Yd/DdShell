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

### Scenario: Keyring Credential Reference Compatibility

#### 1. Scope / Trigger
- Trigger: backend code changes local storage for SSH passwords, AI provider API keys, or any value stored through `core::secret`.
- Applies to `app/src-tauri/src/core/secret.rs` and all callers that persist, read, migrate, or clear secret reference strings.

#### 2. Signatures
- `core::secret::encrypt(plain: &str) -> anyhow::Result<String>`
- `core::secret::decrypt(encoded: &str) -> anyhow::Result<String>`
- `core::secret::try_migrate_to_keyring(reference: &str, plain: &str) -> Option<String>`
- `core::secret::delete(reference: &str) -> anyhow::Result<()>`

#### 3. Contracts
- Secret columns/settings store references, not plaintext. Supported reference formats:
  - `keyring:v1:<account>`: preferred OS credential-store reference.
  - `local:v1:<ciphertext>`: marked local AES-GCM fallback.
  - `<ciphertext>` with no prefix: legacy AES-GCM value from existing installations.
- `encrypt` must prefer the OS credential store and return a `keyring:v1:` reference when keyring write succeeds.
- If keyring write fails because the OS store is unavailable or denied, `encrypt` may return a marked `local:v1:` fallback reference.
- Local ciphertext format remains base64 of `nonce || aes_gcm_ciphertext`, where `nonce` is exactly 12 bytes and generated from an OS cryptographic random source.
- `decrypt` must resolve all supported reference formats.
- Backend read paths with DB/settings access should lazily migrate non-keyring references by calling `try_migrate_to_keyring` after successful decrypt and then updating the stored reference only if migration succeeds.
- Do not delete legacy/local references after a failed keyring migration attempt.
- Clearing or replacing a known keyring reference should call `delete`; deletion failures may be logged, but DB/settings references should still be cleared after the user requested removal.
- Do not expose plaintext secrets through frontend responses. Frontend-visible profile/config responses should use booleans such as `apiKeySet` when possible. Existing password-edit prefilling is a compatibility exception and should not expand.

#### 4. Validation & Error Matrix
- Unknown/no prefix -> treat as legacy local ciphertext.
- Keyring reference read failure -> return an error; do not try to guess or synthesize a secret.
- Local/legacy base64 decode failure -> return an error and do not guess plaintext.
- Local/legacy decoded payload shorter than nonce + tag requirements -> return an error.
- AES-GCM decrypt failure -> return an error without logging plaintext or derived key material.
- OS random nonce generation failure -> fail local fallback encryption rather than falling back to timestamp/pid/counter-derived bytes.
- Keyring migration failure -> log and keep the existing reference unchanged.

#### 5. Good/Base/Bad Cases
- Good: newly saved SSH password stores `keyring:v1:secret:<uuid>` in `hosts.secret_ref` and the plaintext in the OS credential store.
- Base: Linux without accessible Secret Service stores `local:v1:<ciphertext>` and remains usable.
- Base: old raw ciphertext decrypts and is lazily migrated when a backend path uses it.
- Bad: caller stores a raw keyring password/API key directly in SQLite settings.
- Bad: caller assumes every `secret_ref` is AES-GCM ciphertext and calls local decrypt logic directly.

#### 6. Tests Required
- Unit tests for reference parsing, local fallback round-trip, and legacy ciphertext decrypt compatibility.
- Tests must not require a real OS keyring in CI unless explicitly marked/integration-gated.
- `cargo test` must pass after any secret storage change.
- `cargo check` must verify all credential callers still compile against stable Tauri command names.

#### 7. Wrong vs Correct

Wrong:

```rust
let password = decrypt_local_ciphertext(&host.secret_ref.unwrap())?;
```

Correct:

```rust
let reference = host.secret_ref.ok_or_else(|| anyhow::anyhow!("No saved password"))?;
let password = crate::core::secret::decrypt(&reference)?;
if let Some(next_ref) = crate::core::secret::try_migrate_to_keyring(&reference, &password) {
    db.update_host_secret_ref(&host.id, Some(&next_ref)).await?;
}
```

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

### Scenario: SSH Terminal Login Banner Rendering

#### 1. Scope / Trigger
- Trigger: SSH PTY output normalization, terminal startup probes, predictive echo initialization, or login banner/MOTD rendering changes.
- Applies to backend `output_reader_loop` byte handling and frontend terminal startup writes that can affect the remote PTY input stream.

#### 2. Signatures
- Backend normalizer: `CrLfNormalizer::normalize(&mut self, data: &[u8]) -> Vec<u8>`
- Backend flush: `CrLfNormalizer::flush(&mut self) -> Vec<u8>`
- Frontend terminal output sink: `term.write(remaining)`
- Frontend remote input sink: `api.sessionWrite(sessionId, bytes)`

#### 3. Contracts
- Raw SSH output must preserve remote text while normalizing PAM/login-banner `\r\r\n` to `\r\n`.
- CRLF normalization must be stream-based, not per chunk only. SSH may split `\r\r\n` as `"\r"` + `"\r\n"` or `"\r\r"` + `"\n"`.
- A pending trailing `\r` may be held until the next output chunk decides whether it belongs to `\r\r\n`; it must be flushed on channel EOF/close.
- If a login banner text line is followed by a bare `\r` and then a bracket-style shell prompt such as `[root@host ~]# `, normalize that CR to `\r\n` so the prompt starts on a fresh line instead of overwriting the banner.
- Do not globally convert every bare `\r` to a newline. Command output may use bare CR for progress/status rewrites, so non-prompt rewrites such as `progress 10%\rprogress 20%` must remain unchanged.
- Frontend startup must not write terminal capability probes such as `\x1b[6n` to the remote shell stdin during the login banner/MOTD window.
- User input, paste, macro writes, and normal resize synchronization may still use `api.sessionWrite` / `sessionResize`; this rule only forbids synthetic startup probes that can be echoed or interpreted by the shell.

#### 4. Validation & Error Matrix
- `\r\r\n` in one chunk -> emit exactly `\r\n`.
- `\r\r\n` split across chunks -> emit exactly `\r\n` once all bytes arrive.
- chunk ends with bare `\r` -> hold it until next chunk; if no next chunk arrives, flush it unchanged on close.
- `There were 1 failed login attempts...\r[root@host ~]# ` -> emit `There were 1 failed login attempts...\r\n[root@host ~]# `.
- `progress 10%\rprogress 20%` -> preserve the bare CR rewrite.
- startup CPR/probe requirement arises -> implement a local xterm-side query that does not forward probe bytes to the remote shell, or rely on OSC 133 / prompt heuristics.

#### 5. Good/Base/Bad Cases
- Good: `Last failed login...\r\r\n[root@host ~]# ` renders the prompt on a fresh line after the banner.
- Good: `There were 1 failed login attempts...\r[root@host ~]# ` renders the prompt on a fresh line after the login-attempt banner.
- Base: progress output using bare `\r` is preserved once the next byte or channel close arrives.
- Bad: `[root@host ~]# ttempt since the last successful login.` where the prompt overwrites the login-attempt banner.
- Bad: frontend sends `api.sessionWrite(sessionId, encode("\x1b[6n"))` immediately after connecting.

#### 6. Tests Required
- Unit tests must cover in-chunk and cross-chunk `\r\r\n` normalization.
- Unit tests must cover bare-CR bracket prompt overwrite prevention, including a cross-chunk split.
- Unit tests must cover non-prompt bare CR rewrites staying unchanged.
- Unit tests must assert a trailing bare `\r` is not lost on flush.
- Frontend build must pass after terminal startup write changes.
- `cargo check` and `cargo test` must pass after output-reader changes.

#### 7. Wrong vs Correct

Wrong:

```ts
setTimeout(() => {
  api.sessionWrite(sessionId, Array.from(encoder.encode("\x1b[6n")));
}, 300);
```

Correct:

```rust
let normalized = crlf_normalizer.normalize(data);
emit_session_output_bytes(&app, &session_id, &mut decoder, &normalized);
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

### Scenario: Terminal Background Asset Scope

#### 1. Scope / Trigger
- Trigger: terminal background images, Tauri CSP, or `assetProtocol.scope` behavior changes.
- Applies when frontend code renders local files through `convertFileSrc`, or when backend commands import local user-selected files for WebView display.

#### 2. Signatures
- Tauri config: `app.security.csp`
- Tauri config: `app.security.assetProtocol.scope.allow`
- Rust command: `terminal_import_background_image(req: TerminalImportBackgroundImageReq) -> Result<TerminalImportBackgroundImageResponse, String>`
- Request fields:
  - `sourcePath: string`
- Response fields:
  - `path: string`
- Frontend wrapper: `terminalImportBackgroundImage(sourcePath: string): Promise<{ path: string }>`
- Settings key: `terminal.bgImagePath`

#### 3. Contracts
- `assetProtocol.scope.allow` must not be `["**"]` for terminal backgrounds.
- Terminal background images must be copied into `$APPDATA/terminal-backgrounds/**` before being stored in `terminal.bgImagePath`.
- `terminal.bgImagePath` stores the imported absolute path returned by the backend command, not the original user-selected path.
- Rendering still uses `convertFileSrc(path)` from `@tauri-apps/api/core`.
- CSP must allow current app resources, Tauri IPC, inline styles required by existing React style props, `data:` images used by CSS, and Tauri asset image URLs:
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' asset: http://asset.localhost data:`
  - `connect-src 'self' ipc: http://ipc.localhost`
- Backend network requests such as updater and AI provider calls are not governed by WebView CSP.

#### 4. Validation & Error Matrix
- Empty `sourcePath` -> command returns `Err("Image path is empty")`.
- Relative `sourcePath` -> command returns `Err("Image path must be absolute")`.
- Unsupported extension -> command returns `Err("Unsupported image format")`.
- Missing or unreadable file -> command returns an error and frontend must not persist a new background path.
- Non-file path -> command returns `Err("Image path is not a file")`.
- Source already under `$APPDATA/terminal-backgrounds/**` -> command returns the canonical source path without copying.
- Import copy failure -> command returns an error; settings save should fail visibly instead of storing an out-of-scope path.

#### 5. Good/Base/Bad Cases
- Good: user selects `/Users/me/Pictures/bg.png`, backend imports it to app data, settings stores the imported path, terminal renders it with `convertFileSrc`.
- Base: existing old absolute path is migrated best-effort on settings or terminal load; migration failure keeps the app running and lets the user reselect.
- Bad: frontend stores the original picker path and relies on `assetProtocol.scope.allow: ["**"]`.
- Bad: CSP is tightened without allowing `asset:` / `http://asset.localhost`, causing background images to disappear.

#### 6. Tests Required
- `pnpm -C app build` must pass after frontend wrapper or settings flow changes.
- `cargo check` must pass after command/config changes.
- `cargo test` should cover accepted/rejected image extensions and deterministic imported file naming.
- Manual smoke test should select a terminal background image and confirm it persists after reopening settings/terminal.

#### 7. Wrong vs Correct
##### Wrong
```tsx
setTerminal((state) => ({ ...state, bgImagePath: file as string }));
```

##### Correct
```tsx
const importedPath = await api.terminalImportBackgroundImage(file as string);
setTerminal((state) => ({ ...state, bgImagePath: importedPath.path }));
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
- Provider numeric settings must be normalized before storage response and again before provider calls. Current accepted bounds are:
  - `timeoutSec`: 5-300 seconds, default `60`
  - `contextWindowTokens`: 1,000-10,000,000 tokens, default `128000`
  - `temperature`: 0.0-2.0, default `0.2`
  - `maxTokens`: 128-200,000 output tokens, default `1200`
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
- Out-of-range provider numeric values -> clamp to the documented bounds before any HTTP request; never send zero `max_tokens` / `max_output_tokens`.
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
  - out-of-range model numeric settings are normalized and provider request helpers cannot emit invalid zero output-token values
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

### Scenario: Tauri Capability Scope

#### 1. Scope / Trigger
- Trigger: `app/src-tauri/capabilities/*.json`, Tauri plugin usage, or frontend imports from `@tauri-apps/plugin-*` / `@tauri-apps/api/*` change.
- Applies when granting native WebView permissions for `main`, `quick-edit`, or future windows.

#### 2. Signatures
- Capability files:
  - `app/src-tauri/capabilities/default.json` -> `windows: ["main"]`
  - `app/src-tauri/capabilities/quick-edit.json` -> `windows: ["quick-edit"]`
- Validation command:
  - `pnpm -C app tauri build --no-bundle`

#### 3. Contracts
- Grant permissions per window, not globally.
- Prefer specific plugin permissions over `*:default` when the frontend only uses one command.
- Main window currently needs:
  - `dialog:allow-open` for settings and terminal file-picker flows.
  - `clipboard-manager:allow-read-text` and `clipboard-manager:allow-write-text` for terminal/editor clipboard flows.
  - `process:allow-restart`, `updater:allow-check`, and `updater:allow-download-and-install` for official updater flow.
- Quick Edit currently needs clipboard read/write because it reuses `QuickEditor`.
- Quick Edit must not receive dialog permission unless `@tauri-apps/plugin-dialog` is imported by the Quick Edit window path.
- Do not grant `opener:default` merely because backend Rust calls `tauri_plugin_opener`; frontend plugin permissions are only needed for WebView plugin API calls.
- Do not grant `notification:default` unless frontend imports and calls `@tauri-apps/plugin-notification`.
- Do not split `core:default` without a dedicated audit of all `@tauri-apps/api/app`, `path`, `window`, `webview`, and `event` usage.

#### 4. Validation & Error Matrix
- Missing permission for a frontend plugin command -> runtime WebView permission denial; restore the narrow permission for that exact command.
- Invalid permission identifier -> `pnpm -C app tauri build --no-bundle` fails during Tauri config/capability parsing.
- Removing `dialog:allow-open` from main -> settings image/download path selection and terminal upload pickers fail.
- Removing clipboard read/write from Quick Edit -> editor copy/paste command paths fail.
- Removing updater/process permissions from main -> official updater check/install/relaunch flow fails.

#### 5. Good/Base/Bad Cases
- Good: main uses `dialog:allow-open` instead of `dialog:default` when only `open()` is used.
- Good: Quick Edit keeps clipboard permissions because the reused editor calls clipboard-manager APIs.
- Base: backend custom `open_browser` can use Rust opener internally without granting WebView `opener:default`.
- Bad: add `notification:default` because a settings toggle says "notify" even though no frontend notification plugin call exists.
- Bad: remove permissions based only on one page search without checking shared components used by multiple windows.

#### 6. Tests Required
- Search frontend imports before changing capability permissions:
  - `rg "@tauri-apps/(api|plugin)" app/src`
- `pnpm -C app build` must pass.
- `cargo check` and `cargo test` under `app/src-tauri` must pass.
- `pnpm -C app tauri build --no-bundle` must pass after any capability change.
- Manual smoke test recommended for:
  - Settings file/folder pickers.
  - Terminal clipboard paste and file upload picker.
  - Quick Edit copy/paste/save.
  - Updater check/download/relaunch UI path when an update is available.

#### 7. Wrong vs Correct
##### Wrong
```json
"dialog:default",
"opener:default",
"notification:default"
```

##### Correct
```json
"dialog:allow-open",
"clipboard-manager:allow-read-text",
"clipboard-manager:allow-write-text"
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
