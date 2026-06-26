# PRD: 新建文件夹创建按钮样式

## Goal

优化新建文件夹 inline 表单交互，移除显得突兀的“创建”按钮，改为输入完成后按 Enter 或点击表单外部自动确认创建。

## User Value

- 新建文件夹表单更轻量，减少紧凑工具栏内的突兀按钮。
- 用户输入后可以直接回车或点外面完成创建，操作更顺手。
- 创建文件夹交互保持原有键盘和点击行为。

## Confirmed Facts From Code

- 终端文件管理的新建文件夹表单位于 `app/src/features/terminal/TerminalFileManagerDrawer.tsx`。
- SFTP 页面的新建文件夹表单位于 `app/src/features/sftp/SftpPage.tsx`。
- 两处创建按钮当前都使用 `Button size="sm"`，默认 variant 是 primary/default。
- 两处关闭按钮使用 `Button size="sm" variant="ghost"`，只显示 `X` 图标。
- 两个页面都从 `@/components/ui/Button` 导入未主题化的 Button，而不是 `@/components/ui/themed/Button`。
- Aurora 样式中存在 `[data-ui-theme="aurora"] button` reset，会覆盖普通 Tailwind utility 的 `padding`、`background`、`border` 等低 specificity 声明。
- 终端文件管理 inline editor 高度为 `38px`，创建按钮是一个很小的 primary 渐变按钮，可能在输入框旁边显得不协调。
- 用户建议改为“输入完点外面或者回车充当确定”。

## Requirements

- 移除新建文件夹 inline 表单中的文字“创建”按钮。
- 输入框按 Enter 且内容非空时创建文件夹。
- 输入框失焦且内容非空时创建文件夹。
- 输入框内容为空时失焦应关闭/取消表单，不创建文件夹。
- 按 Escape 应取消表单，不创建文件夹。
- 点击 X 关闭按钮应取消表单，不触发输入框 blur 自动创建。
- 终端文件管理和 SFTP 页面的新建文件夹表单应保持一致。
- 不改变 mkdir 逻辑、Enter 创建、Escape 取消、关闭按钮行为。

## Acceptance Criteria

- 打开新建文件夹表单时，不再显示文字“创建”按钮。
- 输入文件夹名后按 Enter 会创建文件夹并关闭表单。
- 输入文件夹名后点击表单外部会创建文件夹并关闭表单。
- 输入文件夹名后点击 X 或按 Escape 会取消，不创建文件夹。
- 空输入失焦或按 Enter 不创建文件夹。
- 前端构建通过。

## Out Of Scope

- 调整新建文件夹入口图标按钮。
- 调整 mkdir 后端/API 行为。
- 重做整个 SFTP 或终端文件管理工具栏布局。

## Open Questions

- None.
