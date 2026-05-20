---
title: fix segmented-control slide animation lost
status: planning
owner: han
priority: P2
created: 2026-05-20
---

# fix: SegmentedControl 滑动动画丢失（Aurora 主题）

## Goal

snippets 第二栏排序 SegmentedControl 在 Aurora 主题下切换 tab 时无平滑动画。
根因是 `AuroraSegmentedControl` 没有滑块结构，active 切换依赖
`background: var(--accent-gradient)` —— gradient 在 CSS 中不可 transition，
所以视觉上是瞬切。修复方向：给 Aurora 实现加 `.seg-pill` 滑块，让选中态在
tab 之间平滑滑动（macOS 风格），与 Classic 主题行为一致。

## What I already know

- 触发：commit `7fa17a6` 把 snippets 手写 seg-control 替换为
  `themed/SegmentedControl` 分发器。
- 分发关系：`uiTheme==='aurora'` → `AuroraSegmentedControl`，否则 →
  `ClassicSegmentedControl`。
- Classic 实现（`app/src/components/ui/SegmentedControl.tsx`）已带滑块：
  useRef + useEffect 计算 active button 的 `offsetLeft/offsetWidth`，CSS
  在 `styles.css:772-782` 用 `transition: left/width ease-spring` 实现滑动。
- Aurora 实现（`app/src/components/ui/aurora/SegmentedControl.tsx`）DOM 结构：
  `<div.seg-control><button.seg.is-active>`，**没有 .seg-pill 元素**。
- Aurora 样式（`app/src/styles/aurora/pages/settings.css:342-367`）：
  - `.seg.is-active` 用 `background: var(--accent-gradient)` 直接着色
  - 仅声明 `transition: background var(--d-fast), color var(--d-fast)`
  - gradient 不可 transition → 看起来瞬切
- 影响面：所有 aurora 主题下的 SegmentedControl
  - settings 页 11 处使用
  - snippets 页 1 处使用
- 当前主题：han 使用 `aurora`（用户确认）

## Decision (ADR-lite)

**Context**：Aurora 的 SegmentedControl 没有滑块结构，切换无平滑动画。

**Decision**：给 `AuroraSegmentedControl` 加 `.seg-pill` 滑块结构（与 Classic
对齐的机制：useRef + useEffect 计算位置），保持 aurora 设计语言（accent-gradient
+ accent-glow）；active 态从 background 转移到 pill 上，button 仅改文字颜色。

**Consequences**：
- 所有 aurora 主题下的 SegmentedControl（settings 11 + snippets 1）都会变成
  滑块滑动效果，视觉更一致。
- Classic / Aurora 两个组件实现接近但 DOM 类名不同（保留分发器分发，因为
  CSS 系统按主题分文件）。
- 不引入新依赖、不改 SegmentedControl 的 React API。

## Requirements

- Aurora 主题下 SegmentedControl 渲染时存在一个 `.seg-pill` 滑块覆盖在当前
  active tab 上。
- 点击切换 tab 时，pill 平滑滑动到目标 tab 的位置（left/width transition）。
- pill 视觉与现有 active 态一致：`background: var(--accent-gradient)` +
  `box-shadow: 0 0 10px var(--accent-glow)`。
- button 在 active 时只改字色（`color: var(--fg-on-accent)`），不再设置
  background。
- 过渡曲线复用 Aurora 已有 design token（`--d-fast` 或 motion 相关 token）。

## Acceptance Criteria

- [ ] Aurora 主题下 snippets 第二栏排序 SegmentedControl 切换有滑块滑动动画
- [ ] Aurora 主题下 settings 页所有 SegmentedControl 也获得相同滑块动画，无
      回归（视觉、点击、键盘焦点）
- [ ] Classic 主题下 SegmentedControl 行为不变
- [ ] 切换 tab 时无明显跳变（初次挂载 pill 位置正确）
- [ ] lint + typecheck 通过

## Definition of Done

- 在 Classic 与 Aurora 两个主题下手测 snippets + settings 页面
- 改动最小化：仅触及 `aurora/SegmentedControl.tsx` +
  `styles/aurora/pages/settings.css` 的 seg-control 段
- 不顺手重构 themed 分发器、不动 Classic 实现

## Out of Scope

- 窗口 resize 时滑块定位实时更新（Classic 实现也无此能力，已有问题）
- 异步 options 加载时的 pill 跳变处理
- 把 Classic 与 Aurora 合并成单一实现
- 移除 `themed/SegmentedControl` 分发器

## Technical Approach

**TSX 改动**（`app/src/components/ui/aurora/SegmentedControl.tsx`）：

参照 Classic 实现的思路：
- 引入 `useRef<HTMLDivElement>` + `useState<{left, width}>`
- `useEffect([value, options])` 内查询 active button DOM 计算位置
- 在 buttons 之前渲染 `<div class="seg-pill" style={{ left, width }} />`
- 保留现有 `.seg-control` / `.seg` / `.is-active` 类名（CSS 兼容）

**CSS 改动**（`app/src/styles/aurora/pages/settings.css:342-367`）：

- `.seg-control` 加 `position: relative`
- 新增 `.seg-pill` 规则：
  - `position: absolute; top: 2px; bottom: 2px;`
  - `background: var(--accent-gradient); box-shadow: 0 0 10px var(--accent-glow);`
  - `border-radius: var(--radius-sm);`
  - `transition: left var(--d-base) var(--ease-spring), width var(--d-base) var(--ease-spring);`
    （token 名以 aurora 实际定义为准，必要时复用 Classic 的 `--duration-toggle / --ease-spring`）
- `.seg` 加 `position: relative; z-index: 1`
- `.seg.is-active` 删除 `background` 行，保留 `color` 与 `font-weight`

## Technical Notes

- 关键文件
  - `app/src/features/snippets/SnippetsPage.tsx:917` — 使用点（不需要改）
  - `app/src/components/ui/themed/SegmentedControl.tsx` — 分发器（不需要改）
  - `app/src/components/ui/aurora/SegmentedControl.tsx` — **改 DOM 结构**
  - `app/src/styles/aurora/pages/settings.css:342-367` — **改样式**
- 参考实现
  - `app/src/components/ui/SegmentedControl.tsx` — Classic 滑块逻辑
  - `app/src/styles.css:760-804` — Classic 滑块样式
- 相关提交
  - `7fa17a6` refactor(snippets): replace hand-written seg-control with SegmentedControl component
