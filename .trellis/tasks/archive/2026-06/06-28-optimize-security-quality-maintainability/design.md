# Design: Low-Risk Compatibility Pass

## Scope

This pass addresses low-risk improvements only. It avoids broad rewrites, public command renames, storage format breaks, and strict CSP/keychain migration that would require manual cross-platform release testing.

## Changes

1. Predictive echo test runner
   - Add `tsx` as a pinned dev dependency.
   - Update the script to use the local binary through `pnpm` instead of `npx --yes`.

2. Bundle pressure
   - Remove static/dynamic duplicate imports that defeat chunking.
   - Add conservative Vite `manualChunks` for large third-party libraries such as React, Tauri API/plugin packages, xterm, CodeMirror, and animation/icons.

3. Credential crypto hygiene
   - Keep existing ciphertext decrypt-compatible.
   - Replace the nonce source for new encryptions with OS randomness.
   - Do not migrate secrets to system keychain in this pass.

4. Tauri security configuration
   - Current local asset usage includes user-selected terminal background images rendered through `convertFileSrc`.
   - Do not tighten `assetProtocol.scope.allow` in this pass because it could block existing arbitrary local image paths.
   - Leave strict CSP/asset scope hardening as a follow-up that first defines supported image locations and tests background image rendering on each platform.

5. Maintainability
   - Avoid large behavior-preserving refactors in this pass.
   - Add focused comments or small extraction only where it directly supports the above work.

## Compatibility

- Existing encrypted values must continue to decrypt.
- Tauri command names and frontend API wrappers stay stable.
- Existing build, Rust checks, Rust tests, and predictive echo self-check must pass.

## Rollback

- Dependency/script and Vite config changes are independent and can be reverted without data migration.
- Nonce generation change affects only new encrypted values and remains decrypt-compatible.
