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
