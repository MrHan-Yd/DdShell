---
title: fix snippets third column width and sidebar mock cleanup
status: planning
owner: han
priority: P2
created: 2026-05-20
---

# fix: snippets 第三栏宽度 + sidebar mock 数据清理

## Goal

合并两项独立的 UI 微调到同一任务，统一一次 commit：

1. 删除主侧边栏 `Sidebar.tsx` 中的 mock 假数据（meta/badge 字段）
2. 修复 snippets 页面第三栏（详情/表单区）内容不撑满父容器的问题

## Sub-item 1: Sidebar mock 数据清理（根因明确）

文件：`app/src/components/Sidebar.tsx:19-25`

删除三处 mock 字段：
- `connections` 的 `meta: "12"`
- `terminal` 的 `badge: "3"`
- `snippets` 的 `meta: "24"`

`Sidebar.tsx:78-79` 的 `<span>` 渲染依赖 `meta`/`badge` 真值判断，删字段后自然不渲染，无需改 JSX。

## Sub-item 2: snippets 第三栏宽度（根因已定位）

### 调查路径与排除

| 假设 | 验证方法 | 结论 |
|---|---|---|
| H1: `.snip-detail-scroll` padding 32px 看着像空白 | 截图测算 | ✗ 排除（右侧约 124 逻辑像素，远大于 32px padding） |
| H2: aurora 主题 override grid 列宽 | grep `aurora/**/*.css` `grid-template-columns` | ✗ 排除（aurora 未触碰 `.snippets-shell`） |
| H3: 内容元素有 max-width | 读 `.snip-cmd-block` / `.snip-detail-head` / `.snip-detail-meta` 规则 | ✗ 排除（均无 max-width） |
| H4: `@keyframes fade-in-up` 改 width | 读 `styles.css:2149-2152` | ✗ 排除（只动 opacity + transform） |
| H5: 滚动条占空间 | 截图无垂直滚动条 | ✗ 排除（当前数据量未触发滚动） |
| **H6: detail 态内容未声明 `width: 100%`，block 元素在嵌套 flex+overflow:auto 链中未撑满父** | 对比 `.snip-form { width: 100% }` 与 `.snip-cmd-block`（无 width）的不对称 | **✓ 高置信度** |

### 关键证据链

- `.snippets-shell { grid-template-columns: 220px 320px minmax(0, 1fr) }`（`styles.css:4325`） — grid 第三列正确撑满 ✓
- `.snip-detail-shell { display: flex; flex-direction: column; overflow: hidden }`（`styles.css:4669-4677`） — flex 容器
- `.snip-detail-scroll { flex: 1; overflow-y: auto; padding: 32px }`（`styles.css:4680-4684`） — flex item，**block 元素**（无 display:flex）
- 表单态渲染：`<div className="animate-fade-in-up snip-form">`（`SnippetsPage.tsx:1013`）— 吃到 `.snip-form { width: 100% }`（`styles.css:4815`）
- 详情态渲染：`<div className="animate-fade-in-up">`（`SnippetsPage.tsx:1056, 1077`）— **无任何 width 类**
- 截图：BASH 块只占第三栏内容区 ~67%，右侧 ~124 逻辑像素（>100px）空白

### 根因判定

作者已经在 `.snip-form` 上**显式打了 `width: 100%` 补丁**，说明开发时已发现这个不撑满问题，但**仅修复了表单态**，详情态（detail）和分组详情态（group-detail）漏修。

用户 han 反馈"三种状态都有空白"补充印证：
- 表单态：`.snip-form { width: 100% }` 撑满了 wrapper，但 wrapper（`.animate-fade-in-up.snip-form`）本身是否真的撑满 `.snip-detail-scroll` 还需运行时验证 —— 推测 `.snip-form` 的 100% 是相对 wrapper（已撑满），所以表单内输入框等也都撑满；但 han 说表单态也有空白，意味着 wrapper 层本身也没撑满父
- 详情态/分组详情态：wrapper（`.animate-fade-in-up`）无 width，内容（`.snip-cmd-block` 等）也无 width，所以更明显地不撑满

## Fix Proposal (推荐方案 A)

**方案 A — 给所有详情态 wrapper 统一加 width**（最小改动 + 解决三种状态）

在 `styles.css` 中追加一条规则，确保 `.snip-detail-scroll` 的所有直接子元素都撑满：

```css
.snippets-shell .snip-detail-scroll > * {
  width: 100%;
}
```

效果：表单态、详情态、分组详情态、空状态四种 wrapper 全部撑满，不再需要单独维护 `.snip-form { width: 100% }`（可保留也可删除，作为冗余兜底）。

**方案 B — 在 SnippetsPage.tsx 中给详情态 wrapper 加类**（侵入到组件）

把 `<div className="animate-fade-in-up">` 改成 `<div className="animate-fade-in-up w-full">`（或新加 `.snip-detail-pane`），分别给两处详情 wrapper 加类。
- ✗ 缺点：需改两处 React 代码，跟现有 `.snip-form` 模式不一致

**方案 C — 改 `.snip-detail-scroll` 为 flex column**（影响最大）

```css
.snippets-shell .snip-detail-scroll {
  display: flex;
  flex-direction: column;
  /* 其他不变 */
}
```
flex column 强制 cross-axis stretch 子元素撑满横向。
- ✗ 缺点：可能影响子元素 margin 折叠或滚动行为，回归风险大

### 选择 A 的理由
- 改动最小（一条 CSS 规则）
- 一次性覆盖所有 wrapper（含未来新增的态）
- 与现有 `.snip-form { width: 100% }` 思路一致（width 100% 是这个项目作者已采用的修复模式）

## Requirements

- Sidebar 不再渲染数字 badge / meta（删除 mock 字段）
- snippets 第三栏在所有状态（空 / 选中 snippet / 编辑表单 / 选中 group）下，内容右边界距离第三栏右边界仅有 `.snip-detail-scroll` 的 32px padding，无额外空白

## Acceptance Criteria

- [ ] Sidebar 主导航中 connections / terminal / snippets 三项右侧不再显示数字
- [ ] snippets 页空状态、选中 snippet、编辑表单、选中分组四种状态下，第三栏内容（BASH 块 / 输入框 / 标题等）撑满到右 padding（32px）边缘，无 >100px 空白
- [ ] Aurora 与 Classic 主题下均验证通过
- [ ] 不引入第三栏出现水平滚动条

## Definition of Done

- 在 aurora 主题下手测 snippets 页所有四种状态
- 改动最小：仅 1 行 CSS + 3 处 TS mock 字段删除
- `pnpm tsc --noEmit` 通过

## Out of Scope

- 将 sidebar mock 替换为真实计数（接 store 动态填充） —— 后续独立任务
- 重构 snippets 整体 layout
- 改 grid 列宽比例（220 / 320 不变）
- 删除已有的 `.snip-form { width: 100% }`（保留作冗余兜底，避免引入回归）

## Technical Notes

### 关键文件
- `app/src/components/Sidebar.tsx:19-25` — 删除三处 mock 字段
- `app/src/styles.css:4680-4684` — 在 `.snip-detail-scroll` 规则后追加 `> *` 子选择器规则

### 当前主题
- han 使用 aurora，但本次修复在 base `styles.css` 中（非 aurora override），两个主题都生效

### 截图证据
- `ScreenShot_2026-05-20_210909_560.png`（项目根目录）—— 第三栏 BASH 块只占约 67% 宽度，右侧 ~124 逻辑像素空白
