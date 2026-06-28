## Bug Analysis: File manager caused local xterm repaint flicker

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: After remote PTY resize was suppressed, file-manager open/close/drag still changed the xterm container height. That caused local xterm `fit()`/buffer repaint and made the active command line visibly flash. The issue was local layout participation, not remote shell output.

### 2. Why Fixes Failed

1. Previous fixes correctly stopped remote `window_change`, but still let the file manager shrink the terminal pane.
2. Treating the file manager as a layout row forced terminal rows to change whenever the panel appeared or resized.
3. The visual requirement needs the terminal viewport to remain stable while the internal tool panel moves independently.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Layout boundary | Render the terminal file manager as an absolute bottom overlay instead of a layout row | DONE |
| P1 | Documentation | Document terminal-internal panels should avoid resizing the xterm container | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Future terminal overlays can cause flicker if they participate in terminal pane layout.
- **Design Improvement**: Terminal chrome should prefer overlays when the user does not need remote PTY rows/cols to change.
- **Process Improvement**: For terminal visual bugs, separate remote output, remote PTY resize, local xterm fit, and CSS layout causes.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with overlay guidance for terminal-internal panels.
