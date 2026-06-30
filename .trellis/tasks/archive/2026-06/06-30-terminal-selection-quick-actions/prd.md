# Terminal Selection Quick Actions

## Goal

Add a FinalShell-like quick action popover for terminal text selections so users can copy selected text or copy and insert it at the current cursor without using keyboard shortcuts.

## Confirmed Facts

- The terminal UI is implemented in `app/src/features/terminal/TerminalPage.tsx` with `@xterm/xterm`.
- Terminal selection text is available through `term.getSelection()`.
- Clipboard helpers already exist in `app/src/lib/clipboard.ts`.
- Terminal input is sent through `api.sessionWrite(sessionId, bytes)` with the shared `TEXT_ENCODER`.
- Existing Alt+Enter behavior already inserts the current terminal selection via the `terminal:insert-selection` event.

## Requirements

- When a user selects non-empty text in an active terminal, show a compact icon-only floating action popover near the selection.
- The popover must contain two actions:
  - Copy: write the selected text to the system clipboard.
  - Copy and paste: write the selected text to the system clipboard, then send the selected text to the current terminal session at the cursor.
- The popover must stay scoped to the terminal instance where the selection occurred, including split panes.
- Hide the popover when selection becomes empty, the user clicks elsewhere, the terminal scrolls/resizes enough to invalidate position, the session changes, or an action completes.
- Existing terminal input, middle-click paste, command assist, quick edit, and Alt+Enter insert-selection behavior must continue to work.

## Acceptance Criteria

- Selecting visible terminal text displays a small icon-only two-option popover adjacent to the selection within the terminal surface.
- When the selection is near the top edge of the terminal, the popover displays below the selection instead of being clipped above it.
- Clicking Copy stores the selected text in the clipboard and does not write to the remote session.
- Clicking Copy and paste stores the selected text in the clipboard and inserts exactly that selected text into the current session.
- Empty/cleared selections do not show stale actions.
- In split terminal mode, the popover only acts on the pane whose text was selected.
- Type-check passes for the app.

## Out of Scope

- New settings for enabling/disabling the feature.
- Changing keyboard shortcuts.
- Rich selection preview, history, or command execution.
- Backend API changes.
