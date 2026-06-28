## Bug Analysis: Overlay file manager can hide terminal bottom

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: Converting the file manager to an overlay stopped xterm resize flicker, but the overlay could cover the active command line. The safe area must be visual-only: move terminal panes with CSS transform instead of changing xterm's measured container height.

### 2. Why Earlier Options Were Risky

1. Resizing xterm would reintroduce local repaint flicker.
2. Sending remote PTY resize would reintroduce bash/readline prompt repaint.
3. A plain overlay would hide terminal bottom content.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Layout boundary | Keep file manager as bottom overlay and move terminal panes visually with transform | DONE |
| P1 | Documentation | Document transform-based safe area for terminal overlays | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Any terminal overlay that covers the active input area needs a visual safe area.
- **Design Improvement**: Terminal overlays should use visual transforms/padding that do not affect xterm measurement unless remote PTY resize is explicitly desired.
- **Process Improvement**: When optimizing terminal panel UX, validate three dimensions separately: visibility, local repaint, and remote prompt repaint.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with transform-based safe area guidance.
