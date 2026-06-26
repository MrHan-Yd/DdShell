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

#### 3. Contracts
- Settings keys:
  - `aiAgent.enabled`: `"true"` / `"false"`
  - `aiAgent.defaultProfileId`: profile id or empty string
  - `aiAgent.executionMode`: `"run"` / `"insert"`
  - `aiAgent.confirmBeforeExecute`: `"true"` / `"false"`, defaulting to `"true"` when missing
  - `aiAgent.timeoutSec`: shared provider request timeout in seconds
  - `aiAgent.profiles`: JSON array of non-secret profile fields
  - `aiAgent.profile.<id>.apiKey`: encrypted API key only
- `AiAgentProfile` response must include `apiKeySet: bool`, but must never include plaintext or encrypted API key.
- `AiAgentProfile.contextWindowTokens` is the model capacity used for app-side prompt/context budgeting; it is not sent as a universal provider parameter and does not override real model limits.
- `AiAgentSendReq` includes `profileId`, `question`, and optional terminal context (`tabTitle`, `cwd`, `selectedText`).
- `AiAgentSendResponse` normalizes all providers to `answer`, `commandMode`, `commands[]`, `rawText`, and `parseMode`.
- `commandMode` must be `"alternatives"` when commands are equivalent choices where one is enough, and `"steps"` when commands should be run in order. Missing/unknown model output should default conservatively to `"alternatives"` unless fallback parsing clearly extracts a shell block workflow or the original user question has diagnostic/triage intent.
- Diagnostic questions such as troubleshooting, "why", "where is space used", disk usage analysis, or broad-to-detail investigation should prefer `"steps"` for multi-command results. This local normalization may override a model's `"alternatives"` value unless the answer/command descriptions explicitly say the commands are optional choices.
- Provider adapters must keep protocol-specific request/response handling in backend code, not in frontend components.
- The AI command second-confirm dialog is a frontend behavior controlled by `AiAgentConfig.confirmBeforeExecute`; backend must persist and return the setting but must not couple provider calls to UI confirmation state.

#### 4. Validation & Error Matrix
- AI disabled -> return error before provider request.
- Profile id not found -> return profile-not-found error.
- Empty base URL or model -> return validation error.
- Missing/cleared API key -> return key-not-configured error.
- Provider non-2xx -> return status plus a short bounded provider error body; never include API key.
- Provider invalid JSON wrapper -> return invalid-response error.
- Model output parse failure -> return `parseMode = "none"` with no commands rather than guessing commands from prose.

#### 5. Good/Base/Bad Cases
- Good: OpenAI-compatible profile stores only non-secret fields in `aiAgent.profiles`; key is encrypted under `aiAgent.profile.<id>.apiKey`; frontend receives `apiKeySet: true`.
- Base: Claude output is JSON because system prompt enforces the shared schema; parser returns `parseMode = "json"` and one command.
- Bad: Frontend calls provider APIs directly with a plaintext key or stores provider key inside `aiAgent.profiles`.

#### 6. Tests Required
- `cd app && pnpm build` verifies frontend/Tauri type alignment and i18n keys.
- `cd app/src-tauri && cargo check` verifies command registration and backend type alignment.
- When automated tests are added, assert:
  - config read redacts keys and reports `apiKeySet`
  - save config preserves profile fields without secrets
  - missing key blocks `ai_agent_send`
  - parser handles raw JSON, fenced JSON, JSON object inside text, shell fenced fallback, and no-command prose
  - command mode normalization keeps simple listing commands as alternatives, but maps diagnostic multi-command answers to steps even when the model mislabels them as alternatives

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
  question,
  context: { tabTitle, cwd, selectedText: null },
});
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
