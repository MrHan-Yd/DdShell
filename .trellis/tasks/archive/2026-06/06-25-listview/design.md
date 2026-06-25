# Design: Command Assist ListView Mode

## Architecture

This is a frontend-only feature over the existing Command Assist index:

- `SettingsPage` owns the draft setting and persists it through the existing settings API.
- `TerminalPage` reads the setting on mount and on `terminal:settings-changed`.
- `CommandAssist` renders the existing candidate list, with mode-dependent query source and copy.
- `useCommandAssistStore.search` remains the candidate source; no backend search changes are needed.

## Setting Contract

Add a persisted setting:

- key: `commandAssist.mode`
- values: `slash` or `listview`
- default: `slash`
- UI labels: Quick Invoke (`slash`) and Live Suggestions (`listview`)

`commandAssist.enabled` remains the master switch. If disabled, neither mode should show suggestions.

## Data Flow

### Slash Mode

Quick Invoke keeps `//` as the invocation marker while also updating suggestions from the local buffer:

1. User types `//query`.
2. `TerminalPage` sends the input to the remote shell normally.
3. `CommandAssist` searches with the local `query` before remote echo returns and shows the query in the panel header.
4. Selection erases `//query` and writes the selected command.

### ListView Mode

1. User types a command normally.
2. `TerminalPage` updates `cmdBufferRef` from local input, before remote echo returns.
3. When the local command buffer passes visibility rules, `CommandAssist` opens automatically.
4. `CommandAssist` searches with the current local command buffer.
5. Selection sends enough backspaces to erase the whole current command buffer, then writes the selected command.
6. Selection does not send Enter.

## Visibility Rules

Recommended initial rules:

- show when Command Assist is enabled and mode is `listview`
- show only for non-empty trimmed command buffers
- do not show for buffers containing `://`, to avoid URL noise
- do not show while IME composition is active
- close on Enter, Ctrl+C, Esc, empty buffer, or no candidates

These rules keep the feature simple while avoiding the most obvious noisy cases.

## High-Latency Behavior

ListView updates from `cmdBufferRef`, so the candidate list does not wait for server echo. Quick Invoke also searches from `cmdBufferRef`, so the suggestion list can update before server echo returns while the characters still flow into the terminal normally. Ordinary terminal text still depends on either remote echo or `PredictiveEcho`; Command Assist modes are not a replacement for `terminal.predictiveEcho.enabled`.

## Replacement Strategy

Use whole-line replacement:

- compute the current local command buffer length
- send `\x7f` repeated for that length
- after a short delay, write the selected command bytes
- update `cmdBufferRef` to the selected command locally

This mirrors the existing slash replacement pattern and avoids partial-completion ambiguity.

## Compatibility

- Existing slash mode must remain the default and behave exactly as before.
- Existing command category filtering and weight updates should continue to work.
- Existing confirm-key setting can still control candidate acceptance in both modes.
