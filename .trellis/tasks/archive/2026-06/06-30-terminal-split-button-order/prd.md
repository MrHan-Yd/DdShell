# 终端分屏按钮顺序调整

## Goal

将终端页右上角两个分屏按钮的位置对调，让按钮排列顺序符合用户期望。

## Confirmed Facts

- 分屏按钮位于 `app/src/features/terminal/TerminalPage.tsx` 的终端 tabbar 右侧工具区。
- 当前两个按钮分别调用 `splitPane("horizontal")` 和 `splitPane("vertical")`。
- 当前图标已使用 `Rows2` 表示上下分屏，`Columns2` 表示左右分屏。

## Requirements

- 只对调两个分屏按钮在右上角工具区的显示顺序。
- 保持每个按钮原有功能、激活态、tooltip、`aria-label` 和快捷键说明对应不变。
- 不改历史记录按钮、关闭分屏按钮、分屏状态管理或终端布局逻辑。

## Acceptance Criteria

- 终端右上角先显示左右分屏按钮，再显示上下分屏按钮。
- 点击左右分屏按钮仍触发 `splitPane("vertical")`。
- 点击上下分屏按钮仍触发 `splitPane("horizontal")`。
- `pnpm --dir app build` 通过。

## Out Of Scope

- 不重设计终端工具栏样式。
- 不修改快捷键绑定。
- 不推送远端发布状态。

## Open Questions

- 无阻塞问题。
