# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)

---

## Convention: Update entry actions must preserve browser fallback

**What**: Components that surface app update actions should treat in-app download/open as an enhancement over the existing GitHub releases path, not as a hard dependency.

**Why**: Release asset targeting can be platform-specific. When the backend cannot select a deterministic target, or when download/open fails, the UI must still give the user a successful path to obtain the update.

**Example**:

```tsx
if (!result.targetAsset || result.shouldFallbackToBrowser) {
  await openBrowser(GITHUB_RELEASES_URL);
  return;
}

try {
  await downloadUpdate(result.targetAsset.browserDownloadUrl, result.targetAsset.name);
} catch {
  await openBrowser(GITHUB_RELEASES_URL);
}
```

**Related**:
- Backend command contract: `check_update` / `open_installer`
- Browser fallback is required for unsupported MVP targets such as Linux
