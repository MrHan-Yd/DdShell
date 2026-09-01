# SFTP 传输遗留优化清单

> 来源：2026-09-01 `fix(sftp): 修复下载完成后传输中计数不清零`（commit `aa8feb6`）的 code review。
> Review 结论 PASSED，以下三项为有意延后的后续优化，按优先级独立执行、独立提交。

## 背景

下载计数卡「N 个传输中」的根因（事件空转 / 陈旧快照复活 / 轮询失效）已在 aa8feb6 修复并通过 review。review 给出 1 个 P1（已当场修复：吸收合并改为仅对事件确认的终态生效）与 3 个 P2；P2 中「终态判断收敛助手函数」已顺手完成，其余两项 + 修复分析中发现的存量后端隐患汇总为本文档的 T1/T2/T3。

---

## T1 [P2] 终端文件管理抽屉渲染优化（review P2-3）

**问题**：`app/src/features/terminal/TerminalFileManagerDrawer.tsx:215` 用 `useSftpStore()` 无 selector 整店订阅，任何 store 字段变化都触发整个抽屉（工具栏 + 完整文件列表，可能几百行）重渲染。

**注意**：仅换 per-field selector 收益有限——抽屉主体要读 `transfers` 计算 `uploadSpeeds`（文件行上的上传速度列），传输期间 `transfers` 仍 ~200ms 变一次，文件列表还是会跟着重渲染。完整做法：

1. 文件列表拆成 memo 化子组件（`remoteEntries` / `selectedRemoteEntries` 不变时跳过整表 diff），或至少对 `file-row` 做 `React.memo`；
2. 传输面板保持独立（`CompactTransferStatus` 已正确使用 `useSftpStore((s) => s.transfers)`，作为模板）；
3. 主组件改 per-field selector，逐字段核对覆盖：render 体内读的每个字段、以及 `useCallback` / `useEffect` 闭包里读到的每个字段都必须有对应 selector。

**风险点（重构纪律，review 已确认）**：

- stale closure：整店订阅下任何字段变化都会重渲染，回调随手读的字段永远是新的；改窄订阅后漏掉某个字段的 selector 就会读到旧值——这是唯一真正容易出错的地方，需逐个 `useCallback` / `useEffect` 核对。
- 不能写每次返回新对象的组合 selector（`useSftpStore((s) => ({ a, b }))` 永远不相等）；组合场景用 `useShallow` 或一字段一订阅。
- action 引用在 zustand 中天生稳定，单独订阅零成本。

**验收**：

- [ ] 传输进行中用 React Profiler 确认：进度事件不再触发文件列表整体 re-render（仅传输面板更新）
- [ ] 回归通过：浏览 / 多选 / 重命名 / 新建目录 / 上传（点击 + 拖拽）/ 下载 / 删除 / 移动 / 快速编辑入口，行为与重构前一致
- [ ] `npx tsc --noEmit` 通过

---

## T2 [P2] 极快下载成功 toast 缺失（review P2-2）

**问题**：单文件下载且文件极小（几 ms 传完）时，`transfer:completed` 事件先于任务进入本地 `transfers` 列表到达，completed 监听里 `task` 为 undefined，「已下载」toast 分支（`sftp.ts:545` 一带 `task && task.direction === "download"`）被跳过。aa8feb6 引入的补拉取只恢复列表行，不回放 toast。批量下载有批次 toast 兜底，仅单文件下载受影响；属存量行为，非本次修复引入。

**修法方向**：

- 监听里 `!task` 时的补拉取（`refreshTransfers`）完成后，按拉取到的 direction 为 download 补发一次成功 toast（注意去重：只对本次事件补一次，避免与批次 toast 重复）；或
- 在监听中先记住「事件驱动成功」的意图，由 `refreshTransfers` 应用终态时统一触发。

**验收**：

- [ ] 小文件（如 1KB）单文件下载 100% 出现「已下载」toast
- [ ] 批量下载不重复弹 toast（批次汇总 toast 正常）
- [ ] 失败路径同理核对（transfer:failed 的错误 toast 在事件先行场景下不丢）

---

## T3 [P1 建议] SFTP 底层 IO 超时保护（存量隐患，非本次引入）

**问题**：`app/src-tauri/src/core/ssh.rs:312` `init_sftp()` 的 `channel_open_session` / `request_subsystem` 无超时包装；`execute_upload` / `execute_download` 中 `sftp.metadata` / `sftp.open` / `SftpManager::stat` 同样裸调用。连接僵死（黑洞路由、对端假死）时传输任务永远停在 running，并**永久占住并发信号量**（`SftpManager::new(3)`），后续传输无限排队——表现为计数卡「N 个传输中」且对应进度条冻结，只能重启应用。当前唯一兜底是 `transfer.timeout` 设置只作用于循环内的单次 read/write。

**影响面**：`init_sftp` 被 list_dir / mkdir / rename / read_text / write_text / quick-edit 保存等所有 SFTP 路径复用，加超时属于全局行为变更，需评估各调用方对超时错误的处理（前端会把 Err 显示为目录错误/保存失败）。

**修法方向**（二选一）：

- 全局：`tokio::time::timeout` 包装 `init_sftp` 与单次元数据/打开操作，超时值复用 `transfer.timeout` 设置；
- 最小面：仅对传输路径（execute_upload / execute_download 的 setup 段）包装，不动其他调用方。

**验收**：

- [ ] 模拟黑洞连接（防火墙 DROP）后启动传输，任务在超时后进入 failed、释放信号量，后续传输可正常进行
- [ ] 正常网络下大文件传输无回归（超时只包 setup 段则不覆盖数据段，数据段已有 transfer.timeout）
- [ ] `cargo check` / 相关路径手工回归

---

## 完成定义

- [ ] T1 / T2 / T3 各自独立提交（T1、T2 前端，T3 后端；可拆成独立 Trellis 任务分别领取）
- [ ] 涉及新约定的同步更新 `.trellis/spec/`（frontend/quality-guidelines.md、frontend/state-management.md）
- [ ] T3 若采用全局超时方案，需在 spec backend/ 下补记超时约定