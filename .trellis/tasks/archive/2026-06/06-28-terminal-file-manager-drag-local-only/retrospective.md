## Bug Analysis: File manager height drag still repaints prompt

### 1. Root Cause Category

- **Category**: E - Implicit Assumption
- **Specific Cause**: The previous boundary treated manual file-manager height drag as a user resize that should sync to the remote PTY. User feedback showed that even this single final `window_change` makes bash/readline repaint a prompt. File-manager height drag is still an internal panel layout change, not a real remote terminal resize.

### 2. Why Fixes Failed

1. Open/close paths were made local-only, but drag kept `syncResizeAfterSuspend=true`.
2. The code distinguished "manual drag" from "panel transition"; the product behavior needs to distinguish "file-manager internal layout" from "real terminal surface resize".

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Runtime guard | Make all file-manager-caused suspended fits local-only | DONE |
| P0 | Documentation | Update frontend terminal resize rule to include file-manager height drag | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Any internal panel drag that changes terminal viewport height can repaint prompt if it reaches remote PTY.
- **Design Improvement**: Only app window resize and terminal split-pane resize should be considered remote terminal surface changes.
- **Process Improvement**: Validate open, close, internal close button, and drag paths whenever fixing terminal panel resize behavior.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` to classify terminal file manager height drag as local-only.
