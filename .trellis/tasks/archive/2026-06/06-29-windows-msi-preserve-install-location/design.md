# Design: Runtime MSI Install Directory Preservation

## Approach

Use two layers:

1. The new MSI package tries to recover an older related product's
   `InstallLocation` before MSI directory costing.
2. New app versions also configure the Tauri updater plugin at runtime, passing
   the current executable directory directly to future MSI updates.

This covers both first-time upgrades from older builds and future upgrades
after this fix is installed.

Runtime updater behavior on Windows only:

1. Check `tauri::utils::platform::bundle_type()`.
2. If it is `BundleType::Msi`, resolve `std::env::current_exe().parent()`.
3. Add MSI public properties to the updater builder:
   - `APPLICATIONFOLDER="<current install dir>"`
   - `INSTALLDIR="<current install dir>"`
4. Build the updater plugin with those args.

Tauri updater appends these extra args to `msiexec /i <msi> ...`, so the MSI
installer receives an explicit target directory during official in-app updates.

WiX package behavior:

- `wix-preserve-install-dir.wxs` is included through `fragmentPaths`.
- It runs an immediate VBScript custom action before `CostFinalize` in UI and
  execute sequences.
- The action uses `WindowsInstaller.Installer.RelatedProducts(UpgradeCode)`,
  `ProductInfo(productCode, "InstallLocation")`, and uninstall registry
  `InstallLocation` / `DisplayIcon` fallback paths.
- If an install location is found and no command-line `APPLICATIONFOLDER` was
  supplied, it sets both `APPLICATIONFOLDER` and `INSTALLDIR`.
- The package sets `ARPINSTALLLOCATION` from `APPLICATIONFOLDER` before
  `RegisterProduct` so future MSI upgrades have a direct `InstallLocation`.

## Why Runtime Args

For future updates, the app process already knows the exact directory it is
running from. That is more reliable than asking WiX to discover a previous
install directory from registry state.

For the first upgrade from older builds, the old app process cannot pass new
runtime installer args. The new MSI package therefore also performs its own
related-product lookup.

`upgradeCode` remains required for product identity, but it is not sufficient
by itself to guarantee install path reuse.

## Compatibility

- MSI: receives explicit install-directory properties.
- MSI first upgrade: new package tries to inherit the old install directory
  before costing even when the old updater did not pass installer args.
- NSIS: receives no MSI-specific properties; NSIS continues to use its own
  `/UPDATE` path and Tauri's previous install location restoration.
- Non-Windows: no behavior change.
- Non-bundled dev builds: `bundle_type()` is absent, so no extra args are set.

## Risk

The exact WiX directory property used by Tauri's default template is expected
to be `APPLICATIONFOLDER`; `INSTALLDIR` is included as a compatibility alias.
Unknown MSI public properties are ignored, while the correct one controls the
install directory.

Manual MSI double-click installs are still outside the official updater path.
Release verification must smoke-test the official in-app update path.
