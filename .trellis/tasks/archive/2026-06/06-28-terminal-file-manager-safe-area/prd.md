# 文件管理覆盖时保留终端底部可见区

## Goal

在文件管理以覆盖层显示时，避免遮住终端底部当前命令行，同时不恢复会导致闪烁和 prompt 重绘的 xterm resize 行为。

## Confirmed Facts

- 文件管理改为覆盖层后，不再挤压 xterm 容器，解决了本地重排闪烁。
- 覆盖层的代价是会遮住终端底部内容。
- 用户希望避免遮挡，同时保持不闪、不刷 prompt。
- 不能通过 xterm `fit()` / 远端 `sessionResize` 解决，否则会回到之前的问题。

## Requirements

- 文件管理打开时，终端底部当前命令行应避开文件管理面板。
- 文件管理关闭时，终端显示应恢复正常位置。
- 拖拽文件管理高度时，避让区域应跟随高度变化。
- 不改变 xterm rows/cols，不触发远端 PTY resize。
- 保留文件管理打开、关闭、拖拽、SFTP 操作。
- 保留窗口 resize、分屏 resize 的正常终端适配。

## Acceptance Criteria

- 文件管理打开后，当前命令行不被面板遮住。
- 拖拽文件管理高度时，命令行可见区跟随面板变化。
- 打开/关闭/拖拽不新增 prompt，不出现明显命令行闪烁。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改远端 shell 配置。
- 不修改 SFTP 后端协议。
- 不重构终端底层渲染库。

## Open Questions

无阻塞问题。用户已确认实现该方案查看效果。
