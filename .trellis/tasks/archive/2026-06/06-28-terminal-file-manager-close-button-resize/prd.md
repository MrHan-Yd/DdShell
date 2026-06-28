# 修复文件管理内部关闭按钮重复 prompt

## Goal

修复点击终端文件管理抽屉右侧 X 关闭按钮时仍刷出多行 shell prompt 的问题。

## Confirmed Facts

- 文件管理开关按钮路径已经启用本地-only远端 resize 屏蔽窗口。
- 用户截图标出的抽屉内部 X 使用 `onClose={() => setShowFileManager(false)}`，绕过了统一的关闭逻辑。
- 该绕过路径不会调用 `beginFileManagerLayoutTransition()`，因此不会启用 `suppressRemoteResize`。
- 关闭抽屉后终端布局变化仍会触发 xterm resize，远端 bash/readline 收到 PTY `window_change` 后重绘 prompt。

## Requirements

- 文件管理内部 X 关闭按钮必须走统一关闭 handler。
- 所有关闭文件管理抽屉的入口都应启用本地-only远端 resize 屏蔽窗口。
- 不影响侧边文件夹按钮打开/关闭。
- 不影响手动拖拽文件管理高度、窗口 resize、分屏 resize 的远端同步。

## Acceptance Criteria

- 点击截图红框 X 关闭文件管理时，不再新增多行 `[root@... ~]#`。
- 点击侧边文件夹按钮关闭文件管理时也不新增 prompt。
- 手动拖拽文件管理高度仍正常。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改 SFTP 功能。
- 不修改远端 shell 配置。
- 不重构终端整体布局。

## Open Questions

无阻塞问题。用户已提供截图和复现路径。
