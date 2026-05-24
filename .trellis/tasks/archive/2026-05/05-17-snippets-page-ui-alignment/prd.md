# Snippets Page UI Alignment

## Goal

对照 `ui/snippets.html` + `ui/styles/pages/snippets.css` 静态设计稿，将 `app/src/features/snippets/SnippetsPage.tsx` 从当前的两栏布局重构为设计稿的三栏布局（220px 分组导航 + 320px 片段卡片列表 + 1fr 详情面板），并对齐卡片、详情头部、命令块、tags 的视觉样式。**只改样式/布局，所有现有 store/handler/事件逻辑保持原样**。

## Requirements

### 布局结构（三栏）

**左列 (220px) — 分组导航**
- 顶部工具栏：搜索框 + 新建分组按钮（保留现有 `setSearchQuery` 逻辑）
- Library 区（section-title "Library"）：仅一个项 "All snippets"（点击 → `selectedGroupId = null`、显示所有片段）
- Groups 区（section-title "Groups"）：用户自定义分组列表，每行 `icon + label + count`；保留拖放 drop target、右键菜单（重命名/删除）、内联重命名
- 末尾："Ungrouped" 项（仅当 `groups.length > 0` 时显示）：点击切换到未分组过滤；可作为 drop target

**中列 (320px) — 片段卡片列表**
- 顶部 head：标题（"All snippets · N" 或当前分组名 + count）+ 新建片段按钮 + 批量选择按钮
- 列表区：当前过滤条件下的片段渲染为 `snip-card` 卡片（标题 + 命令预览 pre + tags），`is-active` 状态边框 accent + 发光
- 底部：批量选择激活时显示当前的操作栏（保留现有 selectAll/batchDelete 逻辑）

**右列 (1fr) — 详情/表单/分组详情**
- SnippetDetail 视觉对齐设计稿：大标题 + desc（如有）+ tags chips → 命令块（深色 `card-glow` 风格、Copy 按钮）→ 元数据
- SnippetForm / GroupDetail / MoveToGroupModal 视觉不变（设计稿未涉及）
- 详情头部操作仅保留 edit/delete icon 按钮（不加 favorite）

### 保留的功能（一行不动逻辑）

- 拖拽 snippet 到分组（mouse-based drag，drop target 现在变成左列分组项）
- 批量选择删除（操作栏移到中列底部）
- 右键菜单（snippet / group）
- 内联重命名分组
- Move to Group Modal
- 新建分组的内联输入流程
- SnippetForm（新建/编辑片段）
- selectedSnippetId / selectedGroupId 互斥逻辑

### 视觉对齐项

- snip-card 样式：圆角、背景 `bg-surface`、hover/active 状态
- 命令预览 `pre`：等宽字、ellipsis、深色背景
- 详情命令块：深色 `term-bg`、card-glow 包裹、Copy 按钮
- tags 统一为现有 `.tag` 样式
- 详情头部操作按钮：`btn-icon btn-ghost` 样式
- 间距 / 字号 / 圆角全部用 token

## Acceptance Criteria

* [ ] 三栏布局生效：左 220px / 中 320px / 右 1fr
* [ ] 现有功能全部可用：新建/编辑/删除片段、新建/重命名/删除分组、拖拽移动到分组、批量选择删除、右键菜单（snippet/group）、Move-to-Group Modal、内联重命名、搜索过滤
* [ ] "All snippets" 入口可正确切换到显示全部片段视图
* [ ] "Ungrouped" 入口可正确切换到显示未分组片段视图（仅当存在分组时显示）
* [ ] 选中分组时右列显示 GroupDetail；选中片段时右列显示 SnippetDetail；新建/编辑时显示 SnippetForm；无选中时显示 empty state
* [ ] 拖动片段到左列分组项时高亮 drop target；释放后片段移动到目标分组
* [ ] 视觉与 `ui/snippets.html` 三栏布局、`snip-card`、详情头部、命令块、tags 一致
* [ ] 完全不引入：Favorites/Recent 智能集合、段控制排序、卡片收藏星标、使用次数、详情 favorite 按钮、bash lang-tag、命令语法高亮、Variables、Run/Insert、Recent runs
* [ ] lint / typecheck / build 通过

## Definition of Done

* lint / typecheck / build 通过
* 手动验证所有现有交互无回归（重点：拖拽、批量、右键菜单、移动到分组）
* 提交一个 commit：`feat(snippets): align page layout and styles with design draft`

## Technical Approach

### 文件改动范围

- **主要文件**：`app/src/features/snippets/SnippetsPage.tsx`
  - 顶层容器从 2 列 flex 改为 3 列 grid
  - 重组左列：搜索 + Library 区 + Groups 区 + Ungrouped 项；GroupHeader 改为不再展开下挂片段（移除 `expandedGroupIds`、`drawer-wrapper` 包裹片段子项的渲染分支）
  - 新增中列：根据 `selectedGroupId`（null = All；"ungrouped" 哨兵 = Ungrouped；其他 = 该分组）过滤片段；渲染 snip-card；移动批量选择栏、新建按钮到这里
  - 右列保留现有 `SnippetDetail` / `SnippetForm` / `GroupDetail` 分支；调整 SnippetDetail 内部样式
- **样式文件**：`app/src/styles.css`（参考 `feae9c1` 风格，新增本页专用类如 `.snippets-shell`、`.snip-aside`、`.snip-list`、`.snip-card`、`.snip-detail`、`.cmd-block` 等，token 化）
- **store/types**：完全不动

### Drop target 调整

当前 `data-drop-group-id` 标记在 GroupHeader（位于左列内联展开树中）。三栏后 GroupHeader 转移到独立左列，`data-drop-group-id` 标记保留，drag handler 不需改 — 因为它通过 `document.elementFromPoint` 查找，只要 DOM 上还有 `data-drop-group-id` 元素就工作。中列卡片通过 `onMouseDown` 启动拖动，左列分组项作为 drop target，仍兼容。

### 移除的内联展开/折叠语义

`expandedGroupIds` state、`drawer-wrapper` 包裹的 in-tree 片段渲染、`onToggle` ChevronRight 按钮 — 这些在三栏方案下消失。点击左列分组直接切换中列内容。auto-expand-on-drag 计时器逻辑（`autoExpandTimerRef`）相应移除（无展开/折叠需求）。

### 中列 head 标题

* `selectedGroupId === null` → "All snippets · {总数}"
* `selectedGroupId === "ungrouped"` → "Ungrouped · {未分组数}"
* 否则 → "{groupName} · {该分组数}"

> 引入哨兵字符串 `"ungrouped"` 仅用于本组件内的中列过滤状态，不污染 store（store 中 selectedGroupId 仍是 `string | null`，但本组件维护一个独立的 `viewMode` 或扩展为 `string | null | "ungrouped"` — 实现时择优）。

## Decision (ADR-lite)

**Context**: 设计稿是三栏布局且含大量当前 store 不支持的功能性元素；项目 spec L63 要求静态草稿仅作视觉参考。

**Decision**: 采用三栏布局重构 + 严格排除所有 store 不支持的元素。左列分组导航独立化、中列卡片列表、右列详情。保留所有现有功能，仅改变 DOM/CSS 结构与样式。

**Consequences**:
- 牺牲：分组内联展开/折叠交互（用导航切换替代，UX 不同但等价）
- 收益：视觉与设计稿三栏架构一致；为后续可能引入的 Favorites/Sort/Variables/Run 功能预留位置（仅在 store 与 backend 支持后再加）
- 风险：拖放、批量、右键菜单 DOM 结构变化导致回归；需手动验证全交互链

## Out of Scope

* 任何 store / API / 后端字段变更
* 引入设计稿独有但 store 无支持的元素（Favorites、Recent、Sort、收藏星标、usage count、Variables、Run、Recent runs、bash lang-tag、命令语法高亮、详情 favorite 按钮）
* SnippetForm / MoveToGroupModal 的视觉调整（设计稿未涉及）
* 任何性能优化、虚拟列表等

## Technical Notes

* 设计稿源：`ui/snippets.html`、`ui/styles/pages/snippets.css`
* 当前实现：`app/src/features/snippets/SnippetsPage.tsx`（1238 行）
* Store：`app/src/stores/snippets.ts`
* 类型：`Snippet`、`SnippetGroup`（来自 `@/types`）
* 对齐范式参考：commit `feae9c1`（workflows 宏步骤对齐）、`ca49128`（workflow editor steps）、`b76a96a`（workflows 页面对齐）
* 关键约束：`.trellis/spec/frontend/component-guidelines.md` L63-84 静态草稿约定
