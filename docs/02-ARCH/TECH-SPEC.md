# Technical Specification

## 1. 依赖与版本建议
- Rust stable（锁定 toolchain）。
- Node LTS（锁定 major 版本）。
- `xterm.js`、`ssh2`、`tokio`、`serde`、`tracing`。

## 2. 数据模型
- `hosts`：连接配置。
- `host_groups`：连接分组。
- `sessions`：会话状态记录。
- `snippets`：命令片段。
- `transfer_tasks`：传输队列。
- `system_metrics_snapshots`：系统监控采样快照（内存环形缓存）。
- `disk_usage_snapshots`：磁盘使用快照（按挂载点）。
- `command_history`：命令历史（按 host/session 维度）。

## 3. 安全规范
- 敏感信息只存 keyring 引用 ID。
- known_hosts 采用“首次确认 + 指纹变化阻断”。
- 日志默认脱敏（主机/IP/用户名）。

## 4. 错误码规范
- `AUTH_FAILED`：认证失败。
- `NETWORK_TIMEOUT`：网络超时。
- `HOST_UNREACHABLE`：主机不可达。
- `FINGERPRINT_MISMATCH`：主机指纹变更。
- `SFTP_PERMISSION_DENIED`：SFTP 权限不足。
- `METRICS_UNSUPPORTED`：目标系统不支持指定采集命令。
- `METRICS_PARSE_FAILED`：监控数据解析失败。
- `DISK_INFO_UNAVAILABLE`：磁盘信息不可用。
- `COMMAND_HISTORY_UNAVAILABLE`：历史命令不可用。
- `NETWORK_INTERFACE_UNAVAILABLE`：网卡不可用或不存在。
- `ARCHIVE_TRANSFER_FAILED`：打包传输失败。

## 5. 事件契约
- `session:state_changed`
- `session:output`
- `transfer:progress`
- `transfer:completed`
- `transfer:failed`
- `metrics:updated`
- `metrics:collector_state_changed`
- `disk:updated`
- `command_history:updated`
- `network_interfaces:updated`
- `ports:updated`

## 6. Command 接口契约（v1）
- `connection.create`
  - input：`{ name, host, port, username, authType, groupId? }`
  - output：`{ id }`
- `connection.update`
  - input：`{ id, ...patch }`
  - output：`{ success }`
- `connection.delete`
  - input：`{ id }`
  - output：`{ success }`
- `session.connect`
  - input：`{ hostId, termOptions }`
  - output：`{ sessionId }`
- `session.disconnect`
  - input：`{ sessionId }`
  - output：`{ success }`
- `sftp.list_dir`
  - input：`{ sessionId, remotePath }`
  - output：`{ entries[] }`
- `sftp.transfer.start`
  - input：`{ sessionId, direction, localPath, remotePath }`
  - output：`{ taskId }`
- `metrics.start`
  - input：`{ sessionId, intervalSec, windowMinutes }`
  - output：`{ collectorId }`
- `metrics.stop`
  - input：`{ collectorId }`
  - output：`{ success }`
- `metrics.snapshot`
  - input：`{ sessionId }`
  - output：`{ uptime, load, cpu, memory, network, processes }`
- `disk.snapshot`
  - input：`{ sessionId, path? }`
  - output：`{ filesystems[] }`
- `file.upload.dragdrop`
  - input：`{ sessionId, localPaths[], remotePath }`
  - output：`{ taskIds[] }`
- `command_history.list`
  - input：`{ sessionId, hostId, query?, limit?, cursor? }`
  - output：`{ items[], nextCursor? }`
- `command_history.insert_to_terminal`
  - input：`{ sessionId, command }`
  - output：`{ success }`
- `network.interfaces.list`
  - input：`{ sessionId }`
  - output：`{ interfaces[] }`
- `network.connections.snapshot`
  - input：`{ sessionId }`
  - output：`{ listeners[], connections[] }`
- `transfer.archive.start`
  - input：`{ sessionId, direction, paths[], targetPath, archiveFormat? }`
  - output：`{ taskId }`
- `command.quick_path.list`
  - input：`{ sessionId, cwd, query? }`
  - output：`{ items[] }`
- `command.quick_name.search`
  - input：`{ sessionId, query }`
  - output：`{ items[] }`
- `system.detect`
  - input：`{ sessionId }`
  - output：`{ os, distro?, distroVersion?, shell }`
- `command.suggest`
  - input：`{ sessionId, input, cursorPos, context? }`
  - output：`{ items[], sourceMeta }`

## 7. 系统监控采集规范（v1）
- 采样方式：通过 SSH 执行远端命令并解析结果。
- 默认采样：`2s`，可选 `1s/2s/5s`。
- 图表窗口：`5/15/60` 分钟。
- 指标范围：
  - uptime
  - load（1m/5m/15m）
  - cpu（总使用率）
  - memory（total/used/free/cache）
  - network（tx/rx，即上行/下行速率）
  - processes（Top N，按 CPU/Memory 排序）
  - disk（filesystem/mount/total/used/available/usage%）
  - network_interfaces（每网卡 tx/rx）
  - network_connections（监听端口与连接状态）
- 平台命令适配：
  - Linux：`uptime`、`cat /proc/loadavg`、`top -bn1`、`free -m`、`ip -s link`
  - Linux 磁盘：`df -h`（必要时 `df -kP` 便于解析）
  - macOS：`uptime`、`top -l 1`、`vm_stat`、`netstat -ib`
  - macOS 磁盘：`df -h`
  - Windows 远端：v1 不强制，后续版本补齐

## 8. 命令提示与发行版适配规范（v1.1）
- 识别流程：`uname -s` + `/etc/os-release` + `$SHELL`。
- 提示源：
  - 历史命令源（本地缓存）
  - PATH 可执行命令源（远端采集）
  - 规则库源（按 distro 匹配）
- 候选项结构：`{ text, kind, source, distroTags?, score }`。
- Ubuntu/CentOS 差异示例：
  - 包管理：`apt` vs `yum/dnf`
  - 防火墙：`ufw` vs `firewalld`
- 行为约束：仅提示与回填，不自动执行。

## 9. 自部署同步规范（v1.1）
- 模式：用户自部署同步服务（单用户优先）。
- 同步内容：`hosts`（脱敏字段）、`snippets`、`settings`。
- 不同步内容：明文凭据、私钥口令。
- 冲突策略：`last_write_wins` + 手动冲突查看。

## 10. Version Baseline Reference
- Runtime/framework version baseline and upgrade policy must follow:
  - `docs/02-ARCH/TECH-STACK-DECISIONS.md`
- If this file conflicts with baseline document, baseline document takes precedence.

## 11. Client Update Mechanism (v1.1)
- Scope: in-app update check, download, verify, install, restart.
- Trigger:
  - manual check from settings/update page;
  - optional startup background check (respect user preference).
- Pipeline:
  1) fetch release metadata
  2) compare current vs target version
  3) download package
  4) verify signature/checksum
  5) install and prompt restart
- Failure handling:
  - network timeout -> retry/backoff
  - signature mismatch -> block install and raise security warning
  - install failure -> keep current version and allow retry
- Security:
  - update manifest and packages must be signed
  - TLS required; no plaintext update channel
- Events (suggested):
  - `update:check_started`
  - `update:available`
  - `update:not_available`
  - `update:download_progress`
  - `update:ready_to_install`
  - `update:install_failed`

## 12. Self-host Service Update & Redeploy (Docker)
- Scope: sync service update through Docker pull + redeploy.
- Required flow:
  1) backup database and config
  2) `docker compose pull`
  3) `docker compose up -d --remove-orphans`
  4) run health checks and smoke tests
  5) publish update result and rollback plan
- Rollback requirement:
  - support previous stable image tag rollback
  - when schema incompatible, execute DB restore plan
- Non-functional target:
  - service recovery after update failure <= 5 minutes
  - data integrity must be preserved.
