# 实现会话无操作超时

## Goal

让设置里的“会话无操作超时”按用户理解生效：配置为 30 秒时，终端会话在没有用户/应用主动操作超过 30 秒后自动断开。

## Confirmed Facts

- 设置页保存键为 `session.keepAlive`，可选值包含 `30`、`300`、`1800`、`0`。
- 当前后端只把该值传给 `russh::client::Config.inactivity_timeout`。
- SSH config 同时启用了固定 30 秒 keepalive，底层 SSH 空闲判断不等价于“用户无操作”。
- `SessionManager` 当前只保存 `SshSession`，没有记录最后用户活动时间。
- 断连状态通过 `event::emit_session_state(..., "disconnected")` 通知前端。

## Requirements

- `session.keepAlive = 30` 时，新建终端会话应在 30 秒无用户/应用主动操作后自动断开。
- `session.keepAlive = 0` 时保持永不断开。
- SSH keepalive 不应刷新用户活动时间，也不应阻止应用层 idle 超时。
- 远端输出不应刷新用户活动时间。
- 用户输入、终端 resize、SFTP 文件管理操作、传输启动、session ping 等主动操作应刷新用户活动时间，避免正在使用时被断开。
- 自动 idle 断开应复用现有断开流程并向前端发送 `disconnected` 状态。
- 不改变手动断开、连接、重连、文件管理、传输的既有 API 形状。

## Acceptance Criteria

- 后端为每个 session 记录 `last_activity` 和配置的 idle timeout。
- 后台 watchdog 到期后主动断开 session 并 emit `disconnected`。
- `0` timeout 不启动 idle watchdog。
- 用户主动命令入口调用 activity touch。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `pnpm -C app build` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不新增设置项。
- 不改设置页 UI 文案和选项。
- 不改变 SSH keepalive 的网络保活策略。
- 不做运行中修改设置即时影响已连接 session；新连接读取当前设置。

## Open Questions

- 无阻塞问题。
