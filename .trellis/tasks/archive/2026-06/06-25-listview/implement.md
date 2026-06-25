# Implementation Plan

## Checklist

1. Load frontend Trellis specs before editing.
2. Add `commandAssist.mode` to Settings draft state, load/save snapshot, and dirty detection.
3. Add settings UI control in Command Assist trigger section:
   - `//` trigger
   - ListView
4. Add i18n strings for the new mode labels/descriptions.
5. Read `commandAssist.mode` in `TerminalPage` and keep it updated on `terminal:settings-changed`.
6. Add ListView trigger logic from `cmdBufferRef`:
   - slash mode keeps current behavior
   - listview mode automatically uses current command buffer
7. Implement ListView whole-line replacement on candidate acceptance.
8. Ensure Enter/Ctrl+C/Esc/empty buffer close the assistant cleanly.
9. Validate with lint/type-check.

## Validation

- `pnpm --dir app build`

`app/package.json` does not define separate lint/typecheck scripts; `build` runs `tsc && vite build`.

## Risk Points

- Terminal input handling is hot-path code; keep changes scoped and avoid rerender-heavy state.
- Replacement sends backspaces to the remote shell; it relies on the existing local buffer staying accurate.
- Avoid changing slash mode behavior while adding ListView.
