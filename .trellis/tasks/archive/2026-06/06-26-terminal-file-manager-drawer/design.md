# Design: 终端页底部文件管理抽屉

## Architecture

在终端页面增加一个终端专用的底部文件管理抽屉组件，核心文件操作复用现有 SFTP store、Tauri API、确认框、toast、传输事件监听和样式语义。为降低改动风险，不在第一版大幅重写独立 SFTP 页面布局；只抽取必要的共享工具函数，避免上传、下载、覆盖检测、目录扫描等逻辑重复发散。

## Component Boundaries

- `TerminalPage.tsx`
  - 读取 `terminal.fileManagerDrawer.enabled` 设置，默认开启。
  - 增加文件管理按钮、抽屉开关状态、抽屉高度状态、最后聚焦 session 状态。
  - 抽屉展开/收起/调整高度时依赖现有 `ResizeObserver` 触发 xterm fit。
- `TerminalFileManagerDrawer`
  - 新增终端内远程文件管理组件。
  - 使用当前目标 session 初始化 `useSftpStore.sessionId`，并显示当前远程文件列表。
  - 提供远程浏览、新建文件夹、重命名、移动到、删除、下载、上传、拖拽上传、刷新、路径导航、Quick Edit。
  - 内置紧凑传输状态条。
- SFTP shared helpers
  - 抽出路径拼接、格式化、上传目录扫描、覆盖预检等纯函数或小工具，供独立 SFTP 页和终端抽屉共用。
- Remote directory picker
  - 基于现有 `RemoteFilePicker` 的目录浏览逻辑，提供“移动到...”选择目标目录的浮层。

## Data Flow

1. 用户聚焦某个终端面板时，`TerminalInstance` 通知父级记录 `lastFocusedSessionId`。
2. 用户点击文件管理按钮。
3. `TerminalPage` 选择目标 session：
   - 优先 `lastFocusedSessionId` 对应且 connected 的 tab。
   - 否则使用当前 `activeTabId` 对应且 connected 的 tab。
4. 抽屉初始化远程路径：
   - 优先从目标终端当前 buffer/OSC cwd 推断目录，并用 `sftpListDir` 验证。
   - 失败则读取该 session 的最近路径。
   - 仍失败则回退 `/`。
5. 抽屉通过 `useSftpStore` 加载和刷新远程文件列表。
6. 上传/下载走现有 `sftpUploadFiles`、`sftpTransferStart` 和 `initSftpListeners`。
7. 移动文件用 `sftpRename(oldPath, newPath)`，目标同名先用 `sftpListDir` 检测并提示。

## UI Behavior

- 抽屉从终端区域底部展开，默认高度约 40%，最小约 260px，最大约 70%。
- 顶部有拖拽手柄、当前主机/路径、关闭按钮。
- 文件列表采用 SFTP 页的远程列表视觉语义，保持密集工具型布局。
- 文件按钮默认开启；设置关闭后按钮隐藏，已打开抽屉应关闭。
- 快捷键只在抽屉打开且文件列表聚焦时生效，避免抢终端输入。

## Compatibility

- 不新增后端命令；使用现有 SFTP rename/list/remove/mkdir/transfer/upload API。
- 复用全局 `useSftpStore`，因此终端抽屉和独立 SFTP 页共享当前 SFTP session 状态。应用当前是单页切换模式，第一版接受此行为。
- `initSftpListeners()` 已有幂等保护，终端抽屉挂载时可以安全调用。

## Risks And Mitigations

- **分屏会话选择错误**：增加最后聚焦 session 记录，回退 active tab。
- **终端 resize 不同步**：抽屉作为 `term-main` 的 grid 第三行改变终端区域实际尺寸，依赖现有 `ResizeObserver` fit。
- **移动覆盖风险**：移动前检查目标目录同名条目，必须确认或阻止，不静默覆盖。
- **拖拽上传事件全局化**：只在抽屉打开且目标区域存在时处理 Tauri drag/drop，并显示明确 drop overlay。
- **SFTP 页面逻辑分叉**：抽出共享工具，避免复制覆盖预检、目录扫描和路径处理。
