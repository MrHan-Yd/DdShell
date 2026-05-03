# Quick Edit Design

## 0. 当前实现状态（2026-05-02）
- 当前代码已完成 Level 1 的一条最小闭环原型，状态应视为 `IN_PROGRESS`，不再是纯设计阶段。
- 已完成：
  - `SftpPage` 远程文件右键菜单 `快速编辑` 入口
  - `SftpPage`：明显是文本的小文件支持双击直接打开 Quick Edit，目录双击仍保持进入目录
  - 最近编辑记录：前端本地持久化，按当前 host 过滤显示，可从远程路径栏右侧轻量重新打开
  - 独立窗口外壳：`QuickEditWindow` + 多 tab 容器（zustand store），原 `QuickEditModal` 草案已废弃，详见 0.3 节
  - `QuickEditor.tsx`，基于 `CodeMirror 6` 的最小编辑器内核接入
  - 编辑器基础能力：行号、查找替换、跳转到行、`Cmd/Ctrl + S`、`Cmd/Ctrl + F`、只读态、dirty 判定、状态栏行列/换行/缩进信息
  - 语言支持已覆盖：`JSON / YAML / Markdown / TOML / Shell / .env* / Dockerfile` 等常见远程配置文件场景
  - Quick Edit header / toolbar / status bar 已补到更接近 mac 工具窗的分层样式
  - 前端 Tauri 封装：`sftpReadText` / `sftpWriteText` / `sftpWriteTextPrivileged`
  - 后端 Tauri command：`sftp_read_text` / `sftp_write_text` / `sftp_write_text_privileged`
  - 后端远程文本读取、UTF-8 校验、二进制阻断、大小限制、保存前 `mtime/hash` 冲突检测，以及同目录临时文件 + rename + 回滚的更安全写回链路
  - Level 3 最小能力已起步：权限不足时可进入 `sudo` 提权保存，并可选择在保存前创建远端备份
  - 编辑器区域原生右键菜单白名单
  - 全局快捷键对 Quick Edit / `contenteditable` 的输入放行
  - Level 2 能力已补齐：更细文件类型映射、Nginx / systemd / env 等配置文件高亮、查找替换入口、跳转到行、状态栏语言/行列/换行/缩进展示、双击文本文件打开、最近编辑、单选文本文件工具栏快速编辑入口、CRLF 保存保留
  - Level 3 运维增强已补齐主链路：普通保存失败后的显式 `sudo` 提权保存、保存前备份、备份路径展示、保存后建议动作、建议命令复制、建议命令回填当前终端但不自动执行、高风险配置文件提示、提权保存 symlink 解析保护
  - 终端辅助入口：`Cmd/Ctrl + Shift + E` 在终端页唤起远程文件选择器（`RemoteFilePicker`）；选区是绝对路径时直接打开 Quick Edit，否则弹选择器并尝试从屏幕缓冲区推断 cwd 作为起点目录，详见 2.1 节
- 当前明确未完成:
  - 完整手工回归测试与体验打磨，因此当前仍保持 `IN_PROGRESS`

## 0.1 当前实现边界补充（2026-05-02）
- 普通保存：
  - 已使用同目录临时文件 + rename + 回滚链路，尽量避免目标文件进入半写状态。
- 提权保存：
  - 当前通过 `sudo -S` + 独立 exec channel 完成，不把密码拼进命令字符串。
  - 当前会先把草稿写到普通用户可写的临时文件，再在提权命令中把内容落到目标目录下的 root staging file，最后 `mv` 到目标路径。
  - 当前支持“保存前创建备份”选项，并返回 `backupPath`。
  - 当前对 symlink 路径会在提权命令内优先解析到真实目标，避免直接替换 symlink 本身。

## 0.2 当前建议回归矩阵
- 打开与基础编辑：
  - 普通文本文件可打开、编辑、保存。
  - 非文本文件 / 超大文件 / 不支持编码文件被正确拦截。
- 保存链路：
  - 普通保存成功。
  - 普通保存命中 `FILE_CHANGED_CONFLICT`。
  - 普通保存命中 `FILE_PERMISSION_DENIED` 后可进入提权保存。
  - 提权保存成功（无备份）。
  - 提权保存成功（有备份）。
  - 提权保存密码错误，返回 `SUDO_AUTH_FAILED`，草稿仍保留。
  - 提权保存失败时，临时文件会尽量清理。
- 文件类型与入口：
  - 目录双击仍进入目录。
  - 文本文件双击打开 Quick Edit。
  - 最近编辑记录按 host 过滤可重新打开目标文件。
- 交互与体验：
  - `Cmd/Ctrl + S`、`Cmd/Ctrl + F`、跳转到行正常。
  - `Cmd/Ctrl + Alt + F` 可进入替换工作流。
  - Quick Edit 内输入不被全局快捷键抢占。
  - 编辑器内原生右键菜单可用。
  - CRLF 文件保存后仍保留 CRLF 换行。
- 特殊场景：
  - 只读文件编辑后，可通过 `sudo` 保存尝试落盘。
  - 会话断开时保存返回 `SESSION_DISCONNECTED`。
  - 保存 `nginx.conf`、systemd unit、`docker-compose.yml`、`sshd_config` 后展示建议动作，且只复制/回填不自动执行。
  - 高风险配置文件显示风险提示。

## 0.3 独立窗口架构（2026-05-02 升级，覆盖 0. 节中原 modal 描述）

Quick Edit 已从主窗口 modal 升级为独立 webview 窗口，目的是不阻塞主窗口的 SFTP / 终端工作流，并支持同时打开多个文件做对照编辑。

### 窗口创建与复用
- Tauri command 入口：`app/src-tauri/src/lib.rs::quick_edit_open`
  - 已存在窗口（label = `quick-edit`，单例）：`unminimize → show → set_focus`，再 `emit("quick-edit:open-file", payload)` 将文件追加为新 tab。
  - 不存在：`WebviewWindowBuilder` 创建窗口，URL = `index.html?window=quick-edit&open=<URL_SAFE_NO_PAD base64(JSON payload)>`。把第一个文件的 payload 通过 URL 带入是为了避免 `create → emit` 的竞态（webview 还没装好 listener 时事件会丢）。
  - macOS 用 `TitleBarStyle::Overlay + hidden_title`；其他平台 `decorations(false)`。
- 主路由：`app/src/main.tsx` 根据 `?window=quick-edit` 选择渲染 `<QuickEditWindow>` 而不是主 `<App>`。同一份前端 bundle 服务两种窗口。
- payload 解码：`QuickEditWindow.decodeInitialPayload` 用 `atob` 还原 Latin-1 binary 后再走 `TextDecoder("utf-8")`；中文路径不会因为 atob 直接当成 UTF-8 字符串而被拆字节。

### 多 tab 状态
- `useQuickEditStore`（`app/src/stores/quickEdit.ts`）持有 `tabs: QuickEditTab[]` 与 `activeTabId`。
- `openOrFocusFile`：以 `sessionId + remotePath` 去重，命中则切换激活 tab，否则新建 tab 并触发 `loadTab`。
- 草稿正文（draft content）刻意**不放进 store**，由 `QuickEditTabContent` 的 `draftContentRef` 持有。每次按键不触发 zustand 重渲染，避免输入路径上的整 modal 重排。store 只承载 baseline / viewState / dirty / errorCode / editorStatus / sudo 子对话框等粗粒度字段。
- `QuickEditTabBar` 在出现重名文件时把同名 tab 显示为 `name · hostName`，避免歧义。

### 跨窗口事件
- `quick-edit:open-file`（主窗口 → quick-edit 窗口）：用于已存在窗口时追加新 tab。
- `terminal:insert-text`（quick-edit 窗口 → 主窗口终端，Tauri global event）：保存后的建议命令（如 `nginx -t`）通过这个事件回填到指定 sessionId 的终端，**只插入、不自动执行**。`TerminalInstance` 在主窗口同时监听 DOM 自定义事件和 Tauri 事件，按 sessionId 过滤。
- `session:state_changed`（主窗口广播）：quick-edit 窗口监听到 `disconnected` 后，对该 sessionId 的 tab：
  - 无 dirty：直接 `closeTab`。
  - 有 dirty：聚合到 `SessionDetachedDialog`，让用户**一次性**选 `discard all` 或 `keep readonly`（`markDetached` 把 tab 锁成只读保留供复制内容）。

### 关闭策略
- 单 tab 关闭：dirty 时弹 `confirm` 二次确认。
- 全部 tab 关完：自动关闭窗口；用 `hasHadTabsRef` 记录"曾经有过 tab"，避免首次 mount 时（URL payload 还没处理）就误关。

### 权限与隔离
- 独立 capability 文件：`app/src-tauri/capabilities/quick-edit.json`
  - `windows: ["quick-edit"]`，与主窗口的 capability 隔离
  - 仅声明 quick-edit 实际需要的权限：`core:default`、窗口控制（minimize / toggle-maximize / close / start-dragging）、`dialog:default`、剪贴板读写、`core:event:default`
  - 不直接持有 `shell:execute` 等高危权限；提权保存依赖主进程 `sftp_write_text_privileged` 的封装。

### 当前局限
- 单例窗口：同一时间只有一个 quick-edit 窗口实例；不支持多窗口并列对照（如有需求需扩展 label 命名策略）。
- 窗口位置 / 尺寸未持久化，每次创建都 `center()` 起 1100x760。
- tab 顺序与激活态未持久化，关闭窗口即丢失。

## 1. 目标
- 为 Shell App 增加一个轻量的远程文本快速编辑能力，用于查看和修改配置文件、脚本、小型文本文件。
- 该能力是当前 SSH / SFTP 工作流下的一个功能点，不是独立产品模块，不做通用远端 IDE。
- 目标用户是“不想进入 `vim` 但又需要快速改文件”的用户；偏好终端操作的用户仍可继续使用 `vim` / `nano`。

## 2. 定位
- UI / 产品名称建议统一使用：`Quick Edit` / `快速编辑`。
- 功能归属：`SFTP / 文件管理`。
- 入口优先级：
  - 主入口：远程文件右键菜单 `快速编辑`
  - 次入口：选中文本文件后顶部工具栏 `编辑`
  - 可选入口：双击文本文件直接打开快速编辑
  - 辅助入口（终端页）：`Cmd/Ctrl + Shift + E` 唤起远程文件选择器或直接打开选区路径，详见 2.1 节
- 不新增一级导航；终端页只提供辅助入口，不作为主入口。

## 2.1 终端辅助入口（2026-05-03）

### 2.1.1 为什么加这个入口
- 用户在终端工作时，看到一个文件想改，"切到 SFTP 页 → 导航到目录 → 右键编辑"路径太长。
- 目标：让终端用户**不切页面、不敲完整路径**就能进入 Quick Edit。
- 仍保留 3 节的产品判断：终端的主职责是 PTY 工作流，Quick Edit 仍以 SFTP 页为主入口；终端入口是辅助、不做发现性引导。

### 2.1.2 触发与行为
- 快捷键：`Cmd/Ctrl + Shift + E`，仅在终端页生效。
- 多面板（split pane）下只有持有焦点的 `TerminalInstance` 响应（通过 `term.element.contains(document.activeElement)` 判断）。
- 触发后按以下规则执行：
  1. 取当前 xterm 选区，做基本清洗（trim、去成对外层引号、`\<sp>` → `<sp>`、拒绝多 token / 含换行的选区）。
  2. 清洗结果以 `/` 开头 → 视为绝对路径，直接调用 `openQuickEditWindow`，不弹选择器。
  3. 否则唤起 `RemoteFilePicker`：
     - 起点目录：尝试从终端缓冲区反向扫描 30 行推断 cwd，规则见 2.1.3；推断失败回退到 `/`。
     - 选区是单一文件名（不含 `/` 与空白且长度 ≤ 256） → 作为 `prefilterFileName` 在选择器进入起点目录后预选高亮。

### 2.1.3 cwd 推断（`cwdInfer.ts`）
反向扫描终端缓冲区（默认 30 行），按优先级返回第一个命中：
1. **提示符里 cwd**：行尾形如 `:/etc/nginx$` / `:/etc/nginx#` 的部分（PS1 含 `\w` 的常见样式）。
2. **命令解析跟踪 cwd**：按时间顺序解析最近缓冲区中的 `cd`、`pushd`、`popd`，支持绝对路径、相对路径、`.`、`..` 与带反斜杠空格的路径片段。
3. **最近一条文件浏览类命令的目录参数**：`ls`、`ll`、`la`、`cat`、`less`、`more`、`head`、`tail` 后的绝对路径；若参数明显是文件（含 `.` 且不以 `/` 结尾）则取其父目录。

明确不识别或不完全保证的情况（失败时回退到 `/` 或用户可在 picker 中修正）：
- `$(...)` / 反引号命令替换不会展开，避免把路径输入变成远程命令执行入口。
- 子 shell、ssh 嵌套、sudo 切换用户后的 cwd 变化无法可靠跟踪；如果远程 shell 配置了 OSC 7，则以 OSC 7 上报的 cwd 为准。
- 命令是否成功执行不区分，仅按文本匹配（例如 `cd /not/exist` 仍可能被当作 cwd 线索）。

设计上**不强求推断准确**：因为推断错也只会让用户进错起点目录，用户在选择器里上下导航即可纠正，不会"静默打开错文件"。

### 2.1.4 RemoteFilePicker 行为
- 弹层风格：与 `ConfirmDialog` 同一气质（`glass-card` + 进场动画 + `var(--shadow-modal)`），尺寸 `640 x min(560px, 80vh)`。
- 数据：复用 `sftpListDir(sessionId, currentPath)`，不引入新后端命令。
- 排序：目录在前，名字字母序；隐藏文件默认折叠。
- 键盘：
  - `↑` / `↓` 选择
  - `Enter` 进目录或打开文件
  - `←` 或 `Backspace`（焦点不在路径输入框时）返回上级
  - `Cmd/Ctrl + .` 切换隐藏文件
  - `Esc` 关闭
- 点击路径栏切换为输入态，可直接输入任意绝对路径跳转。
- 选定文件后调用 `openQuickEditWindow`；不可读 / 非文本 / 超大等错误由 `sftp_read_text` 在 Quick Edit 窗口侧报出（与现有链路一致），picker 不做前置类型校验。

### 2.1.5 当前局限
- cwd 推断仍是启发式；OSC 7 可提供准确 cwd，但需要远程 shell 主动输出 OSC 7 序列。
- 路径栏支持 `~` 与简单 `$VAR` 展开；不执行 `$(...)` / 反引号命令替换，避免安全风险。
- 命令解析跟踪支持 `cd`、`pushd`、`popd` 的常见形式，但不理解 alias、函数、子 shell、ssh 嵌套、sudo 切换用户后的环境变化。
- 不解析命令是否成功执行，仅按文本匹配（`cd /not/exist` 也会被当作 cwd 线索）。

### 2.1.6 已知行为细节
以下不是 bug，是当前实现下用户可能感觉意外的行为，记录在此免得日后被当成 bug 重新研究一遍：
- **picker 打开期间再按 `Cmd/Ctrl + Shift + E` 不会重置选择器**：`TerminalInstance` 在 picker 已打开时早返回，避免重复 dispatch 导致选择状态丢失。
- **picker 路径输入框 / 搜索框聚焦时不会被 Quick Edit 全局快捷键抢占**：输入框带 `data-quick-editor-root="true"`，`useShortcuts` 会跳过。
- **`openQuickEditWindow` 后主窗口失焦**：后端 `quick_edit_open` 会主动 `set_focus` 到 quick-edit 窗口，因此 `onPick`/`onClose` 里的 `term.focus()` 在 quick-edit 抢焦后视觉上不生效。这与 SftpPage 现有路径一致，不视为问题。
- **多面板下未选中面板的选区被忽略**：仅持有 DOM 焦点的 `TerminalInstance` 响应。多面板都没有 selection 的角落场景下也只有焦点面板会弹 picker。
- **没有单元测试**：`cwdInfer.ts` 是纯函数，本应附带测试用例（提示符 / cd / ls / fallback），但项目当前无 vitest/jest 配置。补测试需先搭基础设施，未与本期一并推进。

### 2.1.7 增强项实现状态
按预期价值与实现复杂度排序，当前已落地能在现有架构内闭环的增强项：

| 增强 | 状态 | 备注 |
|---|---|---|
| picker 内显示「最近编辑」入口 | 已实现 | 复用 `shell.quickEditRecent.v1`，终端和 SFTP 入口共享记录 |
| 命令片段中的绝对路径自动识别 | 已实现 | 仅当命令片段中存在唯一绝对路径时直开，避免多路径误判 |
| type-ahead 模糊搜索 | 已实现 | picker 内对当前目录 entries 做 fuzzy match，不调用后端 |
| 路径栏 `~` 展开 | 已实现 | 新增 `sftp_canonicalize`，通过 SFTP REALPATH 展开 |
| 简单环境变量展开 | 已实现 | 新增 `ssh_env_get`，支持 `$HOME` 等简单 `$VAR`；不执行命令替换 |
| OSC 7 shell integration | 已实现 | xterm 注册 OSC 7 handler，远程 shell 上报 cwd 时优先使用 |
| 命令解析跟踪 cwd | 已实现 | 解析 `cd` / `pushd` / `popd`，支持相对路径和 `..` |

## 3. 为什么放在文件管理页
- 用户的触发点天然来自“我看到了一个远程文件，想改它”。
- `app/src/features/sftp/SftpPage.tsx` 已具备远程文件列表、上下文菜单、路径导航、会话上下文，是最自然的落点。
- 放在文件管理页可以保持上下文，不需要让用户跳到新的页面再重新定位文件。
- 放在终端页会削弱终端的核心职责；终端用户本来就能直接使用 `vim`。

## 4. 产品边界

### 4.1 该功能是什么
- 一个面向远程文本文件的轻量编辑器。
- 适合处理：
  - `nginx.conf`
  - `.env`
  - `docker-compose.yml`
  - `systemd service`
  - shell 脚本
  - 小型日志片段与说明文件

### 4.2 该功能不是什么
- 不是通用远端 IDE。
- 不是项目级代码编辑器。
- 不是 `vim` 的图形化替代。
- 不是多标签、多文件、多面板的工作区系统。

### 4.3 第一版明确不做
- 多文件同时编辑
- 自动补全 / LSP / 跳转定义
- diff / merge
- 自动保存
- 二进制文件查看
- 大文件编辑
- `sudo` 提权保存
- 从终端当前 PTY 直接劫持或模拟 `vim` 会话

## 5. UX 形态

### 5.1 推荐形态
- 使用文件管理页内的大号弹层（modal / sheet）承载编辑器。
- 不建议第一版做独立页面，也不建议先做侧边抽屉。

### 5.2 原因
- 配置文件通常需要足够宽度，侧边抽屉会明显压缩阅读体验。
- 大弹层更符合“Quick Edit”而不是“进入一个新模块”的心智。
- 用户保存后可立即回到文件管理上下文。

### 5.3 建议布局
- 顶部栏：文件名、完整路径、主机标签、只读状态、未保存提示。
- 工具栏：保存、重新加载、只读预览、关闭。
- 主编辑区：等宽字体、行号、基础查找、保留缩进。
- 底部状态栏：编码、换行类型、文件大小、最近保存结果。

### 5.4 macOS 质感要求
- Quick Edit 必须继承 `docs/03-UX/COMPONENT-STYLE-SPEC.md` 中的 macOS feel，而不是做成普通后台弹窗。
- 弹层表面：
  - 使用 glass surface
  - modal 级 blur
  - hairline border
  - 轻量双层阴影
- 头部层级：
  - 文件名使用更高视觉权重
  - 路径与主机信息降一层显示
  - 未保存状态使用低噪音但明确的强调色标签
- 工具栏风格：
  - 使用轻玻璃按钮或分段控件
  - 避免厚重实心工具条
  - hover / active / focus 必须完整定义
- 编辑区质感：
  - 背景比 modal 外层更沉稳，减少干扰
  - 行号与状态信息使用低对比辅助色
  - 光标、选区、查找高亮应有精致但克制的视觉反馈
- 动效：
  - 打开与关闭使用 `180ms` 左右的 fade + slight scale
  - 查找条、保存状态、只读提示采用轻动效，不允许跳闪
- 禁止事项：
  - 不要做成 Web 表单弹窗
  - 不要堆过多边框和高饱和按钮
  - 不要使用厚重 IDE 风格工具带破坏整体产品气质

### 5.5 推荐视觉细节
- 弹层尺寸：桌面常规宽度建议 `960~1180px`，高度占视窗 `72~84vh`。
- 圆角：沿用 modal `14px`。
- 头部：
  - 左侧显示文件名与路径
  - 右侧显示只读状态、文件信息、关闭按钮
- 工具栏：保存按钮保持主强调色；重新加载、只读预览、关闭使用次级按钮。
- 状态栏：使用细分隔、轻描边和微弱内阴影，体现专业工具感。
- 字体建议：
  - UI 使用 `SF Pro Text` / `PingFang SC`
  - 编辑区使用 `SF Mono` 或现有终端等宽字体栈

## 6. 可编辑文件判定

### 6.1 判定原则
- 不只依赖扩展名。
- 采用“扩展名提示 + 内容检测”双重判定。

### 6.2 可编辑候选扩展名
- `.conf`
- `.ini`
- `.yaml` / `.yml`
- `.json`
- `.toml`
- `.env`
- `.service`
- `.sh`
- `.py`
- `.rs`
- `.ts` / `.tsx`
- `.js`
- `.md`
- `.log`
- 无扩展名但内容可判定为 UTF-8 文本的配置文件

### 6.3 需要阻断的情况
- 文件包含明显二进制特征（如大量 `NUL` 字节）
- 文件大小超过限制
- 文件编码不受支持

## 7. 大小与性能边界
- 第一版建议只支持 `<= 1 MB` 的文本文件。
- 默认推荐阈值可从 `512 KB` 起步，稳定后再放宽到 `1 MB`。
- 超出阈值时不进入编辑模式，提示用户下载后本地编辑或使用终端工具。
- 打开文件时应一次性加载内容；第一版不做增量读取和超大文件虚拟滚动。

## 8. 后端实现建议

### 8.1 推荐方案：基于现有 SFTP 能力直接读写
- 在 `app/src-tauri/src/core/sftp.rs` 增加文本读取与文本写回能力。
- 读取使用独立 SFTP channel，避免干扰现有 PTY。
- 保存优先使用同目录临时文件写入，再通过 rename 置换正式文件。
- 对普通文件建议走：`temp write -> validate again -> original rename backup -> temp rename target -> cleanup backup`。
- 若置换阶段失败，应优先回滚到原文件，避免把目标路径留在半写状态。
- 对 `symlink` 路径要保守处理，避免把链接本身替换成普通文件；必要时保留直接写目标文件的兼容路径。

### 8.2 为什么不推荐第一版走 SSH 命令拼接
- 使用 `cat` / `tee` / heredoc 保存会引入复杂转义问题。
- 容易引入 shell quoting 错误和注入风险。
- 对多行内容、特殊字符、编码处理都更脆弱。

### 8.3 建议新增接口
- `sftp_read_text`
  - input：`{ sessionId, remotePath, maxBytes? }`
  - output：`{ content, size, mtime, encoding, isText, readonly, hash }`
- `sftp_write_text`
  - input：`{ sessionId, remotePath, content, expectedMtime?, expectedHash? }`
  - output：`{ success, size, mtime, hash }`

### 8.4 实现层级
- Tauri command：在 `app/src-tauri/src/lib.rs` 暴露新命令。
- 能力层：在 `core/sftp.rs` 新增读取 / 保存文本的方法。
- 前端调用层：在 `app/src/lib/tauri.ts` 增加 API 封装。

## 9. 前端实现建议

### 9.1 入口改动
- 在 `app/src/features/sftp/SftpPage.tsx` 的远程文件右键菜单里增加 `快速编辑`。
- 仅对远程 `file` 类型显示该入口；目录不显示。

### 9.2 组件建议
- 新增组件：`QuickEditModal.tsx`。
- 建议放在 `app/src/features/sftp/components/` 或 `app/src/features/sftp/` 下。
- `SftpPage` 负责：
  - 打开/关闭弹层
  - 传入 `sessionId` 与 `remotePath`
  - 保存成功后刷新当前目录

### 9.3 状态建议
- `idle`
- `loading`
- `ready`
- `saving`
- `readonly`
- `conflict`
- `error`

### 9.4 编辑器内核选型
- 推荐结论：使用 `CodeMirror 6` 作为 Quick Edit 的唯一编辑器内核。
- 不建议第一版先用 `textarea` 或手搓行号/查找/快捷键，再在后续切换编辑器内核。
- 不建议 Level 1/2 使用 `Monaco Editor`。
- 不建议引入 `Ace Editor` 作为折中方案。

### 9.5 选型理由
- `CodeMirror 6` 已足够成熟，能稳定提供行号、查找、撤销重做、只读态、快捷键、语法高亮等基础能力。
- 相比 `Monaco`，`CodeMirror 6` 更轻，嵌入成本更低，更容易保持 Quick Edit 的“轻量工具”定位，而不是滑向嵌入式 IDE。
- 相比 `Monaco`，`CodeMirror 6` 不依赖额外的 worker 配置链路，接入 `Vite + Tauri` 更直接，首版实现风险更低。
- 相比 `Ace`，`CodeMirror 6` 的现代扩展体系、主题桥接能力和 React/TS 集成体验更适合当前项目长期维护。
- 对 Quick Edit 这类“中小文本文件、单文件、模态弹层”的场景，`CodeMirror 6` 的流畅度、可控性和复杂度平衡更优。

### 9.6 实现策略
- 推荐直接使用 `CodeMirror 6` 核心包进行集成，不强依赖额外 React wrapper。
- 建议在 `QuickEditor.tsx` 内部持有 editor view 实例，由 `QuickEditModal.tsx` 只负责文件加载、保存、冲突与关闭确认。
- Level 1 即接入最小编辑器能力，不再保留“先做临时文本框版本”的过渡路线。

### 9.7 Level 1 最小依赖建议
- `codemirror`
- `@codemirror/commands`
- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/search`
- `@codemirror/language`
- `@codemirror/legacy-modes`
- `@codemirror/lang-json`
- `@codemirror/lang-yaml`
- `@codemirror/lang-markdown`

### 9.8 App 集成约束
- 必须处理全局快捷键与编辑器快捷键冲突。
- 现有 `useShortcuts` 不能只把 `INPUT/TEXTAREA/SELECT` 当成输入区；需要把 Quick Edit 编辑器焦点态排除在全局快捷键拦截之外。
- 必须处理全局 `contextmenu` 禁用策略，避免编辑器内部右键复制/粘贴、拼写建议或系统文本菜单被整体拦截。
- 必须保证编辑器打开后自动聚焦，关闭时焦点合理回到 SFTP 文件列表。
- 编辑器主题必须桥接到现有 design tokens，不接受默认浏览器样式或默认编辑器主题直接裸用。

### 9.9 macOS 输入质感要求
- Quick Edit 的目标不是“能编辑”，而是“在 macOS 上输入、移动光标、选择文本、滚动时都显得顺滑、克制、专业”。
- 输入体验优先级高于功能堆叠；若某个增强能力会明显拖慢输入、滚动或光标响应，优先砍掉该能力。
- 第一版必须优先保障：
  - 输入跟手，无明显掉帧或字符延迟
  - 光标移动与选择反馈稳定
  - 滚动顺滑，无明显抖动或重排感
  - 查找高亮、当前行高亮、只读提示都不能抢输入主体验

### 9.10 流畅度实现原则
- `QuickEditor.tsx` 内部持有 `CodeMirror` 实例与文档状态，不要把每次输入都做成 React 顶层受控重渲染。
- 不要在每次 `onChange` 时重新创建 editor view、重新拼装 extensions 或重建主题对象。
- 编辑器扩展、主题扩展、keymap 扩展应尽量保持稳定引用，避免输入过程中反复重配置。
- `QuickEditModal.tsx` 不应因文件内容变化而整块重渲染编辑器主体；编辑器内容更新应尽量通过 editor transaction 完成。
- dirty 状态、状态栏信息、保存按钮可随输入更新，但不应让整个 modal 高频重排。
- 对文件大小限制内的文本，第一版应保证“整文件加载后持续编辑”路径足够稳定，不在输入过程中做额外内容分析任务。
- 不在输入主路径上同步执行重计算：
  - 全量哈希重算
  - 大块 diff
  - 复杂语法推断
  - 频繁 layout measurement

### 9.11 建议的性能边界处理
- 打开文件时完成一次性检测：大小、文本性、编码、初始语言类型。
- 输入过程中只做轻量更新：文档变更、dirty 标记、必要的状态栏同步。
- 保存前再做内容哈希或冲突相关附加计算，不要把这类逻辑塞进每次按键。
- 语法高亮第一版只覆盖高频格式；低频格式宁可先退回纯文本，也不要为了“支持更多类型”牺牲流畅度。
- 对 `.log`、超长单行文本、内容噪音较大的文件，应允许保守降级部分装饰能力，优先保住输入与滚动体验。

### 9.12 macOS 细节建议
- 编辑区字体优先使用 `SF Mono` 或当前终端一致的高质量等宽字体栈。
- 光标颜色、选区颜色、当前行高亮要克制，避免高饱和 IDE 风格。
- gutter、状态栏、查找条都应低噪音，不要破坏内容区的沉浸感。
- 滚动条、内边距、行高、选区圆角和 focus ring 要与现有 Shell App 的 glass / modal 质感一致。
- 编辑器获得焦点时要有明确但不刺眼的 focus 提示；失焦后视觉应自然收回。

### 9.13 `QuickEditor.tsx` 建议接口
- 建议把 `QuickEditor.tsx` 设计成“轻受控、重内聚”的组件。
- 推荐 props 形态：

```ts
type QuickEditorProps = {
  value: string;
  baselineValue?: string;
  remotePath: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  onChange: (nextValue: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveRequest?: () => void;
  onFindRequest?: () => void;
  onStatusChange?: (status: {
    line: number;
    column: number;
    lineEnding: "LF" | "CRLF" | "mixed" | "unknown";
    indentStyle: "tab" | "spaces-2" | "spaces-4" | "unknown";
  }) => void;
};
```

- `value` 用于初始化与外部显式重载，不应在每次输入时驱动整个 editor 重建。
- `baselineValue` 表示最近一次成功读取或保存后的基线内容，用于稳定 dirty 判定。
- `remotePath` 用于推断 language extension。
- `readOnly` 用于切换只读态。
- `onChange` 只负责把最新文本同步回上层草稿状态，不负责驱动 editor 重新 mount。
- `onStatusChange` 用于同步行列、换行、缩进等状态栏信息。

### 9.14 `QuickEditor.tsx` 内部状态边界
- 适合放在 editor 内部的状态：
  - editor view 实例
  - 当前文档状态
  - 选区 / 光标位置
  - 查找面板开关与匹配状态
  - 语言扩展实例
- 适合放在 modal 层的状态：
  - loading
  - saving
  - error
  - conflict
  - 是否只读
  - 最近一次保存结果
  - 关闭前确认
- 原则：凡是高频、与按键直接相关的状态，尽量留在 editor 内；凡是业务语义和远端 IO 相关的状态，放在 modal 层。

### 9.15 初始化与重载策略
- 组件 mount 时创建一次 `EditorView`。
- 文件首次加载成功后，把内容写入 editor 初始文档。
- 当 `remotePath` 变化时：
  - 重新推断语言类型
  - 更新文档内容
  - 重置 dirty 基线
  - 焦点回到编辑器
- 当用户执行“重新加载”并确认覆盖当前草稿时：
  - 通过 transaction 替换当前文档
  - 更新 dirty 基线
  - 不重新销毁/创建整个 editor
- 不要因为父组件重新 render 就重新创建 `EditorView`。

### 9.16 文档同步策略
- 建议维护两份概念上的值：
  - `initialContent`：最近一次成功读取或成功保存后的基线
  - `draftContent`：当前编辑内容
- dirty 判定基于 `draftContent !== initialContent`。
- 输入过程中由 editor 内部先更新文档，再通过轻量回调把 `draftContent` 通知给 modal。
- 保存成功后：
  - 把当前内容提升为新的 `initialContent`
  - 清除 dirty
  - 更新状态栏与文件元数据

### 9.17 语言扩展建议
- Level 1 优先支持：
  - JSON
  - YAML
  - Markdown
  - Shell
- 第一版建议映射规则：
  - `.json` -> JSON
  - `.yaml` / `.yml` -> YAML
  - `.md` -> Markdown
  - `.sh` -> Shell
  - 其他类型 -> Plain Text
- `.env`、`nginx.conf`、`*.service`、`docker-compose.yml` 不必急于在 Level 1 做复杂专属语法支持。
- 原则是：高频格式优先，低频格式保守退回纯文本，避免为扩展覆盖率牺牲流畅度。

### 9.18 快捷键建议
- Level 1 最少应支持：
  - `Cmd/Ctrl + S`：保存
  - `Cmd/Ctrl + F`：打开查找
  - `Esc`：优先关闭查找条等次级 UI，再交给 modal 处理关闭逻辑
- 编辑器内快捷键优先级应高于页面级通用快捷键。
- 若编辑器已聚焦，`useShortcuts` 不应继续拦截与输入、查找、保存直接冲突的组合键。
- 不建议第一版接入过多 IDE 式快捷键，避免心智复杂度上升。

### 9.19 右键菜单与系统文本交互
- 当前 App 全局禁用了默认 `contextmenu`，Quick Edit 需要为编辑器区域开白名单。
- 最低要求：
  - 允许系统复制 / 粘贴 / 剪切菜单
  - 允许拼写建议或系统文本服务继续工作
  - 不让全局页面右键禁用策略破坏编辑区的原生文本体验
- 不建议第一版自造一个功能残缺的编辑器右键菜单替代系统菜单。

### 9.20 主题桥接建议
- 不建议直接套用默认 `CodeMirror` 主题完事。
- 应通过主题扩展把以下区域映射到现有 token：
  - editor background
  - text color
  - caret color
  - selection
  - active line
  - gutter background / text
  - search match / active match
  - panel background
  - focus ring
- 视觉目标：
  - 内容区比 modal 外壳更沉稳
  - gutter 低对比、不喧宾夺主
  - 当前行与查找高亮可见但不刺眼
  - 焦点态精致，不出现浏览器默认蓝边

### 9.21 输入路径上的禁止事项
- 不要在每次输入时触发：
  - React 顶层大面积状态更新
  - 目录刷新
  - 文件元数据重新读取
  - 内容哈希重算
  - 重建语言扩展
  - 重建整个主题对象
- 不要在编辑器外层包一层会频繁变化尺寸或布局的动画容器。
- 不要把保存按钮的 loading、toast 或状态栏更新做成影响 editor DOM 结构的整块重排。

### 9.22 建议的保存链路前端行为
- 用户触发保存时：
  1. 立即锁定重复保存按钮点击。
  2. 保持 editor 可见，不清空草稿。
  3. 若处于只读态，则直接提示权限不足，不假装进入正常保存流程。
  4. 调用 `sftp_write_text` 时带上最近一次读取成功后的 `expectedHash` 与可选 `expectedMtime`。
  5. 保存成功后更新基线内容、状态栏、元数据与目录列表。
  6. 保存失败后保留当前草稿和光标位置。
- 冲突与失败反馈应尽量轻量，不要在失败瞬间让整个编辑器区域闪烁或重载。

### 9.23 建议的关闭行为
- 若无未保存改动：直接关闭。
- 若存在未保存改动：
  - 弹出现有确认框
  - 默认焦点不放在危险确认上
  - 不自动丢弃草稿
- 关闭后：
  - 清理 editor view
  - 清理与当前文件相关的局部状态
  - 焦点尽量回到刚才操作的文件项或文件列表区域

### 9.24 验收重点
- 在 `<= 1 MB` 的典型配置文件中连续输入时，无明显字符延迟。
- 长按方向键、按住删除键、连续粘贴多行文本时，光标与内容反馈稳定。
- `Cmd/Ctrl + S`、`Cmd/Ctrl + F` 在编辑器聚焦时优先命中编辑器逻辑，不触发页面级误操作。
- 打开查找、关闭查找、保存成功、保存失败都不应导致 editor 失焦或滚动位置跳变。
- 深色 / 浅色主题下都保持 Shell App 的 macOS 风格，不出现默认 IDE 皮肤割裂感。

## 10. 冲突检测
- 打开文件时返回 `mtime` 和 `hash`。
- 保存时附带 `expectedMtime` 或 `expectedHash`。
- 后端保存前再次检查当前远端文件元数据。
- 若文件已被他人或其他进程修改：
  - 拒绝直接保存
  - 返回冲突错误
  - 前端提示用户重新加载

第一版建议：
- 仅支持“发现冲突后阻断保存”。
- 不做“强制覆盖”按钮，减少误操作风险。

## 11. 权限与失败处理
- 若文件可读但不可写：
  - 允许只读打开
  - 保存时提示权限不足
- 第一版不做 `sudo` 提权保存。
- 若后续要支持提权保存，建议作为二期能力单独设计，避免第一版引入过高复杂度。

## 12. 错误码建议
- `FILE_NOT_TEXT`
- `FILE_TOO_LARGE`
- `FILE_READ_FAILED`
- `FILE_WRITE_FAILED`
- `FILE_ENCODING_UNSUPPORTED`
- `FILE_CHANGED_CONFLICT`
- `FILE_PERMISSION_DENIED`

如需保持现有命名体系一致，也可统一挂在 `SFTP_*` 或 `FILE_*` 前缀下，但应在 `ERROR-CATALOG.md` 中有明确归档。

## 12.1 接口契约建议

### `sftp_read_text`

#### 请求
```ts
type SftpReadTextRequest = {
  sessionId: string;
  remotePath: string;
  maxBytes?: number | null;
};
```

#### 响应
```ts
type SftpReadTextResponse = {
  content: string;
  size: number;
  mtime: number;
  encoding: "utf-8" | "unknown";
  readonly: boolean;
  hash: string;
  isText: boolean;
};
```

#### 字段约定
- `size`：字节数。
- `mtime`：Unix epoch 秒级时间戳，与现有 `FileEntry.mtime` 保持一致。
- `encoding`：Level 1 先只保证 `utf-8`；无法可靠识别时可返回 `unknown` 并阻断编辑。
- `readonly`：后端根据当前保存链路的可写性判断；第一版允许保守判断。
- `hash`：用于保存前冲突检测；建议使用稳定、实现简单的内容哈希。
- `isText`：表示后端内容检测结果；若为 `false`，前端应阻断编辑。

### `sftp_write_text`

#### 请求
```ts
type SftpWriteTextRequest = {
  sessionId: string;
  remotePath: string;
  content: string;
  expectedMtime?: number | null;
  expectedHash?: string | null;
};
```

#### 响应
```ts
type SftpWriteTextResponse = {
  success: boolean;
  size: number;
  mtime: number;
  hash: string;
};
```

#### 字段约定
- `expectedMtime` / `expectedHash`：前端从最近一次成功读取结果中带回。
- 后端保存前应至少校验其中一个；若两者都存在，建议优先同时校验。
- 若检测到冲突，必须拒绝保存，不得静默覆盖。
- 成功后返回新的 `size / mtime / hash`，用于前端更新本地快照。

### `sftp_write_text_privileged`（Level 3）

#### 请求
```ts
type SftpWriteTextPrivilegedRequest = {
  sessionId: string;
  remotePath: string;
  content: string;
  expectedMtime?: number | null;
  expectedHash?: string | null;
  createBackup?: boolean;
};
```

#### 响应
```ts
type SftpWriteTextPrivilegedResponse = {
  success: boolean;
  size: number;
  mtime: number;
  hash: string;
  backupPath?: string | null;
  suggestedActions?: Array<{
    id: string;
    label: string;
    command: string;
  }>;
};
```

#### 字段约定
- `createBackup`：是否在提权保存前生成备份。
- `backupPath`：若成功生成备份，则返回远端备份路径。
- `suggestedActions`：仅作为 UI 展示/复制/回填来源，不代表已执行。

## 12.2 错误码与 UI 行为映射

| 错误码 | 典型场景 | 前端行为 |
| --- | --- | --- |
| `FILE_NOT_TEXT` | 文件内容检测为二进制或不适合文本编辑 | 阻断打开；toast 提示“该文件不是可编辑文本文件” |
| `FILE_TOO_LARGE` | 文件大小超过 Quick Edit 限制 | 阻断打开；提示下载后本地编辑或使用终端工具 |
| `FILE_ENCODING_UNSUPPORTED` | 非 UTF-8 或当前版本不支持的编码 | 阻断编辑；提示编码不支持 |
| `FILE_READ_FAILED` | 读取失败、远端文件不可达、会话异常 | 显示 error 态；支持重试 |
| `FILE_WRITE_FAILED` | 普通写回失败 | 保留当前草稿；提示保存失败 |
| `FILE_CHANGED_CONFLICT` | 远端文件在编辑期间发生变化 | 进入 conflict 态；保留当前草稿；提示重新加载 |
| `FILE_PERMISSION_DENIED` | 无法直接写回目标文件 | Level 1/2：提示只读或权限不足；Level 3：提供提权保存入口 |
| `SESSION_DISCONNECTED` | SSH 会话已断开 | 阻断读写；提示重新连接 |

### UI 处理原则
- 打开失败时，不显示空白编辑器假装成功。
- 保存失败时，不清空用户当前草稿。
- 冲突时，优先保护用户当前输入，再引导重新加载。
- 权限错误与普通写入失败应区分展示，不要都落成“保存失败”。
- Level 3 中，即便出现 `suggestedActions`，也不得暗示系统已自动执行相关命令。

## 13. 与现有产品边界的关系
- 当前 `PRD.md` 与 `GAP-LIST.md` 中存在“不做内置远端编辑器”的表述。
- 本设计建议的不是“通用远端编辑器”，而是“文件管理中的轻量快速编辑”。
- 若采纳本方案，建议后续同步收敛文档表述为：
  - 不做通用 IDE 式远端编辑器
  - 支持轻量远程文本快速编辑

## 14. 第一版开发拆解

### 14.1 后端
- 增加文本文件读取命令
- 增加文本文件保存命令
- 增加文本/大小检测
- 增加保存前冲突校验

### 14.2 前端
- 增加右键菜单入口
- 实现 `QuickEditModal`
- 接入读取 / 保存 API
- 增加加载态、保存态、错误态、冲突态
- 保存成功后刷新目录列表并给出 toast

### 14.4 视觉与交互
- 为 Quick Edit 定义独立样式块，但 token 必须复用全局设计变量。
- 对齐 `COMPONENT-STYLE-SPEC.md`：
  - blur
  - hairline border
  - modal shadow
  - focus ring
- 在桌面宽屏和较窄窗口下分别验证：
  - 宽屏下编辑区应有足够宽度
  - 窄屏下弹层应自动收紧边距并保持可用
- 校验键盘流：
  - 打开后焦点进入编辑区
  - `Cmd/Ctrl + S` 保存
  - `Cmd/Ctrl + F` 打开查找
  - `Esc` 先关闭次级浮层，再处理主弹层关闭

### 14.3 文档
- 若进入正式需求，后续再同步：
  - `PRD.md`
  - `FR-INDEX.md`
  - `FEATURE-STATUS.md`
  - `UI-SPEC.md`
  - `TECH-SPEC.md`
  - `ERROR-CATALOG.md`

## 15. 分期建议

### Level 1：最小可用
- 目标：先把“远程文本文件可安全打开、编辑、保存”这个闭环做稳。
- 必须支持：
  - 远程文本文件打开
  - 文本编辑
  - 保存
  - 只读回退
  - 未保存变更提示
  - 重新加载
  - 行号
  - 等宽字体显示
  - 基础快捷键：`Cmd/Ctrl + S`、`Cmd/Ctrl + F`
  - 文件信息展示：路径、大小、编码、最后修改时间
  - 大小限制
  - 二进制检测
  - 冲突检测
- 适用场景：配置文件、小脚本、`.env`、`yaml/json/toml`、日志片段。

#### Level 1 详细计划
1. 后端补齐 `sftp_read_text` / `sftp_write_text` 命令。
2. 在能力层加入：文本检测、大小限制、UTF-8 解码、保存前元数据校验。
3. 在 `app/src/lib/tauri.ts` 增加前端 API 封装与类型。
4. 在 `SftpPage.tsx` 远程文件菜单增加 `快速编辑` 入口，只对文件显示。
5. 新增 `QuickEditModal`，完成以下基础状态：
   - loading
   - ready
   - saving
   - readonly
   - conflict
   - error
6. 集成轻量编辑器组件，至少具备：行号、编辑、查找、保存快捷键。
7. 保存成功后：
   - 更新弹层内状态栏
   - 刷新当前目录
   - toast 提示成功
8. 保存失败时：
   - 按错误类型给出明确提示
   - 不清空用户当前编辑内容
9. 验证场景：
   - 小文本文件正常打开与保存
   - 非文本文件被阻断
   - 超大文件被阻断
   - 远端变更触发冲突
   - 只读文件保存失败提示正确

#### Level 1 文件级实现计划

##### `app/src-tauri/src/core/sftp.rs`
- 新增远程文本读取方法。
- 新增远程文本保存方法。
- 推荐新增返回结构，至少包含：
  - `content`
  - `size`
  - `mtime`
  - `encoding`
  - `readonly`
  - `hash`
  - `isText`
- 读取阶段处理：
  - 文件大小限制
  - 文本/二进制检测
  - UTF-8 解码
  - 当前文件元数据采集
- 保存阶段处理：
  - 保存前元数据复核
  - 冲突检测
  - 覆盖写回
  - 返回新的文件元数据

##### `app/src-tauri/src/lib.rs`
- 暴露新的 Tauri commands：
  - `sftp_read_text`
  - `sftp_write_text`
- 沿用现有 SFTP command 风格：
  - 先检查 session 是否连接
  - 再调用 `SftpManager`
- 建议新增 request / response struct：
  - `SftpReadTextResponse`
  - `SftpWriteTextResponse`
- 错误信息至少要能区分：
  - 非文本
  - 文件过大
  - 权限不足
  - 冲突
  - 读写失败

##### `app/src/lib/tauri.ts`
- 新增前端 API 封装：
  - `sftpReadText(sessionId, remotePath, maxBytes?)`
  - `sftpWriteText(sessionId, remotePath, content, expectedMtime?, expectedHash?)`
- 保持与现有 `sftpListDir / sftpRename / sftpTransferStart` 一致的封装风格。
- 该文件是前端与 Tauri command 的唯一桥接层，不建议在组件里直接 `invoke`。

##### `app/src/types/index.ts`
- 新增 Level 1 所需类型：
  - `RemoteTextFile`
  - `RemoteTextWriteResult`
  - 可选：`QuickEditViewState`
- 字段建议覆盖：
  - 内容
  - 文件大小
  - 修改时间
  - 编码
  - 是否只读
  - 哈希
  - 是否文本

##### `app/src/features/sftp/SftpPage.tsx`
- 在远程文件上下文菜单中增加 `快速编辑` 项。
- 仅对远程 `file` 类型显示，不对目录显示。
- 增加 Level 1 最小控制状态：
  - `quickEditOpen`
  - `quickEditPath`
- 在页面中挂载 `QuickEditModal`。
- 保存成功后负责触发：
  - 当前目录刷新
  - toast 成功提示
- 第一版先不强行加入双击打开，避免过早影响现有目录操作习惯。

##### `app/src/features/sftp/components/QuickEditModal.tsx`
- 这是 Level 1 前端主组件。
- 负责：
  - 打开时加载远程文本文件
  - 维护 `loading / ready / saving / readonly / conflict / error`
  - 保存
  - 重新加载
  - 关闭前未保存确认
- UI 结构建议：
  - Header：文件名、路径、只读/未保存状态、关闭按钮
  - Toolbar：保存、重新加载、查找
  - Body：编辑器主体或 loading / error 态
  - StatusBar：编码、大小、mtime、当前状态

##### `app/src/features/sftp/components/QuickEditor.tsx`
- Level 1 可单独成文件，也可先内联在 `QuickEditModal.tsx`。
- 如果单独拆分，建议职责只保留：
  - 编辑区渲染
  - 行号
  - 输入变更回调
  - 只读模式
  - 基础查找快捷键支持
- Level 1 不需要承载过多复杂逻辑，避免把 modal 控制和编辑器状态缠在一起。
- 编辑器内核明确使用 `CodeMirror 6`，不建议先用 `textarea` 过渡。

##### `app/src/features/sftp/components/QuickEditStatusBar.tsx`（可选）
- 如果 Level 1 先追求快速落地，可先内联在 `QuickEditModal.tsx`。
- 若拆分，建议仅负责底部状态信息展示：
  - 编码
  - 文件大小
  - 最后修改时间
  - 当前保存状态

##### `app/src/lib/i18n.ts`
- 增加 Level 1 文案：
  - `sftp.quickEdit`
  - `quickEdit.loading`
  - `quickEdit.readonly`
  - `quickEdit.unsaved`
  - `quickEdit.save`
  - `quickEdit.reload`
  - `quickEdit.saved`
  - `quickEdit.saveFailed`
  - `quickEdit.conflict`
  - `quickEdit.notText`
  - `quickEdit.fileTooLarge`
- 文案风格应与现有 SFTP、Toast、Confirm 文案保持一致。

##### `app/src/styles.css` 或 Quick Edit 独立样式文件
- 增加 Level 1 需要的基础样式：
  - modal glass shell
  - header / toolbar / body / status bar
  - 编辑区内层背景
  - badge 状态样式
  - 查找入口样式
- 样式必须复用现有 token：
  - `--color-*`
  - `--shadow-*`
  - `--radius-*`
- 不建议在 Level 1 单独发明新的视觉系统。

##### `app/src/components/ConfirmDialog.tsx`（复用，不一定修改）
- Level 1 的“关闭前未保存确认”建议优先复用现有确认框，而不是另造一套。
- 这样可以保证交互一致，也减少额外组件复杂度。

##### `app/package.json`
- Level 1 直接引入 `CodeMirror 6` 最小依赖，不再保留 `textarea` 过渡方案。
- 依赖建议以最小集合起步：
  - `codemirror`
  - `@codemirror/commands`
  - `@codemirror/state`
  - `@codemirror/view`
  - `@codemirror/search`
  - `@codemirror/language`
  - `@codemirror/legacy-modes`
  - `@codemirror/lang-json`
  - `@codemirror/lang-yaml`
  - `@codemirror/lang-markdown`
- `.env`、`.conf`、`.service`、`.log`、无扩展名文本文件第一版可先按纯文本处理。

##### Level 1 执行顺序建议
1. `app/src-tauri/src/core/sftp.rs`：实现文本读写能力。
2. `app/src-tauri/src/lib.rs`：暴露 `sftp_read_text / sftp_write_text`。
3. `app/src/lib/tauri.ts` + `app/src/types/index.ts`：完成前端 API 与类型。
4. `app/package.json`：补 `CodeMirror 6` 最小依赖。
5. `QuickEditor.tsx`：先跑通 `CodeMirror 6` 的行号、只读、查找、保存快捷键和焦点管理。
6. `app/src/features/sftp/SftpPage.tsx`：挂入口和弹层状态。
7. `QuickEditModal.tsx`：完成基础 UI 与状态闭环。
8. `i18n.ts` + 样式文件：补文案和 mac 风格视觉，并桥接 `CodeMirror` 主题。
9. 修正全局快捷键 / 全局右键菜单与编辑器的冲突。
10. 最后做回归验证与边界场景测试。

##### Level 1 主要风险
- 二进制检测如果过于粗糙，可能误判部分配置文件。
- 保存前冲突处理如果不严谨，容易覆盖远端新内容。
- 若编辑器内核选型或快捷键/右键菜单集成处理不当，会直接影响“流畅丝滑”的第一印象。
- 若视觉没对齐现有 glass / modal 风格，功能虽然可用，但会显得割裂。

### Level 2：更像成熟编辑器
- 目标：让 Quick Edit 具备“正常文件编辑器”的常用体验，但仍保持轻量。
- 建议增加：
  - 语法高亮
  - 查找与替换
  - 跳转到行
  - 自动识别缩进风格
  - 显示换行符类型（LF / CRLF）
  - 更清晰的只读 / 权限状态提示
  - 双击文本文件直接打开
  - 最近编辑文件记录
- 设计原则：增强编辑体验，但不引入项目级文件工作区。

#### Level 2 产品定位
- Level 2 不是把 Quick Edit 做成嵌入式 IDE，而是把它提升到“成熟文本编辑器”的体验层级。
- 对用户的感知目标是：
  - 比 Level 1 更顺手
  - 比普通文本框专业很多
  - 但仍然明显轻于 VS Code / Cursor / JetBrains
- 该阶段的核心仍是配置文件、小脚本、小型文本文件，而不是项目开发。

#### Level 2 用户价值
- 用户可以更快地定位、查找、替换配置项。
- 用户在编辑 `yaml/json/toml/sh` 等常见文本文件时，有更清晰的结构感和可读性。
- 用户无需离开当前文件管理上下文，就能完成更复杂一点的文本修改。

#### Level 2 交互增强点
- 双击文本文件直接打开：
  - 目录仍保持进入目录
  - 文本文件直接打开 Quick Edit
  - 非文本文件继续走下载或阻断提示
- 查找与替换：
  - `Cmd/Ctrl + F` 打开查找
  - `Cmd/Ctrl + Alt/Option + F` 或同类快捷键打开替换
  - 支持上一个/下一个匹配跳转
  - 支持匹配结果高亮
- 跳转到行：
  - 提供轻量输入入口
  - 支持 `line` 或 `line:column` 形式
- 更细的只读提示：
  - 顶部 badge
  - 工具栏禁用态
  - 状态栏说明
- 最近编辑：
  - 保留轻量历史，不引入完整文件历史面板
  - 用于快速重新打开最近编辑过的配置文件

#### Level 2 编辑器能力要求
- 语法高亮：
  - 按文件扩展名自动匹配
  - 第一优先支持：JSON、YAML、TOML、Shell、Markdown
  - 次优先支持：`.env`、Nginx、systemd 等按近似规则或纯文本增强处理
- 查找与替换：
  - 支持输入关键词后即时高亮
  - 支持替换当前匹配项
  - 支持替换全部，但需谨慎交互，避免误操作
- 行与列信息：
  - 状态栏显示当前光标行列
  - 配合跳转到行能力使用
- 缩进识别：
  - 自动识别当前文件常见缩进风格
  - 不自动激进改写整个文件格式
- 换行显示：
  - 状态栏显示 `LF` / `CRLF`
  - 第一版仅显示，不强制提供切换
- 撤销与重做：
  - 至少依赖编辑器内核的本地历史栈
  - 不需要单独做复杂历史系统

#### Level 2 组件与代码结构建议
- 在 `QuickEditModal` 基础上逐步拆分，而不是直接大规模重构。
- 建议新增或明确这些前端组件：
  - `QuickEditor.tsx`
  - `QuickEditFindBar.tsx`
  - `QuickEditReplaceBar.tsx`
  - `QuickEditStatusBar.tsx`
  - 可选：`QuickEditRecentMenu.tsx`
- 状态建议补充：
  - `findOpen`
  - `replaceOpen`
  - `currentLine`
  - `currentColumn`
  - `lineEnding`
  - `indentStyle`

#### Level 2 数据与持久化建议
- 最近编辑记录建议单独做轻量本地持久化，不进入远端同步范围。
- 每条记录至少包含：
  - `hostId`
  - `sessionId` 或可选 session 关联
  - `remotePath`
  - `updatedAt`
- 记录条数建议限制在固定上限，如 `20~50` 条。
- 仅用于“最近编辑”快速打开，不做完整版本管理。

#### Level 2 视觉与质感要求
- Level 2 仍必须保持 macOS feel，不允许因为功能变多就退化成“IDE 工具带堆满按钮”的样子。
- 查找与替换条建议：
  - 采用嵌入式轻玻璃条或顶部浮层条
  - 不占据过高垂直空间
  - 聚焦时有清晰但克制的 focus ring
- 跳转到行入口建议：
  - 用轻量 popover 或小型 command-like 浮层
  - 不要做成大表单弹窗
- 最近编辑入口建议：
  - 放在 header 或 toolbar 次级入口
  - 使用轻量 menu / popover
  - 保持信息密度高但视觉简洁

#### Level 2 技术建议
- 编辑器内核建议继续使用 `CodeMirror 6`。
- Level 2 增强主要通过 CodeMirror extension 完成，而不是自写复杂编辑行为。
- 优先接入的 extension 类型：
  - language support
  - search
  - history
  - line numbers
  - selection / highlight helpers
- 不建议在 Level 2 引入 `Monaco`，以免明显抬高体积、worker 配置复杂度和 IDE 感。

#### Level 2 风险点
- 语法高亮种类变多后，容易出现“某些文件类型高亮不准确”。
- 替换全部操作若交互不谨慎，容易误改大量内容。
- 最近编辑如果做得过重，会逐步演变成文件导航器，与当前功能边界冲突。
- 工具条入口变多后，视觉上容易失去轻盈感。

#### Level 2 验收标准
- 常见文本文件打开后可正确获得基础语法高亮。
- 查找与替换在中小文件中可稳定工作，无明显卡顿。
- 状态栏可显示当前行列、换行类型和只读状态。
- 双击文本文件直接打开行为稳定，不影响目录进入逻辑。
- 最近编辑记录可正常打开最近文件，且不会污染主要文件管理流程。
- 整体 UI 仍符合 Shell App 的专业、现代、macOS 风格，不出现厚重 IDE 化回退。

#### Level 2 详细计划
1. 为常见配置文件接入语法高亮扩展：
   - JSON
   - YAML
   - TOML
   - Shell
   - Nginx / Env 可先按近似规则处理
2. 增加查找与替换条，支持键盘切换与结果高亮。
3. 增加“跳转到行”能力，适配大于几十行的配置文件修改。
4. 自动识别缩进：tab / 2 spaces / 4 spaces。
5. 在底部状态栏显示换行格式与只读状态。
6. 支持双击文本文件直接打开，右键菜单仍保留显式入口。
7. 增加最近编辑记录，用于提升反复修改配置文件时的效率。
8. 加强窄屏适配：
   - 宽度不足时压缩头部信息
   - 工具栏转为紧凑布局
9. 回归验证：
   - 查找替换不破坏光标位置
   - 语法高亮不影响大部分常见配置文件输入性能

#### Level 2 文件级实现计划

##### `app/package.json`
- 新增 Level 2 所需编辑器依赖，建议以 `CodeMirror 6` 生态为主。
- 依赖类型建议至少包含：
  - state / view
  - basic setup
  - search
  - history
  - language support
- 不建议在 Level 2 引入 `Monaco`，避免包体积和复杂度明显抬升。
- 若 Level 1 已按建议接入最小依赖，则 Level 2 只是在此基础上补语言、高亮、搜索与状态扩展，而不是替换编辑器内核。

##### `app/src/features/sftp/SftpPage.tsx`
- 增加双击文本文件直接打开逻辑。
- 右键菜单中的 `快速编辑` 保留，作为显式入口。
- 若引入“最近编辑”快捷入口，可在 SFTP 页面头部或相关工具区增加次级入口，但不要破坏当前文件管理主布局。
- 继续只在远程 `file` 上触发，不改变目录双击进入行为。

##### `app/src/features/sftp/components/QuickEditModal.tsx`
- 从 Level 1 的基础弹层升级为 Level 2 的主控组件。
- 增加以下能力状态：
  - `findOpen`
  - `replaceOpen`
  - `currentLine`
  - `currentColumn`
  - `lineEnding`
  - `indentStyle`
- 增加以下交互：
  - 查找条打开/关闭
  - 替换条打开/关闭
  - 跳转到行入口
  - 最近编辑入口（如采纳）
- 保持弹层总体视觉简洁，不直接把所有细节堆成厚重工具栏。

##### `app/src/features/sftp/components/QuickEditor.tsx`
- Level 2 的核心增强建议集中在该文件，而不是继续把编辑器行为堆在 modal 内。
- 负责：
  - 集成 `CodeMirror 6`
  - 行号
  - 高亮语言扩展切换
  - 查找 / 替换扩展
  - 光标行列同步
  - 缩进风格识别
  - 本地撤销 / 重做历史
- 建议按 `remotePath` 推断文件类型，再映射到对应 language extension。

##### `app/src/features/sftp/components/QuickEditFindBar.tsx`
- 单独承载查找 UI。
- 负责：
  - 查询输入
  - 上一项 / 下一项跳转
  - 匹配计数展示
  - 关闭查找条
- UI 应保持轻薄，适合嵌入 modal 顶部区域，不应像独立表单弹窗。

##### `app/src/features/sftp/components/QuickEditReplaceBar.tsx`
- 在查找的基础上承载替换能力。
- 负责：
  - 替换当前项
  - 替换全部
  - 危险操作确认策略（至少在替换全部时做更明确反馈）
- 若第一阶段不单独拆文件，可先与 `QuickEditFindBar.tsx` 合并；但 Level 2 完整版建议拆开。

##### `app/src/features/sftp/components/QuickEditStatusBar.tsx`
- 从 Level 1 的基础状态栏升级为信息更完整的专业状态栏。
- 建议展示：
  - 编码
  - 文件大小
  - 行列位置
  - `LF/CRLF`
  - `Tabs/Spaces`
  - 只读状态
- 视觉上保持低噪音，不要抢编辑内容焦点。

##### `app/src/features/sftp/components/QuickEditRecentMenu.tsx`（可选）
- 若采纳最近编辑能力，建议通过独立轻量 menu / popover 组件承载。
- 仅显示少量最近文件，不做树结构，不做文件浏览器。
- 应支持点击后重新打开对应远程文件。

##### `app/src/lib/tauri.ts`
- Level 2 本身不一定需要新增后端 command。
- 若最近编辑记录放前端本地持久化，该文件无需新增 API。
- 若后续将最近编辑做成后端存储，再考虑新增接口；Level 2 不建议优先走这条路径。

##### `app/src/types/index.ts`
- 为 Level 2 补充前端类型：
  - `QuickEditRecentItem`
  - `QuickEditLineEnding`
  - `QuickEditIndentStyle`
- 若 `QuickEditor` 组件内部状态较多，也可引入轻量 props / state 类型，避免在 modal 内出现大量匿名对象。

##### `app/src/lib/i18n.ts`
- 增加 Level 2 文案：
  - 查找 / 替换
  - 上一个 / 下一个匹配
  - 跳转到行
  - 最近编辑
  - 行、列、换行类型、缩进方式
- 文案要保持专业工具语气，不要偏通用表单语言。

##### `app/src/styles.css` 或 Quick Edit 独立样式文件
- 增加 Level 2 的编辑器增强样式：
  - 查找条 / 替换条
  - 状态栏细节
  - 最近编辑 popover
  - CodeMirror 外层主题桥接
- 若 `CodeMirror` 原生样式与现有主题不一致，应在这里统一映射到当前 design tokens。
- 重点保证：
  - 背景层次
  - focus ring
  - 选区色
  - 当前行高亮
  - 查找高亮

##### `app/src/components/ConfirmDialog.tsx`（复用，不一定修改）
- 若 Level 2 的“替换全部”或关闭未保存内容时需要更明确确认，可复用现有确认框模式。
- 一般不建议为 Quick Edit 再造一套确认弹层。

##### 存储位置建议
- 最近编辑记录优先使用前端本地持久化。
- 若项目现有已有 settings/local persistence 入口，可复用。
- 若暂时没有统一轻量本地存储封装，可先采用简单本地持久化方案，后续再统一抽象。

##### Level 2 执行顺序建议
1. `app/package.json`：补编辑器依赖。
2. `QuickEditor.tsx`：先把 CodeMirror 6 与语法高亮、基础搜索跑通。
3. `QuickEditModal.tsx`：接入查找、替换、跳转到行状态。
4. `QuickEditFindBar.tsx` / `QuickEditReplaceBar.tsx`：拆出轻量条形交互。
5. `QuickEditStatusBar.tsx`：补行列、换行、缩进显示。
6. `SftpPage.tsx`：接入双击打开与最近编辑入口。
7. `i18n.ts` + 样式文件：统一补文案和 macOS 风格细节。

##### Level 2 主要风险
- `CodeMirror` 接入后若主题桥接不好，视觉上会与现有 Shell App 风格脱节。
- 双击打开逻辑若处理不当，会破坏现有目录导航手感。
- 查找替换若实现细节不稳，容易影响输入焦点和光标位置。
- 最近编辑若入口过重，会让 Quick Edit 逐渐偏向小型文件工作区。

### Level 3：偏运维增强
- 目标：围绕服务器配置修改场景，补足更符合 Shell / 运维工作流的高级能力。
- 建议增加：
  - `sudo` 提权保存
  - 保存前自动备份
  - 保存后建议动作
    - 例如：`nginx -t`
    - `systemctl daemon-reload`
  - `docker compose config`
  - 针对常见配置文件的轻量操作提示
- 设计原则：增强“改配置文件”的效率与安全性，不演进为通用 IDE。

#### Level 3 产品定位
- Level 3 不是继续堆叠编辑器功能，而是把 Quick Edit 往“运维场景下更可靠的配置修改工具”方向推进。
- 对用户的感知目标是：
  - 不只是能改文件
  - 还要更安全地改系统配置
  - 改完之后知道下一步该做什么
- 该阶段强调的是“运维闭环”，不是“代码编辑能力”。

#### Level 3 用户价值
- 用户在修改系统级配置文件时，不需要频繁回退到终端处理权限问题。
- 用户可以在保存前自动留备份，降低误改风险。
- 用户保存后可以快速获得下一步建议动作，减少遗漏检查。
- 用户仍保留对终端工作流的控制权，工具只辅助，不替代决策。

#### Level 3 交互增强点
- 提权保存入口：
  - 正常保存失败且命中权限问题时，提示“使用提权保存”
  - 不默认直接弹出提权流程，避免误触
- 保存前备份：
  - 可作为勾选项或默认策略
  - 需明确展示备份目标与命名规则
- 保存后建议动作：
  - 根据文件类型提供命令建议
  - 支持复制命令
  - 支持“回填到当前终端”，但不自动执行
- 高风险文件提醒：
  - 如 `/etc/nginx/nginx.conf`、`sshd_config`、`systemd` unit
  - 保存前和保存后都应有更明确提示

#### Level 3 能力要求
- 提权保存：
  - 普通保存与提权保存必须是两条明确区分的流程
  - 提权保存必须有清晰确认
  - 失败时不得覆盖原文件
- 备份：
  - 至少支持生成单次备份文件
  - 备份文件名需可追溯，如时间戳或固定后缀
- 建议动作：
  - 仅做“提示 / 回填 / 复制”
  - 不自动执行风险命令
- 审慎反馈：
  - 要明确告诉用户当前做的是普通保存、提权保存还是备份保存

#### Level 3 组件与代码结构建议
- 在 Level 1 / 2 基础上，新增或增强这些前端组件：
  - `QuickEditPrivilegeDialog.tsx`
  - `QuickEditBackupOptions.tsx`
  - `QuickEditPostSaveActions.tsx`
  - 可选：`QuickEditRiskNotice.tsx`
- `QuickEditModal.tsx` 继续作为主控组件，但不建议把提权保存和建议动作的全部 UI 都堆在一个文件里。
- 高风险交互应通过独立组件承载，保证逻辑清晰、可维护。

#### Level 3 数据与持久化建议
- Level 3 不需要引入复杂版本管理系统。
- 建议保留的轻量信息包括：
  - 最近一次保存是否使用提权
  - 最近一次是否创建备份
  - 最近一次建议动作列表
- 备份文件应以远端文件系统为准，不要求本地额外保存副本。
- 若后续要追踪备份历史，应单独建模，不在本阶段混入。

#### Level 3 视觉与质感要求
- Level 3 即使引入更多安全提示，也不能变成“满屏警告框”。
- 提权和高风险提示应：
  - 清晰
  - 明确
  - 但不过度惊吓
- 建议动作区应像专业工具的“下一步建议”，不是醒目的广告式卡片。
- 备份选项、提权说明、动作建议的 UI 应保持：
  - 层级清晰
  - 信息浓缩
  - 与 modal 主体视觉统一

#### Level 3 技术建议
- 普通保存仍优先使用 SFTP 直接写回。
- 提权保存不建议直接通过 shell 拼接长文本内容写入目标文件。
- 更稳妥的链路建议：
  1. 先将内容写入远端临时文件
  2. 再通过 exec command 执行提权移动 / 覆盖
  3. 失败时保留原文件
- 后续若支持备份，应优先在提权命令链中明确加入备份步骤，而不是依赖前端假设。

#### Level 3 风险点
- 提权保存是本功能最敏感的能力，若处理不慎，可能导致配置文件损坏或误覆盖。
- shell quoting、临时文件路径和权限处理都存在较高实现风险。
- 自动建议动作如果表达不准确，容易让用户误以为系统已经帮他执行了命令。
- 高风险提醒过多会破坏整体工具质感，过少又会降低安全性。

#### Level 3 验收标准
- 普通保存失败命中权限问题时，可稳定进入提权保存流程。
- 提权保存失败不会覆盖原文件，也不会丢失当前编辑内容。
- 备份文件可被明确定位和识别。
- 保存后建议动作可按文件类型稳定生成，且只提示不自动执行。
- 高风险配置文件的提示足够明确，但整体 UI 仍保持 Shell App 的专业和现代质感。

#### Level 3 详细计划
1. 设计提权保存链路，但与普通保存严格分开。
2. 当直接保存遇到权限问题时，提示用户可选择提权保存。
3. 提权保存前创建备份文件，保留回滚点。
4. 保存成功后，根据文件类型提供建议动作：
   - `nginx.conf` -> `nginx -t`
   - `systemd` unit -> `systemctl daemon-reload`
   - `docker-compose.yml` -> `docker compose config`
5. 允许用户复制建议命令或一键回填到当前终端，但不自动执行。
6. 对高风险文件增加二次确认与更明显的状态提示。
7. 验证场景：
   - 提权失败不覆盖原文件
   - 备份可追溯
   - 建议动作只提示不自动执行

#### Level 3 文件级实现计划

##### `app/src-tauri/src/core/sftp.rs`
- 保持普通保存链路继续可用，不应因提权保存引入回归。
- 可增加临时文件写入辅助能力，用于提权保存前置步骤。
- 若备份策略需要在远端直接完成，也可在这里保留与文件元数据相关的辅助逻辑。

##### `app/src-tauri/src/core/ssh.rs`
- Level 3 需要复用现有 exec command 能力承载提权动作。
- 建议基于现有 `exec_command_detailed` 扩展提权保存链路，而不是新造一套执行系统。
- 关键关注点：
  - 提权命令执行结果
  - stdout / stderr 收集
  - exit code 判断
  - 失败时错误信息回传

##### `app/src-tauri/src/lib.rs`
- 新增或扩展提权保存相关 command。
- 建议不要把普通保存和提权保存揉成一个黑盒接口；前端应能明确区分调用哪种保存方式。
- 可能的命令形态示例：
  - `sftp_write_text_privileged`
  - 或单独的 `quick_edit_privileged_save`
- 若加入备份选项，应在接口参数中显式传递，不做隐式推断。

##### `app/src/lib/tauri.ts`
- 增加提权保存相关 API 封装。
- 增加保存后建议动作相关返回类型封装。
- 保持前端组件仍通过该桥接层调用，不直接散落 command 名称。

##### `app/src/types/index.ts`
- 新增 Level 3 类型：
  - `QuickEditPrivilegeSaveRequest`
  - `QuickEditPrivilegeSaveResult`
  - `QuickEditBackupOption`
  - `QuickEditSuggestedAction`
  - `QuickEditRiskLevel`
- 类型目标是把“普通保存 / 提权保存 / 建议动作”语义分清。

##### `app/src/features/sftp/components/QuickEditModal.tsx`
- 在主 modal 中增加：
  - 普通保存失败后的提权入口
  - 备份选项入口
  - 保存后建议动作展示区
- 但不要把具体复杂流程全部写在该文件；更适合由子组件承载。
- Modal 负责总流程编排和状态切换。

##### `app/src/features/sftp/components/QuickEditPrivilegeDialog.tsx`
- 承载提权保存的确认与说明。
- 负责展示：
  - 当前目标文件
  - 是否创建备份
  - 提权保存说明
  - 失败风险提示
- 必须保持交互明确，不允许用户误以为这是普通保存。

##### `app/src/features/sftp/components/QuickEditBackupOptions.tsx`
- 承载备份策略 UI。
- 可作为提权保存流程的一部分，也可作为保存前的次级设置区。
- 建议只提供轻量选项，不做复杂历史列表。

##### `app/src/features/sftp/components/QuickEditPostSaveActions.tsx`
- 承载保存后的建议动作。
- 负责：
  - 根据文件类型展示推荐命令
  - 复制命令
  - 回填到当前终端
- 明确标注“未自动执行”。

##### `app/src/features/sftp/components/QuickEditRiskNotice.tsx`（可选）
- 用于高风险文件的轻量风险提醒。
- 仅在确有必要时显示，避免让 Level 3 UI 过度紧张化。

##### `app/src/lib/i18n.ts`
- 新增 Level 3 文案：
  - 提权保存
  - 备份说明
  - 备份已创建
  - 保存后建议动作
  - 回填到终端
  - 未自动执行
  - 高风险文件提示
- 文案要专业、直接，不要过度口语化。

##### `app/src/styles.css` 或 Quick Edit 独立样式文件
- 增加 Level 3 相关样式：
  - 提权确认区
  - 风险提示条
  - 保存后建议动作区
  - 备份选项区
- 风险色要克制使用，只在关键位置点到为止。
- 不能把整个 modal 渲染成错误告警页。

##### `app/src/components/ConfirmDialog.tsx`（复用，不一定修改）
- Level 3 的某些二次确认仍可复用现有确认框。
- 但提权保存由于信息量更高，通常更适合单独组件，而不是强塞进通用确认框。

##### `app/src/features/terminal/TerminalPage.tsx` 或相关终端桥接逻辑
- 若支持“将建议动作回填到当前终端”，需要确认现有终端写入链路的落点。
- 该能力应沿用现有“回填但不执行”的安全原则。
- 不应在 Level 3 引入自动执行命令行为。

##### Level 3 执行顺序建议
1. 先定义提权保存接口与安全边界。
2. 再实现后端临时文件 + exec command 的提权链路。
3. 接着补前端提权确认组件与备份选项。
4. 然后增加保存后建议动作的展示与复制/回填能力。
5. 最后打磨高风险提示与整体 macOS 质感。

##### Level 3 主要风险
- 提权保存链路是最高风险点，必须先设计再实现。
- 若把提权、备份、建议动作一次性混在一个面板里，交互会变得臃肿。
- 若终端回填逻辑处理不慎，可能打破现有“只回填不执行”的边界。
- 若 UI 用力过猛，会让 Quick Edit 从专业工具退化成复杂运维面板。

## 15.1 编辑器能力分层建议
- Quick Edit 应具备“正常文本编辑器”的基础能力，但能力边界要控制在轻量文本编辑范围内。
- 建议按以下原则收敛：
  - Level 1：比纯文本框强，足以替代临时 `vim` 修改
  - Level 2：比记事本类工具更成熟，但明显轻于 VS Code
  - Level 3：突出运维和配置编辑场景，而不是开发 IDE 场景

## 15.2 编辑器组件建议
- 第一版不建议手搓复杂编辑器行为。
- 编辑器内核直接确定为：`CodeMirror 6`
- 原因：
  - 足够轻量
  - 足够成熟，基础编辑体验稳定
  - 行号、查找、语法高亮、快捷键支持成熟
  - 嵌入成本和运行复杂度低于 `Monaco`
  - 更符合 Quick Edit 的轻量定位
  - 更容易贴合当前项目的 modal / glass / token 风格
- `Monaco Editor` 不作为 Level 1/2 备选路线；只有当产品边界明确转向 IDE 式远端编辑器时才重新评估。
- 不建议实现 `textarea + 自定义补丁` 的临时方案，这会在后续切换编辑器内核时产生重复工程成本。

## 16. 最终建议
- 这是一个适合作为当前项目内功能点落地的能力。
- 最佳入口是 `文件管理 / SFTP` 页，而不是独立页面或终端主入口。
- 最佳第一版方案是：`SFTP 文件管理页 + 大号快速编辑弹层 + 基于 SFTP 的直接文本读写 + CodeMirror 6 最小编辑内核`。
- 这样既保留 Shell 工具的专业气质，也能给非 `vim` 用户提供现代化、低门槛的编辑体验。

## 17. 执行顺序建议
- 推荐按以下顺序落地，避免第一版做重：
1. 完成 Level 1，并优先把读写稳定性、冲突处理、错误提示做扎实。
2. 在 Level 1 稳定后，再引入 Level 2 的编辑器增强能力。
3. Level 3 仅在确认存在真实高频运维场景后推进，避免提前引入复杂提权链路。
- 若工程排期需要更细拆分，可进一步按以下任务卡执行：
  - Task A：后端文本读写能力
  - Task B：Quick EditModal 与基础 UI
  - Task C：编辑器集成与快捷键
  - Task D：冲突与错误处理
  - Task E：macOS 质感打磨
  - Task F：Level 2 增强

## 18. 测试矩阵

### 18.1 Level 1 基础场景
| 场景 | 输入/条件 | 预期结果 |
| --- | --- | --- |
| 打开普通文本文件 | 小于大小限制的 UTF-8 文本文件 | 正常打开，进入 `ready` |
| 打开二进制文件 | 含明显 `NUL` 字节或二进制内容 | 阻断打开，返回 `FILE_NOT_TEXT` |
| 打开超大文件 | 超过 `maxBytes` 限制 | 阻断打开，返回 `FILE_TOO_LARGE` |
| 打开不支持编码文件 | 非 UTF-8 且无法可靠解码 | 阻断打开，返回 `FILE_ENCODING_UNSUPPORTED` |
| 正常保存 | 文件未被修改且可写 | 保存成功，更新 `mtime/hash` |
| 保存冲突 | 打开后远端文件被修改 | 拒绝保存，返回 `FILE_CHANGED_CONFLICT`，保留草稿 |
| 权限不足保存 | 目标文件不可直接写 | 返回 `FILE_PERMISSION_DENIED`，保留草稿 |
| 读取时断线 | 读取前或读取中 session 断开 | 返回 `SESSION_DISCONNECTED` 或读取失败错误 |
| 保存时断线 | 保存前或保存中 session 断开 | 返回 `SESSION_DISCONNECTED` 或写入失败错误 |
| 关闭未保存内容 | 有 dirty 内容时尝试关闭 | 弹确认，不直接丢弃内容 |

### 18.2 Level 2 编辑器增强场景
| 场景 | 输入/条件 | 预期结果 |
| --- | --- | --- |
| 语法高亮 | JSON/YAML/TOML/Shell/Markdown 文件 | 正常应用对应高亮 |
| 查找 | 输入关键词 | 匹配项高亮，支持上下跳转 |
| 替换当前项 | 单个匹配项替换 | 仅替换当前匹配 |
| 替换全部 | 多个匹配项 | 全部替换成功，且操作反馈明确 |
| 跳转到行 | 输入 `line` 或 `line:column` | 光标准确跳转 |
| 显示行列 | 光标移动 | 状态栏同步更新行列 |
| 显示换行格式 | LF/CRLF 文件 | 状态栏显示正确 |
| 识别缩进 | Tabs/2 spaces/4 spaces 文件 | 状态栏显示识别结果 |
| 双击文本文件 | 文件列表双击文本文件 | 直接打开 Quick Edit |
| 双击目录 | 文件列表双击目录 | 进入目录，不触发编辑 |
| 最近编辑 | 已存在最近编辑记录 | 可重新打开对应文件 |

### 18.3 Level 3 运维增强场景
| 场景 | 输入/条件 | 预期结果 |
| --- | --- | --- |
| 普通保存失败后提权 | 目标文件需更高权限 | 出现提权保存入口 |
| 提权保存成功 | 权限允许且命令成功 | 文件写回成功，返回新 `mtime/hash` |
| 提权保存失败 | sudo/exec 失败 | 原文件不被覆盖，草稿保留 |
| 提权保存+备份 | 开启 `createBackup` | 生成备份并返回 `backupPath` |
| 备份失败 | 备份阶段失败 | 拒绝继续覆盖或明确按策略回滚 |
| 建议动作生成 | 如 `nginx.conf`、`*.service`、`docker-compose.yml` | 展示建议动作，不自动执行 |
| 回填建议动作 | 用户选择回填到终端 | 仅回填当前终端，不自动发送回车 |
| 高风险文件提示 | `/etc/nginx/nginx.conf` 等 | 展示更明确的风险提示 |

### 18.4 回归与体验场景
| 场景 | 输入/条件 | 预期结果 |
| --- | --- | --- |
| macOS 质感一致性 | 打开/关闭弹层、查找条、建议动作区 | 动效、层级、边框、阴影与现有产品一致 |
| 窄窗口适配 | 窗口较窄 | 仍可正常编辑与保存，不出现关键按钮丢失 |
| 焦点流 | 键盘完成打开、查找、保存、关闭 | 焦点流稳定，无明显丢焦 |
| Toast 与错误反馈 | 成功/失败/冲突/权限错误 | 反馈清晰且不过载 |

## 19. Level 3 安全细节

### 19.1 提权保存基本原则
- 提权保存必须是显式用户选择的第二条路径，不能在普通保存失败后自动执行。
- 普通保存与提权保存必须分别在 UI 上明确标识。
- 提权保存的设计目标是“尽量不破坏原文件”，而不是“无论如何写进去”。

### 19.2 推荐提权保存链路
1. 前端提交 `content + expectedMtime/hash + createBackup`。
2. 后端再次校验冲突，确认远端文件未变化。
3. 后端先将新内容写入远端临时文件。
4. 若启用备份，先在提权链路中生成备份文件。
5. 再通过 `exec_command_detailed` 执行提权覆盖动作。
6. 成功后返回新的元数据、备份路径和建议动作。
7. 失败时确保原文件仍保持可用状态，并清理临时文件。

### 19.3 临时文件策略
- 临时文件应放在远端一个明确、安全、可清理的位置，例如用户可写的临时目录。
- 临时文件命名建议包含：
  - 固定前缀
  - 时间戳
  - 随机后缀
- 临时文件不应直接复用目标文件名，以避免误覆盖。
- 临时文件权限应尽量收紧，避免暴露敏感配置内容。
- 无论成功还是失败，都应在流程结束后尝试清理临时文件。

### 19.4 备份策略
- 备份文件应由后端在远端侧创建，不依赖前端推断。
- 备份文件命名建议：
  - `<target>.bak.<timestamp>`
  - 或团队认可的等价格式
- 同一路径多次备份不得互相覆盖，除非未来明确支持“仅保留最近一个备份”的策略。
- 若备份创建失败：
  - 在启用强制备份策略时，应阻断提权覆盖
  - 在可选备份策略时，应明确告知用户失败原因和是否继续

### 19.5 冲突与覆盖策略
- 提权保存前仍必须执行与普通保存同等级别的冲突校验。
- 不允许因为进入提权链路就跳过 `expectedMtime/hash` 校验。
- 第一版不建议支持“强制覆盖远端新内容”。
- 若发生冲突，应终止提权保存，并让用户重新加载文件。

### 19.6 exec 命令与安全边界
- 不应把完整文本内容直接拼接进 shell 命令。
- 提权执行阶段只负责处理远端临时文件到目标文件的覆盖、移动、备份等动作。
- 所有路径都必须进行严格转义与引用处理，避免命令注入。
- 必须完整收集：
  - stdout
  - stderr
  - exit code
- 失败时应将可读错误回传前端，但不要暴露多余敏感信息。

### 19.7 失败处理策略
- 任一步骤失败，都不应让前端误以为保存成功。
- 失败时必须优先保证：
  - 原文件未被破坏
  - 当前编辑草稿仍保留
  - 用户能获得明确错误原因
- 对于临时文件残留，应在后台尽量清理；若清理失败，不应伪装成完全成功。

### 19.8 建议动作规则原则
- 建议动作只能是辅助建议，不是自动化执行链。
- 规则建议显式维护，不应由模型或模糊推断实时生成。
- 建议动作至少应包含：
  - `id`
  - `label`
  - `command`
  - 可选：`description`
- 示例规则：
  - `nginx.conf` -> `nginx -t`
  - `*.service` -> `systemctl daemon-reload`
  - `docker-compose.yml` -> `docker compose config`
  - `sshd_config` -> 仅提示谨慎校验，不默认建议危险重启命令

### 19.9 UI 风险提示原则
- 风险提示应有层次：
  - 普通权限错误：低强度提示
  - 提权保存：中强度提示
  - 高风险系统配置：更明确提示
- 不要整屏使用高饱和错误色。
- 要让用户感受到“这个动作需要确认”，而不是“系统已失控”。

### 19.10 安全验收底线
- 提权保存失败不能覆盖原文件。
- 备份成功时必须可追溯到 `backupPath`。
- 建议动作不得自动执行。
- 终端回填必须延续现有“只回填不执行”的原则。
