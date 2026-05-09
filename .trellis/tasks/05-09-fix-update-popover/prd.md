# 修复 Toast / ConfirmDialog 弹窗挤变形页面

## Problem

Settings 页面点击"检查更新"按钮后，Toast 弹窗出现在右下角，但会把页面内容挤变形。

**根因**：`styles.css` 中 `.app-shell > *` 给所有直接子元素设置了 `position: relative`（第362-365行），这覆盖了 `ToastContainer` 和 `ConfirmDialog` 的 `position: fixed`，使其降级为 `relative`。结果 Toast/Confirm 不再脱离文档流，而是作为 flex 子项占据空间，挤压 `app-shell` 的 flex 布局。

**影响范围**：所有使用 `toast.*` 的通知（更新、连接、SFTP 等）以及 `ConfirmDialog` 都受此 bug 影响，不仅仅是更新检查。

## Solution

在 CSS 中排除 `ToastContainer` 和 `ConfirmDialog` 不应用 `position: relative`，恢复它们的 `position: fixed` 行为。

具体方案：给 `app-shell > *` 规则增加排除选择器，或给 Toast/Confirm 容器添加更高优先级的 `position: fixed !important`。

## Requirements

### 1. 修复 ToastContainer 和 ConfirmDialog 的定位
- `ToastContainer` 和 `ConfirmDialog` 必须使用 `position: fixed` 脱离文档流
- 它们不应作为 `app-shell` flex 布局的子项参与布局
- 弹窗出现时不影响页面其他元素的布局

### 2. 不影响其他 app-shell 子元素
- `Titlebar`、`app-body`、`StatusBar` 等仍保持 `position: relative`
- 只排除需要 `fixed` 定位的浮层组件

### 3. 不影响弹窗本身的样式和功能
- Toast 仍在右下角弹出（`fixed bottom-10 right-4`）
- ConfirmDialog 仍居中覆盖

## Files to modify

- `app/src/styles.css` — 修改 `.app-shell > *` 规则，排除浮层组件

## Acceptance criteria

1. Toast 弹窗出现时，Settings 页面布局不被挤压变形
2. ConfirmDialog 弹出时，页面布局不受影响
3. 其他 app-shell 子元素（Titlebar、Sidebar、StatusBar 等）布局正常
4. Toast 仍在右下角正确显示
5. 所有 `toast.*` 调用点正常工作（更新、连接、SFTP 等场景）
