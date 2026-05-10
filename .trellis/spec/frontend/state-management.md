# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)

---

## Convention: UI theme and color mode are separate state layers

**What**: App-wide visual theme selection must be modeled separately from color mode. Use `uiTheme` for product skin selection such as `classic` / `aurora`, and keep `theme` for the existing `dark` / `light` / `system` color-mode behavior.

**Why**: A product skin changes visual language, tokens, logos, and layout treatment across the app. Color mode controls dark/light behavior. Combining them into one field would break existing settings semantics and make persistence/migration harder.

**Example**:

```ts
export type UiTheme = "classic" | "aurora";

interface AppState {
  theme: "dark" | "light" | "system";
  uiTheme: UiTheme;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setUiTheme: (uiTheme: UiTheme) => void;
}
```

Load and persist them independently:

```ts
api.settingGet("ui.theme").then((saved) => {
  if (saved === "classic" || saved === "aurora") setUiTheme(saved);
});

api.settingGet("theme").then((saved) => {
  if (saved === "dark" || saved === "light" || saved === "system") setTheme(saved);
});
```

Apply both at the document boundary:

```ts
root.setAttribute("data-theme", isDark ? "dark" : "light");
root.setAttribute("data-ui-theme", uiTheme);
document.body.classList.toggle("theme-dark", isDark);
document.body.classList.toggle("theme-light", !isDark);
```

Every rendered window must apply the same boundary contract. This includes detached or secondary windows such as quick-edit, not only the main app shell. Aurora CSS tokens are scoped through both `data-ui-theme` and `theme-dark/theme-light`; setting only the `<html>` attributes can leave the body in the wrong color mode.

**Related**:
- `app/src/stores/app.ts`
- `app/src/App.tsx`
- `app/src/features/settings/SettingsPage.tsx`
- `app/src/features/quick-edit/QuickEditWindow.tsx`

---

## Convention: Settings drafts must not drive committed visual state

**What**: Settings forms that use a Save button must keep draft values separate from committed app state. Draft fields may drive local control selection states, but app-wide visual boundaries such as `data-ui-theme`, color mode classes, locale, and terminal runtime events must only be updated after the save operation succeeds.

**Why**: A draft-only settings flow promises that changes do not take effect until Save. If a draft value is reused for page shell rendering or global store updates, the UI can visually change before persistence succeeds, creating a split-brain state between what the user sees, what the app store contains, and what the backend has saved.

**Example**:

```tsx
// Wrong: the settings page shell changes as soon as the draft changes.
const isAurora = draft.uiTheme === "aurora";

// Correct: committed state controls app/page-level visual styling.
const isAurora = uiTheme === "aurora";

// The draft only controls selection affordances inside the form.
const isClassicSelected = draft.uiTheme === "classic";
```

Persist first, then commit runtime side effects:

```ts
await api.settingSetMany(entries);
setTheme(draft.theme);
setUiTheme(draft.uiTheme);
setLocale(draft.locale);
window.dispatchEvent(new CustomEvent("terminal:settings-changed"));
```

**Tests Required**:
- Change theme, UI theme, locale, and terminal settings in the settings form and assert the page/app visual state does not change before Save.
- After Save succeeds, assert store state, document theme attributes/classes, locale, and terminal settings event behavior all reflect the saved draft.
- On Save failure, assert the draft remains editable and committed visual state is unchanged.

**Related**:
- `app/src/features/settings/SettingsPage.tsx`
- `app/src/stores/app.ts`
- `app/src/App.tsx`
