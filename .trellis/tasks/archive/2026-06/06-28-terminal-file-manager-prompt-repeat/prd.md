# 修复文件管理打开后终端重复 prompt

## Goal

修复在终端页点击“文件管理”按钮后，终端区域刷出多行 shell prompt 的问题，例如：

```text
[root@C20240428105430 ~]#
[root@C20240428105430 ~]#
[root@C20240428105430 ~]#
[root@C20240428105430 ~]#
```

## Confirmed Facts

- 启动期 prompt 残片问题已经通过抑制启动阶段远端 resize 修复并归档。
- 当前问题由用户点击终端内文件管理入口触发，不是首次连接触发。
- 终端文件管理抽屉打开/关闭时会改变 `term-main` 的 `grid-template-rows`，并且 `.terminal-file-manager-shell` 的 `height` / `flex-basis` 有 `--duration-panel` 过渡。
- 终端实例的 `ResizeObserver` 会在容器尺寸变化时执行 `fitAddon.fit()`，随后 `term.onResize` 会调用 `api.sessionResize()`，给远端 PTY 发送 `window_change`。
- 现有 `suspendResize` 只覆盖手动拖拽文件管理高度时的 resize，未覆盖点击打开/关闭抽屉的布局过渡。

## Requirements

- 点击文件管理打开或关闭抽屉时，不应在终端缓冲区刷出多行空 prompt。
- 文件管理抽屉打开后，终端仍应最终适配新的可视高度。
- 抽屉打开/关闭过渡期间应避免向远端连续发送 resize；过渡稳定后最多同步一次最终尺寸。
- 保留手动拖拽文件管理高度时的 resize 暂停逻辑。
- 不改变文件管理的 SFTP 目录加载、上传、下载、删除、移动等功能。

## Acceptance Criteria

- 点击文件管理按钮打开抽屉后，终端不再新增多行 `[root@... ~]#`。
- 关闭文件管理抽屉后，终端不再新增多行 prompt。
- 打开/关闭后终端本地尺寸正确，输入和输出仍正常。
- 手动拖拽文件管理高度结束后，终端仍能适配最终高度。
- `pnpm -C app build`、`cargo check --manifest-path app/src-tauri/Cargo.toml`、`cargo test --manifest-path app/src-tauri/Cargo.toml`、`git diff --check` 通过。

## Out of Scope

- 不修改 SFTP 后端协议、认证、目录列表逻辑。
- 不改变远端 shell 配置或 prompt 样式。
- 不重构终端页整体布局。

## Open Questions

无阻塞问题。用户已提供复现现象并要求继续处理。
