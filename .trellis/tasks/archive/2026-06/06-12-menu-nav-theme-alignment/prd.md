# PRD: Menu Navigation Theme Alignment

## Goal

Align the main menu navigation bar between Classic and Aurora UI themes so the app shell feels consistent while preserving each theme's intended color system.

## Confirmed Facts

- The main menu navigation bar is implemented by `app/src/components/Sidebar.tsx`.
- Classic and Aurora already share the same Sidebar DOM structure: `.sidebar`, `.sidebar-brand`, `.sidebar-nav`, `.nav-item`, `.sidebar-footer`.
- Navigation labels and icons come from `navItems` in `Sidebar.tsx`; the settings entry is rendered separately in the footer.
- Theme differences are currently driven mainly by CSS:
  - Classic relies on global tokens and Tailwind utility classes from `app/src/styles.css`.
  - Aurora adds scoped sidebar layout rules in `app/src/styles/aurora/layout.css`.
- Aurora sidebar width uses `--sidebar-w` from `app/src/styles/aurora/tokens.css` while Classic sidebar width uses `--width-sidebar` from `app/src/styles.css`.
- The recent settings task established a local convention: shared layout skeletons should be reused across Classic and Aurora, with theme differences kept in CSS tokens and narrow color overrides.

## Requirements

- Classic theme must adopt the Aurora sidebar/menu navigation layout.
- Classic theme top DdShell titlebar row must match Aurora height.
- Classic and Aurora should keep the same shell/page sizing tokens where those tokens affect layout spacing, so switching themes changes colors/style but does not visibly resize the menu or page frame.
- In Settings > General, Classic UI theme option cards should use the same card and preview layout dimensions as Aurora while keeping Classic colors.
- Do not change navigation behavior, routes, labels, icons, dirty-settings confirmation, or page order.
- Do not regress the already-tuned Aurora theme.
- Preserve Classic's color identity: Classic should keep its existing blue accent, dark/light palette, and non-Aurora logo choice unless explicitly changed.
- Keep the implementation scoped to app shell/sidebar styles unless inspection shows a small JSX class-name adjustment is required.
- Cover active, hover, icon, brand, footer, dark mode, and light mode states.

## Acceptance Criteria

- Classic and Aurora menu navigation bars use the same intended layout, spacing, active indicator behavior, and item structure.
- Classic and Aurora top DdShell titlebar rows have matching height.
- Switching between Classic and Aurora does not visibly change menu item spacing, common page font sizing, terminal tabbar height, or statusbar height.
- Classic Settings > General UI theme option cards match Aurora card padding and preview block sizing.
- Classic retains Classic colors; Aurora retains Aurora colors.
- Active and hover states look coherent in both themes.
- The settings footer entry aligns visually with the main navigation items.
- Existing navigation and unsaved-settings guard still work.
- Project build or equivalent frontend validation passes.

## Out Of Scope

- Adding, removing, or renaming navigation items.
- Changing page content inside Connections, Terminal, SFTP, Monitor, Snippets, Workflows, or Settings.
- Redesigning titlebar/statusbar unless required to avoid sidebar visual mismatch.
- Introducing a collapsed sidebar mode.

## Open Questions

- None. The user confirmed Classic should adopt the Aurora navigation layout.
