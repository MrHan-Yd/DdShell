# Quality Guidelines

> Code quality standards for frontend development.

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

### Don't: Wildcard `position` on flex parents

```css
/* Don't do this */
.app-shell > * {
  position: relative;
  z-index: 1;
}
```

**Why it's bad**: A blanket `position: relative` on all children of a flex container overrides `position: fixed` on overlay elements (Toast, ConfirmDialog, Popover), making them participate in the flex flow instead of escaping it. This causes layout distortion — the overlay takes up space and pushes other flex items around.

**Instead**: Exclude overlay components from the wildcard rule using `:not()`:

```css
/* Do this instead */
.app-shell > *:not(.toast-overlay):not(.confirm-overlay) {
  position: relative;
  z-index: 1;
}
```

Overlay components must have a semantic class name (e.g. `toast-overlay`, `confirm-overlay`) so they can be targeted by `:not()` selectors.

### Don't: `t(key) || "fallback"` to bypass i18n key typecheck

```tsx
// Don't do this
<span>{t("snippets.allSnippets") || "All snippets"}</span>
<span>{t("snippets.libraryHeading" as DictKey) || "Library"}</span>
```

**Why it's bad**: `t()` is typed as `t(key: DictKey, ...)` where `DictKey = keyof typeof dict` — a literal union of registered keys. Calling `t("not.registered")` should be a compile error so missing keys are caught at build time. Two patterns silently defeat this:

1. `t("foo.bar") || "fallback"` — when `"foo.bar"` is not in `dict`, the call may still typecheck (the union narrows) but at runtime `t` returns the key itself, and the `||` masks the regression in dev. The build went red mid-task because of unregistered keys, and the `|| fallback` made it look like a "safe default" rather than a missing-key bug.
2. `t("foo.bar" as DictKey)` / `t("foo.bar" as any)` — explicit assertion that throws the type system away.

**Instead**:

1. Register the key in `app/src/lib/i18n.ts` `dict` (both `zh` and `en` entries) **before** using it in any component.
2. Call `t("foo.bar")` with no fallback. If TS complains, the key is missing — fix it at the source, not at the call site.
3. If a string is genuinely runtime-dynamic (not a registered key), don't pretend `t()` handles it — render the plain string directly with a comment.

This contract makes "missing i18n key" a build-time error, the way the type system intends.

---

## Required Patterns

### Platform-specific UI branches use the shared platform helper

Feature and component code must not read browser compatibility strings such as `navigator.platform` or `navigator.userAgent` directly. Use the shared synchronous helper for UI branches that need immediate macOS/non-macOS behavior:

```ts
import { isMacPlatform } from "@/lib/platform";

const isMac = isMacPlatform();
```

This applies to shortcut modifier handling, shortcut labels, and window-control visibility. Keep the helper synchronous so keyboard handlers and module-level UI constants are available during startup.

Do not use this helper for display-safe OS/architecture labels. User-facing runtime platform labels must continue to come from the Tauri-backed `appPlatformInfo()` wrapper because browser compatibility strings can report Apple Silicon as `MacIntel`.

```ts
// Correct for display labels.
const info = await api.appPlatformInfo();
const label = info.label;
```

Before committing platform-related frontend changes, verify:

```bash
rg "navigator\\.platform|navigator\\.userAgent" app/src
```

The only allowed frontend hit should be inside `app/src/lib/platform.ts`.

### Terminal server-scoped local state uses `hostId`

Terminal UI state that users expect to follow a server across reconnects must be keyed by `TerminalTab.hostId`, not by `tab.id` or `sessionId`.

```tsx
// Correct: survives reconnects and isolates per saved server.
const storageKey = `terminal.aiAssist.history.${activeTab.hostId}`;

// Wrong: changes every reconnect, so history appears empty after reopening.
const storageKey = `terminal.aiAssist.history.${activeTab.sessionId}`;
```

Use this for local-only, server-scoped records such as AI assistant history. Keep bounded collections explicitly capped at their product limit, for example `slice(0, 20)` for recent AI questions.

### Batch operations with global confirmation aggregate before prompting

UI flows that use the global confirmation dialog store must not start one confirmation per selected item. The confirm store is singleton state; concurrent prompts overwrite or cancel each other, so multi-select actions can silently skip items.

```tsx
// Wrong: each item starts its own overwrite confirmation.
await Promise.all(selectedEntries.map((entry) => startDownload(entry)));

// Correct: collect the concrete work first, show one confirmation, then run the batch.
const tasks = (await Promise.all(selectedEntries.map((entry) => collectDownloadTasks(entry)))).flat();
const shouldContinue = await confirmOverwritePaths(t, "download", () => collectExistingTargets(tasks));
if (shouldContinue) {
  await Promise.all(tasks.map((task) => api.sftpTransferStart(task)));
}
```

Use this pattern for multi-select file operations such as download, upload, delete, move, or any flow where one user action may affect multiple paths and the confirmation UI is globally shared.

### Clipboard text access uses the shared Tauri-first helper

All frontend text clipboard reads/writes must go through `app/src/lib/clipboard.ts`:

```ts
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";

await writeClipboardText(command);
const text = await readClipboardText();
```

The helper tries `@tauri-apps/plugin-clipboard-manager` first so desktop clipboard access remains governed by Tauri capabilities. It may fall back to `navigator.clipboard` for browser preview/dev environments, but feature code must not call `navigator.clipboard` directly.

Do not confuse terminal session text writes with clipboard writes. For example, `app/src/features/terminal/hooks/useMacroRunner.ts` has a local `writeText(sessionId, text)` helper that writes bytes to SSH sessions; that is not a clipboard API and should not be routed through the clipboard helper.

Before committing clipboard-related changes, verify:

```bash
rg "navigator\\.clipboard" app/src
rg "@tauri-apps/plugin-clipboard-manager" app/src
```

The only allowed hits should be inside `app/src/lib/clipboard.ts`.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
