# Implementation Plan

## Checklist

1. Load frontend/backend Trellis specs before editing.
2. Add a cross-platform keyring dependency.
3. Extend `core::secret` with:
   - keyring references
   - local fallback references
   - legacy reference detection
   - best-effort keyring delete
   - unit-testable reference parsing and local fallback behavior
4. Add DB helper for updating a host secret reference only.
5. Update host password read paths to lazy-migrate legacy values:
   - SSH connect
   - connection test
   - SFTP password lookup
   - workflow runner password lookup
6. Update AI API key read path to lazy-migrate legacy values.
7. Preserve frontend APIs and current edit behavior.
8. Update backend spec if implementation establishes new credential-reference contracts.
9. Run validation.

## Validation Commands

```bash
pnpm -C app build
cargo check
cargo test
git status --short
```

## Risk Notes

- Do not remove legacy decrypt support.
- Do not run destructive batch migration.
- Do not clear legacy values after failed keyring migration.
- Do not rename Tauri commands or frontend API wrappers.
