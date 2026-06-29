# Implementation Plan

1. Inspect updater and bundler contracts
   - Confirm Tauri updater Windows config keys and accepted values.
   - Confirm release workflow has access to MSI/NSIS artifacts and signatures.

2. Tauri updater config
   - Add Windows updater `installMode: "quiet"` in `tauri.conf.json`.
   - Keep user-facing restart confirmation in React; only suppress native
     installer wizard UI.

3. Release workflow
   - Copy/upload MSI signature in addition to MSI and NSIS signature.
   - Generate `latest.json` with both `windows-x86_64-nsis` and
     `windows-x86_64-msi`.
   - Remove or neutralize the broad `windows-x86_64` fallback when both
     installer families are shipped, so missing installer-specific keys fail
     safe instead of crossing families.

4. Installer data preservation
   - Add an NSIS hook file that preserves install-directory runtime data such as
     `shell.db` during uninstall/update.
   - Wire the hook through `bundle.windows.nsis.installerHooks`.
   - Pin WiX `upgradeCode` so MSI upgrades preserve product identity across
     future metadata changes.
   - Preserve the current Windows data model: database remains in the
     exe/install directory.

5. Specs/docs
   - Correct updater specs that currently claim Windows updater should point only
     to NSIS `.exe`.
   - Record installer-family-specific manifest and install-directory data
     preservation as the executable contract.

6. Validation
   - `pnpm -C app build`
   - `cargo check --manifest-path app/src-tauri/Cargo.toml`
   - YAML parse/syntax check for release workflow.
   - Manual Windows smoke remains required before release: non-C install path,
     existing `shell.db`, in-app update, verify no data loss and no path reset.
