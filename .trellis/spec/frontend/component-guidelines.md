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

## Convention: Static UI drafts are visual references, not feature contracts

**What**: When applying a static UI draft to an existing React page, map the draft to existing implemented behavior first. Use the draft for layout, spacing, visual hierarchy, and styling, but do not add draft-only buttons, status chips, actions, data fields, or workflows unless the real page already has matching state and handlers.

**Why**: Static drafts often include aspirational examples. Treating those examples as product requirements can silently add non-functional controls or bypass existing store/backend contracts.

**Example**:

```tsx
// Wrong: adding a draft-only action without real behavior.
<Button onClick={() => undefined}>Duplicate</Button>

// Correct: preserve only implemented actions while adopting the draft layout.
<Button size="icon" variant="ghost" onClick={onEdit} title={t("workflows.editRecipe")}>
  <Pencil size={16} />
</Button>
```

**Required check**: Before merging a visual redesign, verify existing callbacks, store usage, validation, selection, and drag/drop behavior still flow through the original implementation.

**Related**:
- `ui/*.html` static UI drafts
- `app/src/features/workflows/WorkflowsPage.tsx`

---

## Convention: Side drawer width animations must anchor fixed panels to the animated edge

**What**: When a side drawer animates by changing the shell width and also uses `overflow: visible` for floating edge handles, keep the fixed-width drawer panel anchored to the shell edge that is moving. For a left-side drawer that expands rightward, align the panel to the shell's right edge; otherwise the full panel can appear immediately and the width transition will look broken.

**Why**: Floating handles often require visible overflow. With visible overflow, a fixed-width child aligned to the wrong edge is no longer clipped by the animated shell, so users see the open state instantly even though the shell width is transitioning.

**Example**:

```css
/* Wrong: the panel is left-aligned and becomes visible immediately. */
.left-drawer-shell[data-state="open"] {
  width: 280px;
  overflow: visible;
}

/* Correct: the fixed panel follows the shell's animated right edge. */
.left-drawer-shell[data-state="open"] {
  display: flex;
  justify-content: flex-end;
  width: 280px;
  overflow: visible;
}

.left-drawer-panel {
  flex: 0 0 280px;
}
```

**Required check**: For mirrored side drawers, compare both DOM order and CSS anchoring. Matching transition declarations are not enough; verify the panel is attached to the moving edge and that floating handles do not force the panel to bypass clipping.

**Related**:
- `app/src/features/workflows/components/WorkflowEditor.tsx`
- `app/src/styles.css` drawer shell/panel styles

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

---

## Convention: Custom drag ghost must use portal and center on cursor

**What**: When implementing a custom drag ghost (fixed-position element following the cursor), render it via `createPortal(jsx, document.body)` to escape any ancestor `transform`, and position it horizontally centered on the cursor X with a Y offset below so the drop target remains visible.

**Why**: Two issues commonly break drag ghost positioning:
1. A ghost offset to the right of the cursor (e.g. `left: clientX + 8px`) combined with the ghost's own width (e.g. 260px) causes the ghost to appear in a different column than the cursor.
2. Any ancestor with CSS `transform` (including animation `fill-mode: both` that persists `transform: translateY(0)`) creates a new containing block for `position: fixed`, making viewport coordinates (`e.clientX/clientY`) incorrect — the ghost shifts by the ancestor's offset (e.g. Sidebar width).

**Example**:

```tsx
// Wrong: ghost inside transform ancestor, offset right, no centering
dragGhostRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
// renders inside .snippets-shell which is under animate-fade-in-up parent

// Correct: ghost portaled to body, centered on cursor, offset below for visibility
import { createPortal } from "react-dom";

// In JSX:
{dragSnippetId && createPortal(
  <div ref={dragGhostRef}
    className="fixed z-[100] pointer-events-none -translate-x-1/2 ..."
  >...</div>,
  document.body
)}

// In mousemove handler:
dragGhostRef.current.style.left = `${e.clientX}px`;
dragGhostRef.current.style.top = `${e.clientY + 12}px`;
```

**Required check**: After implementing a drag ghost, verify: (1) ghost renders via portal to `document.body`, (2) ghost follows the cursor column-by-column, (3) no ancestor with `transform` interferes with `position: fixed`.

**Related**:
- `app/src/features/snippets/SnippetsPage.tsx` drag ghost implementation
- `App.tsx:41` `animate-fade-in-up` animation on page wrapper
