# Official Updater Integration Design

## Architecture

Use Tauri's official updater as the primary update engine and keep the existing GitHub Releases flow as fallback.

Proposed layers:

- Tauri plugins:
  - `tauri-plugin-updater` for update check/download/install/signature validation.
  - `tauri-plugin-process` for controlled relaunch after user confirmation.
- Frontend plugin wrappers:
  - `@tauri-apps/plugin-updater`
  - `@tauri-apps/plugin-process`
- Frontend update state:
  - A shared update module/store owns all update state and commands.
  - `StatusBar` and `SettingsPage` consume the same state.
- Fallback:
  - Existing `open_browser` can still open GitHub Releases.
  - Existing custom `check_update/download_update/open_installer` can either remain temporarily unused or be removed after the official path is validated.
- Release pipeline:
  - Existing tag-triggered workflow remains.
  - Add updater signing environment variables.
  - Publish official updater metadata/artifacts in addition to normal installers.

## State Machine

Recommended update states:

```text
idle
checking
upToDate
available
downloading
installing
readyToRestart
restarting
checkFailed
downloadFailed
installFailed
unsupported
```

Tracked data:

- current version
- latest version
- release notes/body when available
- downloaded bytes
- total bytes
- progress percentage when total is known
- last progress timestamp
- error code/message
- fallback URL

## UX Contract

- Status bar:
  - Idle: show current version, clickable to check.
  - Checking: spinner + "Checking...".
  - Available: latest version + "Download and install".
  - Downloading: progress text or spinner when total is unknown.
  - Installing: "Installing update...".
  - Ready to restart: "Update ready" + restart action.
  - Failure: compact error + retry/fallback affordance.
- Settings > About:
  - Shows a fuller update panel/action area using the same state.
  - Supports check, download/install, restart, later, and fallback.
- Restart:
  - Never automatic.
  - Ask explicitly before relaunch.
  - Prefer warning if active SSH sessions or SFTP transfers exist.

## Network And Responsiveness

The updater flow must be async and must not run long work on the React rendering path.

Weak-network handling:

- Display progress callbacks from the updater plugin.
- Track no-progress duration in frontend state.
- If there is no progress for a threshold, show "network seems slow" and keep retry/fallback options available.
- If the official API supports cancellation cleanly, expose "cancel"; otherwise scope the first slice to retry/fallback after failure.

## Release Flow

Current release flow remains:

```text
bump version -> commit -> tag -> push -> GitHub Actions release
```

New release responsibilities:

- Generate/store updater signing key once.
- Put private updater signing key in GitHub Actions secrets.
- Put public key in `tauri.conf.json`.
- Add updater endpoint configuration to `tauri.conf.json`.
- Build with updater signing enabled.
- Upload normal installers and updater-required metadata/signature files.
- Ensure manifest/endpoint points at final asset URLs.
- Verify app can discover the new version and reach ready-to-restart state.

## Compatibility And Migration

- Keep current manual release assets so existing users can still download manually.
- Current in-app custom updater can be retained during rollout as fallback, then removed in a later cleanup.
- Existing i18n update keys can be extended instead of replaced wholesale.

## Risks

- Tauri updater artifact/manifest expectations are strict; CI must produce exactly what configured clients expect.
- Asset renaming can break updater metadata if the manifest points to pre-rename files.
- macOS notarization/signing and updater signing are separate concerns and both must be configured correctly for a polished macOS experience.
- Without a real previous-version build, local verification cannot fully prove the update path.
