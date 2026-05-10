# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

### Scenario: Platform Information for Frontend Display

#### 1. Scope / Trigger
- Trigger: frontend UI needs OS/architecture labels that must reflect the actual runtime target.
- Do not use browser compatibility strings such as `navigator.platform` for native app platform labels; Apple Silicon can be reported as `MacIntel`.

#### 2. Signatures
- Rust command: `fn app_platform_info() -> PlatformInfo`
- Tauri command name: `app_platform_info`
- Frontend wrapper: `appPlatformInfo(): Promise<{ os: string; arch: string; label: string }>`

#### 3. Contracts
- `os`: display-safe OS name derived from `std::env::consts::OS`; normalize `macos` to `macOS`.
- `arch`: display-safe architecture derived from `std::env::consts::ARCH`; normalize `aarch64` to `arm64`.
- `label`: `${os} ${arch}` for direct UI display.
- The command has no request payload and should not inspect browser APIs.

#### 4. Validation & Error Matrix
- Backend command unavailable -> frontend should show a neutral fallback such as `Unknown`.
- Unknown OS/arch value -> return the raw Rust constant rather than guessing.

#### 5. Good/Base/Bad Cases
- Good: Apple Silicon macOS returns `macOS arm64`.
- Base: Intel macOS returns `macOS x86_64`.
- Bad: frontend displays `MacIntel` for Apple Silicon.

#### 6. Tests Required
- Type/build check must verify the frontend wrapper and Tauri command registration stay in sync.
- Manual/UI check should confirm the Settings About platform label does not use `navigator.platform`.

#### 7. Wrong vs Correct

Wrong:

```ts
const platform = navigator.platform;
```

Correct:

```ts
const info = await api.appPlatformInfo();
const platform = info.label;
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
