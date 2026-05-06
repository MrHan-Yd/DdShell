# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

<!-- Standard error response format -->

(To be filled by the team)

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)

---

## Scenario: In-app updater asset targeting

### 1. Scope / Trigger
- Trigger: updater commands changed both build-time env wiring and frontend/backend response contracts.
- Applies when backend commands decide whether the UI should download a local installer/package or fall back to the GitHub releases page.

### 2. Signatures
- `check_update(current_version: String) -> Result<UpdateCheckResult, String>`
- `download_update(app: tauri::AppHandle, url: String, filename: String) -> Result<String, String>`
- `open_installer(path: String) -> Result<(), String>`
- `get_install_type() -> String`

### 3. Contracts
- Build env keys:
  - `DDSHELL_PACKAGE_TYPE` (preferred): one of `dmg`, `msi`, `exe`, `deb`, `appimage`
  - `TAURI_BUNDLE_TYPE` (fallback source at build time): normalized into the same set above
- `UpdateCheckResult` response fields:
  - `hasUpdate: bool`
  - `latestVersion: String`
  - `assets: ReleaseAssetInfo[]`
  - `targetAsset: ReleaseAssetInfo | null`
  - `shouldFallbackToBrowser: bool`
  - `error: String | null`
- `targetAsset` must only be set for platforms where the app can deterministically choose a local download target in the current MVP.
- `shouldFallbackToBrowser` is the frontend contract flag for "skip in-app download and open GitHub releases instead".

### 4. Validation & Error Matrix
- Unsupported OS for MVP -> `targetAsset = null`, `shouldFallbackToBrowser = true`
- Missing/unknown package type on Windows after all detection paths -> `targetAsset = null`, `shouldFallbackToBrowser = true`
- Asset list fetched but no suffix match for current target -> `targetAsset = null`, `shouldFallbackToBrowser = true`
- Download failure -> return `Err(...)` from `download_update`, frontend falls back to browser
- Installer open failure -> return `Err(...)` from `open_installer`, frontend falls back to browser

### 5. Good / Base / Bad Cases
- Good: macOS arm64 app finds `*-macos-aarch64.dmg` and opens it after download.
- Base: Windows app with injected `DDSHELL_PACKAGE_TYPE=msi` finds `*-windows-x64.msi` and opens it after download.
- Bad: Linux build receives release assets but does not attempt local package selection in MVP; UI must go straight to browser fallback.

### 6. Tests Required
- Rust compile check covers command registration and type shape changes.
- Frontend build covers `UpdateCheckResult` field alignment and update status flow.
- When adding automated tests later, assert:
  - macOS suffix selection by architecture
  - Windows preference order: injected env -> bundle type -> path heuristic
  - browser fallback when `targetAsset` is null
  - browser fallback when `open_installer` returns an error

### 7. Wrong vs Correct
#### Wrong
- Guess package type only from runtime path and always try in-app download on every platform.

#### Correct
- Use build-time injected package metadata as the primary source, allow deterministic asset selection only for supported MVP targets, and surface explicit browser fallback when selection is unsafe or unsupported.
