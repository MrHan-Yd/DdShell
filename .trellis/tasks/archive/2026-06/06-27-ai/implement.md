# AI 助手多模型切换实施计划

## Steps

1. 更新共享类型
   - 新增 `AiAgentModel`。
   - `AiAgentProfile` 增加 `models`、`defaultModelId`。
   - `AiAgentSendRequest` 增加 `modelId`。
   - 保留旧字段为可选兼容字段，避免旧数据读取失败。

2. 更新后端配置模型
   - Rust 增加 `AiAgentModel`。
   - `StoredProfile` 支持旧单模型字段和新 `models` 字段。
   - 读取配置时归一化模型列表、默认模型、旧字段迁移。
   - `ai_agent_send` 根据 `modelId` 选择模型参数。
   - 补充单元测试覆盖旧配置迁移、默认模型回退、指定模型发送参数。

3. 更新设置页
   - 站点层保留协议、Base URL、API Key、默认模型。
   - 模型层支持新增、删除、编辑模型名称和参数。
   - 默认新站点创建一个默认模型。
   - 防止删除最后一个模型后出现不可恢复状态：允许为空但 UI 提醒，或删除后自动补一个空模型。优先允许为空并在终端禁用发送。

4. 更新终端 AI 助手
   - 用 themed `Select` 替换原生 profile select。
   - 增加模型 Select。
   - 按 profile 记住最近选择的 model。
   - 请求时传 `modelId`。
   - 没有模型或缺少 API Key 时禁用发送并显示中文提示。

5. 清理样式和文案
   - 删除或绕开 `.ai-profile-select` 原生 select 样式。
   - 增加模型相关 i18n。
   - 检查 Aurora 全局 button reset 是否影响 Select。

6. 验证
   - `cd app/src-tauri && cargo test ai_agent`
   - `cd app/src-tauri && cargo check`
   - `cd app && pnpm build`
   - `git diff --check`

## Risk Points

- 旧 `aiAgent.profiles` JSON 中已有单模型字段，迁移必须无损。
- API Key 存储 key 不能改变，否则用户已保存的 Key 会丢。
- 终端弹窗 Select 使用 portal 时要避免焦点/关闭行为影响 AI popover。
- 多模型参数从 profile 层移动到 model 层，前后端字段必须保持 camelCase 对齐。
