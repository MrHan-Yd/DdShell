## Bug Analysis: File manager close button bypassed resize guard

### 1. Root Cause Category

- **Category**: C - Change Propagation Failure
- **Specific Cause**: The file-manager toolbar toggle path used the guarded close logic, but the drawer's internal X button still called `setShowFileManager(false)` directly. That bypassed `beginFileManagerLayoutTransition()` and did not enable the local-only remote resize suppression window.

### 2. Why Fixes Failed

1. Earlier fixes focused on the toolbar file-manager button and shared layout lifecycle.
2. The internal drawer close button was a separate callback and did not reuse the same close path.
3. Testing covered open/toggle behavior but missed the drawer-owned X close button shown in the user's screenshot.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Code structure | Route all file-manager close entry points through one `closeFileManager` callback | DONE |
| P1 | Review checklist | Search for direct `setShowFileManager(false)` when changing file-manager close behavior | DONE |

### 4. Systematic Expansion

- **Similar Issues**: Any panel with multiple close controls can bypass guarded close logic if callbacks mutate state directly.
- **Design Improvement**: Panel close side effects should live in one named callback and be passed to children.
- **Process Improvement**: Validate every visible close affordance, not only the toolbar toggle.

### 5. Knowledge Capture

- Task PRD and retrospective record the close-button bypass.
