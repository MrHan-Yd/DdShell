# PRD: 右键菜单 hover 过渡微调

## Goal

在保持右键菜单 hover 高亮跟手的前提下，给通用右键菜单高亮移动增加更可感知但不拖沓的过渡动画。

## User Value

- hover 高亮在菜单项之间移动时有轻微丝滑感。
- 不回到之前那种切换卡顿或滞后的状态。
- 使用通用 `ContextMenu` 的页面统一生效。

## Confirmed Facts From Code

- 通用右键菜单高亮样式位于 `app/src/styles.css` 的 `.context-menu-highlight`。
- 当前高亮只动画 `transform` 和 `opacity`，避免动画 `height/top`。
- 当前 `transform` 过渡是 `45ms linear`，偏向即时反馈，动画感较弱。
- 组件规范中 `.menu-highlight` 示例也记录了 `transform 45ms linear`。
- 用户希望尝试增加一点过渡动画。

## Requirements

- 将右键菜单 hover 高亮移动过渡调到约 `70ms`。
- 使用 ease-out 类型曲线，让高亮有轻微滑动感但不会拖。
- 继续只动画 `transform` 和 `opacity`，不动画 `height/top/left`。
- 同步更新组件规范里的示例值。
- 不改变菜单打开/关闭、点击、禁用项、danger 项、分隔线逻辑。

## Acceptance Criteria

- 快速划过右键菜单项时，高亮移动比 `45ms linear` 更有过渡感。
- hover 仍然跟手，不出现明显追不上鼠标的拖尾。
- 前端构建通过。

## Out Of Scope

- 重做菜单视觉设计。
- 修改 QuickEditor 自定义右键菜单。
- 修改菜单项入场/关闭动画。

## Open Questions

- None.
