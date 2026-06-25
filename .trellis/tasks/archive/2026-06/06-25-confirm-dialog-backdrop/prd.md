# Confirm Dialog Backdrop

## Goal

Fix the confirm dialog backdrop so opening a confirmation does not visually cover or dim the page behind it.

## Confirmed Facts

- `ConfirmDialog` renders a full-screen `.confirm-dialog__backdrop` behind the dialog.
- The backdrop currently uses `background: var(--bg-overlay)` and backdrop blur/saturation.
- In Aurora theme this makes the underlying page look masked when the dialog opens.

## Requirements

- The confirm dialog must keep its current layout, copy, buttons, keyboard handling, and outside-click cancel behavior.
- The backdrop may continue to capture outside clicks, but it should not visibly dim, blur, or cover the page.
- The dialog itself should remain readable and theme-aligned through its own surface, border, and shadow.
- The change should be scoped to confirm dialog styling.

## Acceptance Criteria

- Opening a confirm dialog no longer makes the page behind it look masked.
- Clicking outside still cancels when the dialog is not in scanning mode.
- Aurora and Classic themes keep the existing confirm dialog card styling.
- `pnpm --dir app build` passes.

## Out of Scope

- Redesigning confirm dialog content.
- Changing confirm store behavior.
- Changing other modal or popover components.
