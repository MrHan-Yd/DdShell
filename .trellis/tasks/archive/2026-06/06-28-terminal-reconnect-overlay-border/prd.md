# 修复重连遮罩边框被裁切

## Goal

修复连接断开时“重新连接”遮罩卡片只显示上半部分边框、下半部分被裁切的问题。

## Confirmed Facts

- 最近为了文件管理覆盖安全区，把终端 panes 整体用 CSS transform 上移。
- 连接断开遮罩属于终端 pane 内部 overlay；跟随整个 panes 上移后，居中卡片可能被外层裁切。
- 安全区只应该影响 xterm 内容，不应该影响断开连接 overlay、确认弹层等 UI。

## Requirements

- 断开连接遮罩卡片完整显示，边框上下都可见。
- 文件管理覆盖时仍能避让终端底部内容。
- 不恢复 xterm resize，不触发远端 PTY resize。
- 不影响重新连接按钮功能。

## Acceptance Criteria

- 断开连接时重连卡片完整显示。
- 文件管理打开时终端内容仍避让底部面板。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改连接/重连后端逻辑。
- 不修改 SSH/SFTP 协议。

## Open Questions

无阻塞问题。用户已提供截图。
