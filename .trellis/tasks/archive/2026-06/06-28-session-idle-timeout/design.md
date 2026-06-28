# Design: 会话无操作超时

## Architecture

在后端 `SessionManager` 内为每个 session 保存一个 `ManagedSession`：

- `session: Arc<TokioMutex<SshSession>>`
- `last_activity: Arc<std::sync::Mutex<std::time::Instant>>`
- `idle_timeout: Option<std::time::Duration>`

`SessionManager::get()` 继续返回 SSH session，保持现有调用兼容。新增：

- `touch_activity(session_id) -> bool`
- `idle_timeout(session_id) -> Option<Duration>`
- `idle_elapsed(session_id) -> Option<Duration>`

`session_connect` 成功后，如果 timeout 非 0，在 `lib.rs` 启动一个 lightweight watchdog task。watchdog 每次读取剩余时间，sleep 到最近到期点；醒来后再次确认 session 仍存在且 elapsed >= timeout，再调用 `SessionManager::disconnect` 并 emit `disconnected`。

## Activity Contract

刷新活动时间的入口：

- `session_write`
- `session_resize`
- SFTP list/canonicalize/mkdir/remove/rename/read/write/privileged write
- SFTP transfer start/upload files
- `terminal_ping`

不刷新活动时间：

- SSH keepalive
- 远端输出
- transfer list/remove/clear/cancel 这类不依赖 live SSH session 的任务列表操作

## Compatibility

- `session.keepAlive = 0` 表示禁用应用层 idle timeout。
- 保留 russh keepalive，继续负责网络稳定。
- 不改 Tauri command request/response。
- 已连接 session 的 timeout 不随设置页保存即时变更；新连接读取当前设置。

## Trade-offs

- 后端 watchdog 比前端定时器更可靠：页面重渲染、隐藏、WebView timer throttling 不会影响断开。
- 把 SFTP 操作计为活动比只计键盘输入更符合“用户正在使用这个会话”的体验。
- 不把远端输出计为活动，避免服务器日志/保活输出让无操作会话永远不断。
