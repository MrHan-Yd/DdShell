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

## Convention: Settings page layout skeleton is shared across UI themes

**What**: `SettingsPage` must render one layout skeleton for `classic` and `aurora`. Do not branch the settings page DOM, section/row wrappers, navigation, hero, or about-page structure on `uiTheme`. Theme differences belong in CSS token values and narrowly scoped color overrides.

**Why**: The settings page imports a layout-heavy static prototype. If React gives Aurora-only classes to one branch and Classic-only Tailwind/card fallbacks to the other, layout fixes land in only one theme and Classic regresses into a different page structure.

**Wrong**:

```tsx
const isAurora = uiTheme === "aurora";

<section className={isAurora ? "settings-group settings-section" : "settings-group glass-card p-5"}>
  ...
</section>
```

**Correct**:

```tsx
<section className="settings-group settings-section">
  <div className="settings-section__header">
    <h3 className="settings-group-title">{title}</h3>
  </div>
  <div className="settings-section__content">{children}</div>
</section>
```

**CSS contract**:
- Shared settings layout selectors use bare `.settings-*` selectors so both themes match the same rules.
- Aurora token definitions stay scoped to `[data-ui-theme="aurora"]`.
- Classic must provide aliases for prototype tokens such as `--bg-*`, `--fg-*`, `--space-*`, `--fs-*`, `--border-*`, and `--accent-*`.
- If a settings rule group is unscoped, unscope the related overrides as a group so Aurora specificity and load-order behavior stay equivalent.
- Keep semantic resets (`p`, headings, `ul`, `ol`) inside `.settings-page` when sharing prototype layout; otherwise Classic keeps browser margins that Aurora resets away.
- When a shared settings selector styles a `<button>` (for example `.settings-nav-button`), also add an Aurora-specific compound selector such as `[data-ui-theme="aurora"] button.settings-nav-button` that restates `padding`, `border`, `background`, and `color`. Aurora's global `button` reset has higher specificity than a bare class selector.
- When shared settings markup reuses Aurora component helpers such as `.input-with-icon`, restate required positioning inside the settings selector (for example `.settings-nav-search { position: relative; }` and `.settings-nav-search .settings-nav-search__icon { position: absolute; ... }`). Otherwise Classic will render the same DOM without the scoped Aurora helper rule and icons can anchor to the wrong container.

**Related**:
- `app/src/features/settings/SettingsPage.tsx`
- `app/src/styles.css`
- `app/src/styles/aurora/pages/settings.css`
- `app/src/styles/aurora/tokens.css`

---

## Convention: Theme parity must compare actual cascade, not only matching component selectors

**What**: When making Classic match Aurora layout while keeping Classic colors, compare every class on the rendered DOM node against all theme-scoped rules that can match it. Do not stop after matching the primary component selector.

**Why**: Generic helper class names can override a nested element only in one theme. For example, the sidebar menu text is rendered as `<span className="label">`; Aurora's generic `[data-ui-theme="aurora"] .label` rule makes it `var(--fs-xs)` with `0.02em` letter spacing, so matching only `[data-ui-theme="aurora"] .nav-item { font-size: var(--fs-sm); }` leaves Classic visually larger.

**Wrong**:

```css
/* Incomplete parity check: misses the nested .label override. */
[data-ui-theme="classic"] .nav-item {
  font-size: var(--fs-sm);
}
```

**Correct**:

```css
[data-ui-theme="classic"] .nav-item {
  font-size: var(--fs-sm);
}

[data-ui-theme="classic"] .nav-item .label {
  font-size: var(--fs-xs);
  letter-spacing: 0.02em;
}
```

**Required check**: For a themed component, inspect the full class list from JSX and search each class name across `app/src/styles.css` and `app/src/styles/aurora/` before declaring parity.

**Related**:
- `app/src/components/Sidebar.tsx`
- `app/src/styles/aurora/components.css`
- `app/src/styles/aurora/layout.css`

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

## Convention: Conditional overlays need a mounted closed state before opening

**What**: Popovers, drawers, and panels that are conditionally rendered must not mount directly in their final open state when they need an entry transition. Keep a short-lived mounted state, render with `data-state="closed"` first, then switch to `data-state="open"` on the next animation frame. On close, switch back to `closed` and unmount only after the CSS transition duration.

**Why**: CSS transitions need a previous computed value. A component that does `if (!open) return null` and then mounts with open classes has no previous opacity, transform, height, or grid/flex basis to interpolate from, so the panel appears instantly. This is especially visible for toolbar popovers and bottom drawers.

**Example**:

```tsx
const PANEL_TRANSITION_MS = 180;
const [mounted, setMounted] = useState(open);
const [active, setActive] = useState(open);

useEffect(() => {
  if (open) {
    setMounted(true);
    const frame = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(frame);
  }

  setActive(false);
  const timer = setTimeout(() => setMounted(false), PANEL_TRANSITION_MS);
  return () => clearTimeout(timer);
}, [open]);

if (!mounted) return null;

return <div data-state={open && active ? "open" : "closed"} />;
```

**Required check**: For any conditionally rendered overlay with a CSS transition, verify both directions: opening starts from the closed styles, and closing keeps the DOM mounted until the transition finishes.

**Related**:
- `app/src/features/terminal/components/MacroQuickPanel.tsx`
- `app/src/features/terminal/TerminalPage.tsx`
- `app/src/styles.css` `.terminal-macro-panel` / `.terminal-file-manager-shell`

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

---

## Convention: Tab/button elements with i18n text must use padding-driven sizing, not fixed height

**What**: When styling tab buttons, chips, or similar inline controls that display translated text (especially CJK languages), size them with `padding` alone rather than a fixed `height` + `line-height` combination. Ensure vertical padding is always non-zero so text never touches the background edge on hover/active states.

**Why**: Design mockups typically use English text (short, smaller cap height). CJK characters like Chinese are taller and visually fill a fixed-height container more, making zero-vertical-padding buttons look cramped — the text appears to "touch" the background edge. Padding-driven sizing adapts naturally to the actual text height across all languages.

**Example**:

```css
/* Wrong: fixed height with zero vertical padding — CJK text touches edges */
.chart-tab {
  height: 26px;
  padding: 0 12px;
  line-height: 26px;
}

/* Correct: padding drives the height, adapts to any text size */
.chart-tab {
  padding: 4px 14px;
  border-radius: 6px;
}
```

**Required check**: For any button/tab/chip with hover or active background states, verify that vertical padding is non-zero and that Chinese text does not touch the background edge.

**Related**:
- `app/src/styles.css` `.mon-chart-tab` styles
- `ui/styles/pages/monitor.css` design mockup

---

## Convention: Aurora button classes must restate reset-clobbered properties in the Aurora override block

**What**: When a class targets a `<button>` element and sets `padding`, `border`, or `background` in the base layer (`app/src/styles.css` or `ui/styles/`), the Aurora override block in `app/src/styles/aurora/base.css` must restate those same declarations on `[data-ui-theme="aurora"] button.<class>`. The values must match the base layer exactly to prevent drift.

**Why**: Aurora has a global button reset that wins on specificity:

```css
/* app/src/styles/aurora/base.css */
[data-ui-theme="aurora"] button {       /* specificity (0,1,1) */
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
}
```

A plain class selector like `.mon-session-pick-card` has specificity (0,1,0) — it **always loses** to the Aurora reset (0,1,1). The base-layer `padding` / `border` / `background` declarations silently evaporate under the Aurora theme, even though they render correctly in dev tools' "Computed" panel for non-Aurora themes. To win, the override must use a compound selector `[data-ui-theme="aurora"] button.<class>` which has specificity (0,2,1) and beats the reset.

**Bug history** (same pitfall, three occurrences):
- commit `d54214a` — `.mon-chart-tab` `padding` disappeared under Aurora until restated in the override block
- session 2026-05-22 — `.mon-session-pick-card` `padding: 12px 22px 12px 18px` disappeared under Aurora; user reported "glyph 贴左边框、绿点贴右边框" twice before root cause was traced
- session 2026-05-22 — `.mon-session-pick-card` `border` style was also reset, requiring the same restate pattern

**Example**:

```css
/* Wrong: base layer only — Aurora reset clobbers padding & border */
/* app/src/styles.css */
.mon-session-pick-card {
  padding: 8px 22px 8px 18px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
}
/* (no entry in app/src/styles/aurora/base.css → Aurora users see padding: 0, border: 0) */

/* Correct: base layer AND Aurora override block restate the properties */
/* app/src/styles.css */
.mon-session-pick-card {
  padding: 8px 22px 8px 18px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
}
/* app/src/styles/aurora/base.css */
[data-ui-theme="aurora"] button.mon-session-pick-card {
  padding: 8px 22px 8px 18px;          /* exact same value */
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
}
```

**Required check**: For any `button.<class>` styled in the base layer, grep `aurora/base.css` for `button.<class>` and confirm:
1. An override block exists.
2. `padding`, `border`, `background` values match the base layer exactly (no drift).

**Verification command**:
```bash
# Find base-layer button styles
rg 'button\.\w+|^\.\w[\w-]*\s*\{[^}]*padding' app/src/styles.css ui/styles/

# Verify each has an Aurora override
rg '\[data-ui-theme="aurora"\] button\.\w+' app/src/styles/aurora/base.css
```

**Related**:
- `app/src/styles/aurora/base.css:42-48` — Aurora button reset block
- `.mon-chart-tab`, `.mon-session-pick-card` — correct examples of the override pattern

---

## Convention: Never put Tailwind margin utilities on `<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>` elements

**What**: Aurora has a global typography reset that strips margins from semantic block elements. Tailwind margin utilities (`mt-*`, `mb-*`, `my-*`) on these elements are silently overridden under the Aurora theme. Put the margin utility on a wrapping `<div>` instead, or use a parent flex/grid `gap`.

**Why**: Aurora's typography reset:

```css
/* app/src/styles/aurora/base.css */
[data-ui-theme="aurora"] p { margin: 0; }                                         /* (0,1,1) */
[data-ui-theme="aurora"] h1, h2, h3, h4, h5, h6 { margin: 0; ... }                 /* (0,1,1) each */
[data-ui-theme="aurora"] ul, ol { margin: 0; padding: 0; list-style: none; }      /* (0,1,1) */
```

Tailwind's `.mb-8 { margin-bottom: 2rem }` has specificity (0,1,0) — it **always loses** to the Aurora reset (0,1,1). The margin is silently 0 under Aurora, breaking spacing only on themed pages. This is the same specificity pattern as the button reset above, but applied to semantic typography elements.

**Bug history** (session 2026-05-22):
- `<p className="mb-8">{t("monitor.selectSession")}</p>` — the 32px gap between the title and the picker grid completely vanished under Aurora; user reported "按钮离上面的字太近" three rounds in a row before root cause was traced
- `MonitorPage.tsx:811` — pre-existing `<p className="mt-1 ...">` in the `collectorState === "error"` branch carries the same latent bug; left for future cleanup

**Example**:

```tsx
// Wrong: margin on the <p> — Aurora reset wipes it
<p className="mb-8 text-base font-medium">{t("monitor.selectSession")}</p>
<div className="mon-session-pick-grid">...</div>

// Correct option 1 (simplest): wrapper <div> carries the margin
<div className="mb-8">
  <p className="text-base font-medium">{t("monitor.selectSession")}</p>
</div>
<div className="mon-session-pick-grid">...</div>

// Correct option 2: move the spacing onto the next sibling (a <div>)
<p className="text-base font-medium">{t("monitor.selectSession")}</p>
<div className="mon-session-pick-grid" style={{ marginTop: '32px' }}>...</div>
// or use a custom class with margin-top — <div> margins are untouched by reset

// Correct option 3: parent uses flex/grid gap
<div className="flex flex-col gap-8">
  <p className="text-base font-medium">{t("monitor.selectSession")}</p>
  <div className="mon-session-pick-grid">...</div>
</div>

// Last resort: dedicated class + Aurora override (verbose, only when wrapper isn't possible)
// CSS:  [data-ui-theme="aurora"] p.session-pick-title { margin-bottom: 32px; }
```

**Required check**: Before merging, grep for margin utilities on semantic block elements and refactor to a wrapper.

**Verification command**:
```bash
# Find all violations across the codebase
rg '<(p|h[1-6]|ul|ol)\b[^>]*className="[^"]*\b(mt|mb|my)-' app/src/

# Every match is a bug — relocate the margin to a wrapping <div> or use parent gap
```

**Related**:
- `app/src/styles/aurora/base.css:102-108` — Aurora typography reset block
- Aurora button reset convention above — same specificity pattern, different element scope
