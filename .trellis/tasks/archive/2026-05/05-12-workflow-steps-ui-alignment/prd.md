# Align Workflow Steps UI With Design Draft

## Goal

Adjust the command macro/workflows steps display and editor layout to follow the `ui/workflows.html` design draft more closely while preserving all existing workflow functionality.

## What I Already Know

* The user wants the command macro Steps page/section aligned with the UI design draft.
* Existing functionality must remain usable.
* The static draft Steps section lives in `ui/workflows.html` and `ui/styles/pages/workflows.css`.
* Real read-only step display is in `app/src/features/workflows/components/WorkflowDetail.tsx`.
* Real step editing, add/remove/copy/reorder, validation, and preview flows are in `app/src/features/workflows/components/WorkflowEditor.tsx`.
* Shared workflow styles live in `app/src/styles.css`.
* Prior visual alignment work already adjusted the workflow header actions and parameter rows; do not regress those.

## Requirements

* Align the read-only workflow detail Steps section with the design draft:
  * section header spacing and title/count layout should match the draft style.
  * step list should use the draft timeline visual: vertical line, compact gap, card row layout, step number badge, command block, and muted note/preview metadata.
  * preserve real step title/command/preview data and do not invent status/time fields from the static draft.
* Align the workflow editor Steps section with the same visual language where it maps to existing editor behavior:
  * keep add step, remove, duplicate, move up/down, drag/drop reorder, title editing, command editing, active step highlighting, validation, and preview flows working.
  * keep input/textarea controls usable and accessible.
  * apply visual layout/style only where it does not hide or break existing controls.
* Do not modify backend/store/schema, recipe JSON contracts, command execution, persistence, or i18n semantics beyond existing labels.
* Do not add static-design-only product behavior such as run status, durations, recent runs, or execution actions unless already backed by real state/handlers.
* Keep changes scoped to workflow UI components/styles.

## Acceptance Criteria

* [ ] Workflow detail Steps section visually follows the draft timeline/card layout.
* [ ] Workflow editor Steps section visually follows the same draft step-card language while preserving edit controls.
* [ ] Add/remove/duplicate/reorder step interactions continue to work.
* [ ] Step title and command editing remain usable.
* [ ] Parameter interpolation preview remains visible when applicable.
* [ ] Validation messages remain visible and useful.
* [ ] No backend/store/schema changes are made.
* [ ] Project build/type-check passes.

## Definition of Done

* Changes are limited to workflow UI files and Trellis task files.
* No existing workflow behavior is removed or replaced by static-only UI.
* Build/type-check passes.
* User can visually review before commit.

## Out of Scope

* Adding run status badges, execution duration, run logs, recent runs, or real run controls.
* Changing macro execution behavior or persistence.
* Redesigning unrelated workflow list/header/parameter sections beyond avoiding regressions.
* Global Button or global design-system changes.

## Technical Approach

* Treat `ui/workflows.html` and `ui/styles/pages/workflows.css` as visual references only.
* Reuse existing React components and handlers; prefer class/style changes and small markup adjustments.
* Map draft-only step affordances to existing controls only when real behavior exists.
* Keep detail display and editor styling consistent but allow editor-specific controls where required for functionality.

## Technical Notes

* Design draft Steps markup: `ui/workflows.html` lines around the `<!-- Steps -->` section.
* Design draft Steps CSS: `ui/styles/pages/workflows.css` `.wf-steps`, `.wf-step`, `.wf-step-num`, `.wf-step-cmd`, `.wf-step-note`, `.wf-step-add-btn`.
* Real detail step display: `app/src/features/workflows/components/WorkflowDetail.tsx` `StepPipeline`.
* Real editor step section: `app/src/features/workflows/components/WorkflowEditor.tsx` `workflow-editor-steps-section`, `StepCard`, sortable wrappers.
* Real styles: `app/src/styles.css` workflow step blocks around `.workflow-detail-content .wf-steps`, `.workflow-editor-steps`, `.workflow-editor-step`, `.wf-step-card`, `.wf-command-editor`.

## Decision (ADR-lite)

**Context**: The design draft shows a polished step timeline, but several elements such as status/duration/more menus are static examples and are not part of the real data model.

**Decision**: Adopt the draft timeline/card visual structure while preserving only real step data and real editor controls.

**Consequences**: The Steps UI should look closer to the draft without introducing non-functional controls or changing workflow behavior.
