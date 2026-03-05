# System Insights Spec

## 1. 目标
- 为“系统信息/监控”功能提供统一技术口径。
- 保证不同开发者与 AI 输出一致的数据字段、图表与行为。

## 2. 指标模型定义

### 2.1 Snapshot 顶层结构
- `timestamp`: ISO8601 时间戳。
- `sessionId`: 关联 SSH 会话 ID。
- `uptime`: 运行时间信息。
- `load`: 负载信息（1m/5m/15m）。
- `cpu`: CPU 使用率信息。
- `memory`: 内存使用信息。
- `network`: 网络上行/下行速率信息。
- `processes`: 进程明细列表（Top N）。

### 2.2 字段约定
- `uptime.seconds`: number，主机运行秒数。
- `load.l1/l5/l15`: number，分别对应 1/5/15 分钟。
- `cpu.usagePercent`: number，范围 `0~100`。
- `memory.totalBytes/usedBytes/freeBytes/cacheBytes`: number。
- `memory.usagePercent`: number，范围 `0~100`。
- `network.rxBytesPerSec`: number，下行。
- `network.txBytesPerSec`: number，上行。
- `processes[].pid`: number。
- `processes[].name`: string。
- `processes[].cpuPercent`: number。
- `processes[].memPercent`: number。
- `processes[].command`: string。

## 3. 采样与缓存策略
- 默认采样间隔：`2s`。
- 可选采样间隔：`1s/2s/5s`。
- 默认窗口：`15m`。
- 支持窗口：`5m/15m/60m`。
- 缓存模型：内存环形缓冲区（按窗口上限预分配）。
- 页面不可见时：自动降频至 `5s` 或暂停（由设置决定）。

## 4. 计算与聚合口径
- CPU 图表：展示 `cpu.usagePercent` 时序值。
- 内存图表：展示 `memory.usagePercent` 时序值。
- 网络图表：双线展示 `tx/rx` 时序速率。
- 概览卡：展示最新一个快照值。
- Top N 进程：默认 `N=10`，支持 `10/20/50`。

## 5. 单位与格式化规则
- 内存基础单位：`Bytes`，UI 自动换算 `KB/MB/GB`。
- 网络速率基础单位：`Bytes/s`，UI 自动换算 `KB/s/MB/s`。
- 百分比保留 1 位小数。
- 负载保留 2 位小数。

## 6. 平台命令适配

### 6.1 Linux（优先）
- `uptime`
- `cat /proc/loadavg`
- `top -bn1`
- `free -m`
- `ip -s link`（或可选 `sar -n DEV`）

### 6.2 macOS
- `uptime`
- `top -l 1`
- `vm_stat`
- `netstat -ib`

### 6.3 Windows 远端
- v1 不强制实现。
- 若实现需独立适配层，不影响 Linux/macOS 主流程。

## 7. 解析与容错
- 解析失败单指标不应导致整体快照丢弃。
- 单字段解析失败时使用 `null` 并附带错误标签。
- 连续解析失败达到阈值（默认 3 次）触发 `collector_state=degraded`。
- 命令不可用触发 `METRICS_UNSUPPORTED`。
- 输出格式变化触发 `METRICS_PARSE_FAILED`。

## 8. 事件与状态机
- `metrics:collector_state_changed`
  - 状态：`idle -> collecting -> degraded -> stopped`
- `metrics:updated`
  - 周期推送最新快照。
- 断线事件触发采集停止并等待重连。

## 9. UI 行为约束
- 首屏打开后 3 秒内展示第一帧监控数据。
- 图表更新必须平滑，禁止闪烁和突变跳轴。
- 断线时显示“连接中断，可重试”。
- 采集失败时显示“部分指标不可用”并保留可用项。

## 10. 性能与资源约束
- 采集逻辑 CPU 占用应低于客户端总开销预算。
- 图表渲染不得显著影响终端输入流畅性。
- 长时间运行（8h）无内存持续增长异常。

## 11. 测试口径
- 功能：指标完整性、排序与筛选、窗口切换。
- 异常：断线、命令缺失、解析失败、超时。
- 兼容：Linux/macOS 命令输出差异适配。
- 性能：1s 采样下 60m 窗口持续渲染稳定。

