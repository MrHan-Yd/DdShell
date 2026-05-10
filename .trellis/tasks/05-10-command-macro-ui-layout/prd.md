# Update Command Macro Page UI Layout

## Goal

Align the real command macro page with the existing UI design draft while preserving the current feature implementation and behavior.

## What I Already Know

* The user wants the command macro page updated after settings work is complete.
* Scope is style and layout only.
* Existing functionality must not be broken.
* The real app route uses `WorkflowsPage` for the `macros` page.
* The relevant React files are under `app/src/features/workflows/`.
* The UI design draft exists at `ui/workflows.html` with page-specific CSS at `ui/styles/pages/workflows.css`.
* Current functionality includes loading recipes/groups, selecting recipes, creating, editing, deleting, batch delete, group management, moving recipes between groups, search, drag/drop grouping, step editing, parameter editing, validation, and save/cancel flows.

## Requirements

* Update only the command macro page presentation: layout, spacing, visual hierarchy, cards, detail panel, editor/list styling, and responsive behavior.
* Apply the design draft as broadly as possible across list, detail, create, and edit states where the design maps to existing real functionality.
* Preserve all existing state transitions and callbacks in `WorkflowsPage`.
* Preserve all existing macro list interactions: search, selection, create, edit, delete, batch delete, group create/rename/delete, moving recipes between groups, drag/drop interactions, and retry on load failure.
* Preserve all existing detail and editor interactions: edit/delete actions, draft editing, validation, save/cancel, step ordering, step add/remove/copy, parameter add/remove, spotlight/side layer behavior, and dirty-state handling.
* Use the design draft as the visual source of truth where it maps to implemented features.
* Do not add new product features from the static design draft unless an equivalent behavior already exists in the real page.
* Keep copy/i18n behavior consistent with existing translation keys unless a visual-only label is already represented in the app.
* Support desktop and narrower window layouts without content becoming unusable.

## Acceptance Criteria

* [ ] The macros page visually follows the `ui/workflows.html` layout as far as current functionality allows: structured page header, left macro list, right detail/editor area, card-based list items, and timeline-like step presentation where applicable.
* [ ] Creating a macro still opens the editor, validates input, saves successfully, selects the new macro, and returns to view mode.
* [ ] Editing a macro still loads existing data, preserves dirty-state behavior, saves updates, and cancels without unintended changes.
* [ ] Deleting and batch deleting macros still invoke confirmation/handlers and update selection/mode correctly.
* [ ] Group management and moving macros between groups continue to work.
* [ ] Search and selected macro highlighting continue to work.
* [ ] Step and parameter editing flows continue to work, including drag/drop step ordering.
* [ ] Empty, loading, and error states remain accessible and visually coherent.
* [ ] The page remains usable on desktop and narrower widths.
* [ ] Project lint/type-check pass.

## Definition of Done

* Code changes are limited to the macros/workflows UI layer unless a shared style primitive must be reused.
* No backend or store behavior is changed.
* Existing functional callbacks and data flow remain intact.
* Lint/type-check pass.
* Any discovered reusable UI convention is considered for spec update.

## Out of Scope

* Adding run history, duplicate workflow, run-on-target, scheduling, tags, status badges, or other static-design-only features not currently implemented.
* Changing persistence, store APIs, backend commands, recipe schema, or macro execution behavior.
* Renaming the feature internally from workflows to macros.
* Redesigning global navigation, titlebar, settings, terminal, SFTP, monitor, or snippets pages.

## Technical Approach

* Treat `ui/workflows.html` and `ui/styles/pages/workflows.css` as visual references, not feature requirements.
* Implement the design through React/Tailwind-style class updates and small markup adjustments in existing workflow components.
* Prefer preserving component boundaries: `WorkflowsPage`, `WorkflowList`, `WorkflowDetail`, and `WorkflowEditor`.
* Avoid changing stores, types, persistence, or handler signatures.
* Verify by running the app's relevant lint/type-check commands and reviewing the modified page behavior.

## Technical Notes

* Real page entry: `app/src/App.tsx` renders `WorkflowsPage` when `currentPage === "macros"`.
* Real page container: `app/src/features/workflows/WorkflowsPage.tsx`.
* Real list component: `app/src/features/workflows/components/WorkflowList.tsx`.
* Real detail component: `app/src/features/workflows/components/WorkflowDetail.tsx`.
* Real editor component: `app/src/features/workflows/components/WorkflowEditor.tsx`.
* Design draft: `ui/workflows.html`.
* Design draft CSS: `ui/styles/pages/workflows.css`.
* Current i18n keys use `workflows.*` for the command macro management page and `macro.*` for terminal macro execution controls.

## Decision (ADR-lite)

**Context**: The static design draft includes more UI affordances than the real command macro implementation currently supports.

**Decision**: Apply the design draft broadly across list, detail, create, and edit states, but only where it maps to existing real behavior.

**Consequences**: The page should look closer to the draft without introducing unimplemented features or changing macro behavior. Some static draft elements may remain intentionally absent.

## Open Questions

* None.
