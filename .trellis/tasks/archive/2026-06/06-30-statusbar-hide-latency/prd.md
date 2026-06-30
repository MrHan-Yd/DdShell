# 底部状态栏隐藏延迟

## Goal

移除底部状态栏中 `x 个会话` 旁边的服务器延迟显示，让延迟只保留在终端 pane 顶栏中。

## Confirmed Facts

- 底部状态栏组件是 `app/src/components/StatusBar.tsx`。
- 状态栏当前在会话数量旁边单独渲染 active session 延迟，例如 `42ms`。
- 终端 pane 顶栏延迟由 `app/src/features/terminal/TerminalPage.tsx` 显示，不属于本次移除范围。

## Requirements

- 移除底部状态栏中 active session 的延迟显示块。
- 底部状态栏仍显示会话数量、传输数量、健康状态、AI 状态和版本/更新信息。
- 不影响终端 pane 顶栏中的服务器延迟显示。
- 不修改 `ssh_ping` 后端命令。
- 不推送远端。

## Acceptance Criteria

- 底部状态栏不再显示 `xxms` 延迟项。
- `x 个会话` 显示不变。
- 终端 pane 顶栏仍可显示延迟。
- `pnpm --dir app build` 通过。

## Out Of Scope

- 不调整底部状态栏整体布局。
- 不删除终端 store 中供其他组件使用的延迟能力。
- 不修改发布或 tag 状态。

## Open Questions

- 无阻塞问题。
