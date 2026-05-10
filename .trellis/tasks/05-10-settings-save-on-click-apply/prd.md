# 设置项改为暂存编辑、点保存才生效

## Goal

把设置页所有设置项改造为「草稿模式」：用户的任何修改先停留在编辑态，**视觉也不立刻变**，必须点 **Save** 才同时应用到运行时（store / 视觉 / 终端 / 后端持久化）。未保存退出设置页需要明确二次确认是否放弃修改。

## Background / What I already know

* 当前 `app/src/features/settings/SettingsPage.tsx`（2013 行）混合了三种持久化时机：
  * **Mode 1（大多数项）**：onChange 立即更新 React state，**视觉立刻变**（主题/字体/语言通过 `setTheme/setUiTheme/setLocale` 直接写全局 store），但**仅在点 Save 时**通过 `api.settingSetMany`(line 738-786) 持久化到后端 → 重启会丢
  * **Mode 2（CommandAssist 一组）**：`enabled` / `confirmKey` / `position` / `enabledAppCategories` 在 `CommandAssistSettings` 子组件 (line 303-) 内每次 onChange **立即** `api.settingSet` 写后端 + 即时生效，完全绕过 Save 按钮
  * **Mode 3（PredictiveEcho 开关）**：`handleTogglePredictiveEcho` (line 847-859) 单独 `api.settingSet` 写后端 + 派发 `terminal:settings-changed` 事件让活跃终端立即响应；注释明确说"保持即时持久化所以正在跑的终端能马上反应"
* `handleSave` (line 738) 已存在，覆盖 30+ 个 key 的 `settingSetMany`
* `handleReset` (line 788-800) 已存在，重置 React state + 全局 store 到默认值
* 全局 store `app/src/stores/app.ts` 只持有 `theme / uiTheme / locale / currentPage / sidebarCollapsed` 5 个字段；其它设置项的"运行时副本"散落在 SettingsPage 局部 state + 后端 KV
* `setTheme/setUiTheme` 改 store 后 `App.tsx` 的 effect 立刻把 `data-ui-theme` 写到 `<html>` → 视觉即时变；这是当前"点了即生效"的视觉感来源

## User-Confirmed Decision

**方案 A — 草稿模式（严格版）**

* 主题 / 语言 / 字体 / 终端外观等点击后**视觉也不立刻变**
* 编辑态独立维护，Save 才一并 commit 到 store / 视觉 / 终端 / 后端
* 未保存退出设置页 → 提示放弃修改（confirm dialog）

## Assumptions (temporary)

* "Save" 是统一的最终生效入口，不允许某些项绕过（CommandAssist / PredictiveEcho 也要纳入草稿模式 —— 待用户确认）
* "退出设置页"包括：左侧 Sidebar 切到其它页 / 关闭主窗口 / 浏览器刷新（Tauri 下相当于 reload）
* Reset 按钮重置的是「编辑态到默认值」，并不会立即写后端；点 Save 后才把默认值持久化
* 当前所有 onChange 处理函数（包括子组件的）都会被改写到走草稿态

## Open Questions

* ~~Q1：CommandAssist + PredictiveEcho 是否纳入草稿模式？~~ → **决议：全纳入草稿，所有项必须点 Save 才生效。CommandAssistSettings 子组件需把 state 提到主 SettingsPage 与 draft 合流；PredictiveEcho 失去"开了立即对活跃终端生效"的便利（Save 成功后再 dispatch `terminal:settings-changed`）**
* ~~Q2：未保存切页时弹的确认框只两选项（放弃/继续编辑），还是三选项（放弃/继续编辑/保存并切走）？~~ → **决议：两选项 `[放弃修改] [继续编辑]`。用户想保存就自己取消并点 Save。沿用现有 confirm 组件无需扩展**
* ~~Q3：主题/UI 主题在编辑态怎么"预览"？~~ → **决议：完全无预览，仅在卡片上加选中态边框/勾。最严格的草稿语义；用户接受"挑选时看不到真实效果"的代价**
* ~~Q4：Save 中途失败时，编辑态是否保留（让用户可以重试），还是回滚？~~ → **决议：保留编辑态，toast 错误，用户可重试 Save**
  * **后端原子性已确认**：`app/src-tauri/src/core/store.rs:1086 set_settings` 使用 SQLite 事务 (`tx.begin → execute × N → tx.commit`)，失败自动 rollback → 不存在"部分持久化"脏状态

## Expansion Sweep (Diverge)

### 1. 未来演化

* 短期可能加：每个 tab 独立 dirty 标记（仅修改过的 tab 显示小圆点）—— 本次不做
* 中期可能加：草稿持久化到 localStorage（重启恢复未保存）—— 本次不做
* 不会加：云同步（已在 PRD M1 副标题里明确"本地设置"）

### 2. 相关场景与一致性

* **Save 按钮置灰**：仅 dirty=true 才可点（避免空保存与误操作）
* **保存中状态**：现有 `saveStatus` 已经支持 idle/saving/saved/error，复用即可
* **三类非设置项动作必须保留即时执行**（不进草稿）：
  * `handleClearAllHistory` (line 802) — 清空命令历史，命令式动作
  * `handleCheckUpdate` (line 820) — 检查更新，无副作用查询
  * `handleResetWeights` (line 406) — CommandAssist 权重重置，命令式动作
  * 外链按钮（GitHub repo / issues）—— 显然不进草稿
* **SettingsPage 内 tab 切换**（General / Data / Terminal 等）不应清除 dirty 也不应触发"放弃修改"提示，跨 tab 累积修改才是正常用法

### 3. 失败 / 边缘场景

* **拦截切页时机**（dirty=true）：
  * 点 Sidebar 其它页：拦截 ✅
  * 点应用顶栏关窗按钮：拦截 ✅（Tauri close 事件）
  * 系统级关窗（Cmd+Q 退出 App）：本次**不拦截**（成本高，且系统行为用户预期清楚）
  * 浏览器刷新 / Tauri reload：开发态会发生，生产态不会，本次**不拦截**
* **Reset 与 dirty**：点 Reset 直接重置编辑态到默认值，**不弹确认**（用户主动操作，意图明确；且 Reset 后可以再 Save 才生效，可逆）
* **dirty 比对**：terminal 字段是对象（含 `ansiColors` 子对象），需要深比较或在 reducer 中按字段拆细
* **打开设置页就有 dirty？** — 不应该：初始化 `lastSaved = draft = 服务端值`；只有用户改动后才产生差异

## MVP 边界确认

**纳入 MVP**：
* 草稿态 + dirty 比对
* Save 后一次性 commit（store / 视觉 / 终端 / 后端 / 派发 `terminal:settings-changed`）
* Save 按钮 dirty=false 时置灰
* Sidebar 切页拦截（dirty 时弹两选项 confirm）
* 顶栏关窗按钮拦截（dirty 时弹两选项 confirm）
* Reset 重置编辑态，不弹确认，不写后端
* 三类非设置项动作（清空历史 / 检查更新 / 重置权重）保留即时执行

**不在 MVP**：
* 系统级关窗 / 浏览器刷新拦截
* 草稿持久化（重启恢复）
* tab 级 dirty 圆点

## Requirements (evolving)

* 引入「设置编辑态」概念：所有 SettingsPage 内的字段统一收口到一个 draft 数据结构（首选 `useReducer` 集中管理，避免 30+ 个 useState 分散）
* `setTheme / setUiTheme / setLocale` 不再在 SettingsPage 的 onChange 直接调用，改为只在 `handleSave` 成功后 commit
* `handleSave` 在写后端成功后：① 同步 commit 全局 store（theme/uiTheme/locale）② 派发 `terminal:settings-changed`（如有终端相关字段变化）③ 把 draft 镜像到 lastSaved
* 引入 dirty 标记：`!isEqual(draft, lastSaved)`，深比较
* Save 按钮在 `dirty === false` 或 `saveStatus === "saving"` 时 disabled
* Sidebar 路由切换 + 顶栏关窗按钮在 dirty=true 时拦截，弹两选项 confirm（沿用现有 `confirm` 组件）
* Reset 直接重置 draft 到默认值，**不弹确认**，不写后端；再次 Save 才生效
* CommandAssist 子组件的 4 项 state 提到主 SettingsPage 与 draft 合流；`handleSave` 覆盖范围扩展到这 4 个 key
* PredictiveEcho 取消即时持久化，纳入 draft；Save 成功后才 dispatch `terminal:settings-changed`
* 三类非设置项动作（`handleClearAllHistory` / `handleCheckUpdate` / `handleResetWeights`）保留即时执行，不动

## Acceptance Criteria

* [ ] 改主题/UI 主题/语言/字体/终端字体等任一项后，UI 视觉**保持原样**（仅卡片选中态高亮）
* [ ] 改终端外观后活跃终端**不立即响应**；Save 成功后才响应
* [ ] 改 CommandAssist 任一项（enabled/confirmKey/position/categories）后**不立即生效**；Save 后才生效
* [ ] 改 PredictiveEcho 开关后**不立即生效**；Save 后才生效，并 dispatch `terminal:settings-changed`
* [ ] Save 按钮在 dirty=false 时置灰；saveStatus="saving" 时也置灰
* [ ] Save 成功后所有改动一次性同时落到：全局 store / 视觉 / 终端 / 后端
* [ ] Save 失败时编辑态保留，toast 错误，可重试
* [ ] dirty=true 时点 Sidebar 切到其它页 → 弹两选项 confirm `[放弃修改] [继续编辑]`；选放弃修改才切走
* [ ] dirty=true 时点顶栏关窗按钮 → 弹两选项 confirm；选放弃修改才关窗
* [ ] SettingsPage 内 tab 切换不弹 confirm，跨 tab 修改累积成同一份 dirty
* [ ] Reset 直接重置 draft 到默认值，**不弹确认**；Reset 后会让 dirty=true（与 lastSaved 不同），需再 Save 才落盘
* [ ] 三类命令式动作（清空历史 / 检查更新 / CommandAssist 权重重置）仍即时执行，不进草稿

## Definition of Done

* Lint / typecheck 通过
* 4 种主题 × 色调组合下手测：改动→视觉不变→Save→视觉变 流程稳定
* 切页拦截 / 关窗拦截 / Reset / Save 失败 路径手测覆盖
* CommandAssist + PredictiveEcho 改造后手测 Save 前后行为符合预期
* 不破坏 05-09-dual-theme-m1 已落地的主题切换机制

## Technical Approach

### Draft 数据结构

集中到一个 `useReducer`（或独立 `useSettingsDraft` hook）：

```ts
type SettingsDraft = {
  theme: "dark" | "light" | "system";
  uiTheme: "classic" | "aurora";
  locale: "zh" | "en";
  terminal: TerminalSettings;          // 现有大对象
  uiFontFamily: string;
  uiFontSize: number;
  confirmDanger: boolean;
  sessionTimeout: string;
  chunkSize: string; maxConcurrent: string; transferTimeout: string;
  retryCount: string; downloadPath: string; transferNotify: boolean;
  predictiveEchoEnabled: boolean;
  // CommandAssist 4 项
  commandAssist: {
    enabled: boolean;
    confirmKey: "tab" | "enter";
    position: string;
    enabledCategories: Record<string, boolean>;
  };
};
```

`lastSaved: SettingsDraft` 镜像最近一次 Save 成功后的快照；`dirty = !deepEqual(draft, lastSaved)`。

### Save 流程

```ts
async function handleSave() {
  setSaveStatus("saving");
  try {
    await api.settingSetMany([...拍平 draft...]);  // 后端事务原子写
    // 全部成功后才 commit:
    setTheme(draft.theme); setUiTheme(draft.uiTheme); setLocale(draft.locale);
    setLastSaved(structuredClone(draft));
    window.dispatchEvent(new CustomEvent("terminal:settings-changed"));
    setSaveStatus("saved");
  } catch {
    setSaveStatus("error");
    // 编辑态不动,允许用户重试
  }
}
```

### 切页 / 关窗拦截

* Sidebar 切页：在 Sidebar 组件 onClick 之前先检查 SettingsPage 是否 dirty —— 但 Sidebar 不感知 SettingsPage 内部状态。两种实现：
  * **A 方案**：把 dirty 提到 `useAppStore` 的 `settingsDirty: boolean`；SettingsPage 通过 `useEffect` 同步；Sidebar 拦截走 store
  * **B 方案**：用 React Router-like 的 navigation guard（当前没用 router，是手写 `setCurrentPage`），SettingsPage 内重写 `setCurrentPage` 包装层
  * → 选 **A 方案**，与现有 store 模式一致
* 关窗按钮：Titlebar 组件的 close 按钮已存在，检查 `useAppStore.settingsDirty` 决定是否拦截

### Reset 流程

```ts
function handleReset() {
  dispatch({ type: "RESET_TO_DEFAULTS" });
  // dirty 自动变 true（默认值与 lastSaved 不同时）
  // 不写后端、不动 store，需再点 Save
}
```

## Decision (ADR-lite)

**Context**: 当前设置页 onChange 即时生效造成两类问题 ——（1）大部分项视觉立即变但后端未持久化，重启丢；（2）小部分项即时持久化又破坏统一保存语义。用户希望统一为"草稿模式"。

**Decision**:
1. 全部设置项进 draft，仅 Save 才 commit 到 store / 视觉 / 终端 / 后端（**严格统一**，不留例外）
2. 主题选择**完全无预览**，仅卡片选中态
3. 切页/关窗拦截走全局 store 的 `settingsDirty` 字段
4. 后端 `set_settings` 已是 SQLite 事务原子，失败时编辑态保留可重试
5. 三类命令式动作（清空历史/检查更新/权重重置）保留即时执行
6. 不做草稿持久化、tab 级 dirty、系统级关窗拦截（YAGNI）

**Consequences**:
* 优点：保存语义统一可预期；用户改错可一键 Reset；批量 Save 减少 IO
* 缺点：主题/语言挑选时看不到真实预览，挑选成本上升；CommandAssist + PredictiveEcho 失去即时生效便利
* 风险：30+ 字段拍平到 reducer 改动较大，要避免回归 5-09 已迁移的主题切换

## Out of Scope

* 不引入"未保存"红点 / Tab 标记动画等额外视觉提示（仅退出时确认即可）
* 不做"自动保存"或"草稿持久化（重启恢复未保存）"
* 不重做主题切换器 UI 本身
* 不改后端 `setting set/setMany` 的 API 形态

## Technical Notes

* 关键文件：
  * `app/src/features/settings/SettingsPage.tsx` (line 557+ 主组件 / line 303+ CommandAssistSettings 子组件 / line 738 handleSave / line 788 handleReset / line 847 handleTogglePredictiveEcho)
  * `app/src/stores/app.ts` (theme/uiTheme/locale)
  * `app/src/App.tsx` (line 128-130 主题挂载 effect — 受 store 驱动)
* 可能新增：`app/src/features/settings/useSettingsDraft.ts`（草稿 reducer/hook）
* 现有 confirm 组件位置：之前 journal Session 4 提到 `ConfirmDialog`（toast/confirm 浮层）—— 复用即可
