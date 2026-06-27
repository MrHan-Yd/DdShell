# AI 助手多模型切换技术设计

## Data Model

继续沿用 `aiAgent.profiles` JSON，不新增数据库表。

站点配置 `AiAgentProfile`：

```json
{
  "id": "profile-id",
  "name": "OpenAI",
  "protocol": "openaiChat",
  "baseUrl": "https://api.openai.com/v1",
  "defaultModelId": "model-id",
  "models": [
    {
      "id": "model-id",
      "name": "GPT 4.1",
      "model": "gpt-4.1",
      "contextWindowTokens": 128000,
      "temperature": 0.2,
      "maxTokens": 1200,
      "responseMode": "nonStream"
    }
  ],
  "apiKeySet": true
}
```

兼容旧配置：

- 旧 `profile.model`、`contextWindowTokens`、`temperature`、`maxTokens`、`responseMode` 继续允许反序列化。
- 如果 `models` 缺失或为空，后端把旧字段转换成一个模型条目。
- 如果 `defaultModelId` 缺失或指向不存在模型，回退到第一个模型。
- API Key 仍按 `aiAgent.profile.<profileId>.apiKey` 加密保存，不进入模型列表。

## Request Contract

`AiAgentSendReq` 增加：

```json
{
  "profileId": "profile-id",
  "modelId": "model-id",
  "question": "...",
  "context": {}
}
```

后端根据 `profileId + modelId` 选择站点和模型参数。若 `modelId` 缺失或无效，回退到站点默认模型；若站点没有任何可用模型，返回可理解错误。

## Frontend Settings

设置页模型配置区域拆成两层：

- 站点层：配置名称、协议、Base URL、API Key、默认模型。
- 模型层：名称、model id、上下文窗口 Token、随机性、最大输出 Token、响应方式。

不要把模型层做成嵌套卡片。沿用现有站点配置卡片，模型列表用紧凑的分组行或 bordered row。

## Terminal AI Assist

终端 AI 助手状态：

- `profileId`: 当前站点配置。
- `modelId`: 当前模型。

选择逻辑：

- profile 下拉改为设置页同款 `Select`。
- 增加 model 下拉，同样用 `Select`。
- 切换 profile 时，从本地记忆中恢复该 profile 最近选择的 model；无记忆时用默认模型；仍无可用项时用第一项。
- 切换 model 后写入本地记忆：`terminal.aiAssist.selectedModel.<profileId>`。
- 发送请求时带上 `modelId`。

## Styling Notes

- 终端弹窗内 Select 需要宽度稳定，避免切换长名称时挤压状态 pill。
- 下拉组件在 Aurora 中使用 portal，不应被 AI popover 的 `overflow: hidden` 裁剪。
- 原生 `.ai-profile-select` 样式可删除或保留为无用兼容；新 UI 不再使用原生 select。

## Validation

- `cd app && pnpm build`
- `cd app/src-tauri && cargo check`
- `cd app/src-tauri && cargo test ai_agent`
- 手动检查：
  - 旧单模型配置读取后仍可发送。
  - 一个站点配置多个模型，终端可切换模型。
  - 切换配置后模型列表变更且恢复最近选择。
  - 没有模型时禁用发送并展示中文提示。
