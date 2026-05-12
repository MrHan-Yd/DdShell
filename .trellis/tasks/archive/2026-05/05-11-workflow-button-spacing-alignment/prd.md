# Align Workflow Page Details With Design Draft

## Goal

Make the real command macro/workflows page detail presentation match the `ui/workflows.html` design draft more closely without changing global primitives or disrupting the page areas that already look close.

## Requirements

* Scope the fix to the workflows/command macro page only.
* Do not modify `app/src/components/ui/Button.tsx`.
* Do not globally change shared button sizing, variants, radius, or typography.
* Align the page header action area with the design draft:
  * preserve the existing right-aligned action group spacing.
  * keep the primary action visually prominent with the existing workflow-local draft parity styles.
  * avoid making the button itself globally smaller or larger.
  * keep the create button outer size stable while reducing the label's visual size/line-height so text does not touch the button's inner edges.
* Align the workflow detail header action area with the design draft hierarchy:
  * ghost/secondary actions should remain visually quieter than the primary action.
  * add or restyle only actions backed by existing real behavior.
  * do not add static-design-only behavior such as real duplicate/run-host execution if handlers do not exist.
* Fix perceived button/container spacing by adjusting workflow-local layout/padding/gaps, not by rewriting the global button primitive.
* Align the workflow detail parameter/inputs display with the design draft:
  * use the draft Inputs section as the visual source of truth for row shape, spacing, typography, and metadata alignment.
  * keep the real parameter data contract unchanged.
  * do not add draft-only parameter fields or controls unless the real data already exists.
* Preserve all existing macro behavior: selection, create, edit, delete, validation, step editing, and save/cancel flows.

## Acceptance Criteria

* [ ] The command macro page header action group visually matches the spacing and prominence seen in `ui/workflows.html` more closely.
* [ ] The workflow detail header action group has the same visual hierarchy as the draft as far as current real actions allow.
* [ ] The workflow detail parameter display visually follows the draft Inputs section while preserving real parameter values.
* [ ] No changes are made to `app/src/components/ui/Button.tsx`.
* [ ] No static-design-only product behavior is added.
* [ ] Existing workflow interactions remain unchanged.
* [ ] Project build/type-check passes.

## Definition of Done

* Changes are limited to workflow page components/styles and Trellis task files.
* No backend, store, recipe schema, or command execution behavior changes.
* Build/type-check passes.
* User can visually review the page before any commit is made.

## Out of Scope

* Global Button redesign.
* Full page redesign.
* Adding Duplicate, Run history, Run on host, recent runs, tags, status fields, or other draft-only features without existing handlers/state.
* Changing default app theme.

## Technical Approach

* Treat `ui/workflows.html` as the visual reference for action group placement and hierarchy.
* Treat existing workflow code as the behavior source of truth.
* Prefer small workflow-local CSS/markup changes over global component changes.
* Keep existing design-parity CSS that already made the page close; only adjust the action areas that are visibly off.

## Technical Notes

* Design screenshot: `ScreenShot_2026-05-11_225242_961.png` at repo root.
* Design draft: `ui/workflows.html`, `ui/styles/pages/workflows.css`, `ui/styles/components.css`.
* Real page: `app/src/features/workflows/WorkflowsPage.tsx`.
* Real detail header: `app/src/features/workflows/components/WorkflowDetail.tsx`.
* Real workflow styles: `app/src/styles.css`.
