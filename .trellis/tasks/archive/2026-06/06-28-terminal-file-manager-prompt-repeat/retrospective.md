## Bug Analysis: File manager open repeats terminal prompt

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: Terminal-adjacent UI layout transitions were treated like ordinary stable resizes. Opening or closing the terminal file manager animates terminal container height, so `ResizeObserver -> fitAddon.fit() -> term.onResize -> sessionResize` could send several PTY `window_change` events in a short burst. Bash/readline can repaint the prompt for each SIGWINCH, producing repeated empty prompts in the terminal buffer.

### 2. Why Fixes Failed

1. The startup resize fix covered connection bootstrap only; it did not cover later terminal layout transitions.
2. Existing `suspendResize` covered manual file manager dragging, but not the click-to-open/click-to-close animation path.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime guard | Suspend terminal remote resize while file manager layout transitions | DONE |
| P0 | Documentation | Generalize frontend terminal resize guideline from startup-only to transient layout changes | DONE |
| P2 | Test coverage | Add UI/integration coverage if terminal resize side effects become testable in Playwright | TODO |

### 4. Systematic Expansion

- **Similar Issues**: Any animated panel that changes terminal container dimensions can cause repeated PTY resize unless it uses the same suspend/pending-fit path.
- **Design Improvement**: Treat terminal local layout fitting and remote PTY resize as separate operations; coalesce remote resize until UI layout is stable.
- **Process Improvement**: When adding terminal-adjacent panels, explicitly check whether their animation changes terminal rows/cols and whether `suspendResize` covers the transition.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with a broader terminal transient layout resize rule.
