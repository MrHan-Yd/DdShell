# 修复拖拽文件管理高度重复 prompt

## Goal

修复拖拽终端文件管理抽屉高度后，终端仍新增一行 shell prompt 的问题。

## Confirmed Facts

- 文件管理打开/关闭路径已经做了本地-only远端 resize 屏蔽。
- 手动拖拽文件管理高度时，现有逻辑会在拖拽结束后执行一次 pending fit，并允许同步远端 `sessionResize`。
- 用户反馈拖拽文件管理窗口大小也会新增一个 prompt，说明这次最终远端 `window_change` 仍会触发 bash/readline 重绘 prompt。
- 文件管理高度变化是应用内部布局变化，不应让远端 shell 感知为真实终端窗口尺寸变化。

## Requirements

- 拖拽文件管理高度结束后，不应新增 shell prompt。
- 拖拽过程中和拖拽结束后，本地终端布局仍要正确适配。
- 不给拖拽增加新的明显延迟。
- 真实窗口 resize、分屏 resize 等非文件管理面板导致的终端尺寸变化仍应同步远端。
- 不改变 SFTP 文件管理功能。

## Acceptance Criteria

- 拖拽文件管理高度后，终端不新增 `[root@... ~]#`。
- 打开/关闭文件管理仍不新增 prompt。
- 拖拽文件管理高度后，本地终端显示区域正确。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改远端 shell 配置。
- 不修改 SFTP 后端协议。
- 不重构终端页布局。

## Open Questions

无阻塞问题。用户已提供明确复现：拖拽文件管理窗口大小会新增一个 prompt。
