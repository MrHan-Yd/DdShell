# PRD: 移动弹窗文件夹图标左距

## Goal

调整终端文件管理“移动到...”目录选择弹窗中目录列表行的左侧间距，让文件夹图标不要贴近左边。

## User Value

- 目录选择弹窗的列表视觉更舒适。
- 文件夹图标与弹窗内其他输入区域的左侧节奏更一致。

## Confirmed Facts From Code

- 移动目录弹窗实现位于 `app/src/features/terminal/RemoteDirectoryPicker.tsx`。
- 目录列表按钮当前使用 `pl-5 pr-4`，文件夹图标位于该按钮最左侧内容起点。
- 上方搜索输入区域的搜索图标视觉起点约为弹窗左侧 28px。

## Requirements

- 增加移动目录弹窗目录列表行的左侧内边距。
- 只调整目录列表行视觉间距，不改变搜索、加载、目录进入、确认移动逻辑。
- Classic 和 Aurora 下保持一致。

## Acceptance Criteria

- 打开“移动到...”弹窗时，文件夹图标相对弹窗左边缘有更明显的留白。
- 目录名称仍然正常截断显示。
- 前端构建通过。

## Out Of Scope

- 调整弹窗其他区域布局。
- 调整文件管理抽屉或 SFTP 页面列表。

## Open Questions

- None.
