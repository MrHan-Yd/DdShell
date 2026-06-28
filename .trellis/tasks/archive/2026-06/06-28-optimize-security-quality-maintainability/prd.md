# PRD: Optimize Security, Quality Gate, Bundle Size, and Maintainability

## Goal

Reduce obvious security and engineering-quality risks found during the repository review without breaking existing SSH, SFTP, updater, quick edit, settings, or terminal workflows.

## Confirmed Facts

- The app is a Tauri 2 + React + TypeScript + Rust desktop SSH/SFTP client under `app/`.
- `pnpm -C app build` passes, but the main JS bundle is large: about 2.1 MB minified / 628 KB gzip.
- `cargo check` passes.
- `cargo test` passes with 32 Rust tests.
- `pnpm -C app test:predictive-echo` passes only when network access can fetch `tsx` through `npx`; it fails in restricted/offline environments because `tsx` is not pinned in project dev dependencies.
- Tauri security currently has `csp: null` and asset protocol scope `allow: ["**"]`.
- Credential encryption currently derives a local key from username + hostname + static salt and uses a non-cryptographic nonce source.
- Several core files are large enough to create maintenance risk:
  - `app/src/styles.css`
  - `app/src-tauri/src/lib.rs`
  - `app/src/features/terminal/TerminalPage.tsx`
  - `app/src/features/settings/SettingsPage.tsx`
  - `app/src/features/sftp/SftpPage.tsx`

## Requirements

1. Keep all existing user-facing workflows functional.
2. Stabilize the predictive echo test runner so it does not depend on runtime network downloads.
3. Reduce Tauri security exposure where it can be done without blocking current app features.
4. Avoid full credential storage migration in this pass; apply only low-risk cryptographic hygiene that remains backward compatible with existing stored secrets.
5. Reduce front-end bundle pressure with low-risk code splitting or import cleanup.
6. Improve maintainability through scoped extraction or documented follow-up boundaries; avoid broad rewrites that mix behavior changes with refactors.

## Acceptance Criteria

- `pnpm -C app build` passes.
- `cargo check` passes.
- `cargo test` passes.
- `pnpm -C app test:predictive-echo` passes without needing `npx` to download missing tooling.
- Existing updater, settings, terminal, SFTP, quick edit, and connection management compile against the same public Tauri command names unless an explicitly planned migration is documented.
- Any security tightening that cannot be fully applied safely is documented with the reason and a concrete follow-up.
- Worktree contains only intentional changes for this task.

## Out of Scope

- Redesigning product UX.
- Replacing the SSH/SFTP backend.
- Rewriting all large pages or all CSS in one pass.
- Changing release version numbers unless required by the implementation.

## Open Question

- Resolved: first implementation pass prioritizes low-risk compatibility fixes. Deeper keychain migration and strict CSP hardening remain follow-up work unless a narrow, verified change is safe in this pass.
