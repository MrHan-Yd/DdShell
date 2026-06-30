# 终端工具栏图标调整

## Goal

优化终端页顶部右侧工具按钮的视觉表达：分屏按钮使用更直观的左右/上下分屏图标，历史记录入口去掉文字，仅保留图标按钮。

## Confirmed Facts

- 终端页工具按钮位于 `app/src/features/terminal/TerminalPage.tsx`。
- 当前分屏按钮使用 `SplitSquareHorizontal` 和 `SplitSquareVertical`。
- 当前历史入口按钮使用 `History` 图标加 `t("term.history")` 文本。
- 项目已使用 `lucide-react`，并且可用 `Columns2`、`Rows2`、`History` 等图标。

## Requirements

- 将终端右侧工具栏的左右/上下分屏入口改为更接近截图中两个按钮的分屏图标。
- 历史记录入口去掉可见文字“历史记录”，只保留图标。
- 历史入口仍需保留 hover tooltip / `aria-label`，用户能通过悬停或辅助技术识别功能。
- 不改变分屏逻辑、关闭分屏逻辑、历史抽屉内容、快捷键和数据行为。
- 按钮尺寸和布局应保持稳定，不因去掉文字导致工具栏跳动或显得不一致。

## Acceptance Criteria

- 终端页右侧分屏按钮显示为左右分屏和上下分屏两个图标。
- 历史入口只显示图标，不显示“历史记录”文字。
- 历史入口点击后仍能打开/关闭命令历史抽屉。
- `pnpm --dir app build` 通过。

## Out Of Scope

- 不重设计终端历史抽屉内部标题和列表。
- 不改快捷键文案、i18n 字典或设置页快捷键说明。
- 不改终端分屏状态管理。

## Open Questions

- 无阻塞问题。建议使用 `Columns2` 表示左右分屏、`Rows2` 表示上下分屏，历史入口继续使用 `History` 图标。
