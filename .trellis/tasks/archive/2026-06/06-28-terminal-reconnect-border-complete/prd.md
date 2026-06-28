# 修复重连遮罩下终端边框缺失

## Goal

修复终端断连/重新连接遮罩显示时，活动终端 pane 边框只剩上半部分、下方和侧边被遮罩覆盖的问题。

## Confirmed Facts

- 活动边框由 `.term-pane.is-active::after` 绘制。
- 断连遮罩 `terminal-disconnect-overlay` 位于 xterm 区域内，`z-index: 20`。
- 当前活动边框 pseudo element 没有显式 `z-index`，会被断连遮罩盖住。
- 因遮罩只覆盖 pane-bar 下方的 term-window，视觉上表现为上半部分边框可见，下半部分缺失。

## Requirements

- 断连/重新连接遮罩出现时，活动终端 pane 的完整边框仍可见。
- 不影响重新连接按钮点击。
- 不影响文件管理覆盖层、终端工具栏、终端输入、resize 抑制逻辑。
- Classic 和 Aurora 两套主题都应保持一致。

## Acceptance Criteria

- `.term-pane.is-active::after` 在断连遮罩上方渲染。
- active border 仍然不拦截鼠标事件。
- `pnpm -C app build` 通过。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不调整断连卡片样式。
- 不调整终端文件管理覆盖方案。
- 不改变终端连接/重连逻辑。

## Open Questions

- 无阻塞问题。
