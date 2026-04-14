# PRD

## 1. 产品定义
- 产品名：Shell App（工作名）
- 目标：打造可替代 `FinalShell` 的开源跨平台 SSH/SFTP 客户端。
- 平台：Windows / macOS / Linux。
- 运行边界：三端支持指客户端运行平台；远端连接目标优先 Linux 服务器（SSH）。

## 2. 目标与边界
### 2.1 目标
- 高效：连接管理、终端操作、文件传输流畅。
- 高质感：统一视觉与交互，支持深浅色主题。
- 高稳定：断线重连、任务可追踪、错误可恢复。
- 高安全：凭据不明文、主机指纹校验、日志脱敏。

### 2.2 边界声明
- 不做企业协作审批、组织权限管理、多租户控制台。
- 不做批量主机管理与批量主机操作能力（例如批量连接、批量执行、批量分发）。
- 支持云端同步，但仅支持“开发者自部署”模式（Self-hosted）。
- 官方项目不提供托管 SaaS，不承担集中式用户数据托管。
- 不做插件系统与插件市场。
- 不做内置远端编辑器（代码/文本编辑由终端工具或本地编辑 + 文件传输完成）。

### 2.3 功能开放策略
- 允许引入与对标产品“高级/收费版”同等级能力。
- 本项目默认全功能免费开放，不做功能分级付费。
- 禁止通过许可证校验、在线激活或隐藏开关限制核心能力。

## 3. 用户与场景
- 开发者：日常连接服务器开发部署。
- 运维：管理多主机、执行命令、传输日志与备份。
- 教学/实验：快速连接实验机并复用命令片段。

## 4. 功能范围
### 4.1 MVP
- 连接管理：CRUD、分组、搜索、收藏、最近连接。
- SSH 终端：多标签、分屏、重连、编码设置、复制粘贴。
- SFTP：双栏浏览、上传下载、重命名删除、新建目录。
- 系统监控：运行时间、负载、CPU/内存/网络实时监控图、进程列表、命令模板。
- 磁盘与路径：磁盘使用率、挂载点容量、当前路径快速导航。
- 文件操作页：提供类 FinalShell 双栏文件管理，支持拖拽上传到服务器。
- 命令中心：精致 macOS 风格命令操作页，支持历史命令查看、检索、选择并回填终端。
- Snippets：片段管理、一键插入、标签过滤。
- 设置：主题、字体、快捷键、终端偏好。

### 4.2 v1.1+
- 断点续传、传输队列持久化恢复。
- 端口转发（本地/远程/动态）。
- 代理链路（HTTP/SOCKS5/JumpHost）。
- 自部署同步服务（连接配置/片段/偏好设置同步）。
- 多网卡网络监控与网卡选择。
- 打包传输（自动压缩/解压，可开关）。
- 快速输入路径与命令名。
- 历史命令字段级选择输入。
- 命令宏（Workflow Recipe）：可参数化、可追踪的单主机顺序命令流程；首版提供运行历史，取消/重试后续补齐。

## 5. 需求清单（含验收）
- FR-01 连接新增编辑删除：保存后立即生效。
- FR-02 连接测试：支持失败原因提示与重试。
- FR-03 SSH 会话：2.5s 内可输入（冷启动典型场景）。
- FR-04 多标签：5 会话并行可顺畅切换。
- FR-05 分屏：水平/垂直分屏可独立输入滚动。
- FR-06 SFTP 浏览：1000 文件目录渲染 < 300ms。
- FR-07 上传下载：显示进度、速度、状态、失败原因。
- FR-08 凭据管理：密码与口令仅存系统 keyring。
- FR-09 首次主机校验：展示指纹并要求用户确认。
- FR-10 设置持久化：重启后保留配置。
- FR-11 系统信息：打开后 3 秒内显示 uptime、load、CPU、内存、网络。
- FR-12 监控图形化：CPU/内存/网络图表持续刷新，支持 5/15/60 分钟窗口。
- FR-13 进程视图：支持 Top N 进程展示，并按 CPU/内存排序。
- FR-14 网络视图：展示上行/下行实时速率，支持自动单位换算。
- FR-15 命令区：提供常用系统命令模板并支持一键复制。
- FR-16 磁盘信息：展示文件系统/挂载点总量、已用、可用、使用率。
- FR-17 路径能力：支持路径跳转、最近路径与收藏路径。
- FR-18 拖拽上传：本地文件拖入文件操作页可触发上传任务并显示进度。
- FR-19 命令历史：支持查看历史命令，按关键字筛选，选择后回填到当前终端输入框。
- FR-20 多网卡监控：支持按网卡维度展示上/下行并切换。
- FR-21 打包传输：支持目录与多文件打包上传/下载并自动解包（可选）。
- FR-22 高级网络监控：支持查看端口监听和连接状态。
- FR-23 高级进程管理：支持更多字段展示与复杂筛选。
- FR-24 快速输入路径：支持路径树选择后回填到命令输入区。
- FR-25 历史字段选择：支持左右键按字段粒度回填历史命令。
- FR-26 快速输入命令名：支持关键字检索命令名并回填。
- FR-27 系统识别：会话建立后识别 OS、发行版与 shell 类型。
- FR-28 命令提示：输入命令时提供候选提示（历史/可执行命令/规则库）。
- FR-29 发行版适配：Ubuntu 与 CentOS 命令差异可识别并给出替代建议。
- FR-30 终端背景自定义：支持为终端输入区域设置背景（颜色/图片/透明度/模糊度）。
- FR-31 终端字体自定义：支持字体家族、字号、字重、行高调节并持久化。
- FR-32 终端配色自定义：支持前景色、背景色、光标色、选区色配置与重置。
- FR-33 可读性保护：在低对比度配置下提供可读性告警与一键增强修正。
- FR-34 终端取词填充：支持将鼠标选中的任意终端内容插入到当前命令光标处（仅插入不自动执行）。

## 6. 非功能需求
- 性能：常驻内存目标 < 250MB。
- 稳定：网络抖动时指数退避重连。
- 安全：敏感字段不落盘明文。
- 可维护：模块化目录、统一日志与错误码。

## 7. DoD
- 三平台安装包可运行。
- 50+ 连接配置检索流畅。
- SSH/SFTP 核心流程稳定可用。
- 文档与测试计划可指导新贡献者开发。

## 8. FR Extension (Update & Redeploy)
- FR-35 Client update center:
  - User can check update manually from settings/update page.
  - User can view current version, latest version, release notes.
  - User can download update package and see progress.
  - User can install update and restart app.
  - Acceptance:
    - check request returns in expected timeout or gives retryable error;
    - download progress is visible and resumable/retryable when interrupted;
    - signature/checksum verification failure blocks install;
    - install failure keeps current version available and reports clear reason.

- FR-36 Self-host service Docker update & redeploy:
  - Service update must support `docker compose pull` + redeploy.
  - Update flow must include backup, health check, smoke test, rollback path.
  - Acceptance:
    - update procedure can complete with explicit step records;
    - on failure, rollback to previous stable image tag is available;
    - when schema incompatible, database restore procedure is executable;
    - key sync path remains available after successful redeploy.
- FR-37 Session health score: compute and display per-session quality score from latency/loss/reconnect/timeout with clear GOOD/FAIR/POOR levels and actionable hints.
- FR-38 Session recording search/export: support keyword/time-range search in recordings and export selected clip.
- FR-39 SSH config import: support importing `~/.ssh/config` including Host alias and ProxyJump mapping.
- FR-40 Folder sync mode: support incremental directory sync with exclude rules and conflict strategy.
- FR-41 Structured output extraction: extract IP/path/error-code/URL from terminal output for quick actions.
- FR-42 Monitoring alerts: configurable thresholds for CPU/memory/disk/session health with toast + status bar alerts.
- FR-43 Unified task center: unify transfer/update/retry/reconnect tasks with pause/retry/cancel/history.
- FR-44 Command Macros (Workflow Recipe):
  - Provide reusable command macros with params and ordered command steps.
  - Recipes are reusable templates and are NOT bound to a specific host; host is selected at run start time.
  - Command macro execution must support explicit host selection, run history, and step-level logs; first shipped version may defer cancel/retry.
  - Command macros use explicit task semantics and must not be treated as Snippets auto-execution.
  - MVP scope: single-host execution, sequential steps, `{{var}}` param rendering (no `{{var:default}}`), failure-stops-remaining, per-step state/logs, persisted run history.
  - MVP explicitly excludes: cancel, retry, timeout, concurrency queueing, DAG/branching, multi-host, interactive commands, SFTP step types, scheduled triggers.
  - State enums (MVP): Run — `running | completed | failed`; Step — `pending | running | completed | failed`. Additional states (`canceled | interrupted | skipped | queued`) are future increments.
  - Field naming convention: use `title` (not `name`) for recipe display text; use `state` (not `status`) for run/step state; use camelCase in JSON payloads.
  - Acceptance:
    - user can create recipe with params and ordered steps;
    - user can run recipe against a selected host and inspect per-step state/exit-code/log output;
    - missing params and failure paths are observable; runtime param values and run history are persisted;
    - cancel/retry may be delivered in a later increment without changing recipe semantics.
