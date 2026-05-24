# Snippets Page UI Alignment — Round 2

## Goal

继续对齐 `ui/snippets.html` + `ui/styles/pages/snippets.css` 设计稿，修复 Round 1 遗留的视觉差距。**只改样式/布局，所有现有 store/handler/事件逻辑保持原样**。

## Requirements

### 1. nav-count 样式对齐设计稿

**设计稿**（`ui/styles/layout.css` list-item + `ui/snippets.html` L80 inline style）:
- `font-size: 10px`
- `color: var(--fg-muted)`
- 无背景、无胶囊、无 border-radius

**当前实现** (`app/src/styles.css` L4365-4373):
- `font-size: 10px; color: var(--color-text-muted)`
- `background: var(--color-bg-elevated); border-radius: 999px; padding: 1px 8px`

**修改**:
- `.snip-nav-item .nav-count` 移除 `background`、`border-radius: 999px`、`padding` → 改为纯文本样式 `margin-left: auto; font-size: 10px; color: var(--color-text-muted);`

### 2. detail 标题字号对齐

**设计稿**: `--fs-2xl`（推测约 22-24px）
**当前实现**: `--font-size-xl` (20px)
**项目约束**: 无 `--font-size-2xl` token

**修改**:
- `.snip-detail-title` 字号改为 `22px`（与设计稿 `--fs-2xl` 视觉一致，不引入新 token）

### 3. snip-card 圆角对齐

**设计稿**: `var(--radius-md)` (components.css 通用 `list-item`/`snip-card` 用 md)
**当前实现**: `var(--radius-control)` (10px in dark theme)

**修改**:
- `.snip-card` `border-radius` 从 `var(--radius-control)` 改为 `var(--radius-card)` — 与设计稿 `var(--radius-md)` 更对齐

### 4. nav-item padding 对齐

**设计稿** (list-item): `padding: var(--space-2) var(--space-3)` → 8px 12px
**当前实现**: `padding: 6px 8px`

**修改**:
- `.snip-nav-item` padding 改为 `8px 12px`

### 5. cmd-block 结构对齐设计稿 card-glow 模式

**设计稿** (`ui/snippets.html` + `ui/styles/pages/snippets.css`):
```html
<div class="snip-cmd-block card-glow">
  <div class="inner">
    <header class="cmd-block-head">
      <span class="lang-tag mono">bash</span>  <!-- OOS: 不加 -->
      <span class="cmd-block-actions">
        <button class="btn btn-ghost btn-sm">Copy</button>
      </span>
    </header>
    <pre class="cmd-block mono">...</pre>
  </div>
</div>
```
- 外层 `card-glow`：渐变描边 (`accent-gradient-soft`) + 深色 `.inner`
- `cmd-block-head` padding `8px var(--space-3)`
- Copy 按钮右侧对齐

**当前实现** (`SnippetsPage.tsx` L336-344 + `styles.css` L4622-4648):
```tsx
<div className="snip-cmd-block">
  <div className="snip-cmd-block-head">
    <Button size="sm" variant="ghost" onClick={handleCopy}>Copy</Button>
  </div>
  <pre>{snippet.command}</pre>
</div>
```
- 无 `.inner` 包裹，直接深色块 + border
- Copy 按钮 `justify-content: flex-end`

**修改** (CSS-only, 不改 TSX 结构 — 卡片已有 `.snip-cmd-block` 类，只需调整样式让它视觉匹配 `card-glow + .inner` 效果):
- `.snip-cmd-block` 添加 `padding: 1px; background-image: linear-gradient(...)` 模拟 `card-glow` 渐变描边
  - 内部内容直接用现有 `.snip-cmd-block-head` + `pre` 即可，不需要额外 `.inner` DOM
- 或者更简单：保持现有 border，让 `border-color` 使用半透明 accent 渐变感
  - 实际上 `card-glow` 效果是 1px 渐变描边 + 内部深色填充，当前实现已有 `border: 1px solid rgba(167, 139, 250, 0.16)` + `background: rgba(11, 12, 18, 0.96)`，视觉上已经很接近
  - **结论**: cmd-block 视觉已基本对齐，仅需微调 pre padding 为 `12px 16px`（设计稿 `var(--space-3) var(--space-4)`）

### 6. snip-card-preview padding 微调

**设计稿**: `padding: 6px 8px`
**当前实现**: `padding: 6px 8px`
**结论**: 已对齐，无需改动

### 7. page-header (三栏上方标题+操作栏)

**设计稿** (`ui/snippets.html` L60-73):
```html
<div class="page-header">
  <div class="title-block">
    <span class="title">Snippets</span>
    <span class="subtitle">24 snippets · 3 groups · synced 4 min ago</span>
  </div>
  <div class="actions">
    <button class="btn btn-secondary btn-sm">Import</button>
    <button class="btn btn-primary btn-sm">New snippet</button>
  </div>
</div>
```

**当前实现**: 无 page-header，三栏直接撑满

**分析**:
- 设计稿 page-header 含 "Import" 按钮 + "New snippet" 按钮 — Import 功能 store 不支持（OOS），"New snippet" 按钮已在中列 head
- 按照组件约定（`component-guidelines.md` L63-84）：静态草稿仅作视觉参考，不加 draft-only 按钮
- 但 `page-header` 布局结构本身（标题+副标题+actions）对整体页面视觉层次有影响
- 副标题 "24 snippets · 3 groups · synced 4 min ago" 中 sync 信息 store 不支持

**决策**:
- **不加 page-header** — 三个栏已经各司其职，加 page-header 会压缩三栏可用空间且 Import 按钮无功能。当前中列 head 的标题 + 操作按钮已覆盖此信息密度
- 如用户后续需要 page-header 再单独加

### 8. SnippetForm 视觉风格对齐

设计稿无独立表单页，但表单页显示在右列详情面板中，应与设计稿整体视觉语言一致（深色终端风格命令输入、card-glow 风格、section-title 标签、按钮风格）。

**当前实现** (`SnippetsPage.tsx` L32-138):
- 表单包裹: `mx-auto w-full max-w-md` + `animate-fade-in-up`
- 标签: inline Tailwind `text-[var(--font-size-xs)] text-[var(--color-text-secondary)]`
- 命令输入: 普通 textarea, `bg-[var(--color-bg-elevated)]` + `rounded-[var(--radius-control)]`
- 按钮区: `flex justify-end gap-2 pt-2`，Cancel 用 `variant="secondary"`，Submit 无 accent glow

**修改** (TSX + CSS):

#### 8a. 表单容器
- 替换 `mx-auto w-full max-w-md` → 添加专用类 `snip-form`
- `snip-form` 样式: `max-width: 480px; margin: 0 auto; width: 100%;`

#### 8b. 表单标题
- 替换 `mb-4 text-[var(--font-size-lg)] font-medium` → 专用类 `snip-form-title`
- `snip-form-title` 样式: `font-size: var(--font-size-xl); font-weight: 600; letter-spacing: -0.01em; margin-bottom: 20px; color: var(--color-text-primary);` — 和详情标题风格一致

#### 8c. 表单字段标签
- 替换 inline `mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]` → 专用类 `snip-form-label`
- `snip-form-label` 样式: `display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); font-weight: 600; margin-bottom: 6px;` — 和设计稿 `.section-title` / `.label` 体系对齐

#### 8d. 命令输入框 → 深色终端风格
- 替换 textarea 的 inline Tailwind class → 专用类 `snip-form-cmd`
- `snip-form-cmd` 样式:
  - `background: rgba(11, 12, 18, 0.96)` — 和 cmd-block 一致的深色终端背景
  - `color: #E8E9F1` — 终端前景色
  - `border: 1px solid rgba(167, 139, 250, 0.16)` — 和 cmd-block 一致的 accent 边框
  - `border-radius: var(--radius-card)` — 和卡片一致
  - `padding: 14px 16px; font-family: var(--font-mono); font-size: var(--font-size-base); line-height: 1.6;`
  - `resize: vertical; outline: none; width: 100%;`
  - `focus:border-color: rgba(167, 139, 250, 0.32); box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.08);`
  - light theme: `background: #14151B; border-color: rgba(124, 58, 237, 0.18);`

#### 8e. 按钮区
- 替换 `flex justify-end gap-2 pt-2` → 专用类 `snip-form-actions`
- `snip-form-actions` 样式: `display: flex; justify-content: flex-end; gap: 8px; padding-top: 16px; border-top: 1px dashed var(--color-border-subtle); margin-top: 8px;`
- Cancel 按钮保持 `variant="secondary"`
- 提交按钮保持默认（已经是 primary variant，自带 accent gradient）

### 9. detail-title 字号精确对齐（26px）

设计稿 `--fs-2xl` = 26px。Round 2 前半改成了 22px，仍差 4px。

**修改**:
- `.snip-detail-title` `font-size: 22px` → `26px`

### 10. nav-item border-radius 对齐

**设计稿**: `list-item` 用 `--radius-md` = 8px
**当前实现**: `var(--radius-control)` = 10px（dark theme）/ 12px（light theme）

**修改**:
- `.snip-nav-item` `border-radius: var(--radius-control)` → `8px`

### 11. snip-card border-radius 对齐

**设计稿**: `var(--radius-md)` = 8px
**当前实现**: `var(--radius-card)` = 12px（Round 2 前半从 control 改为 card，但 card 更大）

**修改**:
- `.snip-card` `border-radius: var(--radius-card)` → `8px`

### 12. detail padding 对齐

**设计稿**: `var(--space-7)` = 32px
**当前实现**: `28px`

**修改**:
- `.snip-detail-scroll` `padding: 28px` → `32px`

### 13. detail-head margin-bottom 对齐

**设计稿**: `var(--space-5)` = 20px
**当前实现**: `24px`

**修改**:
- `.snip-detail-head` `margin-bottom: 24px` → `20px`

### 14. snip-card-title font-size 对齐

**设计稿**: `--fs-sm` = 12px
**当前实现**: `var(--font-size-sm)` = 13px

**修改**:
- `.snip-card-title` `font-size: var(--font-size-sm)` → `12px`

### 15. card-glow 渐变描边结构

**设计稿**: 外层 `.card-glow` 用 `background-image: var(--accent-gradient-soft)` 渐变描边 + 1px padding + `.inner` 深色填充
**当前实现**: 直接深色块 + `border: 1px solid rgba(167,139,250,0.16)`

**修改** (CSS-only，用 padding:1px + background-image 模拟 card-glow，无需改 TSX):
- `.snip-cmd-block`: 添加 `padding: 1px; background: var(--accent-gradient-soft, linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.18)));`
- `.snip-cmd-block-head` 和 `.snip-cmd-block pre` 不需要改动（它们已在内部）
- 现有 `border` 移除（gradient padding 取代 border 描边效果）
- 现有 `box-shadow` 保留

### 16. detail accent gradient 简化

**设计稿**: `radial-gradient(ellipse 60% 30% at 80% 0%, var(--accent-subtle), transparent 70%), var(--bg-base)`
**当前实现**: `color-mix(in srgb, var(--color-accent-subtle) 82%, transparent)` — color-mix 产生单色，不是真渐变

**修改**:
- `.snip-detail-shell` background 改为 `radial-gradient(ellipse 60% 30% at 80% 0%, var(--color-accent-subtle), transparent 70%), var(--color-bg-base)`

### 17. snip-card hover border-color 对齐

**设计稿**: `--border-strong` = `rgba(255,255,255,0.16)`
**当前实现**: `var(--color-border)` — token 可能不同值

**确认**: 需看 `--color-border` token 值

### 18. 拖拽 ghost 位置偏移修复

**问题**: 从二栏拖拽 snippet 卡片时，鼠标在二栏但 ghost 框显示在三栏位置。

**根因**: `App.tsx:41` 的包裹 div 有 `animate-fade-in-up` 类，其 `animation-fill-mode: both` 让 `transform: translateY(0)` 在动画结束后持续生效。CSS 规范规定：任何有 `transform` 的祖先会让 `position: fixed` 子元素相对该祖先定位，而非视口。Ghost 用 `e.clientX/clientY`（视口坐标）设置 `left/top`，但实际定位相对于有 transform 的父 div（从 Sidebar 右侧开始），导致 ghost 右偏了 Sidebar 宽度。

**修改** (`SnippetsPage.tsx`):
1. 添加 `import { createPortal } from "react-dom"`
2. 将 ghost 元素用 `createPortal(ghostJSX, document.body)` 渲染到 `<body>` 下，脱离 transform 祖先链
3. Ghost 定位改为 `left: e.clientX; top: e.clientY + 12` + `-translate-x-1/2` 类使 ghost 以鼠标 X 为中心，Y 偏下 12px

## Acceptance Criteria

* [x] nav-count 为纯文本样式（无背景、无胶囊边框） — Round 2 前半已实现
* [x] detail 标题字号对齐 — 已改为 22px（将升级为 26px）
* [x] snip-card 圆角对齐 — 已改为 radius-card（将升级为 8px）
* [x] nav-item padding 改为 8px 12px — Round 2 前半已实现
* [x] cmd-block pre padding 改为 12px 16px — Round 2 前半已实现
* [x] SnippetForm 标签用 section-title 体系 — Round 2 后半已实现
* [x] SnippetForm 命令输入框为深色终端风格 — Round 2 后半已实现
* [x] SnippetForm 容器/标题/按钮区有专用样式类 — Round 2 后半已实现
* [ ] detail 标题字号精确 26px（设计稿 --fs-2xl）
* [ ] nav-item border-radius 8px（设计稿 --radius-md）
* [ ] snip-card border-radius 8px（设计稿 --radius-md）
* [ ] detail padding 32px（设计稿 --space-7）
* [ ] detail-head margin-bottom 20px（设计稿 --space-5）
* [ ] snip-card-title font-size 12px（设计稿 --fs-sm）
* [ ] card-glow 渐变描边结构
* [ ] detail accent gradient 真渐变
* [ ] 拖拽 ghost 以鼠标为中心定位（不再偏右一栏）
* [ ] 所有现有功能零回归
* [ ] lint / typecheck / build 通过

## Definition of Done

* lint / typecheck / build 通过
* 手动视觉验证差距修复
* 提交 commit

## Out of Scope

* page-header 添加（设计稿独有，功能已在中列覆盖）
* Import 按钮（store 不支持）
* Favorites/Recent 导航项、收藏星标、used X×（store 不支持）
* seg-control 排序（store 不支持）
* 命令语法高亮 c-violet/c-cyan（store 不支持）
* Variables / Run / Recent runs（store 不支持）
* lang-tag bash 标签（store 不支持）
* detail favorite 按钮（store 不支持）
* --font-size-2xl token 引入（项目无此 token，直接用固定值）
* SnippetForm 功能逻辑变更（仅改视觉/布局）

## Technical Notes

* 设计稿源：`ui/snippets.html`、`ui/styles/pages/snippets.css`、`ui/styles/components.css`
* 当前实现：`app/src/features/snippets/SnippetsPage.tsx`、`app/src/styles.css` (L4234-4676)
* Token 约束：`--radius-control: 10px; --radius-card: 12px; --font-size-xl: 20px; --font-size-lg: 16px; --font-size-base: 14px; --font-size-sm: 13px; --font-size-xs: 12px`
* 对齐范式参考：前轮 `05-17-snippets-page-ui-alignment` 的 check.jsonl 已详细对比