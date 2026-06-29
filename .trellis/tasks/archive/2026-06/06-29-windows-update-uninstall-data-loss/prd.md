# PRD: Windows Update Uninstall/Data Loss Analysis

## Goal

Fix the Windows update flow so installing a new version does not show an
uninstall-first prompt, does not delete existing SSH/server/config data, and
does not silently reset the install location to the default C drive path.

## User-Reported Problem

- On Windows, downloading and installing a new version first opens an uninstall
  flow, then installs the new version.
- After reinstalling, previously used server records and configuration are gone.
- The new installation defaults to the C drive instead of inheriting the old
  installation location.

## Confirmed Facts

- The frontend uses Tauri official updater through
  `@tauri-apps/plugin-updater` `check()` and `downloadAndInstall()`.
- The release workflow uploads both Windows `.msi` and NSIS `.exe` installers.
- The generated `latest.json` only contains `windows-x86_64-nsis` and
  `windows-x86_64`, both pointing to the NSIS `.exe`.
- There is no `windows-x86_64-msi` manifest entry.
- Tauri updater resolves Windows updater targets as
  `{os}-{arch}-{installer}` first, then `{os}-{arch}`.
- Tauri updater source supports NSIS `.exe`, NSIS `.exe.zip`, and MSI payloads,
  and passes `/UPDATE` plus passive/quiet install args for NSIS.
- Current non-macOS data storage uses the executable directory:
  `current_exe().parent().join("shell.db")`.
- This install-directory database location is intentional for this product.
- Therefore the updater/installer must treat the installation directory as
  containing user data, not only application binaries. Any uninstall/reinstall
  or install-location change can remove or hide the existing `shell.db`.
- Previous archived updater design notes said Windows official updater should
  not point to the ordinary `.exe`; later specs/docs changed to ordinary `.exe`.

## Requirements

- Windows in-app update must preserve existing data.
- Windows in-app update must not switch installer families via fallback.
  MSI installations must receive MSI update payloads, and NSIS installations
  must receive NSIS update payloads.
- Windows in-app update should inherit the existing install location when using
  the same installer family.
- Existing Windows users with data in the installation directory need a
  preservation path that keeps `shell.db` in that directory.
- Manual GitHub Releases installers should not be the primary in-app update path.
- Windows in-app updates should run with no interactive uninstall/install wizard
  unless an error requires fallback to a browser/manual installer.

## Acceptance Criteria

- `latest.json` contains a correct `windows-x86_64-msi` entry when MSI artifacts
  are released and signed.
- `windows-x86_64` fallback no longer masks installer-family mismatches in a way
  that sends MSI users to NSIS by accident.
- Windows updater/installer never deletes runtime data files in the install
  directory, including `shell.db`.
- Windows update installs into the existing install directory instead of
  defaulting back to a C drive location.
- Release verification includes updating from an older Windows install with
  existing server records and confirming data and install location survive.

## Out Of Scope

- Changing macOS updater behavior.
- Full Linux updater support.
- Windows code-signing certificate setup beyond current updater signing.

## Open Questions

- Resolved: keep both MSI and NSIS for Windows releases, but make the in-app
  updater installer-family specific and fail safe when the matching updater
  payload is missing.
