# 彻底屏蔽文件管理开关远端 resize

## Goal

修复终端内文件管理抽屉关闭后仍追加 3 行 shell prompt 的问题。

## Confirmed Facts

- 文件管理打开/关闭会改变终端容器高度，触发 xterm `fit()` 和 `term.onResize`。
- 远端 bash/readline 收到 PTY `window_change` 后会重绘 prompt，prompt 被写入终端缓冲区。
- 之前已屏蔽过渡期间和一次 pending fit，但关闭后抽屉卸载、CSS 回弹等收尾布局变化仍可能触发额外 resize。
- 用户关心不能因此让手动拖拽文件管理高度产生明显延迟。

## Requirements

- 文件管理打开/关闭造成的 resize 必须作为本地 xterm 适配处理，不向远端 PTY 发送 `sessionResize`。
- 屏蔽窗口要覆盖打开/关闭动画、抽屉卸载和布局回弹的收尾阶段。
- 手动拖拽文件管理高度仍保持现有交互：拖动中本地变化，拖完后允许同步远端。
- 真实窗口 resize、分屏拖拽等用户明确改变终端面积的操作仍应同步远端。
- 不改变文件管理 SFTP 功能。

## Acceptance Criteria

- 打开文件管理不新增 shell prompt。
- 关闭文件管理不再新增 3 行或多行 shell prompt。
- 手动拖拽文件管理高度没有明显延迟，拖完后终端尺寸适配。
- 窗口 resize / 分屏 resize 不被误屏蔽。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改远端 shell 配置。
- 不修改 SFTP 后端协议。
- 不重构终端页整体布局。

## Open Questions

无阻塞问题。用户要求继续修复，并明确拖拽不能变迟钝。
