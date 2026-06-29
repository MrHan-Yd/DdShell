# PRD: Fix SSH PTY Enter Key Handling

## Goal

After connecting through the terminal and entering an interactive database client
or shell command, pressing Enter must submit the command instead of rendering
`^M` in the terminal.

## Confirmed Facts

- The user reports that after connecting to a database, typing a command and
  pressing Enter does not execute it; the terminal displays `^M`.
- Terminal input is sent through the SSH PTY path.
- `app/src-tauri/src/core/ssh.rs` currently requests a PTY with `ICRNL` set to
  `0`, which prevents the remote terminal line discipline from mapping carriage
  return input to newline.
- xterm-style terminal Enter input commonly sends carriage return. With `ICRNL`
  disabled, interactive programs can receive/display the raw carriage return as
  `^M` instead of accepting the line.

## Requirements

- The remote PTY should preserve standard Enter behavior for interactive shells
  and database clients.
- Pressing Enter in an SSH terminal session should submit the current line.
- The fix should be backend-scoped unless inspection shows frontend input
  translation is also required.
- Existing output CRLF normalization and terminal rendering behavior should not
  be changed.

## Acceptance Criteria

- `ICRNL` is enabled, or omitted in favor of the remote default, when requesting
  an SSH PTY.
- Pressing Enter no longer displays `^M` as typed input in normal interactive
  sessions.
- The project passes the relevant Rust check for the Tauri backend.

## Out Of Scope

- Adding a dedicated database connection feature.
- Reworking xterm rendering, predictive echo, or terminal output normalization.
- Changing stored connection data or database schema.

## Open Questions

- None blocking. The reported symptom maps directly to the PTY input mode.
