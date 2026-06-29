# PRD: Preserve Windows MSI Install Location During Updates

## Goal

Make Windows MSI in-app updates explicitly install back into the current
installation directory, including non-default user-selected locations.

## User Problem

The previous Windows updater fix separated NSIS and MSI updater payloads and
pinned the WiX `upgradeCode`, but review found that MSI updates still did not
explicitly pass the existing install directory to `msiexec`. That leaves a
risk that a user who originally installed to a non-C/default path can be
updated into a different location.

## Confirmed Facts

- Windows database/config data intentionally lives in the install directory.
- Official Tauri updater resolves Windows targets by installer family first:
  `windows-x86_64-msi` or `windows-x86_64-nsis`, then `{os}-{arch}` fallback.
- The release manifest now publishes installer-family-specific keys and blocks
  the broad `windows-x86_64` fallback.
- Tauri updater supports `Builder::installer_arg(s)` and passes those extra
  args to the native Windows installer.
- For MSI, Tauri updater invokes `msiexec /i <msi> <install mode args> ...`.
- The running app can resolve the current install directory from
  `current_exe().parent()`.
- First-time upgrades from versions that do not yet pass runtime installer
  args must be handled by the new MSI package itself.

## Requirements

- MSI official in-app update must pass the current executable directory to the
  MSI installer as explicit install-directory properties.
- The MSI package must also try to recover an existing related product's
  install directory before directory costing, using Windows Installer
  `InstallLocation` first and uninstall registry `InstallLocation` /
  `DisplayIcon` as fallback, so first-time upgrades from older builds do not
  depend only on old updater runtime args.
- The installer-directory override must only be added for MSI bundle type, not
  for NSIS installs.
- Paths with spaces must be quoted so `msiexec` receives the full directory.
- Existing Windows data location remains unchanged: the DB stays next to the
  executable.
- Release/spec docs must record that MSI path preservation is runtime-enforced,
  not only dependent on `upgradeCode`.

## Acceptance Criteria

- MSI updater builder includes install-location arguments derived from the
  current exe directory when `bundle_type() == Msi`.
- WiX config includes a fragment that sets MSI install-directory properties
  from the related installed product before `CostFinalize`, and writes
  `ARPINSTALLLOCATION` for future MSI upgrades.
- NSIS updater receives no MSI-specific install-location arguments.
- Unit tests cover MSI install-directory argument generation, including paths
  with spaces and trailing separators.
- `cargo check --manifest-path app/src-tauri/Cargo.toml` passes.
- `pnpm -C app build` passes.
- Manual Windows smoke before release: install MSI old version to a non-default
  path, create data, run in-app update, confirm install path and `shell.db`
  survive.

## Out Of Scope

- Moving Windows data out of the install directory.
- Replacing MSI or NSIS with a single installer family.
- Changing macOS/Linux updater behavior.

## Open Questions

- None. User explicitly requested implementation after review.
