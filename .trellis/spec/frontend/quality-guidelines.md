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

### Terminal server-scoped local state uses `hostId`

Terminal UI state that users expect to follow a server across reconnects must be keyed by `TerminalTab.hostId`, not by `tab.id` or `sessionId`.

```tsx
// Correct: survives reconnects and isolates per saved server.
const storageKey = `terminal.aiAssist.history.${activeTab.hostId}`;

// Wrong: changes every reconnect, so history appears empty after reopening.
const storageKey = `terminal.aiAssist.history.${activeTab.sessionId}`;
```

Use this for local-only, server-scoped records such as AI assistant history. Keep bounded collections explicitly capped at their product limit, for example `slice(0, 20)` for recent AI questions.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
