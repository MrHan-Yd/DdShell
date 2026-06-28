# 修复终端底部黑边

## Goal

修复终端内容区域底部出现一条更黑空隙的问题，让 xterm 渲染区域和父容器背景保持一致。

## Confirmed Facts

- 截图中黑边位于终端 pane 底部、状态栏上方。
- xterm 根据字符行高计算可显示行数，容器高度不能整除行高时，底部可能留下几像素父容器背景。
- xterm 默认背景来自 `termSettings.bgColor ?? "#0F1115"`。
- 终端父容器 CSS 使用 `var(--term-bg)`，Aurora token 默认 `--term-bg: #0B0C12`，会比 xterm 默认背景更黑。

## Requirements

- 终端 pane、term-window、xterm surface 的背景需要跟当前终端背景色同步。
- 无背景图时使用 `termSettings.bgColor ?? "#0F1115"`。
- 背景图模式下保持透明逻辑，不遮挡已有背景图。
- 不改变 xterm 行高、PTY resize、文件管理抽屉避让或终端输入行为。

## Acceptance Criteria

- 终端底部行高舍入留下的区域不再显示为不同颜色的黑边。
- 常规纯色终端背景和背景图模式都不回退。
- `pnpm -C app build` 通过。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不调整状态栏位置。
- 不改终端连接、登录输出或 prompt 处理逻辑。
- 不改文件管理抽屉动画/尺寸。

## Open Questions

- 无阻塞问题。
