# Task Cards（可直接执行）

本文档把 `GAP-LIST` 的 P0/P1 项拆成可直接交给 AI 的任务卡。

## 使用规则
- 严格按卡片顺序执行。
- 每张卡完成后必须产出“完成证据”。
- 未达到“完成定义”不得进入下一卡。

## 状态规范（强制）
- 任务状态仅允许使用：`TODO`、`IN_PROGRESS`、`DONE`、`BLOCKED`。
- 禁止使用：`Not Started`、`In Progress`、`Verified` 或其他自定义状态词。
- 状态变更必须同步到 `docs/01-PRODUCT/FEATURE-STATUS.md` 与相关任务记录。
- `DONE` 必须附测试记录链接或测试任务编号；未附证据不得标记为 `DONE`。

## CARD-01 会话录制与回放（P0）
### 目标
- 支持记录 SSH 会话输入输出，并可按时间回放。

### 前置输入
- `docs/01-PRODUCT/PRD.md`
- `docs/02-ARCH/TECH-SPEC.md`
- `docs/04-ENGINEERING/TEST-PLAN.md`

### 具体步骤
1. 定义录制数据结构（时间戳、方向、内容、会话 ID）。
2. 定义录制开关与存储策略（默认本地、可清理）。
3. 定义回放控制（播放/暂停/快进/跳转）。
4. 定义异常处理（断线、损坏文件、超大记录）。
5. 补测试用例与验收脚本。

### 完成定义
- 可录制完整会话并成功回放。
- 回放时间轴与原始会话顺序一致。
- 断线场景下录制文件可安全结束。

### 完成证据
- 设计文档更新路径
- 测试用例清单
- 验收结论（通过/失败）

---

## CARD-02 端口转发 UI 向导化（P0）
### 目标
- 本地/远程/动态端口转发可视化配置与状态管理。

### 具体步骤
1. 设计转发配置表单（模式、地址、端口、备注）。
2. 设计状态视图（运行中/失败/重试）。
3. 定义冲突端口处理与错误提示。
4. 定义启停控制与持久化策略。
5. 补测试（配置、冲突、重连恢复）。

### 完成定义
- 三种转发模式都可创建并启停。
- 端口冲突能被识别并给出可操作提示。
- 重连后转发状态可正确恢复或提示恢复失败。

---

## CARD-03 SSH 跳板链路可视化（P1）
### 目标
- 展示并管理多跳连接链路（Jump Host）。

### 具体步骤
1. 定义链路模型（节点、顺序、认证）。
2. 设计链路编辑器（增删改、拖拽排序）。
3. 定义连通性检测与错误定位（第几跳失败）。
4. 补测试（链路正确性、失败定位）。

### 完成定义
- 支持创建 2~3 跳链路并连接成功。
- 失败时能明确指出失败跳点。

---

## CARD-04 文件传输冲突预览（P1）
### 目标
- 传输前展示冲突并支持策略模板。

### 具体步骤
1. 定义冲突检测规则（同名、大小、时间戳）。
2. 设计预览界面（覆盖/跳过/重命名）。
3. 支持策略模板（本次/默认）。
4. 补测试（批量冲突、部分失败回滚）。

### 完成定义
- 冲突文件能在传输前完整列出。
- 用户策略能准确应用到批量任务。

---

## CARD-05 Client Update Center (FR-35, P0)
### Goal
- Implement in-app update center: check, download, verify, install, restart.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/02-ARCH/TECH-SPEC.md`
- `docs/03-UX/UI-SPEC.md`
- `docs/04-ENGINEERING/TEST-PLAN.md`
### Steps
1. Define update metadata contract and version comparison rules.
2. Implement update state machine (idle/checking/available/downloading/ready/failed).
3. Implement progress reporting and retry/backoff.
4. Implement signature/checksum verification and security blocking behavior.
5. Implement install + restart flow and failure fallback.
6. Add tests and acceptance evidence.
### Definition of Done
- User can manually check updates in app.
- Download progress is visible and failure is retryable.
- Signature/checksum mismatch blocks installation.
- Install failure does not break current running version.
### Evidence
- Updated docs references
- test cases and results
- acceptance report

---

## CARD-06 Self-host Docker Update & Redeploy (FR-36, P0)
### Goal
- Standardize service update by Docker pull + redeploy + health check + rollback.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/05-RELEASE/DEPLOYMENT.md`
- `docs/05-RELEASE/OPS-RUNBOOK.md`
- `docs/04-ENGINEERING/TEST-PLAN.md`
### Steps
1. Define backup checklist (`db`, `.env`, compose snapshot).
2. Execute `docker compose pull` and `docker compose up -d --remove-orphans`.
3. Run health checks and sync smoke tests.
4. Define rollback path to previous stable image tag.
5. Define DB restore path for schema incompatibility.
6. Add runbook evidence and test records.
### Definition of Done
- Update flow is executable with traceable records.
- Rollback to previous stable tag is verified.
- DB restore flow is executable when required.
- Key sync path remains healthy after redeploy.
### Evidence
- deployment log
- rollback drill record
- health/smoke test result

---

## CARD-07 Session Recording Search/Export (FR-38, P1)
### Goal
- Make session recordings searchable by keyword/time range and exportable as clips.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/04-ENGINEERING/TEST-PLAN.md`
### Steps
1. Define recording index fields (`sessionId`, timestamp, keyword offsets).
2. Implement keyword/time-range query and result highlighting.
3. Implement clip export format and sensitive-content masking.
4. Add unit/integration tests for search precision and export integrity.
### Definition of Done
- User can locate recording fragments by keyword and time range.
- Exported clip preserves timeline and integrity.
- Sensitive content masking works as configured.

## CARD-08 SSH Config Import (FR-39, P0)
### Goal
- Import `~/.ssh/config` safely into connection profiles.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/02-ARCH/TECH-SPEC.md`
### Steps
1. Parse `Host`, `HostName`, `User`, `Port`, `ProxyJump`, `IdentityFile`.
2. Define validation and conflict resolution strategy.
3. Implement preview-before-import and partial-failure reporting.
4. Add tests for compatibility and malformed entries.
### Definition of Done
- Typical ssh config imports successfully.
- Conflict handling is explicit and reversible.
- Malformed entries do not break overall import.

## CARD-09 Folder Sync Mode (FR-40, P1)
### Goal
- Provide incremental folder sync with clear conflict behavior.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/04-ENGINEERING/TEST-PLAN.md`
### Steps
1. Define sync scan model and checksum/mtime strategy.
2. Implement ignore rules and conflict policy selection.
3. Implement dry-run preview and rollback-safe execution.
4. Add tests for drift/conflict/interruption recovery.
### Definition of Done
- Incremental sync is accurate and reproducible.
- Dry-run output matches actual execution changes.
- Rollback/retry path is executable.

## CARD-10 Structured Output Extraction (FR-41, P1)
### Goal
- Extract actionable entities from terminal output.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/03-UX/UI-SPEC.md`
### Steps
1. Define extraction patterns for IP/path/error-code/URL.
2. Implement result panel and safe quick-action mapping.
3. Implement sanitization and false-positive guardrails.
4. Add precision/recall oriented tests on sample logs.
### Definition of Done
- Extraction is stable on representative outputs.
- Quick actions are safe and context-correct.
- No command auto-execution side effects.

## CARD-11 Monitoring Alerts (FR-42, P1)
### Goal
- Add threshold alerts for key metrics with low noise.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/02-ARCH/SYSTEM-INSIGHTS-SPEC.md`
### Steps
1. Define threshold config model and defaults.
2. Implement debounce/cooldown and suppression windows.
3. Implement toast + status bar + alert history.
4. Add tests for alert storm and recovery transitions.
### Definition of Done
- Alerts fire/recover correctly under threshold crossings.
- Noise is controlled by debounce/cooldown.
- History records are queryable and auditable.

## CARD-12 Unified Task Center (FR-43, P1)
### Goal
- Unify transfer/update/retry/reconnect into one task center.
### Inputs
- `docs/01-PRODUCT/PRD.md`
- `docs/03-UX/UI-SPEC.md`
### Steps
1. Define unified task state machine.
2. Implement task center list with filter/search.
3. Implement pause/retry/cancel/history consistency across task types.
4. Add tests for state transitions and persistence.
### Definition of Done
- All supported task types use one consistent lifecycle.
- Cross-task operations behave consistently.
- History survives restart and supports tracing.
