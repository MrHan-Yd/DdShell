# UI 设计稿（HTML+CSS）

## Goal

在仓库根目录的 `ui/` 目录下，使用纯 HTML + CSS（手写 inline SVG）制作 DdShell 应用的**新版视觉风格探索稿**，参考 Warp / Modern Terminal 视觉语言，覆盖 8 个主功能页面，提供暗色 + 亮色双主题。设计稿用于在投入 React 改造前对齐新版视觉方向。

## Requirements

### 范围
- 输出目录：仓库根目录 `ui/`
- 8 个主功能页面均要覆盖：
  1. `connections.html` — 连接管理（主机列表 + 分组 + 编辑表单）
  2. `terminal.html` — SSH 终端（多标签 + 分屏 + 命令助手浮层 + 状态栏）
  3. `sftp.html` — SFTP 文件管理（本地+远端双栏 + 传输队列）
  4. `monitor.html` — 系统监控（CPU/内存/网络趋势图 + 进程列表）
  5. `snippets.html` — 命令片段（分组 + 列表 + 详情）
  6. `workflows.html` — 工作流（步骤编辑器 + 执行记录）
  7. `quick-edit.html` — 远程文件快速编辑（编辑器 + 文件 tab）
  8. `settings.html` — 设置（左侧分类 + 右侧表单）
- `index.html` — 设计稿导航入口，列出所有页面 + 主题切换演示
- 通用部件：Sidebar、Titlebar、StatusBar、按钮/输入框/卡片等

### 风格
- 视觉参考：**Warp / Modern Terminal 风**
  - 深色为主背景，圆角组件
  - 高饱和度紫/青渐变作为强调色
  - 现代无衬线字体 + 等宽字体配合
  - 未来感、开发者工具气质
- 双主题：暗色（默认）+ 亮色
- 主题切换机制：CSS 变量 + `<body>` 类名切换（每页面顶部带主题切换按钮做演示）

### 工程
- 仅 HTML + CSS，不引入 JS 框架（允许写极少量原生 JS 仅用于主题切换演示）
- 图标全部使用**手写 inline SVG**，不引外部图标库
- 字体：通过系统字体栈 + Google Fonts CDN（如 Inter / JetBrains Mono）
- 文件组织：每页独立 `.html`，共享样式抽到 `ui/styles/` 目录
  - `ui/styles/tokens.css` — 设计令牌（颜色、间距、字号、圆角）
  - `ui/styles/base.css` — reset + 全局基础样式
  - `ui/styles/components.css` — 通用组件（按钮、输入、卡片、表单等）
  - `ui/styles/layout.css` — 布局通用（Sidebar、Titlebar、StatusBar）
  - 各页面单独的页面样式可放在 `ui/styles/pages/<name>.css`

## Acceptance Criteria

### 第一批（MVP，先交付对齐风格）
- [ ] `ui/index.html` 导航入口可在浏览器直接打开
- [ ] `ui/connections.html` 完整呈现连接管理页面
- [ ] `ui/terminal.html` 完整呈现终端主界面（含命令助手浮层）
- [ ] 暗色 + 亮色双主题在两个页面都能切换演示
- [ ] 全部图标为手写 inline SVG，无外部图标库依赖
- [ ] 设计令牌（颜色、字号、间距）抽离到 `tokens.css`
- [ ] 用户确认风格 OK 后，再进入第二批

### 第二批（用户确认风格后）
- [ ] sftp / monitor / snippets / workflows / quick-edit / settings 六个页面全部产出
- [ ] 各页面同样支持双主题
- [ ] 共享组件（侧边栏、状态栏、按钮等）跨页面视觉一致

## Definition of Done

- 所有 HTML 文件可在浏览器直接打开预览（双击或 file:// 协议都行），无构建步骤
- 网络断开时除了 Google Fonts 字体降级，其他视觉表现正常（图标都是 inline SVG）
- 暗/亮主题切换无视觉错位、对比度足够（文字 AA 级以上）
- `index.html` 能直观展示当前完成的页面清单
- README 或入口页注明：这是设计探索稿，不直接进入生产

## Technical Approach

### 风格令牌（tokens.css 草拟）
```
--bg-base / --bg-elevated / --bg-surface
--fg-primary / --fg-secondary / --fg-muted
--accent / --accent-glow（紫青渐变）
--border-subtle / --border-strong
--success / --warning / --danger
--font-sans (Inter) / --font-mono (JetBrains Mono)
--radius-sm / --radius-md / --radius-lg
--space-{1..8}
```

### 主题切换
- `<body class="theme-dark">` 默认
- 切换按钮 toggle 到 `theme-light`
- CSS 变量在两个 class scope 下分别定义
- 极小的 `<script>` inline 在 HTML 末尾做 toggle

### 文件树
```
ui/
  index.html
  connections.html
  terminal.html
  sftp.html
  monitor.html
  snippets.html
  workflows.html
  quick-edit.html
  settings.html
  styles/
    tokens.css
    base.css
    components.css
    layout.css
    pages/
      connections.css
      terminal.css
      ...
  README.md
```

## Decision (ADR-lite)

**Context**: 现有 React UI 已经在 `app/` 中实现，但用户希望在投入新版改造前先用 HTML+CSS 做视觉探索稿，对齐方向。

**Decision**:
1. 全套 8 页 + 导航入口，分两批交付（先 connections + terminal 对齐风格，再补齐其余 6 页）。
2. 风格方向锁定 Warp / Modern Terminal 风，深色主题为默认，同时产出亮色主题。
3. 工程上零依赖：纯 HTML+CSS，图标手写 SVG，仅 Google Fonts CDN 用作字体兜底。
4. 共享样式抽到 `ui/styles/` 下的 tokens / base / components / layout 四层 + per-page。

**Consequences**:
- 优点：零构建、单文件可预览、易复制到任意环境演示；后续如转 React 也能直接迁移 tokens.css
- 缺点：复杂交互（拖拽、动画、动态数据）只能用 CSS 模拟，无法体现真实使用流；多页面之间布局一致性需要靠手维护
- 风险：第一批风格如果不被认可，第二批工作量需重做；通过"先对齐再扩展"节奏控制风险

## Out of Scope

- 不写任何 JS 行为（除了主题切换的极简 toggle）
- 不做实际数据/图表的动态绑定（用静态 mock 数据）
- 不修改 `app/` 下任何现有 React 代码
- 不导出 PNG/SVG 设计资产（仅交付 HTML+CSS）
- 不做移动端响应式（桌面应用，按 1280px+ 视口设计）
- 不做无障碍 ARIA 完整覆盖（仅保证基本对比度和语义标签）

## Technical Notes

- 现有 React UI 参考：`app/src/features/{connections,terminal,sftp,monitor,snippets,workflows,quick-edit,settings}`
- 通用组件参考：`app/src/components/{Sidebar,Titlebar,StatusBar}.tsx`
- 现有样式：`app/src/styles.css`（用作令牌灵感参考，不直接复用）
- Warp 视觉参考：https://www.warp.dev
- 字体参考：Inter（UI）、JetBrains Mono（终端/代码）
