# Fix Workflows List Context Menu Position Offset

## Goal

修复「命令宏（Workflows）」列表页面右键菜单弹出位置严重偏离鼠标的问题。修复后菜单应紧贴鼠标点击位置，与 Snippets 页面右键菜单一致。

## Symptom

在 `WorkflowsPage` → `WorkflowList` 中右键点击 recipe 卡片或分组标题时，弹出的 `ContextMenu` 出现在远高于鼠标的位置（约偏上 100+ 像素），影响可用性。

## Root Cause

`ContextMenu` 组件用 `position: absolute` + `style={{ left, top }}` 渲染，其坐标 `pos` 是 `useContextMenu` 通过 `e.clientX - container.rect.left` 算出的「相对 `data-context-menu-container` 元素」的坐标。

要让菜单准确出现在鼠标位置，必须满足：**absolute 元素的「最近 positioned 祖先」必须就是 `data-context-menu-container` 元素本身**。否则 absolute 会向上找 positioned ancestor，导致坐标参考点错位。

- **Snippets**：`<div ref={shellRef} className="snippets-shell" data-context-menu-container>` —— `.snippets-shell` 也无 `position: relative`，但它紧贴页面 header 下方，偏移量小（≈48px），视觉上勉强可接受。
- **Workflows**：`<div ref={listContainerRef} data-context-menu-container className="flex flex-1 flex-col overflow-hidden">` —— 该 div 无 `position: relative`，且其上方有 `workflow-page-header`（约 60px）+ `wf-list-toolbar`（约 52px），合计 112+ 像素偏移，明显错位。

最近的 positioned ancestor 实际是 `.app-body`（受 `.app-shell > *` 全局规则影响），二者坐标系不匹配。

## Fix

给 `WorkflowList` 中的 `listContainerRef` 容器加 `position: relative`，让它成为自身 absolute 子节点的 containing block。坐标系与 absolute 参考点对齐后，菜单将出现在鼠标位置。

具体做法：将该 div 的 className 从 `"flex flex-1 flex-col overflow-hidden"` 改为 `"relative flex flex-1 flex-col overflow-hidden"`。

## Scope

- 只修 `app/src/features/workflows/components/WorkflowList.tsx` 中 `listContainerRef` 所在 div 的 className（添加 `relative`）。
- 不动 `SnippetsPage`（用户明确说参考 snippets 是正确方向，且当前 snippets 视觉上可接受；如未来要彻底修齐，单独建 task）。
- 不动 `ContextMenu` 组件本身（避免影响其他调用方）。

## Acceptance

1. 在「命令宏」页面右键点击 recipe 卡片，菜单出现位置紧贴鼠标（左上角约在鼠标坐标处）。
2. 右键点击分组标题（group header），同样紧贴鼠标。
3. 菜单边界检测仍然生效（靠近右/下边界时不溢出 `listContainerRef`）。
4. Snippets 页面右键菜单行为不变。
