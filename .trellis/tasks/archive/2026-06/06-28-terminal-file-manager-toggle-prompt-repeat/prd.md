# 修复文件管理开关仍重复 prompt

## Goal

修复终端内文件管理抽屉打开/关闭后仍然向终端缓冲区追加 shell prompt 的问题。用户复现现象：

```text
点开加一个，x 掉后刷出多行：
[root@C20240428105430 ~]#
[root@C20240428105430 ~]#
...
```

## Confirmed Facts

- 上一轮已经在文件管理打开/关闭过渡期间暂停了 `ResizeObserver -> fitAddon.fit()`。
- 现有逻辑在暂停结束后会执行 pending fit，以适配最终布局。
- 该 pending fit 仍会触发 `term.onResize`，进而调用 `api.sessionResize()`，向远端 PTY 发送 `window_change`。
- 用户反馈说明这个最终 resize 本身也会让 bash/readline 重绘 prompt；对文件管理这种内部面板开关而言，这次远端 resize 不应发送。

## Requirements

- 点击文件管理打开抽屉时，不应新增 shell prompt。
- 点击文件管理关闭抽屉时，不应刷出多行 shell prompt。
- 文件管理开关导致的终端本地尺寸变化应只更新本地 xterm 布局，不同步为远端 PTY resize。
- 保留真实窗口 resize、分屏 resize、手动拖拽文件管理高度后的远端 resize 同步能力。
- 不改变 SFTP 文件管理的目录加载和文件操作功能。

## Acceptance Criteria

- 打开文件管理后终端不新增 `[root@... ~]#`。
- 关闭文件管理后终端不刷出多行 `[root@... ~]#`。
- 文件管理开关后终端本地显示区域正确适配。
- 手动拖拽文件管理高度后仍能做最终尺寸适配。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改远端 shell 配置或 prompt 样式。
- 不修改 SFTP 后端协议。
- 不重构终端页整体布局。

## Open Questions

无阻塞问题。用户已提供明确复现路径并要求继续修复。
