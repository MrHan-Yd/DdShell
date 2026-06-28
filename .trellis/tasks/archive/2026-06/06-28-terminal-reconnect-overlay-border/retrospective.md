## Bug Analysis: Reconnect overlay border clipped by safe-area transform

### 1. Root Cause Category

- **Category**: B - Cross-Layer Contract
- **Specific Cause**: The file-manager safe-area transform was applied to the whole terminal panes container. That moved terminal overlays, including the disconnect/reconnect card, along with xterm content and let the outer overflow clipping hide part of the card border.

### 2. Why Fixes Failed

1. The safe-area design correctly avoided xterm resize, but applied the transform at too broad a DOM level.
2. Terminal content and terminal overlays were treated as one visual layer.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Layout boundary | Apply safe-area transform only to `.terminal-xterm-surface` | DONE |
| P1 | Documentation | Record that overlay siblings must not be transformed by terminal safe area | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Command assist, reconnect overlay, and other terminal UI overlays can be clipped if parent containers are transformed.
- **Design Improvement**: Separate xterm surface transforms from overlay/card positioning.
- **Process Improvement**: When adding visual transforms, check overlay siblings in connected and disconnected states.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md` with xterm-surface-only transform guidance.
