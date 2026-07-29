# 修复非活动终端 pane 隐藏失效导致的假分屏

## 目标

修复连接两个及以上终端时，所有终端 pane 同时显示、视觉上等同于「自动分屏」且无法关闭的问题。分屏与否必须完全由用户点击分屏按钮或快捷键决定。

## 已确认事实

- 分屏状态由 `app/src/stores/terminal.ts` 的 `splitDirection` 控制，初始值为 `null`（`stores/terminal.ts:31`）。
- 唯一能写入 `splitDirection` 的方法是 `splitPane()`（`stores/terminal.ts:152`），入口只有工具栏分屏按钮与快捷键（`hooks/useShortcuts.ts:103` / `:112`）。`openSession()` 不触碰任何分屏状态。
- 结论：代码层面**不存在自动分屏逻辑**，用户看到的分屏是渲染层的视觉假象。
- 真实根因是 CSS 优先级冲突：
  - `TerminalPage.tsx:3224` 依赖 Tailwind 工具类 `hidden` 隐藏非活动 pane。
  - Tailwind v4 将 `.hidden{display:none}` 编译进 `@layer utilities`（已在 `dist/assets/index-*.css` 中验证）。
  - 15 套主题 CSS 经 `main.tsx` 直接 import，**不属于任何 CSS layer**（已用脚本对构建产物做括号平衡验证，layer 栈为空）。
  - 按 CSS Cascade Layers 规范，无层样式优先级高于所有分层样式，故 `[data-ui-theme=*] .term-pane{display:flex}` 覆盖了 `display:none`。
- 隐藏失效后，`.term-panes:not(.is-split) .term-pane{flex:1}` 使所有 pane 均分空间，产生与分屏一致的外观。
- 「关不掉」的原因：关闭分屏按钮调用 `closeSplit()` 仅把 `splitDirection` 置为 `null`，而该值本就是 `null`，操作无实际效果。
- `TerminalInstance` 的 `ResizeObserver` 已对 `width/height === 0` 的隐藏态做跳过处理（`TerminalPage.tsx:1030`），说明原设计本就预期 pane 会被隐藏；pane 恢复显示时 ResizeObserver 会自动重新 `fit()`。

## 需求

- 非活动 pane 必须真实隐藏，不受任何主题 CSS 影响。
- 修复须在渲染层一次性解决，覆盖全部 15 套主题，不逐个修改主题 CSS 文件。
- 采用内联 `display: none`（内联样式不参与 layer 级联，优先级高于无层样式），改动集中在 `getTerminalPaneStyle()`（`TerminalPage.tsx:102`）。
- 保留 `hidden` 类名或一并清理，不得与内联样式产生冲突。

## 验收标准

- 连续连接 2 个及以上终端，默认只显示当前活动终端，不出现分屏。
- 点击分屏按钮或快捷键后正常进入分屏，两个 pane 按 `splitRatio` 显示。
- 分屏状态下点击关闭分屏，可正确回到单终端视图。
- 切换标签页时，目标终端正确显示且内容尺寸自适应（xterm 正常 `fit`，无错行或残留字符）。
- 15 套主题下行为一致。
- 前端构建与 lint / type-check 通过，`git diff --check` 无格式错误。

## 不在范围内

- 不改动分屏交互设计（按钮位置、快捷键、拆分方向选择流程）。
- 不重构主题 CSS 的 layer 归属（治标即可，全面 layer 化风险过大且超出本次范围）。
- 不修改 `splitPane` / `closeSplit` 的状态机逻辑。
- 不改版本号或发布流程。

## 追加范围：SFTP 传输状态卡在「1 个传输中」

同一会话中发现并修复的第二个缺陷，已随本任务一并交付。

### 已确认事实

- 现象：终端内置文件管理器批量传输全部结束后，摘要栏长期显示「1 个传输中」，需重开抽屉才恢复。
- 后端 `app/src-tauri/src/core/sftp.rs:1050` 在 `update_task_state(Completed)` **之前**发送最后一次 100% 进度事件。
- 前端 `updateTransferProgress`（`app/src/stores/sftp.ts`）无条件将任务状态写为 `running`，晚到的进度事件会把已完成任务复活。
- `features/sftp/SftpPage.tsx:2018` 存在 500ms 轮询兜底，可自愈该竞态；而 `TerminalFileManagerDrawer.tsx` **完全没有轮询**，仅依赖事件，故问题只在终端抽屉暴露。

### 修复

- `stores/sftp.ts`：任务处于 `completed` / `failed` / `canceled` 终态时，进度事件不再回写状态。
- `TerminalFileManagerDrawer.tsx`：补上与 SFTP 页一致的 500ms 轮询兜底，事件丢失时状态可自愈。

### 验收标准

- 批量传输结束后摘要栏立即归位，不残留「1 个传输中」。
- 传输过程中进度与速率仍实时更新。
- 失败与取消的任务状态不被进度事件覆盖。
- 轮询仅在存在进行中任务时运行，传输结束后自动停止。

