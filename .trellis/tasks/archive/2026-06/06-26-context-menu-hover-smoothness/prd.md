# PRD: 右键菜单 hover 流畅优化

## Goal

优化应用通用右键菜单中菜单项 hover 切换的流畅度，减少选择高亮在不同菜单项之间移动时的卡顿感。

## User Value

- 右键菜单打开后，鼠标在菜单项之间移动时高亮响应更跟手。
- 菜单 hover 反馈保持稳定、轻量，不出现拖慢或滞后的感觉。
- Connections、SFTP、终端文件管理、Snippets、Workflows 等使用通用 `ContextMenu` 的位置统一受益。

## Confirmed Facts From Code

- 通用右键菜单实现位于 `app/src/components/ui/ContextMenu.tsx`。
- 通用右键菜单样式位于 `app/src/styles.css` 的 `.context-menu-*` 规则。
- 当前 hover 高亮通过 `updateHighlight()` 在 `mouseenter` 时读取 `el.offsetTop` 和 `el.offsetHeight`，然后直接写入高亮块的 `transform` 和 `height`。
- 当前 `.context-menu-highlight` 同时 transition `transform` 和 `height`，其中 `height` 会触发布局/重绘成本。
- 菜单项还带有 `.animate-menu-item` 阶梯入场动画，每个 item 延迟 `30ms`，刚打开菜单就移动鼠标时可能与 hover 高亮竞争，造成拖沓感。
- QuickEditor 里有单独的 `quick-editor-context-menu`，本任务优先处理通用 `ContextMenu`。

## Requirements

- 右键菜单 hover 切换应更跟手，减少高亮移动滞后。
- 避免在 hover 切换路径中做不必要的布局动画。
- 不改变菜单项点击、禁用、danger、分隔线、关闭逻辑。
- 不改变右键菜单打开/关闭位置计算。
- Classic 和 Aurora 下保持一致。

## Acceptance Criteria

- 在通用右键菜单中快速移动鼠标时，高亮切换明显更轻、更顺滑。
- 菜单打开动画仍存在，但不应妨碍 hover 切换。
- 禁用项仍不可点击，danger 项文字/icon 颜色不变。
- 前端构建通过。

## Out Of Scope

- 重做菜单视觉设计。
- 修改 QuickEditor 自定义右键菜单。
- 增加键盘导航或子菜单。

## Open Questions

- None.
