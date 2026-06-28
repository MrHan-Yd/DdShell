## Bug Analysis: File manager close still sends remote resize

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: The previous local-only fit covered the pending fit after the visible transition, but closing the file manager still caused later layout changes when the drawer unmounted and the terminal grid rebounded. Those later `term.onResize` events could still call `sessionResize`, so bash/readline repainted prompt lines.

### 2. Why Fixes Failed

1. Suppressing resize only while `isFileManagerTransitioning` was true did not cover teardown after the transition timer.
2. Making one pending fit local-only did not cover independent `onResize` events emitted after drawer unmount.
3. The fix needed an explicit remote-resize suppression window for file-manager toggle lifecycle, separate from manual drag behavior.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime guard | Add independent `suppressRemoteResize` gate in `TerminalInstance.onResize` | DONE |
| P0 | Scope boundary | Enable that gate only for file manager open/close lifecycle, not manual drag | DONE |
| P1 | Documentation | Document that internal panel suppression must cover unmount/rebound | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Any terminal-adjacent UI that unmounts after animation can emit post-transition resize events.
- **Design Improvement**: `suspendResize` handles local fit timing; `suppressRemoteResize` handles whether xterm resize events may reach the remote PTY.
- **Process Improvement**: Validate terminal panel bugs across open, close, unmount, and rapid toggle paths.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with the unmount/rebound suppression requirement.
