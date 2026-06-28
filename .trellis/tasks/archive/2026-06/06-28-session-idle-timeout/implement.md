# Implementation Plan

1. Update `app/src-tauri/src/core/ssh.rs`
   - Add `ManagedSession`.
   - Store session metadata in `SessionManager`.
   - Add activity touch/elapsed helpers.
   - Keep existing `get`, `is_connected`, `disconnect`, `ping_session` behavior compatible.

2. Update `app/src-tauri/src/lib.rs`
   - Start idle watchdog after successful `session_connect`.
   - Touch activity on user/application active session commands.
   - Ensure watchdog emits `disconnected` on automatic timeout.

3. Add backend tests for session idle metadata where practical.

4. Validate
   - `cargo check --manifest-path app/src-tauri/Cargo.toml`
   - `cargo test --manifest-path app/src-tauri/Cargo.toml`
   - `pnpm -C app build`
   - `git diff --check`
