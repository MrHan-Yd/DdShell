# Existing UI Information Architecture

> 作用：为 `ui/` 目录下 HTML+CSS 设计稿提供功能结构基线，避免设计稿和真实功能脱节。
> 仅描述结构、不描述视觉。视觉是新版 Warp 风重新做的。

## Shared Chrome

### Sidebar (`app/src/components/Sidebar.tsx`)
- 宽度：展开 / 折叠两态（CSS 变量 `--width-sidebar` / `--width-sidebar-collapsed`）
- 顶部：Logo + "DdShell" 标题（折叠时只剩 logo）
- 导航项（顺序固定，7 项）：
  1. connections — Server 图标
  2. terminal — Terminal 图标
  3. sftp — FolderOpen 图标
  4. monitor — Activity 图标
  5. snippets — Code2 图标
  6. macros / workflows — Workflow 图标
  7. settings — Settings 图标
- 选中态：滑动 pill 高亮 + accent 色文字
- 底部：折叠/展开按钮

### Titlebar (`app/src/components/Titlebar.tsx`)
- 高度：`--height-titlebar`
- 左侧：macOS 时留 70px 给原生 traffic lights
- 中间：`data-tauri-drag-region` 可拖拽空白
- 右侧：非 macOS 时显示 minimize / maximize / close 三个圆形按钮

### StatusBar (`app/src/components/StatusBar.tsx`)
- 高度：`--height-statusbar`
- 左侧：版本号（带更新检查状态：idle / checking / available / downloading / upToDate / error 等）
- 中间：flex spacer
- 右侧依次（仅相关状态时显示）：
  - 已连接会话数（绿点 + "N sessions"）
  - 活动传输数（"N transfers"，accent 色）
  - 健康徽章 GOOD / FAIR / POOR（带状态点的圆角胶囊）
  - 当前会话延迟（"42ms"，颜色按 <100/<300/>=300 区分）
  - 空闲时显示 "Ready"

---

## Page: Connections (`app/src/features/connections/ConnectionsPage.tsx`)

### Layout
- 两栏：左侧 280px 主机列表 + 右侧 flex-1 详情/表单/导入区

### Left column — Host list panel
- 顶部工具栏（一排小按钮）：
  - 搜索框（Search 图标 + Input）
  - 新建分组按钮（FolderPlus 图标）
  - 批量选择切换按钮（ListChecks / X）
  - 导入 SSH config 按钮（Upload 图标）
  - 新增连接按钮（Plus 图标，主按钮）
- 列表内容：
  - 分组（可折叠）：ChevronRight + Folder/FolderOpen + 大写组名
  - 未分组区域：拖拽时也能高亮成 drop target
  - 主机条目（HostItem）：批量复选框（仅批量模式） + Server 图标 + name + user@host:port + 收藏星
  - 拖拽中显示 ghost 指示器
- 底部（仅批量模式）：选中数 + 全选 + 删除按钮

### Right column — three states
1. **详情态**：host name + 工具按钮（收藏 / 编辑 / 删除）+ 详情卡片（host/port/username/auth/created/lastConnectedAt）+ "Connect" 主按钮 + "Test connection" 次按钮
2. **表单态**：name / host+port / username / authType / password (条件) / group (条件) + Cancel / Create-or-Update
3. **SSH 导入态**：标题栏 + 警告条（解析错误数）+ 选项列表（每条带复选框）+ Cancel / Import (N)
4. **空态**：居中 Server 大图标 + "Select or create a connection"

### Notable interactions
- 拖拽主机到分组（含 ghost 浮层、悬停 500ms 自动展开分组）
- 右键菜单（host）：编辑 / 测试 / 收藏 / 移动到分组 / 删除
- 右键菜单（group）：重命名 / 删除
- 移动到分组的弹窗（带 backdrop blur）

---

## Page: Terminal (`app/src/features/terminal/TerminalPage.tsx`)

### Layout
- 顶部 Tab bar（高度 `--height-tabbar`）+ 中间 Terminal area + 右侧抽屉（命令历史 / 书签）

### Tab bar
- 可拖拽 Tab（固定 120px 宽）：
  - 状态点（connected→success / failed→error / 其他→muted）
  - 标题（hostname，truncate）
  - 关闭 X（hover 出现，带确认对话框）
- 拖动时其他 Tab 让位（CSS transform 动画）
- 右侧固定区：
  - 横向分屏按钮（SplitSquareHorizontal）
  - 竖向分屏按钮（SplitSquareVertical）
  - 关闭分屏按钮 XCircle（仅分屏时显示）
  - 分隔竖线
  - 工作流执行按钮（含状态：idle / running / cancelling / failed badge）
  - 分隔竖线
  - 历史面板切换（History 图标 + "History" 文字）

### Terminal area
- 单屏 / 横向分屏 / 竖向分屏（分屏时中间有 ResizeHandle）
- 背景：纯色 / 自定义图片（透明叠加，带 opacity + blur）
- 断线遮罩：黑色半透明遮罩 + 闪电图标 + "Disconnected" + 重连按钮

### Floating: Command Assist (`//` 触发)
- 浮层位置：bottom-left / bottom-right / follow-cursor 三种
- 内容：query + 候选命令列表（图标 + 命令文本 + 描述）+ 当前选中高亮
- 关闭：Esc / 选中后回填

### Right drawer 1: Command History（宽 280px，可显示/隐藏）
- 标题栏：History 图标 + "History" + 清空按钮 + 关闭 X
- 搜索框
- 列表：每条点击插入到终端

### Right drawer 2: Bookmark（始终在最右，22px tab + 280px 折叠面板）
- Tab peg：始终可见的 Bookmark 图标按钮（边框圆角左半）
- 面板：标题栏 + 添加 label 输入框 + Add 按钮（星形）+ 列表（每条 FolderOpen + label + path + 删除按钮，单击二次确认进度条）

### Floating: Macro Quick Panel
- 由工作流按钮触发，浮层显示最近/全部 recipe，可输入参数后执行

### 空态
- 当 tabs.length === 0：居中提示 "No active sessions" + "Open Connections" 按钮

---

## Page: SFTP (`app/src/features/sftp/SftpPage.tsx`)
> 第二批实现时再细化。结构概要（基于已知功能）：
- 双栏布局：左侧本地文件浏览，右侧远端文件浏览
- 各栏顶部：路径面包屑、刷新、新建目录、上一级
- 文件列表：图标 + 名称 + 大小 + 修改时间，支持多选
- 底部：传输队列（进度条 + 速度 + 取消/清理）
- 收藏路径菜单、最近访问下拉

## Page: Monitor (`app/src/features/monitor/MonitorPage.tsx`)
> 第二批实现时再细化。
- 时间窗口切换：5min / 15min / 60min
- 多个图表卡片：CPU / 内存 / 网络吞吐 / 系统负载 / 磁盘
- 进程表
- 会话健康卡片 + 远端系统信息卡片

## Page: Snippets (`app/src/features/snippets/SnippetsPage.tsx`)
> 第二批实现时再细化。
- 左侧分组列表，右侧片段列表 + 详情面板
- 每条片段：title / command / description / tags

## Page: Workflows (`app/src/features/workflows/WorkflowsPage.tsx`)
> 第二批实现时再细化。
- 左侧分组+列表，右侧步骤编辑器
- 步骤可拖拽排序，每步：command + 参数定义 + 注释
- 最近执行记录 panel

## Page: Quick Edit (`app/src/features/quick-edit/QuickEditWindow.tsx`)
> 第二批实现时再细化。
- 独立窗口，多 tab
- 左侧文件 tab 栏 + 右侧 CodeMirror 编辑区
- 顶部工具栏：保存 / 查找替换 / 跳转到行 / sudo 提权
- 底部状态栏：光标位置 / 换行符 / 缩进 / 文件大小

## Page: Settings (`app/src/features/settings/SettingsPage.tsx`)
> 第二批实现时再细化。
- 左侧分类导航：通用 / 外观 / 终端 / 命令助手 / 数据 / 关于 等
- 右侧表单：每个设置项 label + 输入控件 + 帮助文字

---

## CSS 变量参考（从现有代码提取的命名约定，新版可改但模式保留）

### 颜色
`--color-bg-base` / `--color-bg-elevated` / `--color-bg-surface` / `--color-bg-hover`
`--color-text-primary` / `--color-text-secondary` / `--color-text-muted`
`--color-accent` / `--color-accent-hover` / `--color-accent-subtle`
`--color-border` / `--color-border-focus`
`--color-success` / `--color-warning` / `--color-error`
`--color-good` / `--color-fair` / `--color-poor`（健康徽章用）

### 尺寸
`--width-sidebar` / `--width-sidebar-collapsed`
`--height-titlebar` / `--height-tabbar` / `--height-statusbar`

### 字号
`--font-size-xs` / `--font-size-sm` / `--font-size-base` / `--font-size-lg` / `--font-size-xl`

### 圆角
`--radius-control` / `--radius-card`

### 动画
`--duration-base` / `--duration-fast` / `--duration-panel`
`--ease-smooth`
