# Implementation Plan: 终端页底部文件管理抽屉

## Checklist

1. Extract shared SFTP utilities
   - Move path helpers, formatting helpers, local directory scan, overwrite pre-check helpers from `SftpPage.tsx` into a shared module.
   - Update `SftpPage.tsx` to import the shared helpers without behavior changes.

2. Add terminal file manager setting
   - Add `fileManagerDrawerEnabled` to terminal settings state/defaults.
   - Load/save `terminal.fileManagerDrawer.enabled`.
   - Add a terminal settings row with localized label/description.
   - Include the setting in terminal runtime settings reload.

3. Track focused terminal session
   - Add an `onFocusSession` callback from `TerminalInstance` to `TerminalPage`.
   - Record `lastFocusedSessionId`; validate it against connected tabs before use.

4. Build terminal drawer component
   - Create terminal remote-only file manager drawer.
   - Initialize target session and initial remote path with cwd/recent/root fallback.
   - Reuse `useSftpStore`, `initSftpListeners`, confirmations, toasts, and SFTP APIs.
   - Implement remote browse, refresh, mkdir, rename, delete, download, upload, drag upload, Quick Edit.

5. Add move-to flow
   - Add a remote directory picker.
   - Support one or more selected files/directories.
   - Check target conflicts before `sftpRename`.
   - Refresh source/target state after move.

6. Add compact transfer status
   - Show active transfer count and progress summary by default.
   - Expand to list transfers with cancel and clear finished actions.

7. Integrate into terminal layout
   - Add toolbar button controlled by setting.
   - Add drawer height state and resize handle.
   - Ensure drawer close on disabled setting or disconnected target session.
   - Add Aurora/classic CSS as needed without nested cards.

8. Keyboard and focus behavior
   - Scope `F5`, `F2`, `Delete`, `Ctrl/Cmd+Shift+N` to focused drawer file list only.
   - Do not intercept terminal keystrokes when focus remains in xterm.

9. Localization
   - Add Chinese and English i18n keys for settings, button titles, drawer labels, move/upload actions, and conflict prompts.

## Validation

- `pnpm --dir app build`
- `cargo check --manifest-path app/src-tauri/Cargo.toml`
- Manual checks:
  - Setting on/off hides and shows the terminal file button.
  - Drawer opens on focused split pane session and falls back to active tab.
  - Initial path uses inferred cwd, then recent path, then `/`.
  - Create folder, rename, move, delete, upload, drag upload, download work.
  - Transfer progress updates while staying on terminal page.
  - Terminal resizes correctly when drawer opens, closes, and is dragged.
  - SFTP page still works after shared helper extraction.

## Risky Files

- `app/src/features/terminal/TerminalPage.tsx`
- `app/src/features/sftp/SftpPage.tsx`
- `app/src/stores/sftp.ts`
- `app/src/features/settings/SettingsPage.tsx`
- `app/src/lib/i18n.ts`
- `app/src/styles.css`
- `app/src/styles/aurora/pages/terminal.css`
- `app/src/styles/aurora/pages/sftp.css`

## Rollback Points

- If shared extraction destabilizes SFTP page, keep helpers additive and revert only the SFTP import changes.
- If move picker grows too large, ship move-to with a path input fallback using `sftpListDir` validation.
- If drawer resize conflicts with terminal split layout, ship fixed 40% drawer height behind the same component boundary and revisit resizing separately.
