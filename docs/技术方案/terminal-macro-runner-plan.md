# 终端内运行命令宏方案（V1）

> 目标：在 Terminal 页面内，以“小图标 + 轻弹层”的方式运行命令宏，不新增 tab，不打断终端主视图。

---

## 1. 结论与边界

### 1.1 本次确定的产品决策

1. **入口形态**：终端右上角悬浮胶囊按钮（图标态），点击打开轻弹层。  
2. **交互风格**：类似 Spotlight / Raycast（搜索 + 最近使用），非新页面、非新 tab。  
3. **参数策略**：**V1 不做临时参数覆盖**，仅使用宏中参数默认值。  
4. **执行位置**：在当前活动终端会话中执行（当前 tab 的 session）。  
5. **执行方式**：按步骤串行执行，失败即停，支持手动停止（Ctrl+C）。

### 1.2 非目标（V1 不做）

- 不新增“运行参数填写表单”。
- 不做复杂编排（并行步骤、条件分支、重试策略）。
- 不做独立运行详情页（先以终端内可见输出为主）。

---

## 2. 交互方案

## 2.1 入口与状态

- 终端工具区新增一个 `MacroRunButton`（建议图标：`Zap`）。
- 空闲态：仅图标。
- 运行态：图标 + 简短进度（如 `2/5`）。
- 失败态：图标 + 红点提示。

## 2.2 弹层内容（轻量）

- 顶部：搜索输入框（按标题/描述筛选宏）。
- 中部：结果列表（标题、步骤数、参数数、最近运行时间）。
- 底部：最近使用（最多 3 条）。
- 快捷键：
  - `Enter` 运行当前选中
  - `↑/↓` 切换选中
  - `Esc` 关闭

## 2.3 运行反馈

- 运行开始时，在终端打印统一前缀：
  - `[Macro] Start: <title>`
  - `[Macro] Step 1/5: <step title>`
- 每步结束打印：
  - 成功：`[Macro] Step 1 done (exit 0)`
  - 失败：`[Macro] Step 1 failed (exit X)`
- 全部完成打印：`[Macro] Completed`。
- 手动停止打印：`[Macro] Cancelled by user`。

---

## 3. 执行模型设计

## 3.1 绑定规则

- 必须有 active terminal tab。
- 运行绑定 `activeTab.sessionId`。
- 若会话断开（非 connected），禁止启动并提示重连。

## 3.2 参数解析规则（V1）

- 使用 recipe 参数定义中的 `defaultValue`。
- `required=true` 且默认值为空：启动前拦截，报错并阻止运行。
- 插值规则沿用现有：`{{key}}` / `{{ key }}`。

## 3.3 串行步骤状态机

状态：

- `idle`
- `running(stepIndex)`
- `failed(stepIndex, reason)`
- `completed`
- `cancelled`

流程：

1. 校验会话、校验参数默认值完整性。
2. 读取 steps，按顺序执行。
3. 当前步 exit code 为 0 则进入下一步；否则失败并终止。
4. 用户可随时“停止运行”，发送 `Ctrl+C` 并置为 `cancelled`。

---

## 4. 技术实现建议

## 4.1 前端结构

新增/调整组件：

1. `app/src/features/terminal/components/MacroRunButton.tsx`  
   - 悬浮胶囊按钮 + 状态显示。
2. `app/src/features/terminal/components/MacroQuickPanel.tsx`  
   - 搜索弹层（列表、键盘导航、最近使用）。
3. `app/src/features/terminal/hooks/useMacroRunner.ts`  
   - 核心 runner（start/stop/next/fail/done）。
4. `app/src/features/terminal/TerminalPage.tsx`  
   - 接入按钮、面板、runner 状态，调用 `sessionWrite`。

## 4.2 数据与 store

- 复用 `useWorkflowsStore` 的 recipes 数据。
- 在 terminal 侧新增轻量本地状态（可先组件内，后续再抽 store）：
  - `activeMacroRun`（runId、title、stepIndex、total、state）
  - `recentMacroIds`（本地缓存）

## 4.3 执行 API 复用

- 写入命令沿用：`sessionWrite(sessionId, bytes)`。
- 暂不调用 `workflow_run_start`（它是独立 SSH 会话，不是当前终端交互模型）。

---

## 5. 风险与规避

1. **提示符判定不稳定**  
   - V1 不依赖 prompt 检测，先用“单步命令尾部输出 exit code”的方式闭环。
2. **命令输出干扰状态判断**  
   - 使用唯一 token 包裹每步结束标记，避免普通输出误匹配。
3. **用户手动输入干扰运行**  
   - 运行中建议显示“宏执行中”提示；必要时可临时禁用宏面板再次启动。
4. **会话断开中途失败**  
   - 监听 `session:state_changed`，非 connected 时立即标记失败并提示。

---

## 6. 里程碑计划

## M1（核心可用）

- 完成 `useMacroRunner` 串行执行。
- 支持开始/停止。
- 终端内输出进度日志。

验收：可在当前会话一键运行任意宏，失败即停。

## M2（现代化交互）

- 完成 `MacroRunButton + MacroQuickPanel`。
- 支持搜索、键盘导航、最近使用。
- 支持运行态进度展示（`2/5`）。

验收：无需离开终端即可快速选宏并运行。

## M3（稳定性补强）

- 增加异常处理（会话断开、required 默认值缺失）。
- 增加危险命令总确认（可开关）。
- 增加埋点/日志（启动、成功、失败、取消）。

验收：异常链路完整，错误可理解、可恢复。

---

## 7. 后续可扩展（V2+）

- 临时参数覆盖（高级折叠区，不改默认极简路径）。
- 与 `workflow_runs` 持久化打通（历史回放、审计）。
- 宏运行队列与并发控制（同会话防重入策略）。

---

## 8. 验收清单（V1）

- [x] 无 active tab 时，按钮不可执行并提示。  
- [x] 运行中显示步骤进度，停止按钮可用。  
- [x] 失败步后不会继续执行后续步骤。  
- [x] required 且无默认值会在启动前阻止运行。  
- [x] 全程不跳转页面、不新开 tab。  

---

## 9. 当前实现状态（2026-04-21）

### 9.1 已实现范围

1. **M1 核心执行链路**：
   - `useMacroRunner` 完成串行执行、失败即停、手动停止。
   - 每步通过唯一 token + exit code 判定完成，不依赖 prompt。
   - 终端内输出统一 `[Macro]` 前缀日志（本地渲染，不写入远端命令）。

2. **M2 交互入口与快速面板**：
   - 增加 `MacroRunButton`（空闲图标、运行进度、失败红点）。
   - 增加 `MacroQuickPanel`（搜索、键盘导航、最近使用）。
   - 运行入口保持在 Terminal 页内，不新开 tab。

3. **M3 稳定性补强（V1 范围）**：
   - 会话断开即时失败。
   - `required=true` 且默认值为空时启动前拦截。
   - 危险命令统一确认（复用现有危险命令配置）。
   - 同会话防重入（运行中禁止重复启动）。

### 9.2 暂未纳入（保持 V1 边界）

- 不提供临时参数覆盖表单。
- 不做复杂编排（并行/分支/重试）。
- 不引入独立运行详情页。

---

## 10. 手工回归脚本（V1）

1. **无 active tab**
   - 前置：关闭所有终端会话。
   - 操作：点击宏运行按钮。
   - 预期：按钮不可执行或提示无活动 tab，不进入运行态。

2. **基础成功链路**
   - 前置：准备 2~3 步均返回 0 的宏。
   - 操作：在当前 tab 启动宏。
   - 预期：显示进度 `1/N -> ... -> N/N`，终端出现 Start/Step done/Completed。

3. **失败即停**
   - 前置：第 2 步为 `exit 2`，第 3 步可观察是否执行。
   - 操作：启动宏。
   - 预期：第 2 步 failed，整体 failed，第 3 步不执行。

4. **手动停止**
   - 前置：某一步执行长命令（如 `sleep 30`）。
   - 操作：运行后点击 Stop。
   - 预期：状态进入 cancelling，随后 cancelled；终端打印 Cancelled by user。

5. **会话断开中断**
   - 前置：宏运行中。
   - 操作：主动断开当前会话。
   - 预期：宏状态转 failed，终端打印 Session disconnected。

6. **required 默认值拦截**
   - 前置：参数 `required=true` 且 `defaultValue` 为空。
   - 操作：点击运行。
   - 预期：启动被阻止并提示缺少默认值。

7. **危险命令确认**
   - 前置：宏步骤包含危险命令匹配项。
   - 操作：点击运行并在确认框中取消/确认各执行一次。
   - 预期：取消时不启动；确认时正常启动。

8. **防重入**
   - 前置：宏 A 正在 running。
   - 操作：再次运行任意宏。
   - 预期：提示已有宏运行中，不启动第二个 run。

9. **最近使用与搜索**
   - 前置：依次运行多个宏。
   - 操作：打开面板，查看 recent 与搜索过滤。
   - 预期：recent 最多 3 条且按最近排序；搜索结果与标题/描述匹配。

10. **不跳转不新开 tab**
    - 前置：Terminal 页已有多个 tab。
    - 操作：运行宏并观察界面。
    - 预期：全程停留在 Terminal 页面，tab 数量不变。
