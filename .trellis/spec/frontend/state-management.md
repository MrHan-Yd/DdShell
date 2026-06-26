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

---

## Scenario: Embedded SFTP Store Session Binding

### 1. Scope / Trigger

- Trigger: UI features may embed remote file management outside the standalone SFTP page while reusing `useSftpStore`.
- The store action signature is part of the frontend state contract because it controls whether selecting a session automatically loads `/`.

### 2. Signatures

```ts
setSessionId(id: string | null, options?: { navigate?: boolean }): void;
navigateRemote(path: string): Promise<void>;
```

### 3. Contracts

- `setSessionId(id)` keeps the standalone SFTP page behavior: bind the session, reset remote state, then load `/`.
- `setSessionId(id, { navigate: false })` only binds the session and resets remote state. The caller must explicitly call `navigateRemote(path)` after resolving the desired initial directory.
- `setSessionId(null)` clears the bound SFTP session. The `navigate` option has no effect for `null`.
- Embedded drawers that infer an initial directory from terminal cwd must resolve that directory once per drawer-open/session-change. Later terminal cwd updates must not move the file manager away from the directory the user is browsing.

### 4. Validation & Error Matrix

- `id` is `null` -> clear SFTP state; do not navigate.
- `navigate !== false` and `id` is present -> attempt `navigateRemote("/")`; errors are surfaced through store `error`.
- `navigate === false` and caller never calls `navigateRemote` -> remote list remains empty by design.
- Inferred initial path is inaccessible -> caller should try recent path, then `/`, before showing an error state.

### 5. Good/Base/Bad Cases

- Good: terminal file manager calls `setSessionId(sessionId, { navigate: false })`, validates cwd/recent/root candidates, then calls `navigateRemote(candidate)`.
- Base: standalone SFTP session picker calls `setSessionId(sessionId)` and lands at `/`.
- Bad: embedded file manager calls `setSessionId(sessionId)` and also calls `navigateRemote(cwd)`; the `/` request can finish last and overwrite the cwd.

### 6. Tests Required

- Standalone SFTP selection still loads `/` after choosing a connected session.
- Embedded terminal file manager opens on the inferred cwd when that directory is readable.
- If terminal cwd changes while the drawer is already browsing another directory, the drawer does not jump.
- If the inferred cwd fails, recent path is attempted before `/`.

### 7. Wrong vs Correct

#### Wrong

```tsx
useEffect(() => {
  setSessionId(sessionId);
  void navigateRemote(initialPath);
}, [sessionId, initialPath, setSessionId, navigateRemote]);
```

#### Correct

```tsx
useEffect(() => {
  setSessionId(sessionId, { navigate: false });
  void navigateRemote(resolvedInitialPath);
}, [sessionId, setSessionId, navigateRemote]);
```
