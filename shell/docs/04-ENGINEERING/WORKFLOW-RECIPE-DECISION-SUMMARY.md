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
- Secret params must not be written to:
  - SQLite plain fields
  - event payloads
  - frontend persisted stores
- Stored `resolvedCommand` must be masked before persistence.

## 9. Recommended Canonical Decisions

### 9.1 Host selection model
- Recommendation: recipes are reusable templates and should not be bound to a single host in MVP.
- Recommendation: `hostId` should be selected at run start.
- Why:
  - better reuse value
  - cleaner separation between template and execution target
  - matches the later UX guidance in the design doc

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
| `WorkflowsPage.tsx` | Added `runHostId` state; added host selector Select in run config panel; added host validation before run; `startRun` call passes `hostId`; reset `runHostId` on recipe change. |
| `WorkflowEditor.tsx` | Replaced host Select with informational text ("select host at run time"); removed `useConnectionsStore` import. |
| `WorkflowDetail.tsx` | Removed `targetHostId` reference and host display; removed `useConnectionsStore` and `Globe` imports. |
| `WorkflowRunPanel.tsx` | Added `Terminal` import; removed unused `durationText` variable. |
| `lib/i18n.ts` | Added `workflows.hostSelectAtRunTime`, `workflows.selectHost`, `workflows.runValidationSelectHost`; updated `workflows.formTargetHost` meaning. |

#### Database migration
- Added automatic migration that detects `target_host_id` column in `workflow_recipes` and recreates the table without it, preserving existing data.

### 11.3 Not yet started
- Editor UX redesign (方案 A / 方案 B from `docs/workflow-editor-redesign.md`).
- Cancel and retry support.
- Timeout control.
- `workflow_run_steps` child table.
- Secret param masking in `resolvedCommand`.
- Dangerous command confirmation layer.
- `continue_on_error` step option.
- Host "last used" or "recommended" metadata on recipes.

## 12. Suggested Next Steps
1. Editor UX redesign: implement 方案 A (inline editing, param cards, hover actions, Cmd+K spotlight) as documented in `docs/workflow-editor-redesign.md`.
2. Add dangerous command confirmation layer before run start.
3. Add `resolvedCommand` masking for secret params before persistence.
4. Build cancel and retry support (future increment, after contract is stable).
5. Build timeout control for steps (future increment).
6. Consider `workflow_run_steps` child table when step-level queries become necessary.

## 13. Working Recommendation
- Proceed with Command Macros as an independent `Workflow / Recipe` capability.
- Treat the backend execution engine as a single-host sequential task runner.
- MVP is frozen around: reproducible exec behavior, explicit host selection at run start, param rendering, per-step logs, and persisted run history.
- Defer cancel, retry, timeout, queueing, and extra step types until the next increment.
- All six alignment gaps identified in the original document have been resolved in code and docs as of 2026-04-14.