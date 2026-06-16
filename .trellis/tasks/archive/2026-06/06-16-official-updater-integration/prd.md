# Official Updater Integration PRD

## Goal

Replace the current GitHub-release-only update path with Tauri's official updater as the primary in-app update mechanism, while keeping the existing GitHub Releases download flow as a fallback.

The user value is a safer and smoother update flow: check updates in-app, download without blocking the UI, verify the updater signature, install through the supported updater path, and restart only after explicit user confirmation.

## Confirmed Facts

- Current status bar update entry lives in `app/src/components/StatusBar.tsx`.
- Current Settings > About update entry lives in `app/src/features/settings/SettingsPage.tsx`.
- Both entries call the custom `check_update` Tauri command through `app/src/lib/tauri.ts`.
- Current backend update commands live in `app/src-tauri/src/lib.rs`:
  - `check_update`: reads GitHub Releases latest redirect, compares versions, optionally fetches release assets.
  - `download_update`: downloads a selected release asset into the user's Downloads directory.
  - `open_installer`: opens the downloaded installer on macOS/Windows.
- Current download is async and should not block the app UI, but it has no visible progress, no cancel path, and no no-progress timeout handling.
- Current release workflow builds and uploads normal platform installers through `.github/workflows/release.yml`.
- Current release documentation describes tag-triggered GitHub Actions publishing in `docs/发布/发布文档.md`.
- Current docs already require update install/restart readiness and signature/checksum failure handling in `docs/shell/05-RELEASE/FIRST-RUN-CHECKLIST.md`.

## Recommended Scope

- Make the official Tauri updater the primary update path for macOS and Windows.
- Keep the existing GitHub Releases page/manual installer path as fallback for unsupported platforms, missing updater artifacts, and updater failures.
- Do not silently restart the application. Always show a clear restart confirmation after update installation.
- Unify right-bottom status bar and Settings > About behavior behind one frontend update state model.
- Update GitHub Actions and release docs so daily release steps remain mostly unchanged: bump versions, commit, tag, push, wait for CI.

## Functional Requirements

- Users can check for updates from the right-bottom status bar.
- Users can check for updates from Settings > About.
- Both entries report the same update state and do not run competing checks/downloads.
- When a new version is available, users can start an in-app download/install flow.
- Download/install progress is visible enough that weak networks do not look like a frozen app.
- Failed checks, failed downloads, failed signature verification, and failed installs show actionable fallback messaging.
- After update installation completes, users see a "restart now" and "later" choice.
- Restart must not happen automatically.
- Existing manual GitHub Releases fallback remains available.
- Release output includes official updater-compatible signed update artifacts or a valid updater manifest endpoint.
- Release verification includes an actual updater smoke test where feasible.

## Non-Functional Requirements

- The UI must remain responsive during checking, downloading, and installing.
- Update logic should be centralized to avoid separate status bar and settings behavior drifting again.
- Release secrets must not be committed to the repository.
- Updater signing private key must live only in CI secrets or local developer secret storage.
- Keep the current ordinary installer release assets available for users who do not use in-app updates.

## Out Of Scope

- Fully silent background auto-update without user action.
- Automatic restart without user confirmation.
- Linux official updater support in the first slice unless the official plugin path is straightforward with existing Linux artifacts.
- Replacing the entire release workflow with a different release tool.
- Windows code-signing certificate setup, unless required separately from updater signing.

## Acceptance Criteria

- Status bar and Settings > About both use the new unified updater path.
- No-update, update-available, download/install progress, ready-to-restart, and failure states are represented.
- Restart requires explicit user action.
- Weak network / stalled download has a visible state and does not freeze the app.
- Fallback to GitHub Releases remains reachable from update failure states.
- `pnpm build` passes.
- Rust/Tauri build or check command passes as far as local dependencies allow.
- Release docs describe updater signing secrets, expected artifacts, manifest/endpoint, and verification checklist.
- GitHub Actions contains the updater signing inputs and uploads/generates the updater metadata needed by the app.

## Product Decision

- First implementation supports official updater on macOS + Windows.
- Linux keeps the GitHub Releases fallback.
