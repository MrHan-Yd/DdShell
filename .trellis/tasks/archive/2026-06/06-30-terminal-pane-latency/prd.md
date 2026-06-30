# 终端面板延迟显示

## Goal

将终端 pane 顶栏右侧原本显示的 `connected` 状态改为服务器延迟，让用户在分屏终端中直接看到当前可见服务器的响应时间。

## Confirmed Facts

- `connected` 文案来自 `app/src/features/terminal/TerminalPage.tsx` 中两个 pane 顶栏的 `pane-tag`。
- 项目已有 `latencyMap`，以 `sessionId -> ms` 保存延迟。
- `app/src/stores/terminal.ts` 已有 `pingActiveSession()`，通过 `api.sshPing(sessionId)` 更新活动会话延迟。
- 右侧分屏 pane 可能不是当前活动 tab，仅依赖 `pingActiveSession()` 不能稳定刷新分屏 pane 的延迟。

## Requirements

- 终端 pane 顶栏右侧连接状态显示改为服务器延迟。
- 已连接会话显示 `<number> ms`。
- 已连接但暂未测得延迟时显示 `-- ms`，不再显示 `connected`。
- 断开、失败或空闲状态仍显示原状态文本，避免误报延迟。
- 分屏场景下，主 pane 和分屏 pane 都能刷新各自可见会话的延迟。
- 延迟刷新不得调用 `sessionTouchActivity`，不能影响会话空闲过期判断。
- 不修改 SSH 后端 ping 命令、不修改分屏布局和状态管理语义。

## Acceptance Criteria

- 主 pane 顶栏原 `connected` 位置显示服务器延迟。
- 分屏 pane 顶栏原 `connected` 位置显示对应服务器延迟。
- 无延迟数据时显示 `-- ms`。
- `pnpm --dir app build` 通过。

## Out Of Scope

- 不修改状态栏延迟展示。
- 不新增延迟颜色分级。
- 不修改后端 `ssh_ping` 实现。
- 不推送远端。

## Open Questions

- 无阻塞问题。
