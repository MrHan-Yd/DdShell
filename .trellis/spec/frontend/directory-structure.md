# Directory Structure

> How frontend code is organized in this project.

---

## Overview

<!--
Document your project's frontend directory structure here.

Questions to answer:
- Where do components live?
- How are features/modules organized?
- Where are shared utilities?
- How are assets organized?
-->

(To be filled by the team)

---

## Directory Layout

```
<!-- Replace with your actual structure -->
src/
├── ...
└── ...
```

---

## Module Organization

<!-- How should new features be organized? -->

(To be filled by the team)

---

## Naming Conventions

<!-- File and folder naming rules -->

(To be filled by the team)

---

## Examples

<!-- Link to well-organized modules as examples -->

(To be filled by the team)

---

## Convention: Static UI theme prototypes use a complete parallel directory

**What**: A design-only UI theme lives under `ui/ui-<theme-id>/` and must preserve the complete static prototype surface. The prototype is separate from application integration under `app/src/styles/`.

**Why**: Theme reviews compare the same product pages across visual directions. A partial prototype can look finished on the landing page while hiding missing terminal, SFTP, settings, or dark-mode behavior.

**Required structure**:

```text
ui/ui-<theme-id>/
├── DESIGN.md
├── index.html
├── connections.html
├── terminal.html
├── sftp.html
├── monitor.html
├── snippets.html
├── workflows.html
├── quick-edit.html
├── settings.html
├── assets/
│   ├── logo-v2.svg
│   └── logo-v2-dark.svg
└── styles/
    ├── tokens.css
    ├── base.css
    ├── components.css
    ├── layout.css
    └── pages/
        ├── index.css
        ├── connections.css
        ├── terminal.css
        ├── sftp.css
        ├── monitor.css
        ├── snippets.css
        ├── workflows.css
        ├── quick-edit.css
        └── settings.css
```

**Contracts**:

- Copy a recently completed prototype only as the structural starting point; rewrite theme names, visual prose, palette literals, landing-page decoration, and both logos.
- Every HTML page loads `tokens.css`, `base.css`, `components.css`, `layout.css`, and its matching `styles/pages/<page>.css`.
- Every page keeps the shared dark/light toggle and the selected default mode. Light-first themes use `body.theme-light`; dark-first themes use `body.theme-dark`.
- `DESIGN.md` records the name, inspiration, visual principles, color structure, differentiation boundary, and intended use.
- Prototype work does not modify `app/src/` unless the user separately requests application integration.

**Required checks**:

```bash
diff -u \
  <(find ui/ui-<reference> -type f | sed 's#ui/ui-<reference>/##' | sort) \
  <(find ui/ui-<theme-id> -type f | sed 's#ui/ui-<theme-id>/##' | sort)

rg '<old theme name>|<old theme-specific classes>|<old palette literals>' ui/ui-<theme-id>
git diff --check
```

Also verify that every local `href` and `src` target exists and that both SVG logos parse successfully.

**Related**:

- `ui/ui-cloudrift/`
- `ui/ui-celadon/`
- `.trellis/spec/frontend/state-management.md` for the separate application-theme integration contract
