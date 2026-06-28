# 修复状态栏心跳续期会话

## Goal

修复会话无操作超时仍不生效的问题：状态栏自动延迟 ping 不应刷新 session activity，避免每 5 秒续期导致 30 秒 idle timeout 永远无法触发。

## Confirmed Facts

- `StatusBar` 在 active tab 存在时立即调用 `pingActiveSession()`，并每 5 秒 `setInterval(pingActiveSession, 5000)`。
- `pingActiveSession()` 调用 `api.sshPing(tab.sessionId)`。
- 后端 `ssh_ping` 当前调用 `ssh_mgr.touch_activity(&session_id)`，导致状态栏自动 ping 每 5 秒刷新 `last_activity`。
- `session.keepAlive = 30` 时，只要状态栏 ping 仍在刷新 activity，idle watchdog 不会达到 30 秒。

## Requirements

- 自动状态栏 latency ping 不应刷新用户/应用 activity。
- 30 秒 idle timeout 应能在无用户操作时触发，即使状态栏继续显示/刷新延迟。
- 保留状态栏延迟显示功能。
- 保留用户输入、resize、SFTP 操作和传输进度对 activity 的刷新。
- 更新 backend spec，明确自动 status ping/heartbeat 不算用户 activity。

## Acceptance Criteria

- `ssh_ping` 不再调用 `touch_activity`。
- `StatusBar` 的 5 秒 ping 不再续期 session idle timeout。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `pnpm -C app build` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不移除状态栏延迟显示。
- 不改变 SSH ping API 响应。
- 不改变其他用户主动操作的 activity 语义。

## Open Questions

- 无阻塞问题。
