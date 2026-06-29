# Design: Windows Update Data Preservation

## Root Cause

Two behaviors combine into the data-loss bug:

1. Windows update/install can run through a normal installer path that performs
   uninstall/reinstall or switches install location.
2. On Windows, `shell.db` is intentionally stored next to the executable. That
   makes the installation directory part of the user's data boundary. If the
   install directory is removed, or if the app starts from a new install
   directory, the app opens an empty database.

The release workflow increases the risk because it publishes both MSI and NSIS
but the updater manifest only points Windows fallback entries at NSIS. A current
MSI installation can fall back to an NSIS payload instead of receiving an MSI
payload, so the installer family and registry metadata may not match.

## Recommended Solution

### 1. Preserve Install-Directory Data

Keep Windows data in the install directory, but make the installer/updater treat
runtime files as user data.

Required behavior:
- Updates must install over the existing installation directory.
- Uninstall/update steps must not delete runtime data such as `shell.db`.
- If a normal installer detects an existing installation, it must reuse the
  recorded install path rather than defaulting to a new C drive path.

Implementation options:
- Prefer the official updater path, because Tauri passes `/UPDATE` to NSIS and
  is designed for in-place updates.
- Add NSIS installer hooks to skip deleting known runtime data files during
  uninstall/update.
- If MSI remains supported, ensure the MSI upgrade path preserves the install
  directory and does not remove unknown runtime files.

### 2. Windows Updater Manifest Must Match Installer Family

Generate and upload signed updater artifacts for both Windows installer types
that are shipped:

- `windows-x86_64-nsis` -> signed NSIS updater payload.
- `windows-x86_64-msi` -> signed MSI updater payload.

Avoid using a broad `windows-x86_64` fallback that points to NSIS when MSI is
also shipped, because it can hide a missing MSI-specific manifest entry.

The intended runtime behavior is:
- an app launched from an NSIS install resolves `windows-x86_64-nsis`;
- an app launched from an MSI install resolves `windows-x86_64-msi`;
- if the matching key is missing, the updater fails and the UI opens the
  Releases fallback instead of installing a different family.

### 3. Release Workflow Validation

The release workflow should fail if:

- Windows MSI is uploaded but `.msi.sig` is missing.
- `latest.json` lacks `windows-x86_64-msi`.
- `latest.json` has a fallback that can route MSI users to NSIS.
- the release manifest points a Windows updater key to a normal installer that
  has not been verified to preserve install-directory runtime data.

### 4. Updater Install Mode

Configure the Windows updater for `quiet` mode so official in-app updates do not
show an interactive uninstall/install wizard. User confirmation remains in the
app UI before download/install and before relaunch; the native installer itself
should not ask product questions during a verified update.

### 5. Manual Installer Safety

If the app still supports downloading/opening ordinary installers from inside
old versions, add NSIS installer preservation hooks or document that the safe
path is the official updater. Since Windows data intentionally lives in the
install directory, ordinary uninstall-first flows are unsafe unless the
installer explicitly preserves runtime files.

## Trade-offs

- Keeping Windows data in the install directory preserves the current product
  behavior, but it raises the bar for every installer/update path: they must
  preserve the install directory and never treat it as disposable.
- Moving Windows data to AppData would be safer for installed apps, but it would
  change the current install-directory data model. Treat it as a fallback option,
  not the recommended path for this task.
- Keeping both MSI and NSIS increases CI/release validation work. Removing one
  installer family simplifies updater safety, but may affect existing users.

## Validation Plan

- Build/type-check:
  - `pnpm -C app build`
  - `cargo check --manifest-path app/src-tauri/Cargo.toml`
- Unit tests:
  - data-directory behavior continues to resolve to the exe/install directory
    for Windows.
  - installer hook/config artifacts include runtime-data preservation rules.
- Release checks:
  - generated `latest.json` contains installer-specific Windows keys.
  - missing Windows updater signatures fail CI.
  - updater manifest does not route MSI installs to NSIS by fallback.
- Manual Windows smoke:
  - install old version to non-C drive.
  - create server records.
  - run in-app update.
  - confirm no uninstall-first prompt, install path remains the previous path,
    and server records remain.
