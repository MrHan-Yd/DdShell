# PRD: 移动到弹窗搜索图标居中

## Goal

修复终端文件管理抽屉中“移动到...”目录选择弹窗的布局问题：搜索输入框图标垂直居中，小窗口下关键操作可见，目录列表左侧留出合理间距。

## User Value

- 用户打开移动目标目录弹窗时，搜索输入框视觉对齐正常，不出现图标下沉。
- 该弹窗和已有远程文件选择弹窗的搜索框布局保持一致。
- 用户在较小窗口中仍能看到左上角返回按钮和右下角“移动到这里”按钮。
- 目录列表行与弹窗左边缘保持适当距离，视觉更舒适。

## Confirmed Facts From Code

- 移动目标目录弹窗实现位于 `app/src/features/terminal/RemoteDirectoryPicker.tsx`。
- 该弹窗搜索区域当前使用外层 `div.relative.px-4.pb-2` 作为放大镜绝对定位容器。
- 放大镜使用 `top-1/2 -translate-y-1/2`，但定位容器包含底部 padding，导致相对外层高度居中而不是相对 32px 输入框居中。
- `app/src/features/terminal/RemoteFilePicker.tsx` 已有正确模式：外层负责间距，内层 `div.relative` 包住图标和输入框。
- 移动弹窗从 `TerminalFileManagerDrawer` 内渲染，而文件抽屉 shell 使用 `transform` 和 `overflow: hidden`；嵌套的 `position: fixed` 容易受祖先 containing block / clipping 影响。

## Requirements

- 搜索放大镜必须在“移动到...”弹窗搜索输入框内垂直居中。
- 弹窗必须在小窗口下保持在 viewport 内，返回按钮和确认移动按钮不能被裁掉。
- 弹窗应脱离文件抽屉的 transform/overflow 裁剪上下文。
- 目录列表条目需要增加左侧留白，不能贴近左边缘。
- 保持输入框尺寸、边框、placeholder、搜索行为不变。
- 不影响目录加载、搜索过滤、路径编辑、确认移动等功能。
- 尽量复用 `RemoteFilePicker` 的搜索输入布局模式。

## Acceptance Criteria

- 打开终端文件管理抽屉，选择条目后点击“移动到...”，弹窗搜索框内放大镜相对输入框垂直居中。
- 将窗口高度缩小后，弹窗左上返回按钮和右下确认移动按钮仍可见。
- 目录列表中的文件夹行左侧有明确内边距，不贴边。
- Classic 和 Aurora 主题下位置一致。
- 前端构建通过。

## Out Of Scope

- 调整弹窗整体视觉设计。
- 修改搜索过滤逻辑。
- 修改移动文件/目录流程。

## Open Questions

- None.
