# UI 设计稿 vs 真实代码 — 全量功能核对

> **用户约束（强）**：
> 1. 数据流、后端接口、交互行为与真实代码**完全一致**；
> 2. UI 仅在**布局/视觉/排版**层面重新设计；
> 3. 设计稿**不得新增**真实代码里没有的功能（即"设计稿独有项"应删除，不允许超前设计）；
> 4. 设计稿**不得简化**真实功能（不能合并状态、省略字段、砍掉对话框）。
>
> 本文档列出 `app/src/features/*` + `app/src/components/*` 中所有用户可见功能，对照 `ui/*.html` 设计稿是否覆盖；缺失项给一句话新排版位置建议。

---

## 总览

| feature | 真实功能点 | 设计稿已覆盖 | 缺失需补 |
| --- | ---: | ---: | ---: |
| connections | 23 | 11 | 12 |
| terminal | 21 | 8 | 13 |
| sftp | 19 | 9 | 10 |
| monitor | 13 | 5 | 8 |
| snippets | 14 | 7 | 7 |
| workflows | 17 | 6 | 11 |
| quick-edit | 16 | 7 | 9 |
| settings | 28 | 12 | 16 |
| 通用部件 | 12 | 5 | 7 |
| **合计** | **163** | **70** | **93** |

> 数字仅为粗略估计，用于体感"还差多少"。每个细项见下文。

---

## 1. connections — 主机管理

### 真实代码功能（来源 `app/src/features/connections/ConnectionsPage.tsx`）

1. 主机列表（按分组）/ 搜索 / 新建主机 / 新建分组
2. Import SSH config（独立子页）
3. 主机右键菜单：编辑 / 测试连接 / 收藏切换 / 移动到分组 / 删除
4. 分组右键菜单：重命名分组 / 删除分组（带确认）
5. 拖拽主机到分组
6. 批量选择模式 toggle / 选中计数 / 全选 / 批量删除（带确认）
7. 创建/编辑表单：name / host / port / username / authType(password|publickey) / password / group
8. 详情卡片：host / port / username / auth tag / group tag / created / lastConnected
9. "Password saved" / "No password saved" 双态提示
10. Connect 按钮（含 connecting 状态）+ Connect 快捷键 ⌘↵
11. Test connection 按钮（含 testing 状态）
12. 删除主机二次确认
13. Loading 状态 / 空连接占位（addFirst CTA）/ 选中后未选状态（selectOrCreate）
14. "Move to group" 子菜单（列分组 + No group 选项）
15. 批量删除 toast 反馈

### 设计稿核对（`ui/connections.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| 主机列表 + 分组分组 | ✅ | — |
| 搜索框 | ✅ | — |
| 新建主机 / Import SSH config 按钮 | ✅ | — |
| 新建分组按钮 | ✅ | — |
| 收藏星标 | ✅ | — |
| 详情卡片基本字段 | ✅ | — |
| Connect / Test 按钮（基础态） | ✅ | — |
| Tags（标签：app-tier / region 等） | ✅ | — |
| Drop target 视觉（拖入分组） | ✅ | — |
| Password saved 提示 | ✅ | — |
| 批量选择 toggle 按钮 | ✅ | — |
| 主机右键菜单（5 项） | ❌ | 主机卡片 hover 时右上角 `⋯` 按钮 → 浮出菜单（替代右键），保留一致的快捷键提示 |
| 分组右键菜单（重命名/删除/新建） | ❌ | 分组 header hover 出 `⋯` → 浮层菜单 |
| 创建/编辑表单（详细 form） | ❌ | 详情区切换为 form 模式（详情卡片整体替换为表单，不弹模态框） |
| Auth Type 切换 + 密码字段 | ❌ | 表单内的 segmented control（password / public key）+ 条件字段 |
| 多选模式：选中计数 + 全选 + 批量删除 | ❌ | 列表底部出现浮动操作条（FAB-style），脱离原 toolbar |
| Connecting / Testing 进行态 | ❌ | Connect 按钮内加 spinner + 文字切换；Test 按钮同理 |
| Move to group 子菜单 | ❌ | 主机右键菜单展开侧滑子菜单，列分组（选中态高亮当前分组） |
| 删除二次确认对话框 | ❌ | 通用 Confirm 组件（见"通用部件"段） |
| Loading 状态 | ❌ | 列表区骨架屏（skeleton 几行） |
| 空连接首次引导 | ❌ | 列表中央 "No connections, add first" 占位卡 |
| 未选主机时占位 | ❌ | 详情区中央 "Select or create" 占位 |
| Connect 快捷键 ⌘↵ 提示 | ✅ | 已有 |
| 批量删除/已删除 toast | ❌ | 通用 Toast 组件（见"通用部件"段） |

**设计稿独有（应删除）**：详情卡的 "Recent activity" 时间线 — 真实代码无此功能，按强约束需移除。

---

## 2. terminal — SSH 终端

### 真实代码功能

1. Tab 栏 + 拖拽重排 + 新建 tab + 关闭 tab
2. 关闭未保存 session 二次确认
3. 分屏：水平 / 垂直 / 关闭分屏（快捷键 Alt+Shift+- / Alt+Shift+|）
4. 重连按钮（disconnected/failed 状态浮层）+ Reconnecting 状态
5. 命令历史浮层：搜索 / 列表 / 清空（带二次确认）
6. Bookmarks 浮层：添加（带 label）/ 删除（带二次确认）
7. 危险命令二次确认（rm -rf 等）
8. CommandAssist（命令助手）：触发键 //、↑↓ 导航、Tab/Enter 确认、Esc 关闭
9. CommandAssist 位置：bottom-left / bottom-right / follow-cursor
10. Macro 运行按钮（紫色闪电）+ Macro Quick 面板：搜索 / 参数填写 / 必填/secret 标记 / 最近运行 / 危险确认
11. RemoteFilePicker 浮层（拉起 Quick Edit）：路径栏 / 搜索 / 面包屑 / 最近访问 / 显示隐藏文件 toggle / 键盘提示行
12. 选区→Quick Edit 触发（绝对路径直开，文件名预选）
13. 无活动 session 空态：goToConnections 按钮 / openConnections
14. 状态栏：连接状态 / 当前 cwd / latency / 编码 / 类型 / 终端尺寸

### 设计稿核对（`ui/terminal.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| Tab 栏 + 新建 tab + 关闭 tab | ✅ | — |
| 分屏（水平/垂直） | ✅ | — |
| Search in terminal 按钮 | ✅ | — |
| AI Assist 浮层（命令助手） | ✅ | — |
| Pane 工具栏 + latency 标签 | ✅ | — |
| 状态栏 cwd / 编码 / 终端尺寸 | ✅ | — |
| 关闭分屏按钮 | ✅ | tabbar 右侧再补一个，仅在 split 模式可见 |
| 状态栏 AI on 标记 | ✅ | — |
| Tab 拖拽重排视觉提示 | ❌ | 拖动 tab 时显示插入位置的细线（accent 色 1px） |
| 关闭 session 二次确认对话框 | ❌ | 通用 Confirm 组件（见"通用部件"） |
| 重连按钮 / Reconnecting 进行态 | ❌ | 终端内顶层覆盖一层"Disconnected · Reconnect"，与命令区错开 |
| 命令历史浮层 | ❌ | 单独 popover（右上角触发），列表 + 顶部搜索 + 底部"Clear history" |
| Bookmarks 浮层 | ❌ | 同上风格 popover，含"+ Add bookmark"输入条 |
| 危险命令二次确认 | ❌ | 通用 Confirm 组件（红色 destructive variant） |
| CommandAssist 位置切换演示 | ❌ | 在终端三个角各放一个示意图（或主示意 + 旁注 3 种位置） |
| Macro 运行按钮 + Macro Quick 面板 | ❌ | tabbar 右侧加紫色闪电图标 → 点击拉出 popover：搜索 + 配方列表 + 参数表单 + Recent runs |
| RemoteFilePicker 浮层 | ❌ | 选中文本后浮层式弹出（终端中部），含路径输入 / 搜索 / 列表 / 键盘提示行 |
| 选区→Quick Edit 触发反馈 | ❌ | 选中绝对路径时终端右上角浮 "⌘⇧E to quick edit" 提示气泡 |
| 无活动 session 空态 | ❌ | 终端区中央显示插画 + "Go to Connections" 按钮 |
| 危险命令保护开关提示 | ❌ | 状态栏左侧加盾牌图标（绿色=protected on） |

**设计稿独有（应删除）**：AI Assist 卡片里的 "Step 1 of 3 / Next / high confidence"。真实代码 CommandAssist 是**单条建议列表**（带 confirmKey: tab/enter 确认），没有"分步骤"概念。需改为：单条命令建议 + 上下方向键导航多条 + Tab/Enter 确认 + Esc 关闭。

---

## 3. sftp — 文件管理

### 真实代码功能（`app/src/features/sftp/SftpPage.tsx`）

1. 本地 + 远端双栏
2. 收藏路径栏（每栏顶部，可添加当前路径）
3. 最近访问栏（每栏，可清空）
4. 文件右键菜单：打开 / Quick edit / 下载 / 重命名 / 删除
5. 批量选择 + 上传选中（带计数）
6. 批量删除（含非空目录额外提示 + 文件计数）
7. 拖拽上传（drop overlay 提示）
8. 新建文件夹（输入 placeholder + 创建按钮）
9. Filter 输入框 / 路径栏 / 上一级
10. Quick edit 入口（远端栏工具栏）
11. 切换 SFTP session
12. Overwrite confirm（含 scanning + scanCount 进行态）
13. 传输队列：transferring count / clearFinished / minimize / pause? / cancel?
14. 文件类型空目录占位 / 无活动会话占位 / 选会话提示
15. 删除 toast / 上传完成 toast / 下载已开始 toast

### 设计稿核对（`ui/sftp.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| 双栏（local + remote） | ✅ | — |
| 路径栏 + Up 按钮 + Filter | ✅ | — |
| New folder / Refresh / Quick edit 按钮 | ✅ | — |
| 传输队列面板（含 Pause / Cancel） | ✅ | — |
| Reveal 按钮 | ✅ | — |
| 折叠传输面板 | ✅ | — |
| 文件列表基础视图 | ✅ | — |
| 多选状态视觉 | ✅ | 已有但缺操作条 |
| Upload / Download 按钮位置 | ✅ | — |
| 收藏路径栏（每栏顶部） | ❌ | 路径栏下方插入一行 chip：⭐ /home, ⭐ /etc/nginx, ＋ Add current |
| 最近访问栏 | ❌ | 在收藏栏下方加一行 "Recent: …" 横滑 chips |
| 右键菜单（5 项） | ❌ | hover 文件行右侧出 `⋯` → 菜单 |
| 批量上传/批量删除浮动操作条 | ❌ | 多选后底部冒出工具条："3 items · Upload · Delete · Cancel" |
| 拖拽上传 drop overlay | ❌ | 远端栏全栏覆盖虚线框 + 中央"Drop to upload" |
| Overwrite 确认对话框（含 scanning） | ❌ | 通用 Confirm 加进度副标题 |
| 切换 SFTP session 控件 | ❌ | 标题栏右侧加 host 选择器（dropdown：当前 host + Change session） |
| 空目录占位 | ❌ | 文件列表中央 "Empty directory" 占位 |
| 无活动 session 空态 | ❌ | 整页中央插画 + "Connect first" |
| Clear finished 按钮 | ❌ | 传输面板顶部右侧 "Clear finished" 文字按钮 |
| Minimize 传输面板 | ❌ | 传输面板顶部已有 collapse 按钮，命名改 "Minimize" 即可 |

**设计稿独有（应修正）**：本地栏只画了 Linux 路径风格 — 真实代码本地路径会跟随 OS（macOS / Windows / Linux），建议补一版 macOS 路径 `/Users/…` 和 Windows 路径 `C:\Users\…` 做参考，避免视觉默认 Linux 误导。

---

## 4. monitor — 系统监控

### 真实代码功能（`app/src/features/monitor/MonitorPage.tsx`）

1. 顶部 stat：uptime / load / cpu / memory / network
2. session health 健康徽章
3. CPU / Memory / Network 趋势图（CollapsibleSection）
4. Network Rx + Tx 分别折线
5. Processes 表格（Top 15）：pid / user / cpu / mem / command + 按 command 搜索
6. Disk Usage 表格：filesystem / usage / available / used / total / mount
7. Command templates section（自定义采集模板）
8. 停止采集按钮
9. 切换会话 / selectAnother / connectFirst
10. 错误态：collectionFailed / sessionDisconnected
11. Collecting 状态
12. 标题（monitor.title）+ 采样间隔显示

### 设计稿核对（`ui/monitor.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| Page header | ✅ | — |
| Processes 表格 + 搜索 | ✅ | — |
| 状态栏的 CPU/MEM/LA 数值 | ✅ | — |
| Healthy 标签 | ✅ | — |
| 采样间隔提示 | ✅ | — |
| Disk Usage 表格 | ❌ | Processes 下方加一个 "Disk Usage" 折叠面板（默认收起） |
| Network Rx/Tx 趋势图 | ❌ | 顶部 stat 下方加 4 联图（CPU / Memory / Net Rx / Net Tx） |
| Memory 单独趋势图 | ❌ | 同上 4 联图之一 |
| Command templates 段 | ❌ | 整页底部加"Custom metrics"折叠面板（输入命令 + 解析正则 + 时序图） |
| Uptime / Load / Network 顶部 stat 卡 | ❌ | 顶部一行 5 联卡片：Uptime / Load / CPU / Memory / Network（替换/扩展现有 stat 区） |
| 停止采集 / 切换会话 | ❌ | Page header 右侧加 "Stop" + session 选择 dropdown |
| 错误态（采集失败/断开） | ❌ | 趋势图区中央覆盖错误图标 + "Reconnect" 按钮 |
| 无活动 session 空态 | ❌ | 整页中央插画 + "Connect first" |

**设计稿独有**：状态栏的 "Healthy" 是设计稿自创的简化版，真实代码用 GOOD/FAIR/POOR 三档。建议改成三档徽章保持一致

---

## 5. snippets — 命令片段

### 真实代码功能（`app/src/features/snippets/SnippetsPage.tsx`）

1. 列表 + 分组 + 搜索 + 新建片段 + 新建分组
2. 表单字段：title / command / description / tags（逗号分隔）/ group
3. 右键菜单：编辑 / 复制 / 移动到分组 / 删除
4. 分组右键菜单：重命名 / 删除分组（带确认）
5. 拖拽片段到分组
6. 批量选择 + 选中计数 + 全选 + 批量删除（含确认）
7. 复制到剪贴板（toast 反馈）
8. 重复命令检测（duplicateCommand 警告）
9. 编辑/创建表单（与 connections 一致的"详情区替换"模式）
10. 占位：no snippets / addFirst / loading / selectOrCreate
11. 创建/更新时间显示

### 设计稿核对（`ui/snippets.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| Library / Groups 分类侧栏 | ✅ | — |
| 搜索框 | ✅ | — |
| 列表 + 详情双栏 | ✅ | — |
| 详情：title / 操作按钮（收藏/编辑/删除） | ✅ | — |
| 标题区子标题（24 个片段） | ✅ | — |
| Favorite / Edit / Delete 按钮 | ✅ | — |
| 创建/更新时间 | ✅ | — |
| 右键菜单（4 项） | ❌ | 列表项 hover `⋯` → 菜单 |
| 创建/编辑表单 | ❌ | 详情区切换 form 模式（与 connections 同模式） |
| 复制到剪贴板按钮 + toast | ❌ | 详情顶部加大号 "Copy" 按钮（带状态切换 Copy → Copied ✓） |
| 重复命令警告 | ❌ | 表单 command 字段下方红色 hint："This command already exists" |
| 批量选择 + 浮动操作条 | ❌ | 列表底部浮动条："3 selected · Move · Delete" |
| 移动到分组子菜单 | ❌ | 右键菜单展开侧滑（同 connections） |
| 加载/空态 | ❌ | 列表骨架 / "No snippets, add first" |

**设计稿独有（应删除）**：详情区里的 **"Variables"** 和 **"Recent runs"** — 这是 workflows 的功能错放在 snippets。snippets 是单条命令片段，**没有**变量替换和运行记录概念。必须从 snippets 设计稿删除，仅保留在 workflows 设计稿里。

---

## 6. workflows — 工作流

### 真实代码功能（`app/src/features/workflows/`）

1. 列表（WorkflowList）+ 分组 + 搜索 + 新建（newRecipe）
2. 详情（WorkflowDetail）：preview / steps / params / 步骤计数 / 参数计数
3. 编辑器（WorkflowEditor）：title / description / group / steps / params
4. **StepNavigator**（左侧步骤导航，可隐藏）
5. **ParamInspector**（右侧参数检查器，可隐藏）
6. **Spotlight 命令面板**（⌘K）：goto step / edit title/desc / add step/param / save
7. 步骤：title / command / 复制步骤 / 变量提示（var hint）/ params 关联
8. 参数：key / default / required / secret / 搜索 / addFirstParam
9. dirty 状态指示 + saved 提示
10. RunPanel：状态（running/completed/failed）+ startedAt + finishedAt + 加载/无运行
11. 批量选择 + 选中计数 + 全选 + 批量删除
12. 右键菜单：edit / move to group / delete
13. 分组右键菜单：rename / delete
14. 加载失败 / retry / loadFailed / noRecipes / addFirst

### 设计稿核对（`ui/workflows.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| 列表 + 搜索 | ✅ | — |
| 详情：标题 / Inputs / Steps / Recent runs | ✅ | — |
| 步骤拖拽 handle | ✅ | — |
| 步骤 More 按钮 | ✅ | — |
| Duplicate 按钮 | ✅ | — |
| Recent runs section | ✅ | — |
| 分组 / Library | ❌ | 左侧加分组树（同 connections / snippets 模式） |
| 编辑器 vs 只读详情切换 | ❌ | 右栏顶部 toggle：Detail / Edit 两态 |
| Spotlight 命令面板 ⌘K | ❌ | 编辑模式下右上角触发；浮于编辑器中央，含 section 分组（Basics / Actions / Steps） |
| StepNavigator（可隐藏） | ❌ | 编辑模式下左侧加抽屉式 step 列表（点 step 滚动定位），带"Hide" |
| ParamInspector（可隐藏） | ❌ | 编辑模式下右侧抽屉，列 param 表单（key/default/required/secret） |
| Variable hint（变量提示） | ❌ | 步骤 command 下方加 "{{params.foo}}" 类提示行 |
| dirty / saved 状态 | ❌ | 顶部加 status pill："Unsaved" / "Saved ✓" |
| Run panel running 动画 | ❌ | Recent runs 列表第一项加 spinner + "Running…" |
| 运行失败/成功配色徽章 | ❌ | runs 列表 dot 用真实代码三态（running 蓝/completed 绿/failed 红） |
| 批量选择 + 浮动操作条 | ❌ | 同 connections / snippets 风格 |
| 右键菜单 / 移动到分组 | ❌ | 同上 |
| 加载失败 + Retry | ❌ | 列表区加 retry 占位 |
| 空态 / addFirst | ❌ | "No workflows, add first" |

**设计稿独有**：步骤"Drag to reorder"对应真实代码的步骤拖拽，无独有项。

---

## 7. quick-edit — 远程文件编辑

### 真实代码功能（`app/src/features/quick-edit/`）

1. 独立 Tauri 窗口（QuickEditWindow），URL 参数传 open
2. Tab 栏 + 关闭 tab + 关闭未保存确认（unsavedCloseTitle/Desc）
3. 编辑器（CodeMirror）：find / replace / goto line / 上下文菜单（cut/copy/paste/selectAll）
4. Save 按钮 + Reload 按钮
5. **Save with sudo**（提权保存）：弹窗输入 sudo 密码 / 创建备份 / 备份路径展示
6. **保存后操作建议**（Post-save actions）：基于文件名识别（nginx test / systemd reload / docker compose / sshd test）→ 复制命令 / 填到终端
7. **风险标记**（risk hints）：High（sshd/sudoers）/ Medium（config）双级别
8. 状态条：dirty / readonly / saving / conflict / sessionDetached / Saved ✓
9. **Conflict 检测**：远端文件被改动 → 提示"Reload"
10. **SessionDetachedDialog**：discardAll / keepReadonly
11. 加载错误：notText / fileTooLarge / encodingUnsupported / permissionDenied / sudoAuthFailed / saveFailed / loadFailed
12. Try again 重试

### 设计稿核对（`ui/quick-edit.html`）

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| 独立窗口 + traffic lights | ✅ | — |
| Tab 栏 + 关闭 + dirty 圆点 | ✅ | — |
| 工具栏：Save / Reload / Find / Replace / Goto line | ✅ | — |
| Find 计数（3/7） | ✅ | — |
| 路径面包屑（host:/path） | ✅ | — |
| 编辑器骨架 + gutter + 语法高亮 | ✅ | — |
| 状态条：modified | ✅ | — |
| Save with sudo 入口 + 弹窗 | ❌ | Save 按钮右边加分隔三角，下拉出 "Save with sudo…" 选项；点选后弹密码输入对话框（带备份 toggle） |
| 保存后操作建议卡 | ❌ | 编辑器底部 toast 式横幅："Saved ✓ · Run `nginx -t`?" + 复制 / 填终端两按钮 |
| 风险标记 (High / Medium) | ❌ | 文件名 tab 上挂红/黄圆点 + hover 提示 "Risky: sshd_config" |
| Conflict 状态 + Reload 提示 | ❌ | 编辑器顶部全宽红色横幅 "Remote modified · Reload" |
| SessionDetachedDialog | ❌ | 整窗覆盖模态："Session closed · Discard all / Keep readonly" |
| 加载错误占位（多类型） | ❌ | 编辑器中央占位 + 错误图标 + "Try again" 按钮 |
| readonly 状态条标记 | ❌ | 状态条加 "Readonly" pill |
| Saving / Conflict / Saved ✓ 多态 | ❌ | 状态条左侧 status text 切换 |
| 上下文菜单 cut/copy/paste/selectAll | ❌ | 不必单独画（沿用 OS 菜单），但可在 settings 里说明 |
| 备份路径展示 | ❌ | sudo 保存后状态条显示 "Backup: /tmp/…" 单击复制 |

**设计稿独有（应删除）**：**"Diff against remote" 按钮** — 真实代码无 diff 功能。按强约束需移除。

---

## 8. settings — 设置

### 真实代码功能（`app/src/features/settings/SettingsPage.tsx`）

**Tab 分组（6 个）**：通用 / 传输 / 终端 / 命令助手 / 快捷键 / 关于

**通用 (general)**：
1. 主题（dark/light/system）
2. 语言（zh/en）
3. UI 字体 + UI 字号
4. 危险操作二次确认开关

**传输 (transfer)**：
5. chunkSize / maxConcurrent / timeout / retryCount
6. downloadPath（含浏览选择）
7. 传输完成通知

**终端 (terminal)** — 最丰富：
8. 字体（family / size / weight / lineHeight / ligatures）
9. 光标（color / style: bar/block/underline / width）
10. 背景：source(color/image) / 颜色 / 图片路径 + 选择 / opacity / blur
11. 前景色 / 选区色 / ANSI 16 色调色板（含对比度警告 + Fix 按钮）
12. session timeout（30s / 5m / 30m / never）
13. 编码 / setLocale
14. 清空所有命令历史
15. **PredictiveEcho** 开关
16. **危险命令保护**：开关 / 内置黑名单 / 自定义黑名单
17. 数据隐私说明

**命令助手 (commandAssist)**：
18. 启用开关 / 触发位置（bottom-left/right/follow-cursor）/ 确认键（tab/enter）
19. 应用类别（git/docker/python/node/...）多选
20. 重置权重

**快捷键 (shortcuts)** — 只读：
21. 全局 / 终端 / SFTP / Picker / QuickEdit / CommandAssist 6 个作用域

**关于 (about)**：
22. 版本 / 框架 / 许可证

**底部公共**：
23. Save / Saving / Saved / SaveFailed 四态
24. Reset to default + ResetDone

### 设计稿核对（`ui/settings.html`）

| Tab / 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| 左侧 6 个 Tab | 部分 | 设计稿：通用 / 外观 / 终端 / 命令助手 / 数据 / 关于 — 与真实差 2 项 |
| **通用 - 主题** | ✅ | — |
| **通用 - 语言** | ✅ | — |
| **通用 - UI 字体/字号** | ❌（设计稿在"外观"） | 合并"外观"回"通用"，或保持拆分但补"传输 / 快捷键"两 tab |
| **通用 - 危险操作确认开关** | ❌ | 通用 tab 加 toggle 行 |
| **传输 tab**（整 tab 缺失） | ❌ | 加 tab："传输"，含 6 个字段（chunk/concurrent/timeout/retry/downloadPath/notify） |
| **终端 - 字体** | ✅ | — |
| **终端 - 光标** | ✅ | — |
| **终端 - 背景**（color/image/opacity/blur） | ❌ | 终端 tab 加 collapsible "Background"：source toggle + 对应字段 |
| **终端 - 前景/选区/ANSI 16 色** | ❌ | "Colors" 折叠面板：foreground swatch / selection swatch / ANSI 4×4 调色板 + 对比度警告 |
| **终端 - session timeout** | ❌ | "Session" 折叠：timeout select |
| **终端 - 编码 / setLocale** | ❌ | 同 "Session" 段 |
| **终端 - 清空命令历史** | ❌ | "Data" 段（独立按钮，有红色 hint） |
| **终端 - PredictiveEcho 开关** | ❌ | "Experimental" 折叠面板 |
| **终端 - 危险命令保护**（开关 + 黑名单编辑） | ❌ | "Safety" 折叠：toggle + 内置标签列表 + 自定义输入框（按 Enter 添加） |
| **命令助手 - 启用 / 触发位置 / 确认键** | ✅（基础态） | 设计稿有该 tab，但缺位置和确认键的 segmented control 实物 |
| **命令助手 - 应用类别多选** | ❌ | 命令助手 tab 加 13 个 chip 选择器（git/docker/python/node/...） |
| **命令助手 - 重置权重** | ❌ | 命令助手 tab 底部加 "Reset weights" 按钮（带 done 状态） |
| **快捷键 tab**（整 tab 缺失） | ❌ | 加 tab："快捷键"，6 个分组的双列表格（Keys / Effect） |
| **关于 - 版本/框架/许可证** | ✅ | — |
| **关于 - Logo/产品名** | ✅ | — |
| **关于 - 致谢** | ✅ | 真实代码无此 section（设计师可决定是否新增） |
| **底部 Save / Reset** | ❌ | 整页底部固定底栏：左 Reset / 右 Save（多态：saving/saved/failed） |
| ANSI 对比度警告 + Fix 按钮 | ❌ | 调色板下方红色提示 + "Fix" 文字按钮 |
| Setting Row 双列布局（label + control） | ✅ | 已有 |
| Section 分组标题 | ✅ | 已有（settings-group-title） |

**设计稿独有（应删除/调整）**：
- 设置里的"**数据**" tab（local storage / sync）— 真实代码无 sync 功能；该 tab 应删除，里面的 dataPrivacy 文案已存在于真实代码（`settings.dataPrivacy` 在终端 tab 末尾），保留位置即可
- "**致谢**" section — 真实代码无；应删除

**设计稿命名差异（重排修正）**：
- 设计稿"外观"应合并回"通用"（真实代码 theme/language/uiFont 都在 General tab）
- 设计稿缺"传输""快捷键"两整 tab，必须新增
- "终端" tab 内容缺约 60%，需大幅扩充

---

## 通用部件（Sidebar / Titlebar / StatusBar / ConfirmDialog / Toast / Logo）

### 真实代码（`app/src/components/`）

1. **Sidebar**：7 项 nav（connections / terminal / sftp / monitor / snippets / **macros** / settings）+ 折叠/展开按钮 + 滑动高亮 pill 动画
2. **Titlebar**：macOS 留白让位 traffic lights / Windows 三按钮（min/max/close）
3. **StatusBar**：版本 + 检查更新（9 种状态：idle/checking/available/downloading/downloadComplete/downloadFailed/upToDate/rateLimited/networkError/error）
4. **StatusBar**：会话数 / 活跃传输数 / 健康徽章（GOOD/FAIR/POOR 三档）/ 当前会话延迟（带颜色档：<100ms 绿 / <300ms 黄 / 其余红）
5. **StatusBar**："Ready" fallback
6. **ConfirmDialog**：通用确认（含 scanLabel / scanCount 进行态）
7. **Toast**：success / error / warning / info 四种
8. **Logo**：独立 SVG 组件
9. **ContextMenu**（ui/）：通用右键菜单
10. **Button / Input / SegmentedControl / Select**：通用控件

### 设计稿核对

| 功能 | 状态 | 缺失时的新排版建议 |
| --- | --- | --- |
| Sidebar 7 项导航 | 部分 ✅ | 设计稿是 6 项（缺 Macros 单独入口）— 注：真实代码 nav 是 macros，对应 workflows.html，需保持一致 |
| Sidebar 当前页高亮 | ✅ | — |
| Sidebar 折叠态 | ❌ | 加一版折叠态变体（仅图标 + 居中），index.html 演示 toggle |
| Sidebar 折叠按钮 | ❌ | 底部加 panel-toggle 按钮 |
| Sidebar pill 滑动高亮 | ❌ | CSS transition 模拟（背景色块切位置），用 keyframes 做 demo |
| Logo 独立 SVG（DdShell 标识） | ❌ | 真实代码用 Logo 组件（独立 svg），设计稿沿用 terminal 图标，需要单独设计一个 logo |
| Titlebar macOS / Windows 双形态 | ✅ | 设计稿有 mac traffic lights，缺 Windows 三按钮态 |
| StatusBar 版本号 + Check update 多态 | ❌ | StatusBar 左侧版本号区域，加 9 种状态变体演示（在 index.html 单独列出） |
| StatusBar 会话数 / 传输数 / GOOD 徽章 | ✅ | — |
| StatusBar 延迟带颜色档 | ✅ | — |
| **ConfirmDialog 通用组件** | ❌ | 在 index.html 加专门一段"Components"展示：基础确认 / 危险确认（红色 destructive）/ 含 scanning |
| **Toast 通用组件** | ❌ | 同上 Components 段，4 类（success/error/warning/info）+ 位置 |
| ContextMenu 通用样式 | ❌ | Components 段单独展示，含子菜单 |
| Logo 单色 + 渐变两版 | ❌ | 单独画 |
| Loading skeleton 通用样式 | ❌ | 列表骨架 / 卡片骨架两种 |

---

## 设计稿独有项汇总（按强约束统一处理）

| 项 | 出现位置 | 真实代码状态 | 处理 |
| --- | --- | --- | --- |
| Recent activity 时间线 | connections 详情 | 不存在 | **删除** |
| AI Step 1/2/3 分步骤 | terminal AI 浮层 | 单条建议（confirmKey: tab/enter） | **改为单条建议 + 上下导航 + Tab/Enter 确认 + Esc 关闭** |
| Variables / Recent runs | snippets 详情 | 是 workflows 的功能 | **删除**（移回 workflows） |
| Diff against remote | quick-edit 工具栏 | 不存在 | **删除** |
| 数据 tab（含 sync） | settings 左侧 | 无 sync | **删除整 tab**；其中 dataPrivacy 文案保留在终端 tab 末尾 |
| 致谢 section | settings/about | 无 | **删除** |
| Healthy 单档徽章 | monitor statusbar | 真实代码三档（GOOD/FAIR/POOR） | **改为三档徽章** |
| 本地路径仅 Linux 风格 | sftp 本地栏 | OS 自适应 | **补 macOS / Windows 路径示例** |
| Sidebar 6 项 | 全页面 | 真实代码 7 项（缺 Macros 入口） | **补第 7 项 nav.macros → workflows.html** |

---

## 高密度缺失点 Top 5（按强约束都是必补，下列按补的优先级排序）

1. **批量选择浮动操作条** — connections / sftp / snippets / workflows 四个页面都缺，是同一类组件，必须设计成跨页统一 pattern。
2. **右键菜单 + 移动到分组子菜单** — 同样四个页面都缺，是核心交互（用户最常用）；必须用统一的 ContextMenu 组件。
3. **Confirm 对话框** — 全应用 10+ 处都用到（删除/危险命令/覆盖/未保存等），通用组件未在设计稿出现，必须有 Components 展示。
4. **Quick Edit 提权保存（sudo）+ 风险标记 + 保存后操作建议** — 这是 quick-edit 三个核心功能，目前一个都没体现，必须补全。
5. **Settings 缺整 tab** — 缺"传输"和"快捷键"两个 tab，且终端 tab 内容只覆盖了不到 40%。Settings 设计稿目前是"外壳"，需大量内容补全。

---

## 通用部件层面的系统性遗漏（按强约束都是必补）

- **没有 Components 单页**：ConfirmDialog / Toast / ContextMenu / Skeleton 这些跨页组件缺独立展示；建议在 index.html 加一个"Components"段或新增 `ui/components.html`。
- **Sidebar 折叠态完全没画**：真实代码这是核心交互（节省空间），必须补。
- **StatusBar 更新流程的 9 种状态没画**：建议在 index.html 用一组小卡片展示 idle/checking/available/downloading/downloadComplete/downloadFailed/upToDate/rateLimited/networkError/error。
- **Sidebar 缺第 7 项 nav.macros**（对应 workflows.html）。
- **Logo 没单独设计**：用了 terminal 图标顶替，需独立的 DdShell 品牌标识。
