# Default Command Assist Mode to Live Suggestions

## Goal

Make Command Assist default to Live Suggestions for users who do not already have a saved `commandAssist.mode`.

## Confirmed Facts

- The setting key is `commandAssist.mode`.
- Valid values are `slash` and `listview`.
- UI labels are Quick Invoke for `slash` and Live Suggestions for `listview`.
- `SettingsPage` currently initializes the draft mode to `slash`.
- `TerminalPage` currently falls back to `slash` unless the saved value is exactly `listview`.

## Requirements

- New or missing settings should default to `listview`.
- Existing saved `commandAssist.mode` values must be respected.
- `slash` remains selectable from Settings.
- No setting migration should overwrite an existing user choice.

## Acceptance Criteria

- Settings shows Live Suggestions selected when `commandAssist.mode` is missing.
- Terminal behavior uses Live Suggestions when `commandAssist.mode` is missing.
- If `commandAssist.mode` is saved as `slash`, Quick Invoke remains active.
- `pnpm --dir app build` passes.

## Out of Scope

- Renaming modes.
- Changing Command Assist trigger behavior.
- Changing saved settings storage format.
