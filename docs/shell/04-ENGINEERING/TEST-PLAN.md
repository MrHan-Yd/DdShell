# Test Plan

## 1. 测试分层
- 单元测试：Rust core 与前端 utils。
- 集成测试：连接流程、传输流程、配置持久化。
- E2E 测试：关键用户路径（连接、命令、上传下载）。

## 2. 核心测试场景
- 连接：正确密码、错误密码、超时、主机不可达。
- 会话：多标签切换、分屏、重连、编码切换。
- SFTP：上传下载、重试、权限不足、网络中断。
- 安全：keyring 读取失败回退策略、指纹变化阻断。
- 系统监控：
  - 首屏 3 秒内显示 uptime/load/cpu/memory/network。
  - 图表在 1s/2s/5s 采样间隔下持续刷新。
  - 进程列表可按 CPU/内存排序并正确分页/截断。
  - 网络上行/下行速率单位自动换算正确。
  - 断线、命令不可用、解析失败时展示对应错误态。
- 磁盘与路径：
  - 挂载点容量与使用率展示准确。
  - 路径跳转、最近路径、收藏路径行为正确。
- 文件拖拽上传：
  - 拖拽单文件/多文件均可创建上传任务。
  - 冲突文件命名策略与提示正确。
  - 取消上传后任务状态与 UI 一致。
- 命令历史：
  - 历史记录可检索、排序、分页。
  - 选择命令后正确回填终端输入且不自动执行。
  - 会话切换后历史上下文按 host/session 正确隔离。
- 多网卡监控：
  - 网卡切换与多选显示正确。
  - 各网卡上下行曲线与总览一致。
- 打包传输：
  - 目录/多文件打包上传下载成功。
  - 打包失败、解包失败可回退并提示。
- 高级网络监控：
  - 监听端口与连接状态列表可刷新并筛选。
- 快速输入增强：
  - 路径快速选择可回填输入框。
  - 命令名快速输入匹配准确。
  - 左右键字段级历史回填行为正确。
- 系统识别与提示：
  - Ubuntu/CentOS 识别准确，版本信息可读。
  - 命令提示可按来源分组（历史/系统/规则库）。
  - 发行版不匹配命令能给出正确替代建议。
  - 提示选择后仅回填，不自动执行。
- 终端背景自定义：
  - 纯色/渐变/图片背景设置可保存并重启后生效。
  - 透明度与模糊调节即时生效且无明显卡顿。
  - 深浅主题下文本与光标对比度达标。
  - 单会话覆盖全局配置时行为正确。
- 终端字体与配色：
  - 字体家族、字号、字重、行高修改可即时生效并持久化。
  - 前景色/光标色/选区色修改后可读性达标。
  - 图片背景下触发低对比提示时可一键增强修正。
- 终端取词填充：
  - 选中任意文本后可正确插入到命令光标处。
  - 多行文本、空格文本、特殊字符文本插入行为可控。
  - 插入后不自动执行，用户可继续编辑。
  - 含 ANSI 控制字符的选中内容可被正确清洗。

## 3. 兼容性矩阵
- Windows 10/11
- macOS（近两代）
- Linux（Ubuntu LTS 优先）
- 监控命令适配优先级：Linux > macOS > Windows 远端（后续）

## 4. 质量门禁
- PR 必须通过 lint + unit tests。
- 每周至少一次跨平台回归。
- Release 前执行完整 E2E 与手工冒烟。

## 5. Update & Redeploy Test Scope (FR-35 / FR-36)
- Client update center (FR-35):
  - manual check update success and no-update branches
  - metadata fetch timeout/retry behavior
  - download progress/reporting correctness
  - signature/checksum mismatch blocks install
  - install failure fallback keeps current version usable
- Self-host redeploy (FR-36):
  - pull + redeploy flow executes successfully
  - `/healthz` and sync smoke tests pass after redeploy
  - rollback to previous stable image tag works
  - DB restore path executable for schema incompatibility

## 6. Performance Baseline
- Baseline environment:
  - OS: Windows 11 / macOS (latest 2 versions) / Ubuntu LTS
  - CPU: 4 cores+, RAM: 8GB+
  - Network: stable LAN and simulated unstable network
- Datasets:
  - Connection profiles: 50 / 200 / 500 entries
  - SFTP directory size: 1k / 10k files
  - Concurrent sessions: 1 / 5 / 10
- Measurement commands/examples:
  - Cold start: measure app-ready timestamp from process start
  - Memory: capture resident memory after 10 minutes idle and active usage
  - SFTP rendering: measure time from list request to first complete render
- Acceptance thresholds:
  - Cold start <= 2.5s (typical baseline machine)
  - Resident memory <= 250MB (normal workload)
  - 1000-file directory render <= 300ms
- Required evidence for PR/Release:
  - test environment summary
  - raw metrics and percentile (P50/P95)
  - regression comparison against previous baseline

## 7. FR-38~FR-44 Dedicated Test Scope
- FR-38 Recording Search/Export:
  - keyword/time-range query accuracy
  - clip export integrity and masking correctness
- FR-39 SSH Config Import:
  - compatibility with common OpenSSH configs
  - malformed/partial entries handling and conflict policy
- FR-40 Folder Sync:
  - incremental change detection correctness
  - conflict policy behavior and dry-run vs actual consistency
- FR-41 Structured Extraction:
  - extraction precision/recall on representative output corpus
  - safe quick action mapping without auto-execution side effects
- FR-42 Monitoring Alerts:
  - threshold crossing/recovery correctness
  - debounce/cooldown anti-noise behavior
- FR-43 Unified Task Center:
  - lifecycle consistency across transfer/update/retry/reconnect
  - pause/retry/cancel/history persistence and traceability
- FR-44 Command Macros (Workflow Recipe):
  - recipe CRUD and validation correctness
  - parameter rendering with required/default/missing branches and frontend required-field validation
  - single-host sequential execution with per-step status, exit code, stdout/stderr capture, and fail-fast behavior
  - workflow run persistence, history list loading, and persisted run detail reload after restart
  - runtime param values persisted with run record and displayed in history/detail UI
  - cancel/retry remains future scope; current test scope should not assert these behaviors as shipped
  - run history remains local-only and excluded from sync scope
