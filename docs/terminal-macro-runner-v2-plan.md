# 终端命令宏 V2 方案（参数覆盖 + 历史持久化 + 队列）

> 目标：在 V1 可用基础上，补齐“临时参数覆盖、运行历史持久化、会话队列控制”，保持终端内快速运行体验不变。

---

## 1. V2 目标与边界

### 1.1 目标（必须）

1. 支持**本次运行参数覆盖**（不改 recipe 默认值）。
2. terminal 内宏运行结果写入 `workflow_runs`（含 step 级状态与关键输出）。
3. 同一 `sessionId` 增加队列策略（默认串行排队）。

### 1.2 边界（V2 不做）

- 不做并行步骤、条件分支、重试策略。
- 不做跨会话分布式调度。
- 不做复杂审批流（保留危险命令确认）。

---

## 2. 产品交互

## 2.1 面板升级（保持轻弹层）

- `MacroQuickPanel` 增加“高级参数”折叠区：
  - 默认收起；用户主动展开才展示参数输入。
  - 参数项：`key / value / required / secret`。
  - 底部显示“本次运行覆盖 N 项”。

## 2.2 运行入口

- 继续支持 `Enter` 一键运行（无覆盖时走默认值）。
- 用户填写覆盖值后点击 `Run`，仅作用于当前 run。

## 2.3 队列反馈

- 若当前 session 已在运行：
  - 默认入队，toast 提示 `Queued (#2)`。
  - 按钮态显示 `Running 1 + Queue 2`（简写可 `1+2`）。
- 可在面板中取消未开始的排队项。

---

## 3. 执行模型

## 3.1 参数合并规则（V2 核心）

设：
- `defaults`: recipe params 中 `defaultValue`
- `runtime`: 本次输入覆盖

合并：`effective[key] = runtime[key] ?? defaults[key] ?? ""`

校验：
- `required=true` 且 `effective[key].trim()===""` -> 阻止启动。
- `secret=true` 只影响显示脱敏，不影响传值。

## 3.2 队列模型（session 维度）

每个 `sessionId`：
- `runningRun: ActiveMacroRun | null`
- `pendingRuns: QueuedRun[]`

规则：
1. 无 running 时直接执行。
2. 有 running 时新任务入队。
3. 当前 run 结束（completed/failed/cancelled）后自动拉起下一条。
4. 停止仅影响当前 running；排队项可单独取消。

## 3.3 状态机扩展

- 运行态：`idle | queued | running | cancelling | completed | failed | cancelled`
- 队列态：`pending | dropped`

---

## 4. 数据持久化设计（workflow_runs）

## 4.1 写入策略

每次 terminal run：
1. `run_start`：创建 run（state=running）。
2. 每步结束：更新 step state / exitCode / timestamps。
3. run 结束：更新 run state（completed/failed/cancelled）与 error。

## 4.2 关键字段建议

run 级：
- `id`
- `recipeId`
- `hostId`
- `sessionId`（新增建议）
- `triggerSource="terminal_macro"`
- `runtimeParamsJson`（新增建议，记录本次覆盖）
- `state`
- `error`
- `startedAt/finishedAt`

step 级：
- `stepId/title/command/renderedCommand`
- `state`
- `exitCode`
- `stdout/stderr`（可截断，避免过大）
- `startedAt/finishedAt`

## 4.3 输出截断策略

- stdout/stderr 单步建议上限：64KB。
- 超出写入 `...<truncated>` 标记，防止 DB 膨胀。

---

## 5. 前后端改造点

## 5.1 前端

1. `useMacroRunner.ts`
   - 入参扩展：`runtimeParams`。
   - 增加 session 队列容器与调度器。
   - 在生命周期节点调用 run 持久化 API。

2. `MacroQuickPanel.tsx`
   - 新增参数折叠区与输入组件。
   - 支持 secret 输入掩码。
   - 支持排队可视化与取消。

3. `TerminalPage.tsx`
   - 注入 hostId/sessionId 到 runner。
   - 展示 queue 数量（按钮/面板）。

## 5.2 后端（Tauri/Rust）

- 复用或扩展现有 workflow run 相关 command：
  - `workflow_run_start_terminal`（建议）
  - `workflow_run_step_update`
  - `workflow_run_finish`
- 或在现有 `workflow_run_*` 上加 `triggerSource/sessionId/runtimeParamsJson`。

---

## 6. 兼容性与迁移

1. 老 recipe 无 `required/secret` 字段时，默认：
   - `required=false`
   - `secret=false`
2. 老 run 记录无 `triggerSource/runtimeParamsJson/sessionId` 时，按空值处理。
3. DB 迁移加列应为可空，避免破坏旧数据。

---

## 7. 里程碑（建议 3 个迭代）

## M1（参数覆盖）

- 面板参数折叠区 + runtimeParams 合并与校验。
- 运行链路保持 V1，先不持久化。

验收：可对同一宏多次运行不同参数，且不改默认值。

## M2（持久化）

- run/step 全链路写入 workflow_runs。
- Workflows 页面可查看 terminal 触发的执行记录。

验收：运行后可在历史中看到完整状态与步骤结果。

## M3（队列）

- session 串行队列 + 队列 UI + 取消排队项。

验收：同 session 连续触发多个宏时按顺序执行且可观测。

---

## 8. 验收清单（V2）

- [ ] 可填写临时参数覆盖且不改 recipe 默认值。
- [ ] required 参数在“默认值+覆盖值”合并后校验正确。
- [ ] secret 参数在 UI 中脱敏显示。
- [ ] terminal 触发的 run 可在 workflow_runs 历史中查看。
- [ ] run/step 的 started/finished/exitCode/state 准确。
- [ ] 同 session 并发触发时自动入队并顺序执行。
- [ ] 可取消排队项，不影响当前 running。
- [ ] 当前 running 停止后，队列下一项自动接续。
- [ ] 大输出被截断且有可识别标记。

---

## 9. 风险与规避

1. **输出量大导致卡顿/膨胀**
   - 运行时实时渲染不变，持久化时截断。
2. **队列与手工输入冲突**
   - 队列运行中显示明显提示；允许用户暂停队列。
3. **多来源 run 混淆**
   - 增加 `triggerSource` 区分 `terminal_macro` 与其它来源。
4. **数据一致性**
   - run finish 作为最终一致点，异常退出统一落 failed/cancelled。
