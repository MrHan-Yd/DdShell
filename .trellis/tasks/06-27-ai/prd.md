# AI 助手多模型切换 PRD

## Goal

优化终端 AI 助手的模型选择体验：终端弹窗里的配置选择改用设置页同款下拉组件；一个模型站点配置可以包含多个模型；终端 AI 助手中可以先切换配置，再切换该配置下的模型。

## User Value

- 用户配置一个兼容站点时，不需要为同一个 Base URL / API Key / 协议重复创建多条配置。
- 终端 AI 助手可以快速在同一站点的不同模型之间切换，例如普通模型、推理模型、快模型。
- 下拉控件视觉与设置页保持一致，避免原生 select 和应用主题不一致。

## Confirmed Facts From User

- 终端 AI 助手里的配置下拉要改成设置页同款下拉组件。
- 一个配置站点需要支持配置多个模型。
- 终端 AI 助手使用时需要支持切换配置和切换模型。
- 终端 AI 助手应按配置记住用户最近选择的模型；如果该模型被删除，则回退到配置默认模型或第一项。

## Repository Evidence

- 终端 AI 助手在 `app/src/features/terminal/TerminalAiAssist.tsx` 中使用原生 `<select className="ai-profile-select">` 切换配置。
- 设置页使用 `app/src/components/ui/themed/Select` 组件，支持 Classic / Aurora 主题。
- 当前类型 `AiAgentProfile` 只有单个 `model: string` 字段。
- 后端 `app/src-tauri/src/core/ai_agent.rs` 的 provider 请求读取 `profile.model`，配置存储在 `aiAgent.profiles` JSON 中。
- API Key 当前按 profile id 加密保存，适合继续作为“站点配置”的密钥边界。

## Requirements

### Settings

- AI 模型配置中的单个站点配置应支持多个模型。
- 每个模型至少需要一个模型名称 / model id。
- 需要保留当前单模型配置的兼容迁移路径：旧配置中的 `model` 应自动成为模型列表中的默认模型。
- 用户可以在同一配置中新增、编辑、删除模型。
- 用户可以选择该配置的默认模型。
- Base URL、协议、API Key 继续归属站点配置。
- 每个模型单独配置 model id、上下文窗口 Token、随机性、最大输出 Token、响应方式。

### Terminal AI Assist

- 配置选择下拉改为设置页同款主题化 Select。
- 在配置下拉旁或下方增加模型下拉。
- 切换配置后，模型下拉只展示该配置下的模型。
- 切换配置后，如果当前模型不属于新配置，自动选择新配置的默认模型或第一项。
- 切换模型后，按配置记住最近选择；重新打开 AI 助手或切回该配置时恢复最近选择。
- 发送请求时必须携带用户当前选择的模型，而不是只使用配置里的旧 `profile.model`。
- 未配置模型时，应显示中文提示并禁用发送。

### Backend

- 后端保存/读取配置时需要支持多模型字段，并兼容旧 `model` 字段。
- `ai_agent_send` 请求需要能指定模型，后端使用请求中的模型及其参数发送 provider 请求。
- API Key 不应复制到模型层，仍跟随站点配置加密保存。

## Acceptance Criteria

- 设置页能在一个 AI 配置中维护多个模型。
- 旧的单模型配置读取后仍能正常显示和发送请求。
- 终端 AI 助手中的配置下拉使用设置页同款 Select 样式。
- 终端 AI 助手可以分别切换配置和模型。
- 切换模型后，下一次 AI 请求使用当前选中的模型。
- 关闭并重新打开 AI 助手后，同一配置能恢复最近选择的模型。
- 如果最近选择的模型已删除，自动回退到该配置默认模型或第一项。
- 没有模型时不能发送请求，并显示可理解的中文状态。
- `pnpm build` 和 `cargo check` 通过。

## Out Of Scope

- 自动从服务端拉取模型列表。
- 云端同步模型配置。
- 真正 SSE 流式响应实现。

## Open Questions

- 无阻塞型开放问题。范围已确认，可进入设计和实现。
