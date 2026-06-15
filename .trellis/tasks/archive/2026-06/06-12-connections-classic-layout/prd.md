# PRD: 对齐经典主题连接管理布局

## Goal

经典主题的连接管理页面采用极光主题的连接管理布局、密度和间距，同时继续使用经典主题自身的颜色 token。极光主题现有表现不能回退。

## Confirmed Facts

- 用户确认连接管理沿用前面导航/设置的原则：经典主题套用极光主题布局，颜色保持经典。
- `ConnectionsPage.tsx` 已经使用极光连接页样式需要的类名，包括 `connections-page`、`page-header`、`split-layout`、`host-aside`、`aside-toolbar`、`host-group`、`host-item`、`detail-pane`、`detail-wrap`、`detail-grid`、`detail-cta`、`detail-activity`。
- 极光主题连接管理布局规则位于 `app/src/styles/aurora/pages/connections.css`，并且被 `[data-ui-theme="aurora"]` 作用域限制。
- 极光的通用页头和左右分栏规则位于 `app/src/styles/aurora/layout.css`。
- `app/src/styles.css` 已经桥接了极光布局 token 名称到经典主题颜色系统，例如 `--bg-base`、`--fg-primary`、`--border-subtle`、`--accent-subtle`。

## Requirements

- 经典主题连接管理的顶部页头、操作按钮区域、左侧搜索/动作工具条、分组列表、主机条目、空状态、右侧详情区域布局应与极光主题保持一致。
- 样式调整应优先限定在 `[data-ui-theme="classic"]` 下，避免影响极光主题和其他页面。
- 颜色、强调色、边框、文字颜色应继续使用经典主题 token，不复制极光主题紫色视觉。
- 程序内 Logo、浏览器/dev favicon、Tauri 打包图标统一使用暗色极光 Logo 资源，不再按经典/极光 UI 主题切换回旧 Logo。
- 经典主题终端页的 pane header 必须保持在 tab 栏下方，主机名和连接状态不能贴连成 `Serverconnected` 或漂到 tab 区域。
- 经典主题文件管理/SFTP 页面采用极光文件管理布局、间距和密度，包括顶部栏、双栏文件面板、工具栏、文件表格、传输队列和最小化传输浮层；颜色仍使用经典 token。
- 连接管理详情区点击“连接”进入连接中状态时，详情内容和 CTA 区域宽度不能因为按钮文案变化而收缩；经典和极光主题都必须稳定。
- 不新增字段、不改连接管理行为、不改后端接口。
- 不启动开发服务器；用户本地已在运行并会视觉检查。

## Acceptance Criteria

- 切换经典/极光主题时，连接管理页面的整体布局、主要尺寸、字体密度、左右分栏、列表行、详情卡片和 CTA 排列保持一致。
- 经典主题的连接管理颜色仍符合经典主题，不出现极光主题专属紫色背景或渐变铺底。
- 极光主题连接管理 CSS 仅允许做连接中状态的宽度稳定修复，现有颜色和布局语义不回退。
- 侧边栏、设置关于页等通过 `Logo` 组件渲染的程序 Logo 在经典和极光主题下都显示极光 Logo。
- favicon 初始值和运行时更新都指向暗色极光 Logo。
- `app/src-tauri/icons/` 下的 Tauri 应用图标由 `app/public/logo-aurora-dark.svg` 生成。
- 经典主题终端页 `.pane-bar`、`.pane-spacer`、`.pane-tag`、`.tab-dot` 布局与极光保持一致，连接状态显示在 pane header 右侧。
- 经典主题文件管理页 `.sftp-main`、`.sftp-body`、`.file-pane`、`.file-row`、`.file-row-local`、`.transfer-drawer` 等布局与极光保持一致。
- 经典和极光主题下，连接管理详情 wrapper 在最大宽度 640px 内占满可用宽度，点击连接后页面宽度不跳变。
- `git diff --check` 通过。

## Out of Scope

- 连接数据模型、增删改查逻辑、导入 SSH 配置逻辑。
- 新增连接管理功能。
- 顶部 DdShell 标题栏调整。
- 启动或占用本地开发服务器端口。
