# Terminal History Overlay Drawer

## Goal

Make the terminal command history drawer behave like the bookmarks drawer: opening history should not shrink or squeeze the terminal input area. Also move the bookmarks icon to the left of the history icon in the top-right terminal toolbar.

## Confirmed Facts

- `CommandHistoryPanel` currently renders as a right-side flex sibling with `w-[280px]`, so it reduces the terminal area's available width.
- `BookmarkPanel` currently renders inside the terminal area as an absolute slide-out drawer and does not squeeze terminal panes.
- The history toolbar button currently appears before the bookmark drawer peg; the bookmark icon is inside the terminal area's right-edge drawer peg.

## Requirements

- History opens as an overlay drawer instead of a layout-resizing flex sibling.
- History panel should preserve its current content, search, clear, insert, and close behavior.
- History should visually match the bookmark drawer pattern enough to feel consistent.
- Bookmark control should appear to the left of history in the right-side control area.
- Opening history or bookmarks must not resize the terminal panes.
- Confirm dialogs should better match the current theme style, including the close-session confirmation.

## Acceptance Criteria

- Opening history no longer changes terminal pane width.
- Bookmarks icon appears left of the history icon.
- Existing history insert and close behavior still works.
- Confirm dialogs use a theme-aligned card, icon treatment, spacing, and action footer.
- `pnpm --dir app build` passes.

## Out of Scope

- Redesigning history item content.
- Changing bookmark persistence or navigation behavior.
- Adding new settings.
