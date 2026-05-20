# Snippets Context Menu Style Alignment

## Goal

Snippets 页面右键菜单（ContextMenu）的视觉风格与整体 UI 设计不搭，需要优化使其与设计稿的 popover/floating-panel 视觉语言一致。

## What I already know

**设计稿参考**（`ui/styles/components.css` `.popover` + `ui/styles/tokens.css`）:
- `.popover`: `background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); overflow: hidden; min-width: 240px;`
- `--shadow-popover` (dark): `0 4px 8px rgba(0, 0, 0, 0.28), 0 16px 40px rgba(0, 0, 0, 0.44)`
- `--shadow-popover` (light): `0 4px 12px rgba(20, 21, 27, 0.10), 0 24px 48px rgba(20, 21, 27, 0.12)`
- `--radius-lg` = 12px
- `--bg-surface` = `#21222C` (dark) / 卡片/下拉/popover 通用背景

**当前实现**（`app/src/components/ui/ContextMenu.tsx` L113）:
- 容器: `bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg`
- 问题:
  1. `bg-[var(--color-bg-elevated)]` — 用 elevated 而非 surface，比设计稿更暗
  2. `shadow-lg` — Tailwind 内置 shadow，没有设计稿 `--shadow-popover` 那种大范围柔和深影
  3. `rounded-lg` — Tailwind 的 lg=8px，设计稿 `--radius-lg`=12px
  4. `min-w-[180px]` — 偏窄，设计稿 popover `min-width: 240px`
  5. 高亮条: `bg-[var(--color-bg-hover)]` — 平色块，设计稿更柔和
  6. 分割线: `border-t border-[var(--color-border)]` — 可用但间距可能不够
  7. 无 backdrop-blur — 设计稿 popover 有隐含的 glass 感

## Requirements

### 1. ContextMenu 容器样式对齐 popover

**当前**: `bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg min-w-[180px]`
**目标**: 
- `background: var(--color-bg-surface)` — 和设计稿 popover 一致
- `border: 1px solid var(--color-border)` — 保持
- `border-radius: 12px` — 对齐设计稿 `--radius-lg`（用固定值，项目无 `--radius-lg` token）
- `box-shadow: 0 4px 8px rgba(0, 0, 0, 0.28), 0 16px 40px rgba(0, 0, 0, 0.44)` — 设计稿 `--shadow-popover` dark
- light theme: `box-shadow: 0 4px 12px rgba(20, 21, 27, 0.10), 0 24px 48px rgba(20, 21, 27, 0.12)`
- `min-width: 200px` — snippet 菜单项较短，240px 太宽，200px 适中
- `backdrop-filter: blur(12px)` — 轻微 glass 效果

**修改方式**: 将 inline Tailwind 类替换为专用 CSS 类 `.context-menu`，在 `styles.css` 中定义完整样式。

### 2. ContextMenu 高亮条优化

**当前**: `bg-[var(--color-bg-hover)] rounded`
**目标**:
- `background: var(--color-accent-subtle)` — accent 色调，和整体 UI 一致
- `border-radius: var(--radius-control)` — 和其他 hover 态一致

### 3. ContextMenu 分割线优化

**当前**: `my-1 border-t border-[var(--color-border)]`
**目标**: 保持，但确认间距 `my-1`(4px) 是否足够。设计稿 popover 一般用 `8px` 分隔 → 改为 `my-2`

### 4. ContextMenu item 样式微调

**当前**: `px-3 py-1.5 text-[var(--font-size-sm)]`
**目标**:
- `padding: 6px 12px` — py-1.5=6px 对齐，px-3=12px 对齐
- `border-radius: var(--radius-control)` — item hover 区域圆角，更柔和

### 5. Light theme 适配

添加 `[data-theme="light"] .context-menu` 样式覆盖：
- `box-shadow` 使用 light 版 `--shadow-popover`
- `background` 保持 `var(--color-bg-surface)` (token 自带 light 值)

### 6. 间距更宽松

**当前**: 容器 `padding: 4px 0`，item `padding: 6px 12px`
**目标**:
- 容器 `padding: 6px 0` — 上下各 6px
- item `padding: 8px 12px` — 上下 8px，更宽松
- item `gap: 10px` — icon 和文字间距从 8px 增到 10px

### 7. 边框改为 accent 渐变描边

**当前**: `border: 1px solid var(--color-border)`
**目标**: 用和 cmd-block 一致的 card-glow 渐变描边模式：
- 移除 `border`
- 改用 `padding: 1px; background-image: var(--accent-gradient-soft, linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.18)))`
- 内部内容包裹层用 `background: var(--color-bg-surface); border-radius: 11px`
- 即：外层 1px 渐变 padding + 内层深色填充，视觉上形成渐变描边

**实现方式**: 在 ContextMenu.tsx 中给容器 div 内部加一个 `.context-menu-inner` 包裹层，CSS 如下：
```css
.context-menu {
  padding: 1px;
  background: var(--accent-gradient-soft, linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.18)));
  border-radius: 12px;
  box-shadow: ...;
  backdrop-filter: blur(12px);
  overflow: hidden;
}
.context-menu-inner {
  background: var(--color-bg-surface);
  border-radius: 11px;
  padding: 6px 0;
}
```

## Acceptance Criteria

* [ ] ContextMenu 容器用 `.context-menu` 专用类，bg-surface + 12px radius + popover shadow
* [ ] 高亮条用 accent-subtle 背景
* [ ] 分割线间距 8px
* [ ] item 有 hover 圆角
* [ ] light theme shadow 适配
* [ ] 容器和 item 间距更宽松（容器 6px，item 8px）
* [ ] 边框改为 accent 渐变描边（card-glow 模式）
* [ ] 现有功能零回归（定位、边界检测、动画、交互逻辑不变）
* [ ] lint / typecheck 通过

## Definition of Done

* lint / typecheck 通过
* 手动视觉验证右键菜单风格与整体 UI 协调

## Out of Scope

* ContextMenu 定位/边界检测逻辑变更
* ContextMenu 动画变更（保留现有 animate-context-menu/exit）
* MoveToGroupModal 样式（已有独立样式）
* 其他页面的 ContextMenu 使用场景（只改通用组件 + snippet 专用样式）

## Technical Notes

* 设计稿源：`ui/styles/components.css` (`.popover`)、`ui/styles/tokens.css` (`--shadow-popover`, `--radius-lg`, `--bg-surface`)
* 当前组件：`app/src/components/ui/ContextMenu.tsx`（通用组件，被 snippets 和其他页面使用）
* 当前样式：`app/src/styles.css` L2288-2320 (动画)、L2469-2471 (.context-menu-item)
* 项目 Token：`--color-bg-surface`、`--color-bg-hover`、`--color-accent-subtle`、`--color-border`、`--radius-control: 10px`、`--font-size-sm: 13px`
* 注意：ContextMenu 是通用组件，样式改动需确保不影响其他使用场景（如 workflow 页面）
