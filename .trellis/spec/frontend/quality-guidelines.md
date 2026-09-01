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

### Terminal transient layout must suppress remote resize side effects

Terminal startup code and animated terminal-adjacent panels must not send eager or repeated `sessionResize` / PTY `window_change` events while the terminal layout is still settling. xterm local layout can fit immediately during ordinary stable resizes, but remote resize notifications during login or panel transitions can make bash/readline repaint the prompt over MOTD or the current line, leaving duplicated prompts or visible fragments such as `0 ~]# 05430`.

```tsx
// Correct: remote resize is gated during startup or transient panel layout.
const resizeObserver = new ResizeObserver(() => {
  if (suspendResizeRef.current) {
    pendingResizeFitRef.current = true;
    return;
  }
  fitAddon.fit();
});

const onResize = term.onResize(({ cols, rows }) => {
  void api.sessionResize(sessionIdRef.current, cols, rows);
});

// Wrong: unconditional startup or panel-transition resize can corrupt display.
setTimeout(() => {
  void api.sessionResize(sessionId, term.cols, term.rows);
}, 800);
```

Manual or real container resizes after the layout is stable must still call `sessionResize`; the rule is only about automatic startup fit/ResizeObserver effects and terminal-internal panel changes such as the terminal file manager opening, closing, or height drag. Backend SSH PTY creation already receives initial `cols` / `rows`, so frontend startup resize is not required for the session to become usable. For internal panels, pause remote resize through the transition and perform the final fit as local-only. The local-only remote suppression window must also cover panel unmount and layout rebound after the visible animation ends. Only real terminal-surface resizes, such as app window resize or terminal split-pane resize, should reach the remote PTY.

Terminal-internal panels should avoid participating in the terminal container's row/column layout when they can be presented as overlays. A panel that pushes or shrinks the xterm container forces local `fit()`/buffer repaint and can make the active command line flash even when remote resize is suppressed. For the terminal file manager, keep the panel absolutely positioned at the bottom of `term-main`; change the panel height, not the terminal pane height. If the overlay would cover the current command line, move only the xterm surface visually with CSS `transform` instead of resizing xterm; do not transform overlay siblings such as disconnect/reconnect UI.

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

### Don't: Add CSS outside the established cascade layers

**Why it matters**: All app stylesheet code lives in explicit cascade layers. `src/styles.css` is the only orchestration entry: it imports Tailwind, the xterm vendor CSS (`layer(vendor)`), the app body (`styles/app.css`, `layer(app)`), and the 15 theme indexes (also `layer(app)`). The precedence order is fixed as:

```
properties < vendor < theme < base < components < utilities < app
```

`app` sits **above** `utilities` on purpose: app + theme rules historically outranked Tailwind utilities, and the migration that introduced this order verified the bundled CSS rule-for-rule against the pre-migration build. Within a single layer, specificity and source order behave normally; across layers they do not.

Implications:

- **State visibility** (`hidden`, conditional `flex`/`grid`/`block`) must use inline styles — utilities live below `app`, so a `display` utility cannot hide a theme-styled element:
  ```tsx
  <div className="term-pane" style={visible ? undefined : { display: "none" }} />
  ```
- **One-off overrides** of an app/theme rule from JSX must use `!` important utilities (`!px-6`, `!bg-[…]`). The important cascade inverts layer order, so an important utility beats an un-important app-layer rule.
- **New stylesheet files** must be imported through `src/styles.css` with an explicit `layer(...)`. A bare `@import` (or a JS-side `import "./x.css"`) produces **unlayered** rules that outrank every layered rule regardless of specificity — the exact defect class that shipped as the v0.3.2 fake-split-pane bug (a theme `display:flex` silently defeating Tailwind's `.hidden`). The build guard `scripts/check-css-layers.mjs` fails the build if any rule escapes the layers or the order drifts.

### Don't: Ship persistent error visuals built on strict-syntax assumptions across languages

**Problem**:

```ts
// rainbowBrackets.ts（初版）：配对不上的右括号常驻标红
} else {
  builder.add(pos, pos + 1, unmatchedDecoration); // 红色 + 波浪线，全文档常驻
}
```

**Why it's bad**: QuickEditor 服务 17 种语言，"括号必须严格配对"只在部分语言成立。shell 的 `case x) ... ;;` 每个分支都有合法的单侧 `)`——本项目是 SSH 工具，编辑 `.sh`/`.bashrc` 是核心高频场景，这个"错误标记"变成大面积常驻误报。同类陷阱：任何基于单一语言语法直觉的常驻 error/warning 视觉（未闭合引号、缩进"错误"等），跨语言应用前都要先问：**这个假设在全部支持的语言里都成立吗？**

**Instead**: 默认只做被动信号——配不上的括号保持 token 原色，光标停靠时由官方 `bracketMatching` 的 `.cm-nonmatchingBracket` 提示（已拍板决策，见 tasks/08-17-quick-edit-enhance/prd.md ADR）。若产品要常驻错误视觉，必须按语言白名单启用（如 JSON/JS 开、shell 关），不做全局假设。

```ts
// 配对不上的右括号不装饰：shell `case x)`、正文里的半括号都是合法场景。
if (stack.length > 0 && stack[stack.length - 1] === CLOSE_TO_OPEN[code]) {
  stack.pop();
  builder.add(pos, pos + 1, bracketDecorations[stack.length % BRACKET_COLOR_CYCLE]);
}
```

### Convention: Semantic token groups follow the `:root` + `[data-theme="light"]` dual-block pattern

**What**: 新增一组语义 CSS 变量（如 QuickEditor 语法色板 `--color-syntax-*`）时，在 `styles/app.css` 中写两个同构块：暗色默认值挂 `:root`，亮色整套挂 `[data-theme="light"]`，紧邻放置、变量一一对应。不要只写一套再零散补另一套。

**Why**: 与全局 token 体系同构（`styles.css` `@theme` 暗色默认 + `app.css` light 块覆盖），主题切换零 JS 参与。放在 app.css 意味着自动进 `layer(app)`；15 套 ui-theme 的 index 文件在 `styles.css` 中 import 于 app.css **之后**（同层内源顺序靠后），因此任何主题可用 `[data-ui-theme="x"]` 无条件覆盖单个变量做逐主题微调，无需动基础色板。

**Example**（app.css，v0.3.x quick-edit 语法色板）:

```css
/* 暗色默认 */
:root {
  --color-syntax-keyword: #C678DD;
  --color-syntax-bracket-match-bg: color-mix(in srgb, var(--color-accent) 28%, transparent);
  /* ... 全部变量 ... */
}

/* 亮色整套覆盖（变量集合与 :root 块一一对应） */
[data-theme="light"] {
  --color-syntax-keyword: #A626A4;
  --color-syntax-bracket-match-bg: color-mix(in srgb, var(--color-accent) 18%, transparent);
  /* ... */
}
```

**Related**: 消费侧若在 CodeMirror `EditorView.theme`（CSS-in-JS 运行时注入，不受 layer 管辖）中引用这些变量，与同为 inline span 装饰的 token 色叠加时需 `!important`（如彩虹括号 class 压 HighlightStyle 的 token 色）。独立窗口（quick-edit window）与主窗口共用 `main.tsx` → `styles.css` 入口且自行设置 `data-theme`，变量天然可解析，无需额外接线。

### Don't: Let progress events overwrite terminal states

```ts
// Don't do this
transfers: s.transfers.map((t) =>
  t.id === taskId ? { ...t, transferredBytes, state: "running" as const } : t,
)
```

**Why it's bad**: the Rust side emits a final 100% `transfer:progress` **before** marking the task `Completed` (`app/src-tauri/src/core/sftp.rs`). An unconditional write back to `running` resurrects a finished task, leaving the UI stuck at "1 transferring" forever.

**Instead**: treat `completed` / `failed` / `canceled` as absorbing states — progress events may update byte counters but must never move a task out of a terminal state.

```ts
// Do this instead
const isTerminal =
  task?.state === "completed" || task?.state === "failed" || task?.state === "canceled";
const nextState = isTerminal ? task.state : ("running" as const);
```

Additionally, any surface that displays live transfer state must poll as a fallback while tasks are in flight. `SftpPage` polls every 500ms; `TerminalFileManagerDrawer` originally did not, which is why the bug only surfaced in the terminal drawer. Event-only state sync has no recovery path when an event is dropped.

**2026-09 addendum — the same class has three writers, guard all of them** (`fix` for the download variant of "stuck at 1 transferring"):

1. `refreshTransfers` applies the fetched list wholesale — a snapshot served before the backend marked a task terminal can land after `transfer:completed` was processed. Merge with absorbing semantics, **gated on event-confirmed terminal states** (`eventConfirmedTerminalIds`, recorded by `markTransferCompleted`/`markTransferFailed`): a snapshot must never resurrect a task whose terminal state came from an event, but snapshot-derived terminal states must NOT be absorbed — the backend's transient Failed→Queued transition between retry attempts has to stay visible.
2. `markTransferCompleted` / `markTransferFailed` are `transfers.map(...)` no-ops when the task is not in the local list yet (fast transfers complete before the start-flow's first `refreshTransfers` response lands, and those events are emitted exactly once). When the task is missing, re-fetch via `refreshTransfers()` from the event handler.
3. Poll effects must depend on a boolean (`hasActiveTransfers`), never on the `transfers` array: progress events replace the array every ~200ms, which resets the 500ms interval before it ever fires — the fallback was silently dead during exactly the window it exists for.

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
