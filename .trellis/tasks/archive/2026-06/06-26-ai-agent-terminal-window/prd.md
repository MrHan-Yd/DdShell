# AI Agent 终端窗口 PRD

## Goal

在终端页增加一个 AI Agent 窗口，用户可以通过设置配置不同模型供应商和鉴权信息。Agent 不只是聊天，还能根据用户问题生成建议命令，由用户确认后再写入并执行到当前终端会话。

## User Value

- 用户可以在终端上下文中询问问题，获得自然语言解释和可执行命令建议。
- API 地址、Key、模型和协议格式由用户自行配置，适配 OpenAI-compatible、OpenAI 新接口、Claude、Gemini 等不同服务。
- 命令执行必须经过明确确认，避免 AI 自动执行危险命令。

## Confirmed Facts From User

- AI 配置放在设置页，不只在聊天窗口里临时填写。
- Agent 能力不只是聊天。
- AI 回答中要把建议执行的命令列出来。
- 每条命令需要用户点击确认后才执行。
- 用户可在配置里选择协议格式：
  - Chat Completions API（OpenAI 兼容）
  - Responses API（OpenAI 新版）
  - Claude Messages API
  - Gemini Generate Content API
- 用户可以自定义 URL、Key、模型等配置。
- AI 输出采用“官方结构化输出优先 + 强 prompt 约束 + 本地兜底解析”的策略。
- 只要本地解析出命令建议，就需要在 AI Assist 中展示 Run command 按钮。

## Repository Evidence

- 应用是 Tauri + React；前端设置页在 `app/src/features/settings/SettingsPage.tsx`。
- 设置目前使用 SQLite key/value 存储，前端通过 `settingGet` / `settingSetMany` 访问。
- 已有 `app/src-tauri/src/core/secret.rs`，用于本机加密保存敏感字符串，可复用到 API Key 存储。
- 终端页已有危险命令确认逻辑，可作为 AI 命令确认交互的参考。
- 终端页已有 `terminal:insert-text` 事件，可向指定终端会话写入文本。
- 命令助手已有设置分组和终端浮层相关模式，可作为 UI 集成参考。
- UI 设计稿 `ui/terminal.html` 已定义终端页右下角 `AI Assist` 悬浮窗口：
  - 使用 `.term-ai-popover`，定位在终端区域右下角。
  - 顶部包含标题、历史按钮、关闭/折叠按钮。
  - 内容包含用户问题、AI 建议命令卡片、复制按钮、解释文本、Run command、Dismiss、Next。
  - 底部输入栏 placeholder 为“问 AI 想做什么…  (查日志、重启服务、查 PID)”。
  - 状态栏有 `AI on` 状态提示。

## Requirements

### Settings

- 设置页新增 AI Agent 配置区域或独立分组。
- 支持启用/禁用 AI Agent。
- 支持配置一个或多个供应商配置。
- 第一版支持多个 AI 配置，并允许设置一个默认配置。
- Agent 窗口里可以切换当前使用的配置；切换后后续请求使用所选配置。
- 每个配置至少包含：
  - 名称
  - 协议格式：Chat Completions API（OpenAI 兼容）、Responses API（OpenAI 新版）、Claude Messages API、Gemini Generate Content API
  - Base URL
  - API Key
  - Model
  - 上下文窗口 token：模型最多能处理的输入+输出总 token，用于控制本地上下文预算。
  - 可选默认参数：随机性/temperature、最大输出 token
- 超时秒数是所有 AI 配置共用的全局设置，不放在单个 provider 配置里。
- 最大输出 token 只限制模型单次回答输出长度，不代表上下文窗口大小。
- 上下文窗口 token 记录模型能力上限，不是 API 强制扩容参数；如果用户配置超过模型真实能力，provider 仍可能报错。
- API Key 不应以明文长期展示；保存时应使用本机加密机制。
- 用户可以选择默认配置。

### Terminal Agent Window

- 终端页提供一个按钮打开 AI Agent 窗口。
- 窗口应优先按 `ui/terminal.html` 里的 `AI Assist` 设计稿落地：
  - 右下角悬浮 popover，而不是全屏页面或独立路由。
  - 宽度接近设计稿的 380px，并受终端区域高度限制。
  - 保留标题区、历史/关闭动作、问题区、建议卡片区、底部输入栏。
  - 底部状态栏显示 AI 启用状态。
- 支持输入用户问题并发送给当前默认 AI 配置。
- 支持在 Agent 窗口切换当前 AI 配置。
- 支持展示自然语言回答。
- 支持展示结构化命令建议列表。
- Run command 按钮出现与否以本地解析出的命令列表为准，不直接依赖模型原始文本。
- 支持通过右上角历史按钮查看当前服务器最近 20 条问答；历史按服务器隔离并保存在本机，点击历史项可恢复当时的回答和命令卡片。
- 支持加载、错误、空配置、鉴权失败、请求超时等状态。

### Command Suggestions

- AI 响应应被解析为：
  - 普通回答内容
  - 命令建议列表
- 每条命令建议至少包含：
  - command
  - description
  - risk level 或是否危险
- AI 请求应尽量要求模型返回结构化结果：
  - `answer`
  - `commandMode`: `alternatives` 或 `steps`
  - `commands[]`
  - `command`
  - `description`
  - `risk`
  - `confidence`
- 对支持原生 JSON/Schema 的协议，应优先使用原生结构化输出能力。
- 对不支持或兼容性不稳定的协议，应通过 system prompt 强约束“只返回 JSON”。
- 本地解析顺序：
  - 直接解析 JSON。
  - 提取 Markdown fenced `json` 代码块再解析。
  - 截取首个 JSON 对象再解析。
  - 最后从 `shell` / `bash` / `sh` 代码块中提取命令作为兜底。
- 兜底提取命令时，不应从普通自然语言段落里猜测命令。
- 每条命令旁边提供确认执行按钮。
- 如果 `commandMode=alternatives`，多条命令表示备选方案，用户选择其中一条执行即可。
- 如果 `commandMode=steps`，多条命令表示顺序步骤，用户执行当前步骤后窗口自动切到下一步。
- 用户点击确认后，命令才会发送到当前活动终端。
- 命令确认后的行为可在设置里控制：
  - 直接执行：发送 `command + Enter`，作为默认推荐行为。
  - 只插入：只把命令写入终端输入区，由用户手动按 Enter 执行。
- 支持在设置里控制点击“执行命令”后是否弹出二次确认；默认开启二次确认，关闭后点击执行命令直接进入上述执行/插入流程。
- 命令执行前仍应尊重现有危险命令保护。

### Provider Protocol Support

- Chat Completions API（OpenAI 兼容）：兼容 `/chat/completions` 的 messages 输入和 choices 输出。
- Responses API（OpenAI 新版）：兼容 Responses API 风格输入和输出。
- Claude Messages API：兼容 Anthropic Messages API 风格输入和输出。
- Gemini Generate Content API：兼容 Google Gemini generateContent 风格输入和输出。
- UI 中允许用户显式选择格式，不通过 URL 自动猜测。
- 不同格式需要统一转换成应用内部消息和结果结构。
- OpenAI Responses / 支持 schema 的 Chat Completions / Gemini 应尽量启用 JSON schema 或 JSON MIME 类型。
- Claude 第一版可用 Messages API + system prompt 约束 JSON；后续再扩展 tool use。

### Context

- 第一版至少支持用户手动输入问题。
- Agent 请求可附带当前终端的基础上下文：
  - 当前连接/标签名称
  - 当前工作目录，如果可获取
  - 用户明确选择的终端文本，后续可扩展
- 不应默认上传大量终端历史。

## Acceptance Criteria

- 用户可以在设置中新增 AI 配置，填写 URL、Key、模型并选择协议格式。
- 用户可以保存多个 AI 配置、设为默认，并在 Agent 窗口中切换。
- 未配置 AI 时，终端 Agent 窗口提示先去设置配置。
- 用户在终端页打开 AI Agent 窗口后可以发送问题并看到回答。
- 对支持命令的回答，窗口能列出待执行命令。
- 如果模型返回有效结构化结果，命令卡片来自 `commands[]`。
- 如果模型返回 Markdown fenced shell/bash 代码块，命令卡片可从代码块兜底生成。
- 如果没有解析出命令，只展示回答，不展示 Run command。
- 设置为直接执行时，点击某条命令的确认按钮后，该命令被写入当前活动终端并执行。
- 设置为只插入时，点击某条命令的确认按钮后，该命令只写入当前活动终端，不自动发送 Enter。
- 二次确认开关默认开启；关闭后，点击“执行命令”不弹出 AI 命令二次确认。
- 取消或关闭确认不会写入终端。
- 配置为 OpenAI Chat Completions、OpenAI Responses、Claude、Gemini 时，代码路径有对应 adapter。
- API Key 不以明文暴露在日志、错误提示或普通设置读写结果中。
- 请求失败时展示可理解的错误，不导致终端页崩溃。

## Out Of Scope For First Pass

- AI 自动连续执行多步任务。
- 无确认的自动命令执行。
- 自动读取整个终端历史或项目文件。
- 复杂工具调用/function calling 的完整编排。
- 云端同步 AI 配置。
- 云端同步或跨设备同步 AI 问答历史。

## Open Questions

- 无阻塞型开放问题。规划范围已确认，可进入设计和实现。
