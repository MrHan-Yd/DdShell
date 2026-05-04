# Command Macros Decision Summary

## 1. Purpose
- This document is a convergence summary for implementation.
- It does not replace the current source-of-truth documents:
  - `docs/01-PRODUCT/PRD.md`
  - `docs/02-ARCH/TECH-SPEC.md`
  - `docs/02-ARCH/API-CONTRACTS.md`
  - `docs/04-ENGINEERING/WORKFLOW-RECIPE-DESIGN.md`
- Its goal is to make the current direction executable and highlight the items that still need alignment.

## 2. Naming
- UI / product name: `Command Macros`
- Internal capability name: `Workflow / Recipe`
- Recommendation: keep this naming split and avoid renaming storage, events, or internal modules again.

## 3. Confirmed Product Positioning
- Command Macros is an independent capability, not an executable extension of `Snippets`.
- `Snippets` remain insertion-only and must not auto-execute.
- Command Macros is an explicit execution feature with run history, per-step state, logs, and stronger safety prompts.

## 4. MVP Scope

### In scope
- Single-host execution.
- Ordered sequential steps.
- Command step only.
- Runtime params with `{{var}}` / `{{ var }}` rendering.
- Step-level state and logs.
- Run history persistence.
- Failure stops the remaining steps.

### Out of scope
- DAG, branching, or parallel execution.
- Multi-host fan-out.
- Interactive commands that require TTY input.
- Shared PTY context with the currently open terminal.
- SFTP upload/download step types.
- Scheduler, cron, webhook, or auto-run triggers.

## 5. Execution Model
- Runs must not inject commands into the active terminal PTY.
- Each step executes through an independent SSH exec channel in the backend.
- Each step should capture at least:
  - `resolvedCommand`
  - `stdout`
  - `stderr`
  - `exitCode`
  - `durationMs`
- Default shell behavior should target reproducibility, not interactive shell emulation.
- Recommendation: execute steps through a non-interactive shell wrapper such as `/bin/sh -lc '<command>'`.
- Shell context is not implicitly shared across steps. If a working directory is needed, it must be expressed explicitly in the step.

## 6. Data Model

### Current MVP model
- `workflow_recipes`
- `workflow_runs`
- Recipe params and steps stay in JSON for now:
  - `workflow_recipes.params_json`
  - `workflow_recipes.steps_json`
- Run step results stay in JSON for now:
  - `workflow_runs.steps_json`

### Current implementation snapshot
- Recipe CRUD is already landed.
- Param definition is already landed.
- Sequential execution is already landed.
- Runtime param input is already landed.
- Recent run history persistence is already landed.
- Run detail replay is already landed.

### Deferred structure work
- `workflow_run_steps` child table.
- Richer query model for step history.
- Log retention tuning beyond tail snapshots.

## 7. UX Structure
- Command Macros should live as an independent top-level page.
- Recommended page structure:
  - left: recipe list
  - center: recipe editor
  - right: run history and recent result
- Run start should require an explicit confirmation layer with:
  - target host
  - runtime params
  - step count
  - risk warning

## 8. Security and Safety
- Running a macro is an explicit execution action and must not be silent.
- Existing fingerprint and known-hosts rules must still apply.
- Dangerous commands should trigger a stronger warning before start.
- Secret params are marked via `secret: bool` on `WorkflowRecipeParam`.
- Secret param values are masked to `******` before being written to:
  - `workflow_runs.params_json` (stored in SQLite)
  - `workflow_runs.steps_json` → `rendered_command` field (stored in SQLite)
  - `workflow:run_updated` event payloads sent to the frontend
- At execution time, the in-memory `WorkflowRun` holds plaintext values for actual SSH execution.
- `run_to_masked_record` and `mask_run_for_event` are used for all DB writes and event emissions.
- `run_to_record` (plaintext) is retained for testing but not called in production code.

## 9. Recommended Canonical Decisions

### 9.1 Host selection model
- Recommendation: recipes are reusable templates and should not be bound to a single host in MVP.
- Recommendation: `hostId` is determined by the terminal session context — the currently selected host in the terminal is used automatically, not selected via a dropdown on the workflow page.
- Why:
  - workflows are triggered from within an active terminal session
  - the host context is already established by the user's terminal selection
  - no need for a separate host picker in the workflow UI

### 9.2 State field and enum
- Recommendation: use `state` consistently in domain models and API payloads.
- Recommendation: current MVP enums should be:
  - Run: `running | completed | failed`
  - Step: `pending | running | completed | failed`
- Recommendation: only add `canceled | interrupted | skipped` when the matching feature is actually implemented.
- Recommendation: do not mix `status` and `state`, and do not mix `success` with `completed`.

### 9.3 Template syntax
- Recommendation: MVP supports only `{{var}}` and `{{ var }}`.
- Recommendation: default values come from param definitions, not from inline template syntax.
- Recommendation: do not support `{{var:default}}` in MVP.

### 9.4 API and command naming
- Recommendation: formal public contract stays on dot notation:
  - `workflow.recipe.create`
  - `workflow.recipe.update`
  - `workflow.recipe.delete`
  - `workflow.recipe.list`
  - `workflow.recipe.get`
  - `workflow.run.start`
  - `workflow.run.list`
  - `workflow.run.get`
- Recommendation: if backend code still uses snake_case Tauri function names internally, treat that as an implementation detail rather than the public contract.

### 9.5 Field naming
- Recommendation: use `title` consistently for recipe title.
- Recommendation: do not mix `title` and `name` for the same concept.
- Recommendation: use camelCase in JSON payloads and UI-facing types.

## 10. Alignment Gaps — Resolution Status

### Gap 1: recipe host binding — RESOLVED (2026-04-14)
- Decision: Recipe does NOT bind to a host. `hostId` is selected at run start.
- Status: Code aligned. `target_host_id` removed from all layers (DB, Rust, TS, UI). `hostId` is now a required parameter on `workflow_run_start`.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` §8.4, §9.1, §17.2.1; `TECH-SPEC.md`; `API-CONTRACTS.md`; `PRD.md`; Rust structs; TS types; DB schema; UI components.

### Gap 2: `state` vs `status` — RESOLVED (2026-04-14)
- Decision: Use `state` consistently. Do not use `status`. Use `completed`, not `success`.
- Status: Code already uses `state` in all layers. Docs aligned.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` §11; `TECH-SPEC.md` §5.1; `API-CONTRACTS.md` §7; `ERROR-CATALOG.md`.

### Gap 3: `title` vs `name` — RESOLVED (2026-04-14)
- Decision: Use `title` for recipe display text. Do not use `name`.
- Status: Code already uses `title` in all layers. Docs aligned.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` §10.3, §13; `API-CONTRACTS.md` §7; `TECH-SPEC.md`.

### Gap 4: dot notation vs snake_case command names — RESOLVED (2026-04-14)
- Decision: Public contract uses dot notation (`workflow.recipe.create`). Tauri internal uses snake_case (`workflow_recipe_create`) as implementation detail.
- Status: No code change needed. Current Tauri commands use snake_case internally which is correct. Docs aligned to show dot notation as public contract.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` §13; `API-CONTRACTS.md` §7; `TECH-SPEC.md`.

### Gap 5: MVP vs future draft leakage — RESOLVED (2026-04-14)
- Decision: Split clearly in docs using `[MVP]` and `[future]` markers.
- Status: `WORKFLOW-RECIPE-DESIGN.md` §14 error codes, §16 concurrency/cancel, §25 convergence notes updated. `ERROR-CATALOG.md` §5 fully annotated.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` header, §14, §16, §25.1; `ERROR-CATALOG.md`; `TECH-SPEC.md`.

### Gap 6: inline default syntax — RESOLVED (2026-04-14)
- Decision: MVP does NOT support `{{var:default}}`. Default values come from param definition `defaultValue` field only.
- Status: Code already implements this. Docs aligned.
- Updated: `WORKFLOW-RECIPE-DESIGN.md` §10.2; `DECISION-SUMMARY` §9.3.

## 11. Implementation Progress

### 11.1 Completed: Document alignment (2026-04-14)
- Updated `PRD.md` FR-44 with host selection model, MVP scope, state enums, field naming.
- Updated `TECH-SPEC.md` §2 (data model), §5 (state enums, template syntax), §6 (commands — removed `targetHostId`, added `hostId` on `workflow.run.start`), §4 (error codes annotated MVP/future).
- Rewrote `API-CONTRACTS.md` §7 (dot notation, `hostId` required, `state` field, `title` field, `[MVP]`/`[future]` annotations).
- Annotated `ERROR-CATALOG.md` §5 with `[MVP]` and `[future]` markers.
- Updated `WORKFLOW-RECIPE-DESIGN.md` header (convergence reference), §8.4 (host selection), §9.1 (removed `target_host_id`), §10.2 (template syntax), §10.3 (field naming), §13 (full API contract rewrite), §14 (error codes), §16 (MVP/future), §17.2.1 (host binding), §25.1 (convergence log).
- Created `WORKFLOW-RECIPE-DECISION-SUMMARY.md` as convergence reference.

### 11.2 Completed: Backend-frontend code alignment (2026-04-14)

#### Rust backend changes
| File | Change |
|------|--------|
| `store.rs` | Removed `target_host_id` from `WorkflowRecipe` struct; removed from DB CREATE TABLE; added migration to drop the column from existing databases; removed from all CRUD method signatures and SQL queries. |
| `workflow.rs` | Renamed `resolve_recipe_host_and_password` → `resolve_host_and_password` (takes `host_id` directly instead of recipe). |
| `lib.rs` | Removed `target_host_id` from `CreateWorkflowRecipeReq` and `UpdateWorkflowRecipeReq`; added `host_id: String` to `WorkflowRunStartReq`; updated `workflow_recipe_create` and `workflow_recipe_update` handlers; updated `workflow_run_start` to resolve host from request `host_id` instead of recipe. |

#### Frontend TypeScript changes
| File | Change |
|------|--------|
| `types/index.ts` | Removed `targetHostId` from `WorkflowRecipe`, `CreateWorkflowRecipeRequest`, `UpdateWorkflowRecipeRequest`. |
| `lib/tauri.ts` | `workflowRunStart` now requires `hostId` as second parameter. |
| `stores/workflows.ts` | Removed `targetHostId` from `WorkflowRecipeDraft` and all helper functions (`createEmptyWorkflowDraft`, `workflowRecipeToDraft`, `draftToCreateRecipeRequest`, `draftToUpdateRecipeRequest`); `startRun` now takes `hostId` parameter. |
| `WorkflowsPage.tsx` | Added `selectedHostId` from connections store; removed host selector dropdown and `runHostId` state; `startRun` passes `selectedHostId` automatically; host validation warns if no terminal session is active. |
| `WorkflowEditor.tsx` | Replaced host Select with removed chip (host is determined by terminal context, not editor UI); removed `useConnectionsStore` import and `Globe` icon. |
| `WorkflowDetail.tsx` | Removed `targetHostId` reference and host display; removed `useConnectionsStore` and `Globe` imports. |
| `WorkflowRunPanel.tsx` | Added `Terminal` import; removed unused `durationText` variable. |
| `lib/i18n.ts` | Added `workflows.hostSelectAtRunTime`, `workflows.selectHost`, `workflows.runValidationSelectHost`; updated `workflows.formTargetHost` meaning. |

#### Database migration
- Added automatic migration that detects `target_host_id` column in `workflow_recipes` and recreates the table without it, preserving existing data.

### 11.3 Completed: Secret param masking (2026-04-14)

#### Rust backend changes
| File | Change |
|------|--------|
| `workflow.rs` | Added `secret: bool` field to `WorkflowRecipeParam` struct (with `#[serde(default)]`). Added `mask_command`, `mask_params`, `collect_secret_keys`, `run_to_masked_record`, `mask_run_for_event` functions. |
| `lib.rs` | `workflow_run_start` now calls `collect_secret_keys` and uses `run_to_masked_record` for all DB writes and `mask_run_for_event` for all event emissions. In-memory run stays plaintext for execution. |

#### Frontend TypeScript changes
| File | Change |
|------|--------|
| `types/index.ts` | Added `secret?: boolean` to `WorkflowRecipeParam` interface. |
| `WorkflowEditor.tsx` | Added "Secret" checkbox per parameter row. New param defaults include `secret: false`. |
| `lib/i18n.ts` | Added `workflows.secretParam` translation key (zh: "密钥", en: "Secret"). |

#### Security behavior
- Params marked `secret: true` have their values replaced with `******` in:
  - DB `workflow_runs.params_json`
  - DB `workflow_runs.steps_json` → `rendered_command` field
  - `workflow:run_updated` event payloads
- The in-memory `WorkflowRun` object retains plaintext values during execution so SSH commands work correctly.
- `run_to_record` (plaintext) is retained for testing but not called in production code paths.

#### Unit tests (16 tests, all passing)
| Test | What it covers |
|------|--------|
| `test_interpolate_command_*` (4 tests) | `{{var}}` and `{{ var }}` rendering, missing params, empty values |
| `test_mask_command_*` (4 tests) | Secret masking in rendered commands, non-secret preservation, spaced tokens, empty secret values |
| `test_mask_params_masks_secrets` | Params map masking |
| `test_collect_secret_keys` | Collecting secret param keys from definition |
| `test_resolve_param_values_*` (3 tests) | Defaults, overrides, missing required validation |
| `test_run_to_masked_record_masks_secrets` | Full run record masking (params + rendered_command) |
| `test_mask_run_for_event` | Event payload masking while preserving in-memory plaintext |
| `test_secret_param_deserialization_backward_compat` | Backward compat: `secret` field defaults to `false` when absent from JSON |

### 11.4 Completed: Editor UX redesign — 方案 A (2026-04-15)

#### Completed
- **A2: Inline editing for title/description** — Replaced label+input rows with borderless inline text inputs. Title uses `text-[var(--font-size-xl)] font-semibold`, description uses `text-[var(--font-size-sm)] text-[var(--color-text-secondary)]`. No visible borders, focus shows bottom border.
- **A2: Metadata bar** — Replaced two-column grid label+select with horizontal chip-style layout. Group selector shows as a rounded-full capsule. Target host shows as a descriptive chip ("Select host at run time").
- **A3: Step card hover actions** — Delete and duplicate buttons now only appear on hover (`opacity-0 group-hover:opacity-100`). Duplicate copies the step and inserts it right after.
- **A3: Command textarea style** — Updated to terminal-style with `.wf-command-editor` CSS class: monospace font, subtle border, accent focus glow.
- **A4: Parameter card grid** — Replaced 5-column table grid with 2-column card grid. Each card collapses to show key name + required/secret badges when filled; expands on click or when empty. Delete button shows on hover only. Toggle switches replace checkboxes for required/secret. "Add param" is a dashed card in the grid.
- **A5: Cmd+K spotlight search** — `SpotlightOverlay` component: modal with search input, keyboard navigation (arrow keys + Enter), grouped actions (basics, actions, steps). Actions include edit title, edit description, add step, add param, save, and jump-to-step. Triggered by `Cmd/Ctrl+K`.
- **A6: Step animations** — Added `wf-step-enter` (fade-in-up scale) and `wf-step-remove` (slide-left + collapse) CSS keyframe animations.
- **A7: Sticky save bar** — Bottom bar changed from simple right-aligned buttons to sticky bar with `backdrop-blur-xl`, dirty state hint ("Unsaved changes"), ghost cancel button. `Cmd/Ctrl+Enter` triggers save.
- **Dirty detection** — `isDraftDirty()` helper in `stores/workflows.ts` compares current draft against original recipe. Passed via `originalRecipe` prop.
- **i18n** — Added `workflows.duplicateStep`, `workflows.dirtyHint`, `workflows.spotlightEditTitle`, `workflows.spotlightEditDesc`, `workflows.spotlightSave`, `workflows.spotlightSectionBasics`, `workflows.spotlightSectionActions`, `workflows.spotlightSectionSteps`, `workflows.spotlightGotoStep`.

### 11.5 Completed: Editor UX redesign — 方案 B 微卡片风格演进 (2026-04-16)

#### 设计决策
- 选项方案 B（微卡片式/Linear 风格）的头部布局，取代方案 A 的卡片化/tab 式头部。
- 标题和描述采用 hover/focus 底线效果（无框时不可见，hover 淡线，focus 蓝线）。
- 分组选择器改为右上角胶囊下拉（GroupChipSelect 组件）。
- 底部操作栏从 sticky 毛玻璃改为轻量文字取消 + 脏状态圆点 + 主色保存按钮。
- 描述字段始终显示（不为空时也不隐藏）。

#### 已完成的改造项

| 改造项 | 说明 |
|--------|------|
| **头部微卡片布局** | 标题+描述左对齐行内编辑，hover 时淡灰底线、focus 时蓝色底线；分组胶囊移到右上角（`GroupChipSelect` 自定义下拉组件），描述始终可见 |
| **底部操作栏** | 取消按钮降级为文字链接样式，脏状态用 `h-1.5 w-1.5` 圆点 + 文字提示，保存按钮是主色按钮，整体 `pt-4` 非sticky |
| **hover/focus 底线** | 标题：`border-b border-transparent hover:border-[color-border] focus:border-[color-accent]`，描述同理但更细 |
| **步骤卡片拖拽** | 实现了长按拖拽排序，含 FLIP 动画、ghost 浮层、drop indicator |
| **GroupChipSelect** | 自定义胶囊下拉组件，点击展开选项列表，点击外部关闭，选中项高亮 |

#### 参数区交互决策记录
- 曾尝试将参数区从内联卡片改为右侧覆盖抽屉（ParamDrawer），但用户反馈抽屉看起来像弹窗悬空、不像紧贴边缘的真正抽屉效果。
- 最终决定：**参数区保持内联卡片形式**，不使用抽屉。参数仍然在编辑器主体中以 2 列卡片网格展示，折叠/展开交互不变。

#### 前端文件变更（本轮）
| File | Change |
|------|--------|
| `WorkflowEditor.tsx` | 全面重写头部（微卡片 + 行内底线编辑 + GroupChipSelect），参数卡片化，步骤hover操作，SpotlightOverlay，底部操作栏轻量化 |
| `styles.css` | 新增 `.wf-command-editor`、`.wf-step-entering`、`.wf-step-removing`、动画关键帧 |
| `stores/workflows.ts` | 新增 `isDraftDirty()` 导出函数 |
| `lib/i18n.ts` | 新增多条 i18n key（dirtyHint、spotlight 系列、secretParam 等） |
| `types/index.ts` | `WorkflowRecipeParam` 增加 `secret?: boolean` 字段 |
| `WorkflowsPage.tsx` | 移除主机选择UI，改为用 selectedHostId 自动传 |

### 11.6 Completed: Variable hint & dangerous command confirmation (2026-04-16)

#### Variable hint popup
- 在命令 textarea 中输入 `{{` 时，自动弹出参数列表供选择。
- 选择参数后自动插入 `{{paramKey}}` 到光标位置。
- 支持输入过滤：输入 `{{ho` 会只显示包含 `ho` 的参数。
- 无参数时显示 "暂无参数，请先添加" 提示。
- 实现方式：`StepCard` 组件增加 `paramKeys` prop，`onChange` 时用正则 `/\{\{(\s*[a-zA-Z_]*)$/` 检测光标前是否正在输入变量。

#### Dangerous command confirmation layer
- 运行宏时在 `startRun` 之前检查所有步骤命令是否匹配危险命令模式。
- 复用终端已有的 `DEFAULT_DANGEROUS_COMMANDS` 列表，提取到 `@/lib/constants.ts` 共享。
- 新增 `isCommandDangerous(command, patterns)` 工具函数。
- 匹配到危险命令时弹出确认框，列出所有命中的命令（超过 80 字符截断）。
- 用户取消则不执行，确认则继续运行。
- 新增 i18n key：`workflows.dangerousConfirmTitle`、`workflows.dangerousConfirmDesc`。

#### i18n 修复
- 补充了 `workflows.selectToRunDescription` key（zh: "点击运行按钮执行此命令宏"，en: "Click Run to execute this macro"），修复了 WorkflowRunPanel 的 TS 错误。

#### 代码去重
- `DEFAULT_DANGEROUS_COMMANDS` 和 `isCommandDangerous` 从 `TerminalPage.tsx` 和 `SettingsPage.tsx` 提取到 `@/lib/constants.ts`，两处改为 import。

#### 参数模型简化
- `WorkflowRecipeParam` 从 `{ key, label, defaultValue, required, secret }` 简化为 `{ key, defaultValue }`。
- 移除了 `label`、`required`、`secret` 字段。参数只需键和默认值。
- 编辑器参数区从折叠卡片改为单行 `{{ key }} = 值` 行内编辑。
- 运行面板参数标签从 `param.label` 改为 `{{param.key}}`，移除必填校验和 `runParamErrors` 状态。
- 后端 Rust `WorkflowRecipeParam` 保持 `#[serde(default)]` 兼容旧数据，label/required/secret 字段缺失时自动填充默认值。
- detail 视图参数显示改为 `{{key}}` 格式，不再显示 label 和 required badge。

### 11.7 Completed: View-mode simplification & action-bar polish (2026-04-19)

#### Workflow view (outside editor)
- Removed the **Recent Runs** card from `WorkflowsPage` view mode.
- View mode now keeps only:
  - recipe detail
  - run config (params + run button)
  - run result panel (`WorkflowRunPanel`)
- Simplified run panel empty state text:
  - kept: `workflows.noRunYet` ("还没有执行记录")
  - removed: `workflows.selectToRunDescription` ("点击运行按钮执行此命令宏")

#### Run config wording cleanup
- `workflows.runConfig` changed from "运行参数" to "参数".
- `workflows.runValidationRequired` changed to "请先填写所有必填参数".
- Removed unused i18n key: `workflows.selectToRunDescription`.

#### Editor bottom action bar polish
- `WorkflowEditor` bottom actions were changed to a bottom-right floating capsule.
- Capsule includes cancel + dirty hint + save.
- Removed full-row background blocking effect; only the capsule itself overlays content.

#### Frontend files updated (this round)
| File | Change |
|------|--------|
| `app/src/features/workflows/WorkflowsPage.tsx` | Removed recent runs card and related rendering logic in view mode. |
| `app/src/features/workflows/components/WorkflowRunPanel.tsx` | Removed empty-state helper line `workflows.selectToRunDescription`. |
| `app/src/features/workflows/components/WorkflowEditor.tsx` | Bottom action bar changed to floating bottom-right capsule style. |
| `app/src/lib/i18n.ts` | Updated run-config wording and removed unused run-panel helper copy key. |

### 11.8 Completed: Step navigator drawer visual + animation polish (2026-04-20)

#### What was fixed
- Removed the distracting **halo/glow** around the Step Navigator drawer toggle (between the step count and chevron) by removing gradient/backdrop/glow styling.
- Made Step Navigator drawer open/close feel more macOS-like, aligned with `app/docs/animation-guide.md`:
  - double-layer motion (shell + panel)
  - open uses spring for transform
  - close uses smooth (no bounce)
  - width uses the dedicated non-overshoot size easing

#### Notes
- Close animation previously flashed due to opacity transitions during width collapse. Opacity animation was removed for the drawer panel to keep teardown stable.

#### Frontend files updated (this round)
| File | Change |
|------|--------|
| `app/src/features/workflows/components/WorkflowEditor.tsx` | Removed Step Navigator drawer glow styles; switched drawer container to `data-state` driven CSS (`step-drawer-shell` / `step-drawer-panel`). |
| `app/src/styles.css` | Added drawer animation classes and tuned timing/curves to match the animation guide; removed panel opacity transitions to avoid flashing on close. |

### 11.9 Completed: Single-active side-layer implementation spec (2026-04-20)
- Added implementation detail doc for the "left step drawer + right param drawer" interaction model with **single active side layer** rule.
- Covers: state machine, breakpoint policy, motion guidance, accessibility, keyboard map, persistence, rollout sequence, and DoD.
- Doc: `shell/docs/04-ENGINEERING/WORKFLOW-EDITOR-SINGLE-ACTIVE-SIDE-LAYER-IMPLEMENTATION.md`

### 11.10 Not yet started
- `workflow_run_steps` child table.
- `continue_on_error` step option.
- Host "last used" or "recommended" metadata on recipes.
- Cancel / Retry support for workflow runs.
- Timeout control for steps.
- 参数区抽屉方案：曾尝试右侧覆盖抽屉，用户不满意效果（像弹窗而非紧贴边缘的抽屉），已回退为内联卡片。如后续重试，需要确保抽屉紧贴视口右边缘、无间距。

## 12. Suggested Next Steps
1. Build cancel and retry support (future increment, after contract is stable).
2. Build timeout control for steps (future increment).
3. Consider `workflow_run_steps` child table when step-level queries become necessary.

## 13. Working Recommendation
- Proceed with Command Macros as an independent `Workflow / Recipe` capability.
- Treat the backend execution engine as a single-host sequential task runner.
- MVP is frozen around: reproducible exec behavior, explicit host selection at run start, param rendering, per-step logs, and persisted run history.
- Defer cancel, retry, timeout, queueing, and extra step types until the next increment.
- All six alignment gaps identified in the original document have been resolved in code and docs as of 2026-04-14.
