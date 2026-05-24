# SFTP 页面 UI 对齐设计稿

## Goal

将 SftpPage.tsx 的样式和布局对齐到 ui/sftp.html + ui/styles/pages/sftp.css 设计稿。只改样式和布局，保持所有现有功能可用。

## Requirements

### 1. 整体布局：CSS Grid 替代 Flexbox

- [x] `sftp-main` 改为 `grid-template-rows: auto 1fr auto`
- [ ] `sftp-body` 改为 `grid-template-columns: 1fr 8px 1fr`（双面板+中段沟槽）
- [ ] 添加 `sftp-gutter` 沟槽元素（替代当前 `gap-3`），内含箭头图标

### 2. 页面头部（page-header）

- [ ] 添加 `page-header` 区域，含 `title-block`（标题+SFTP副标题）+ `actions`（Refresh / Upload 按钮）
- [ ] 替代当前独立的 session indicator bar

### 3. 文件面板（file-pane）

- [ ] `file-pane` 改为 `grid-template-rows: 36px 38px 1fr 28px`（header/toolbar/list/footer）
- [ ] `is-active-pane` 加 `border: 1px solid var(--accent-subtle)` 高亮

#### 3.1 面板头部（file-pane-head）

- [ ] Local pane: `pane-icon`(Monitor图标) + `pane-label`("LOCAL") + `pane-host`(路径)
- [ ] Remote pane: `pane-icon`(HardDrive图标) + `pane-label`("REMOTE") + `pane-host`(root@host:path) + `badge-success`(Connected)
- [ ] 右侧操作按钮：refresh / new-folder / quick-edit 等
- [ ] 样式: `bg-[--bg-elevated]` + `border-bottom` + `font-size: var(--fs-xs)` + `pane-label uppercase letter-spacing`

#### 3.2 工具栏（file-toolbar）

- [ ] 左侧：path-up 按钮（向上导航）
- [ ] 中间：breadcrumb（当前已有，保留）
- [ ] 右侧：search-mini 过滤输入框（新增功能控件，但不实现过滤逻辑，仅 UI）
- [ ] 样式: `border-bottom` + `bg-[--bg-base]` + `height: 38px`

#### 3.3 文件列表头部（file-head row）

- [ ] 添加 `file-row file-head` 固定头部行：Name / Size / Modified / Perm 列标签
- [ ] 样式: sticky top-0, `bg-[--bg-elevated]`, `uppercase letter-spacing: 0.06em`, `cursor: default`

#### 3.4 文件行（file-row）

- [ ] 改为 CSS Grid 布局 `grid-template-columns: 1fr 80px 90px 110px`
- [ ] 目录行: `.is-dir` → 文件名颜色 `var(--accent)`
- [ ] 选中行: `.is-selected` → `bg-[--accent-subtle]`
- [ ] 上传中行: `.is-uploading` → 渐变背景 + 进度条
- [ ] 拖拽目标: `.is-drop-target` → dashed accent border
- [ ] 行内进度条: `.row-progress` (80px 宽度 pill)

#### 3.5 面板底部（file-foot）

- [ ] 添加 `file-foot` 底部状态栏，显示: 选中项数量+大小 | 总项数+总大小
- [ ] 样式: `height: 28px`, `bg-[--bg-elevated]`, `border-top`, `font-size: var(--fs-xs)`, `color: var(--fg-muted)`

### 4. 中段沟槽（sftp-gutter）

- [ ] 添加独立的沟槽元素（替代 flex gap-3）
- [ ] 内含箭头图标，`bg-[--bg-elevated]`，accent gradient 背景
- [ ] `cursor: col-resize`

### 5. 传输队列（transfer-drawer）

- [ ] 改为页面底部内嵌 drawer（非浮动 panel），`grid-template-rows: 36px auto`
- [ ] 头部: `td-head` 含图标+"Active transfers"+badge+clear completed 按钮+collapse 按钮
- [ ] 行: `td-row` 8 列 grid（direction icon / name / route / progress bar / pct / speed / eta / actions）
- [ ] 上传方向圆标 `.td-dir.up`（accent subtle 背景）、下载 `.td-dir.down`（info subtle 背景）
- [ ] 进度条: `.td-bar` + `.td-bar-fill` （gradient + glow）
- [ ] 完成状态: `.is-done` → name 变 muted, pct 变 success checkmark

### 6. 文件行 Perm 列

- [ ] 为 RemoteFileList 添加权限列（Permission），使用 mono 字体
- [ ] LocalFileList 不显示 Perm 列（本地文件系统不支持 Unix perms 显示）

## Acceptance Criteria

- [ ] SFTP 页面视觉与 ui/sftp.html 设计稿一致
- [ ] 所有现有功能（导航、上传、下载、删除、重命名、右键菜单、拖拽上传、快速编辑）保持正常工作
- [ ] 双面板布局正确响应窗口大小变化
- [ ] 传输队列功能保持可用（暂停/取消/最小化）
- [ ] 过滤输入框可见（不需要实现过滤逻辑）
- [ ] 选中状态、拖拽状态、上传进度状态视觉正确

## Definition of Done

- [ ] 视觉对照设计稿完成
- [ ] lint + typecheck 通过
- [ ] 无功能回归

## Out of Scope

- 实现搜索过滤逻辑（仅添加输入框 UI）
- 添加 Permission 列的实际功能（仅展示已有数据）
- 修改传输队列的业务逻辑
- 修改 session 选择逻辑
- 修改右键菜单功能

## Technical Approach

只修改 SftpPage.tsx 中的 JSX 结构和 Tailwind/CSS 类名，不修改任何逻辑代码。核心变更：

1. **SftpPage** 组件: 重构布局从 flex → CSS Grid，添加 page-header
2. **LocalFileList** 组件: 重构布局，添加 header/toolbar/footer/search-mini，文件行改为 grid 列布局，添加 column head
3. **RemoteFileList** 组件: 同上 + 添加 Perm 列 + 连接状态 badge
4. **TransferQueue** 组件: 从浮动 panel 改为内嵌 drawer，行改为 grid 列布局
5. **TransferRow** 组件: 从 flex 改为 8 列 grid

关键原则：所有 `onClick`/`onDoubleClick`/`onContextMenu` 等 handler、所有 state 管理、所有 API 调用 — 原封不动保留，只改 JSX className 和 DOM 结构。