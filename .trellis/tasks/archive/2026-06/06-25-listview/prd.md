# Command Assist PowerShell-Style ListView Mode

## Goal

Add an optional Command Assist usage mode inspired by PowerShell/PSReadLine `PredictionViewStyle ListView`: settings let the user choose between Quick Invoke and Live Suggestions modes.

## User Value

Users can use Command Assist in a more native terminal-editing style: keep typing normally, see multiple matching suggestions in a list, navigate them with the keyboard, and accept one when useful. On slow SSH links, the suggestion list can update from the local command buffer immediately, even when remote echo is delayed.

## Confirmed Facts

- The current `//` trigger is the existing Command Assist usage mode.
- Current Command Assist search is already frontend-memory synchronous via `useCommandAssistStore.search`; it does not perform network or IPC per keystroke.
- Current terminal input path still sends typed characters to the remote session immediately via `api.sessionWrite`.
- Current `//` selection replaces `//query` by sending remote backspaces and then the selected command, so that specific replacement behavior is latency-sensitive.
- Settings already contain a Command Assist tab with enable/confirm-key/position/category controls.
- Settings already contain `terminal.predictiveEcho.enabled`, which reduces ordinary shell typing lag by locally predicting remote echo.
- The proposed ListView mode should complement Predictive Echo, not replace it: ListView can make suggestion lookup/navigation local and responsive, while Predictive Echo still covers ordinary terminal text echo.

## Requirements Draft

- Add a persisted setting for Command Assist usage style with two mutually exclusive options: Quick Invoke and Live Suggestions.
- Default should preserve existing `//` popup behavior unless the user selects ListView mode.
- In `//` trigger mode, behavior remains unchanged.
- In ListView mode, Command Assist appears automatically while the user composes commands, without requiring the `//` prefix.
- In ListView mode, `//` is not required as the primary invocation method; whether literal `//` should still trigger legacy behavior is out of scope unless explicitly selected by the setting.
- Suggestion matching, list updates, keyboard navigation, and selection in ListView mode should use the local command buffer and not wait for remote echo.
- Selecting a candidate should replace the current command buffer with the selected command and should not automatically execute it.
- Existing Command Assist enablement, confirm key, positioning, categories, and weighting should continue to work where applicable.

## Acceptance Criteria Draft

- Settings exposes a Command Assist usage style control with two choices: Quick Invoke and Live Suggestions.
- With existing mode selected, behavior remains unchanged.
- With ListView mode selected, suggestions can appear from the current command buffer without requiring the `//` prefix.
- ListView updates from local input state and remains responsive on high-latency sessions.
- Switching back to `//` mode restores the current invocation behavior.
- Candidate navigation and confirmation work with keyboard and mouse.
- Accepting a ListView candidate erases the current command buffer, writes the selected command, and leaves it ready for user review/editing without sending Enter.
- Selection updates command weight and closes the assistant.
- Settings save/load and `terminal:settings-changed` update open terminals.

## Out of Scope Draft

- Replacing Predictive Echo.
- Full local shell line editing for all terminal input.
- Supporting both `//` and automatic ListView simultaneously in one combined mode.
- Changing the `//` trigger string.
- Changing command candidate indexing or ranking beyond what the mode needs.

## Product Decisions

- Settings choose one Command Assist usage style at a time: Quick Invoke or Live Suggestions.
- ListView mode appears automatically while typing, rather than requiring explicit invocation.
- ListView candidate acceptance uses whole-line replacement and does not auto-execute.
- ListView visibility is suppressed for empty buffers, URL-like buffers containing `://`, UNC-like buffers containing `\\`, IME composition, and buffers with no matching candidates.

## Open Question

- None.
