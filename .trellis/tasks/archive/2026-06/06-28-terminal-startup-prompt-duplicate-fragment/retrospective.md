## Bug Analysis: Terminal startup prompt duplicate fragment

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: Earlier fixes assumed the remaining corruption came from backend CR/LF handling. After login banner output became complete, the remaining duplicate prompt and prompt fragments pointed to a frontend startup `sessionResize` / PTY `window_change` side effect: bash/readline can repaint the prompt when SIGWINCH arrives while login output is still settling.

### 2. Why Fixes Failed

1. Backend CRLF normalization fixed banner/prompt line separation, but did not address prompt redraw caused by frontend resize.
2. Delaying the explicit startup resize to 800ms reduced timing risk but still allowed automatic window_change during startup on slower or noisy login paths.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Documentation | Add frontend terminal startup resize rule to quality guidelines | DONE |
| P1 | Runtime guard | Suppress remote resize notifications during the terminal startup window | DONE |
| P2 | Regression coverage | Prefer an integration/UI test if terminal startup rendering becomes testable in Playwright | TODO |

### 4. Systematic Expansion

- **Similar Issues**: Other terminal startup probes or automatic commands can have visible shell side effects if they run before the prompt is stable.
- **Design Improvement**: Keep local xterm layout changes separate from remote PTY mutations during connection bootstrap.
- **Process Improvement**: When terminal display corruption remains after byte-stream normalization, inspect frontend terminal control events such as CPR, resize, focus, and startup probes.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with the terminal startup remote resize rule.
