# Implementation Plan

## Checklist

1. Load frontend/backend Trellis specs before editing.
2. Add local `tsx` dev dependency and update `test:predictive-echo`.
3. Remove duplicate static/dynamic dialog import in settings if safe.
4. Add conservative Vite manual chunks for large third-party dependencies.
5. Replace secret nonce generation with OS randomness while preserving decrypt compatibility.
6. Review Tauri security config for a low-risk change; document follow-up if strict CSP/asset tightening is not safe in this pass.
7. Run validation.

## Validation Commands

```bash
pnpm -C app build
pnpm -C app test:predictive-echo
cargo check
cargo test
git status --short
```

## Risk Notes

- Do not rename Tauri commands.
- Do not change existing encrypted payload format.
- Do not enforce a strict CSP unless current asset usage is verified against it.
- Keep refactors small and behavior-preserving.
