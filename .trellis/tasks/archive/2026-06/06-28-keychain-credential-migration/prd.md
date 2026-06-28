# PRD: Keychain Credential Migration

## Goal

Move saved SSH passwords and AI provider API keys from app-managed encrypted strings into the operating system credential store while keeping existing users' saved credentials usable.

## User Value

- Reduces credential exposure if the local SQLite database is copied or inspected.
- Aligns the implementation with FR-08 and architecture/security docs that require sensitive values to live in the system keyring.
- Preserves existing connection, SFTP, workflow, and AI assistant behavior during migration.

## Confirmed Facts

- Product docs require system keyring:
  - `docs/shell/01-PRODUCT/PRD.md`: FR-08 says passwords and passphrases are stored only in system keyring.
  - `docs/shell/02-ARCH/TECH-SPEC.md`: sensitive data stores only keyring reference IDs.
  - `docs/shell/02-ARCH/ARCHITECTURE.md`: `core::secret` is intended to handle keyring reads/writes.
  - `docs/shell/SECURITY.md`: client should prefer system keyring for sensitive information.
- Current implementation stores encrypted secret strings in SQLite-backed fields/settings:
  - SSH host password: `hosts.secret_ref`.
  - AI profile API key: `aiAgent.profile.<id>.apiKey`.
- Current `core::secret` provides app-managed AES-GCM `encrypt` and `decrypt`.
- SSH, SFTP, workflow, connection test, connection edit, and AI send paths call `core::secret::decrypt` directly or indirectly.
- Frontend currently has a `password_decrypt` command used by the connection edit form to prefill an existing saved password.
- Recent low-risk hardening already changed new nonce generation to OS randomness but did not migrate storage to keyring.

## Requirements

1. Use the OS credential store for newly saved SSH passwords and AI provider API keys on supported platforms.
2. Keep legacy encrypted values decryptable during migration.
3. Migrate existing legacy values without breaking normal app startup or connection usage.
4. Preserve current public user workflows:
   - create/update/test/connect SSH hosts
   - SFTP and workflow operations that need host passwords
   - AI profile key save/send/clear
   - connection edit behavior
5. Avoid exposing plaintext secrets to frontend unless needed for an existing edit workflow; if retained, keep the command narrowly scoped.
6. Store only a stable credential reference in SQLite/settings after migration, not plaintext or keyring payloads.
7. Report keyring failures with actionable errors and avoid silently deleting legacy credentials.
8. If the OS credential store is unavailable or denied, fall back to the current local AES-GCM encryption path and mark the reference as a fallback value.

## Acceptance Criteria

- Existing legacy host passwords can still be used to connect/test/SFTP/workflow after the migration code is present.
- Newly saved host passwords are stored as keyring references, not raw AES-GCM ciphertext.
- Existing legacy AI API keys can still be used by AI send paths after migration.
- Newly saved AI API keys are stored as keyring references.
- Clearing a host password or AI key removes the corresponding keyring entry when possible and clears the DB/settings reference.
- `cargo check` passes.
- `cargo test` passes.
- `pnpm -C app build` passes.
- At least one backend unit test covers reference parsing / legacy compatibility / keyring-fallback-safe behavior without requiring a real OS keyring in CI.

## Out of Scope

- Strict CSP / asset protocol hardening.
- Broad frontend redesign.
- Reworking all credential UI.
- Migrating SSH private key passphrases unless they are already persisted by current code paths.
- Cloud sync of credentials.

## Open Question

- Resolved: prefer OS credential store, but allow a marked local-encryption fallback when keyring is unavailable or denied so existing workflows remain usable.
