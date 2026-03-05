# Glossary

## 1. 核心术语
- `Host`：一条远端连接配置。
- `HostGroup`：连接分组。
- `Session`：一次 SSH 终端会话实例。
- `TransferTask`：一次文件传输任务。
- `Collector`：系统监控采样器实例。

## 2. 关键 ID
- `hostId`：连接配置唯一 ID。
- `sessionId`：会话唯一 ID。
- `taskId`：传输任务唯一 ID。
- `collectorId`：监控采样器唯一 ID。
- `requestId`：一次请求追踪 ID。

## 3. Command / Event 命名约定
- Command：`domain.action`，如 `session.connect`。
- Event：`domain:event`，如 `transfer:progress`。
- 错误码：全大写下划线，如 `AUTH_FAILED`。

## 4. 方向与单位约定
- `network.rxBytesPerSec`：下行速率。
- `network.txBytesPerSec`：上行速率。
- 时间：统一使用 UTC ISO8601。
- 大小与速率：内部基础单位为 `Bytes` 与 `Bytes/s`。

## 5. 终端行为约定
- “回填”= 插入到当前光标处，不自动执行。
- “执行”= 发送回车提交命令。
- “取词填充”= 选中终端输出内容后插入命令行。

## 6. 平台边界约定
- 三端支持：指客户端运行在 Windows/macOS/Linux。
- 远端优先：Linux（Ubuntu/CentOS/RHEL 系）通过 SSH 连接。

## 7. 状态枚举约定
- Session：`connecting | connected | reconnecting | disconnected | failed`
- TransferTask：`queued | running | paused | completed | failed | canceled`
- Collector：`idle | collecting | degraded | stopped`

