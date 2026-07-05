# Implementation Plan

1. Update terminal split state actions so split target can be chosen explicitly.
2. Add target resolution in `TerminalPage`:
   - auto-select the only other tab when exactly one candidate exists
   - open a compact picker when multiple candidates exist
   - reject split when no candidate exists
3. Wire horizontal/vertical split buttons and shortcuts through the same behavior.
4. Add minimal styling for the split target picker.
5. Run frontend build and diff checks.

## Validation

- `pnpm --dir app build`
- `git diff --check`
