# Official Updater Integration Implementation Plan

## Phase 0: Verify Official API Details

- Confirm exact Tauri v2 updater configuration keys and artifact/signature output names against installed package docs or official docs.
- Confirm required capability permissions for updater and process plugins.
- Confirm whether the updater endpoint can be GitHub Release static JSON in this repo's current workflow.

## Phase 1: Dependencies And Configuration

- Add frontend dependencies:
  - `@tauri-apps/plugin-updater`
  - `@tauri-apps/plugin-process`
- Add Rust dependencies:
  - `tauri-plugin-updater`
  - `tauri-plugin-process`
- Register plugins in `app/src-tauri/src/lib.rs`.
- Add required capability permissions under `app/src-tauri/capabilities/`.
- Add updater public key and endpoint configuration to `app/src-tauri/tauri.conf.json`.
- Keep existing `open_browser` fallback command.

## Phase 2: Unified Frontend Update Module

- Create a shared update state module/hook/store for:
  - current version
  - latest version
  - state
  - progress
  - error
  - actions: check, downloadAndInstall, restart, openFallback
- Use official updater APIs for check/download/install.
- Use process plugin for relaunch only after user confirmation.
- Include weak-network no-progress handling in state.

## Phase 3: UI Integration

- Replace `StatusBar` local update state with shared update state.
- Replace Settings > About toast-only check with the same shared update actions.
- Add i18n strings for:
  - download and install
  - installing
  - update ready
  - restart now
  - later
  - slow network/no progress
  - updater unavailable/fallback
- Ensure active sessions/transfers are considered before restart prompt.

## Phase 4: Release Pipeline

- Update `.github/workflows/release.yml` to pass updater signing secrets during build.
- Upload any updater-required signature/metadata files.
- Generate or publish updater manifest/endpoint after all assets are available.
- Keep existing installer assets and release notes table.
- Update `docs/发布/发布文档.md` with:
  - updater signing secrets
  - artifact list
  - manifest/endpoint
  - release verification checklist
- Update `docs/shell/05-RELEASE/RELEASE-PLAN.md` if needed.

## Phase 5: Validation

- Run `cd app && pnpm build`.
- Run Rust/Tauri check/build command appropriate for local environment.
- Verify no TypeScript errors.
- Verify existing custom fallback still opens GitHub Releases.
- If possible, smoke test by building an old version and checking against a draft/local updater manifest.

## Rollback Points

- If official updater API integration compiles but CI manifest generation is uncertain, keep official code behind fallback-ready UI and avoid removing custom updater commands.
- If updater signing blocks CI, revert only release workflow updater additions while keeping UI fallback path intact.
- If plugin capabilities break startup, revert plugin registration and capability entries first.

## Recommended First Slice

- macOS + Windows official updater support.
- Linux keeps GitHub Releases fallback.
- No automatic restart.
- No background auto-check until manual update flow is proven.

## Verification Notes

- Tauri updater target keys are resolved as `{os}-{arch}-{installer}` first, then `{os}-{arch}`.
- macOS updater artifacts are `.app.tar.gz` plus `.sig`.
- Windows official updater install expects a tauri-bundler generated installer zip, such as `*-setup.exe.zip` for NSIS, plus `.sig`; the manifest must not point to the ordinary `.exe` installer.
- The release workflow publishes both normal user installers and updater-only artifacts.
- Validation completed:
  - `cd app && pnpm build`
  - `cd app/src-tauri && cargo check`
  - `cd app && TAURI_SIGNING_PRIVATE_KEY=... TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... pnpm tauri build --debug --bundles app`
  - `git diff --check`
  - workflow YAML parse check
