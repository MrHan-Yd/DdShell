# AI Agent 终端窗口技术设计

## Architecture

该功能分为四层：

1. Settings UI
   - 在设置页新增 AI Agent 分组。
   - 管理多个 provider 配置、默认配置、执行模式。
   - 前端不长期持有明文 API Key；编辑时只允许输入新 key 或保留原 key。

2. Backend AI Core
   - 新增 Rust core 模块，例如 `core::ai_agent`。
   - 负责保存/读取配置、加密/解密 API Key、请求第三方模型、解析响应。
   - 使用现有 `reqwest` 发送 HTTP 请求。

3. Provider Adapters
   - 内部统一请求：
     - user prompt
     - terminal context
     - provider config
   - 内部统一结果：
     - `answer`
     - `commands[]`
     - raw text
     - parse status
   - adapter 覆盖：
     - OpenAI Chat Completions
     - OpenAI Responses
     - Claude Messages
     - Gemini Generate Content

4. Terminal AI Assist UI
   - 在 `TerminalPage` 里实现设计稿中的右下角 `AI Assist` popover。
   - 由当前 active tab/session 驱动命令写入。
   - 按设置决定 Run command 是发送 `command + "\n"` 还是只发送 `command`。
   - 历史问答按 `TerminalTab.hostId` 隔离，本地保存每台服务器最近 20 条。

## Data Model

设置建议沿用 SQLite `settings` key/value，避免第一版引入新表。

- `aiAgent.enabled`: boolean string
- `aiAgent.defaultProfileId`: string
- `aiAgent.executionMode`: `"run"` | `"insert"`
- `aiAgent.confirmBeforeExecute`: `"true"` / `"false"`, defaults to `"true"`
- `aiAgent.timeoutSec`: shared request timeout for every profile
- `aiAgent.profiles`: JSON array，保存非敏感配置

Profile:

```json
{
  "id": "uuid",
  "name": "OpenAI",
  "protocol": "openaiChat" | "openaiResponses" | "claudeMessages" | "geminiGenerateContent",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4.1",
  "contextWindowTokens": 128000,
  "temperature": 0.2,
  "maxTokens": 1200,
  "apiKeySet": true
}
```

`contextWindowTokens` describes the model's input + output capacity and is used by the app to budget terminal context. It does not force the provider to accept a larger context than the model actually supports.

API Key 单独存储：

- `aiAgent.profile.<id>.apiKey`: encrypted string

后端返回 profile 时只返回 `apiKeySet`，不返回明文 key 或密文。

## Backend Commands

新增 Tauri commands：

- `ai_agent_config_get()`
- `ai_agent_config_save(config)`
- `ai_agent_profile_set_key(profile_id, api_key)`
- `ai_agent_profile_clear_key(profile_id)`
- `ai_agent_send(request)`

第一版可以把配置保存和 key 保存组合在一个 save 命令里，但返回结果仍必须脱敏。

## Request Contract

Frontend request:

```json
{
  "profileId": "uuid",
  "question": "nginx 502 怎么排查",
  "context": {
    "tabTitle": "api-prod-01",
    "cwd": "/var/log/nginx",
    "selectedText": ""
  }
}
```

Backend response:

```json
{
  "answer": "先确认 nginx 进程和 upstream 日志。",
  "commandMode": "steps",
  "commands": [
    {
      "command": "systemctl status nginx --no-pager | tail -n 30",
      "description": "查看 nginx 主进程状态和最近日志",
      "risk": "low",
      "confidence": "high"
    }
  ],
  "rawText": "...",
  "parseMode": "json" | "jsonBlock" | "jsonObject" | "shellBlock" | "none"
}
```

## Structured Output Strategy

Provider adapters should prefer native structured output:

- OpenAI Responses: use JSON schema / structured output when possible.
- OpenAI Chat Completions: use `response_format` JSON object/schema where compatible.
- Gemini: use `responseMimeType = "application/json"` and schema when possible.
- Claude Messages: use system prompt requiring JSON-only output for first pass.

All adapters include a shared system instruction:

- act as terminal command assistant
- return only the agreed JSON shape when possible
- command suggestions must be shell commands only
- do not include destructive commands unless explicitly needed
- explain risk in command metadata
- set `commandMode` to `alternatives` when commands are choices where one is enough, or `steps` when commands should be run in order

Local parser order:

1. `JSON.parse(raw)`
2. parse fenced `json` block
3. parse first balanced JSON object
4. extract fenced `shell` / `bash` / `sh` code blocks
5. no commands

Run command buttons are rendered only from normalized `commands[]`.
`commandMode=alternatives` renders as options and executes only the selected command. `commandMode=steps` renders as ordered steps and advances to the next step after the current command is sent.

## Command Execution

AI Assist never auto-runs model output. User action is required per command. The optional second confirmation is configurable and defaults on.

Flow:

1. User clicks Run command.
2. If `aiAgent.confirmBeforeExecute` is enabled, UI opens existing confirm dialog with command text and risk.
3. If second confirmation is disabled or the user confirms:
   - execution mode `run`: write `command + "\n"` to active session.
   - execution mode `insert`: write `command` only.
4. Existing terminal dangerous-command protection still applies to actual terminal input path.

## UI Design Notes

The implementation should follow `ui/terminal.html` and `ui/styles/pages/terminal.css`:

- `.term-ai-popover` right-bottom floating panel.
- Header: AI Assist title, history button, collapse/close button.
- Content: question block and one or more suggestion cards.
- Suggestion card: step tag, confidence, command block, copy, explanation, Run command, Dismiss, Next.
- Footer input bar with AI icon and submit affordance.
- Status bar shows AI state when enabled.

Cards should support multiple commands as a step list. If space is constrained, show the current command and Next/Previous navigation.

History should be keyed by server/host rather than tab/session id. Tab and session ids can change when a connection is reopened, while `hostId` is the stable boundary users expect when switching between servers.

## Error Handling

- Missing config: show settings CTA.
- Missing API Key: show key configuration error.
- HTTP 401/403: authentication error without echoing key.
- HTTP 404/model error: show provider/model error.
- Timeout: show timeout.
- Parse failure: show raw answer as text; no Run command unless shell block fallback succeeds.

## Security

- API keys are encrypted with existing local secret helper.
- API keys are never included in frontend config responses.
- API keys are never logged.
- Requests should not include full terminal scrollback by default.
- Command execution always requires an explicit Run/Insert click. The AI command second-confirm dialog is configurable and defaults on; terminal dangerous-command protection remains separate.
