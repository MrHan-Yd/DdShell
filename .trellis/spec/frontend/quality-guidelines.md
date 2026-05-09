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

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
