# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- `docs/02-ARCH/TECH-STACK-DECISIONS.md` with version baseline (as-of 2026-03-05), compatibility notes, and upgrade policy.
- FR extensions for update/redeploy:
  - `FR-35` Client update center (check/download/install/restart)
  - `FR-36` Self-host Docker update & redeploy
- Workflow documentation set:
  - `FR-44` Workflow Recipe
  - `docs/04-ENGINEERING/WORKFLOW-RECIPE-DESIGN.md`
  - `CARD-13` (FR-44)
- Update/redeploy engineering execution cards:
  - `CARD-05` (FR-35)
  - `CARD-06` (FR-36)
- Release readiness additions for update/redeploy in first-run checklist.

### Changed
- Unified status vocabulary across docs to: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED`.
- Added quality-first release principle: release is gated by quality criteria, no fixed-week promise.
- Extended architecture spec with:
  - version baseline reference
  - client update lifecycle and security constraints
  - Docker redeploy and rollback requirements
  - workflow recipe data model, contracts, sync scope, and event/error definitions
- Extended UX spec with `Update Center` page/state model.
- Extended release docs with Docker update/redeploy SOP and update failure runbook.
- Extended engineering docs (`BACKLOG`, `TEST-PLAN`, `TASK-CARDS`) to include FR-35/FR-36 planning and test scope.
- Extended product and engineering docs to formally register Workflow Recipe as `FR-44`.
- Updated Workflow docs to match the current shipped increment:
  - FR-44 status is now `IN_PROGRESS`
  - current scope includes recipe CRUD, sequential execution, runtime params, persisted run history, and history detail reload
  - cancel/retry/timeout remain future-scope design items and are no longer documented as already shipped contracts
  - UI / product naming is now `Command Macros`; internal technical naming remains `Workflow Recipe` / `workflow_*`

### Fixed
- Removed status naming inconsistency between product board and AI development spec.

### Security
- Enforced signature/checksum verification as mandatory gate before client update install.
- Added explicit rollback and DB-restore requirements for self-host redeploy failures.

### Breaking
- 

## [0.1.0] - 2026-03-05

### Added
- Documentation system initialized.
- PRD / Architecture / UX / Engineering / Release docs completed.
- AI execution handbook and prompt kits added.

### Changed
- 

### Fixed
- 

### Security
- Security policy and deployment hardening docs added.

### Breaking
- 
