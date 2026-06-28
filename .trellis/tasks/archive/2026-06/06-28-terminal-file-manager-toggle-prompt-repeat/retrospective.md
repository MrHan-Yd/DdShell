## Bug Analysis: File manager final fit still repeats prompt

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: The previous fix assumed suppressing repeated resize during the file manager transition and sending one final remote resize would be safe. On the reported server, even that final PTY `window_change` can make bash/readline repaint the prompt into the terminal buffer. File manager open/close is an internal app layout change, so the final xterm fit should be local-only.

### 2. Why Fixes Failed

1. Startup resize suppression fixed connection bootstrap but not later UI panel toggles.
2. File manager transition suppression reduced resize bursts, but still allowed the final pending fit to call `sessionResize`.
3. The mental model treated terminal height changes caused by app chrome as remote terminal size changes. For this UI, they should be local viewport changes unless the user explicitly resizes the terminal surface.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime guard | Track whether a pending fit should sync remote resize after suspension | DONE |
| P0 | Documentation | Clarify that internal panel final fit is local-only | DONE |
| P2 | Test coverage | Add UI coverage when terminal resize side effects can be exercised reliably | TODO |

### 4. Systematic Expansion

- **Similar Issues**: AI assist panels, history/bookmark drawers, or future terminal-adjacent UI should not blindly convert app-layout transitions into remote PTY resize.
- **Design Improvement**: Keep local xterm viewport fitting separate from remote PTY `window_change`; make callers state whether a suspended fit should sync remotely.
- **Process Improvement**: After fixing terminal repaint issues, validate both open and close paths, not only the first visible transition.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` to require local-only final fits for internal terminal panels.
