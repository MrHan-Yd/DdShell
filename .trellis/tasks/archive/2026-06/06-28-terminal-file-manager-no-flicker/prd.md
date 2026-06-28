# 优化文件管理调整时终端闪烁

## Goal

修复终端文件管理打开、关闭、拖拽高度时，终端当前命令行闪一下的视觉问题。

## Confirmed Facts

- 远端 prompt 重复问题已经通过屏蔽文件管理导致的远端 PTY resize 修复。
- 当前剩余问题是本地 xterm `fit()`/重排造成的视觉闪烁，不是远端输出新内容。
- 文件管理抽屉目前参与 `term-main` 布局，会改变终端容器高度；终端容器高度变化会触发 xterm 重新计算行列并重绘当前命令行。
- 若文件管理作为覆盖层浮在终端底部，不挤压终端容器高度，则打开/关闭/拖拽不会触发终端本地重排。

## Requirements

- 文件管理打开/关闭时，终端命令行不应闪烁。
- 拖拽文件管理高度时，终端命令行不应随拖拽重排闪烁。
- 文件管理仍应能浏览目录、上传、刷新、关闭和拖拽高度。
- 真实窗口 resize、分屏 resize 仍应保持终端适配和远端同步。
- 不改变远端 SSH/SFTP 协议逻辑。

## Acceptance Criteria

- 打开文件管理时，终端当前命令行不出现明显闪烁。
- 关闭文件管理时，终端当前命令行不出现明显闪烁。
- 拖拽文件管理高度时，终端当前命令行不随高度变化闪烁。
- 文件管理面板显示在终端页底部，拖拽高度和关闭按钮正常。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改远端 shell 配置。
- 不修改 SFTP 后端协议。
- 不重构终端页整体导航。

## Open Questions

无阻塞问题。用户已确认可以优化该闪烁问题。
