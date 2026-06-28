# Design: Keychain Credential Migration

## Architecture

`core::secret` becomes the compatibility boundary for credential references:

- `keyring:v1:<account>`: preferred OS credential-store reference.
- `local:v1:<ciphertext>`: explicit local AES-GCM fallback reference.
- `<ciphertext>` with no prefix: legacy AES-GCM value from existing databases/settings.

Existing callers keep using `core::secret::encrypt` and `core::secret::decrypt` so the public command surface stays stable. Internally, `encrypt` writes the secret into OS keyring when possible and returns a reference. If keyring write fails, it returns a marked local fallback reference. `decrypt` resolves keyring references, local fallback references, and legacy ciphertext.

## Migration Strategy

Use lazy migration instead of startup batch migration:

1. When a backend flow reads a legacy host password or AI API key, decrypt it through `core::secret`.
2. If the reference is legacy, attempt to write the plaintext into keyring and update the DB/settings reference.
3. If migration fails, keep using the plaintext for the current operation and leave the legacy value unchanged.

This avoids blocking app startup, preserves current user workflows, and makes migration naturally converge as users use saved credentials.

## Data Flow

### New Host Password

UI password -> `connection_create` / `connection_update` -> `core::secret::encrypt` -> keyring ref or local fallback ref -> `hosts.secret_ref`

### Existing Host Password

`hosts.secret_ref` -> `core::secret::decrypt` -> operation uses plaintext -> if legacy, best-effort migration updates `hosts.secret_ref`

### New AI API Key

UI API key -> `ai_agent_profile_set_key` -> `core::secret::encrypt` -> keyring ref or local fallback ref -> setting `aiAgent.profile.<id>.apiKey`

### Existing AI API Key

setting value -> `core::secret::decrypt` -> provider call uses plaintext -> if legacy, best-effort migration updates setting value

## Compatibility

- Public Tauri command names stay unchanged.
- Legacy ciphertext remains decryptable.
- Local fallback remains decryptable.
- Keyring failures do not delete existing secrets.
- Clearing a known keyring reference should attempt keyring deletion and clear the DB/settings value regardless of deletion result.

## Trade-offs

- Lazy migration means unused old credentials remain in legacy format until used or edited.
- Allowing local fallback preserves compatibility but is weaker than strict keyring-only security.
- Prefilling saved SSH passwords in the edit form still exposes plaintext to the frontend; this pass keeps current behavior for compatibility and can be tightened later with a UI redesign.

## Rollback

- Keyring references are opaque strings in existing DB/settings columns.
- If the keyring feature is reverted, legacy and local fallback references remain usable, but keyring references would need a compatibility reader or a one-time downgrade path.
