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

**Theme registry contract**:

- Declare all valid UI themes once in `app/src/stores/app.ts` as `UI_THEMES`.
- Derive `UiTheme` from that tuple, not from a duplicated string union.
- Validate persisted settings through `isUiTheme(saved)` everywhere a saved `ui.theme` value is loaded.
- Use `usesDesignSystemTheme(uiTheme)` for component-family switches. Do not hard-code `uiTheme === "aurora"` in shared themed controls when a new UI theme should reuse the same design-system component set.
- Adding a UI theme must update the settings option card, i18n labels, CSS entry import in `main.tsx`, and document boundary behavior in every rendered window.

**Example**:

```ts
export const UI_THEMES = ["classic", "aurora", "abyssal-vent", "obsidian-sand"] as const;
export type UiTheme = typeof UI_THEMES[number];

export function isUiTheme(value: string | null): value is UiTheme {
  return UI_THEMES.includes(value as UiTheme);
}

export function usesDesignSystemTheme(uiTheme: UiTheme): boolean {
  return uiTheme === "aurora" || uiTheme === "abyssal-vent" || uiTheme === "obsidian-sand";
}

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
  if (isUiTheme(saved)) setUiTheme(saved);
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

**Adding a new UI theme**:

1. Add the id to `UI_THEMES` and decide whether `usesDesignSystemTheme()` should return true for it.
2. Import a theme index CSS file from `app/src/main.tsx`; the index should own imports for tokens, base, components, layout, page styles, and app overrides.
3. Scope theme CSS with `[data-ui-theme="<id>"]`; light/dark differences should combine `data-theme` and body color-mode classes where needed.
4. Add the theme option in `SettingsPage`, including preview CSS and typed i18n keys for both `zh` and `en`.
5. Replace any loading guard that enumerates old theme ids with `isUiTheme(saved)`.
6. Verify the main window and secondary windows load the same saved `ui.theme`.

When the theme comes from a static prototype under `ui/ui-<id>/styles/`, keep the prototype and application adaptation as separate layers:

- Convert `base.css`, `components.css`, `layout.css`, and supported page CSS by adding `[data-ui-theme="<id>"]` to ordinary selectors. Preserve declaration values/order and keep `@keyframes` bodies unchanged.
- Map `:root` / `.theme-dark` and `.theme-light` token blocks to the document boundary contract above, then add the existing React/Tailwind `--color-*`, sizing, surface, and shadow token bridge.
- Put selectors needed only because the real React class structure differs from the static prototype in `app-overrides.css`; use an existing completed theme as the coverage template, but replace both the theme id and palette-specific literal colors.
- Keep the theme index import order as tokens → base → components → layout → supported pages → app overrides.

For mechanically scoped files, compare source/target rule-block counts (tokens may have additional bridge blocks), search the new theme directory for old theme ids and palette literals, and run the production build so Vite parses the complete CSS bundle.

**Required check**:

```bash
rg 'uiTheme === "|savedUiTheme ===|saved === "classic"|saved === "aurora"' app/src
```

Every remaining hard-coded theme comparison must be intentional and local to a branch where individual theme behavior differs.

**Related**:
- `app/src/stores/app.ts`
- `app/src/App.tsx`
- `app/src/features/settings/SettingsPage.tsx`
- `app/src/features/quick-edit/QuickEditWindow.tsx`
- `app/src/main.tsx`
- `app/src/styles/abyssal-vent-index.css`
- `app/src/styles/obsidian-sand-index.css`

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

---

## Scenario: SFTP Upload Tracking Uses Full Remote Paths

### 1. Scope / Trigger

- Trigger: frontend code tracks active SFTP uploads, virtual remote file rows, task-to-file mappings, or transfer progress in `useSftpStore`.
- Applies to standalone SFTP file management and embedded terminal file management because both share the same upload state.

### 2. Signatures

```ts
uploadingFiles: Map<string, number>; // remotePath -> totalSize
taskIdToRemotePath: Map<string, string>; // taskId -> remotePath
addUploadingEntry(remotePath: string, totalSize: number, taskId: string): void;
clearUploadingEntry(remotePath: string): void;
```

### 3. Contracts

- Upload tracking keys must be full remote file paths such as `/app/src/index.ts`, not basenames such as `index.ts`.
- Components that render a visible directory must compute each row key with `joinRemotePath(remotePath, entry.name)` before checking `uploadingFiles` or upload speed maps.
- `navigateRemote(path)` may merge only upload placeholders whose parent directory equals `path`.
- `transfer:completed`, `transfer:failed`, and refreshed terminal transfer states must clear upload placeholders using the task's full `remotePath`.

### 4. Validation & Error Matrix

- Directory upload contains repeated basenames -> each task remains isolated by full remote path.
- Upload is in a nested directory while the UI is browsing the parent -> do not render the nested file as a parent-directory row.
- User navigates into the upload target directory during transfer -> show only placeholders for that directory.
- Completed upload close/progress event arrives late -> clear the full-path placeholder and force completed transfer progress to 100%.

### 5. Good/Base/Bad Cases

- Good: `/web/src/index.ts` and `/web/dist/index.ts` upload concurrently without sharing progress or speed text.
- Base: uploading `/tmp/readme.md` into the current remote directory shows one virtual `readme.md` row.
- Bad: using `entry.name` or `fileName` as the upload key, causing nested `package.json` uploads to overwrite each other's progress.

### 6. Tests Required

- Frontend build must pass after store contract changes.
- Search must show no upload progress lookup by basename, for example no `uploadingFiles.get(entry.name)` or `taskIdToName` references.
- Manual or integration test should upload a directory containing repeated basenames and verify progress reaches 100% and placeholders clear without reconnecting.

### 7. Wrong vs Correct

#### Wrong

```ts
addUploadingEntry(fileName, size, taskId);
const total = uploadingFiles.get(entry.name);
```

#### Correct

```ts
const remoteFilePath = joinRemotePath(task.remoteDir, getPathName(localPath));
addUploadingEntry(remoteFilePath, size, taskId);

const entryRemotePath = joinRemotePath(remotePath, entry.name);
const total = uploadingFiles.get(entryRemotePath);
```
