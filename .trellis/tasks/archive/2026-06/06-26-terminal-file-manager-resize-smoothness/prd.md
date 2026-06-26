# PRD: Terminal File Manager Resize Smoothness

## Goal

Improve the terminal file manager drawer resize feel when users drag its top resize handle.

## Confirmed Facts

- The drawer height is controlled by `fileManagerHeight` in `TerminalPage.tsx`.
- Mouse movement currently updates height directly through React state on every `mousemove`.
- The drawer shell CSS transitions `height` and `flex-basis`, so drag updates can visibly lag behind the pointer.
- This task is scoped to the first two optimizations requested by the user.

## Requirements

- Disable drawer `height` and `flex-basis` transition while the user is actively resizing.
- Disable parent terminal grid row transition while the user is actively resizing.
- Keep the existing open/close animation behavior when the drawer is not being resized.
- Throttle resize height updates with `requestAnimationFrame`, so at most one DOM height/grid update is committed per frame.
- Avoid running xterm `fit()` and remote resize on every drag frame; defer terminal fit until the resize ends.
- Clean up any pending animation frame and document listeners when resizing ends.

## Acceptance Criteria

- Dragging the terminal file manager resize handle follows the pointer more directly.
- The drawer still animates when opening or closing.
- Releasing the mouse commits the final height.
- TypeScript build passes.

## Out of Scope

- Virtualizing the file list.
- Changing the drawer visual design.
