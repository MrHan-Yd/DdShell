# Implementation Plan

1. Add helper functions in `app/src-tauri/src/lib.rs`
   - Build quoted MSI property args from a `Path`.
   - Keep helper platform-independent enough for unit tests.

2. Configure updater builder
   - Create updater builder before `tauri::Builder::default()`.
   - On Windows MSI bundle type, add generated install-directory args.
   - Keep NSIS and non-Windows unchanged.

3. Add WiX package fallback
   - Add `wix-preserve-install-dir.wxs`.
   - Include it through `bundle.windows.wix.fragmentPaths`.
   - Use related product `InstallLocation` and uninstall registry fallback to
     set `APPLICATIONFOLDER` and `INSTALLDIR` before `CostFinalize`.
   - Set `ARPINSTALLLOCATION` before `RegisterProduct` for future MSI upgrades.

4. Tests
   - Assert generated properties include `APPLICATIONFOLDER` and `INSTALLDIR`.
   - Assert spaces are quoted.
   - Assert non-root trailing slash is removed before quoting.

5. Docs/spec
   - Update updater contract to state MSI path preservation is enforced through
     both the WiX first-upgrade fallback and runtime installer args from
     `current_exe().parent()`.

6. Validation
   - `pnpm -C app build`
   - `cargo check --manifest-path app/src-tauri/Cargo.toml`
   - `cargo test --manifest-path app/src-tauri/Cargo.toml msi_install`
   - `pnpm -C app tauri build --no-bundle`
