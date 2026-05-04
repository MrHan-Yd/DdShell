# Predictive Echo 阶段 1 接力文档

> 用途：上下文已满，本文档用于在新会话中无缝接手开发
> 阅读顺序：§1 总览 → §2 已完成 → §3 未完成 → §4 接手指南 → §5/§6/§7 各切片详细 TODO
> 关联文档：[`predictive-echo-phase1-plan.md`](./predictive-echo-phase1-plan.md)（设计契约，必读）

---

## 1. 总览

### 1.1 项目背景

终端模块在高 RTT（400-2000ms）SSH 链路下打字卡顿，目标是实现"接近 0ms 视觉反馈"的体验，做法借鉴 mosh / iTerm2 的 **Predictive Echo（预测回显）**。

### 1.2 阶段 1 进度

| 阶段 | 状态 | 备注 |
|---|---|---|
| 前置优化（批量 1 + TCP_NODELAY） | ✅ 已完成 | 见 §2.1 |
| 设计文档 | ✅ 已完成 | `docs/predictive-echo-phase1-plan.md` |
| 切片 1：骨架 + 普通字符预测 + 朴素失配回滚 | ✅ 已完成 | `predictiveEcho.ts` + selfCheck 33/33 通过 |
| 切片 2：接入 TerminalInstance + dim 样式 + 启发式行编辑检测 | ✅ 已完成 | 类改造 + TerminalPage 接入 + 手测通过；启发式按文档备选方案推迟到切片 3 |
| 切片 3：退格预测 + alternate screen + 队列饱和保护 + 弱启发式 | ✅ 已完成 | 类改造 + CSI ?1049/47/1047 h/l handler + selfCheck 89/89 |
| 切片 4：UI 开关 + 一次性引导 + 监控指标 | ✅ 已完成（2026-05-04 视觉验收） | 设置项持久化（`api.settingGet/Set`）+ i18n 文案 + 一次性 toast 引导 + 类内 metrics 计数器 + dev 模式 60s console.debug + selfCheck 104/104 + 视觉手测通过（颜色 dim→正色 + vim 进入画面干净） |

### 1.3 关键文件清单

| 路径 | 状态 | 说明 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | ✅ 切片 4 完成 | 四态状态机 + dim + freeze + 退格 + 超时 + 弱启发式 + metrics + selfCheck 104/104，~900 行 |
| `docs/predictive-echo-phase1-plan.md` | ✅ 已写完 | 设计契约 |
| `docs/predictive-echo-phase1-progress.md` | ✅ 本文档 | 接力指南（切片 4 完成时更新） |
| `app/src/features/terminal/TerminalPage.tsx` | ✅ 切片 4 完成 | 实例化 + onData/session:output 接入 + OSC 133 + CSI ?1049/47/1047 h/l + 持久化设置读取 + `terminal:settings-changed` 订阅 + dev metrics 60s console.debug |
| `app/src/features/settings/SettingsPage.tsx` | ✅ 切片 4 完成 | 新增"预测回显（实验）"开关 + 一次性引导 toast + 立即写入 + dispatchEvent |
| `app/src/lib/i18n.ts` | ✅ 切片 4 完成 | 新增 3 条 key（settings.predictiveEcho / Desc / Guidance），中英双语 |
| `app/src/features/terminal/hooks/useMacroRunner.ts` | ✅ 仅做了批量 1（TextEncoder 复用） | 不在预测层范围 |
| `app/src-tauri/src/core/ssh.rs` | ✅ 已加 TCP_NODELAY | 不在预测层范围 |

---

## 2. 已完成工作

### 2.1 前置优化（已合入主分支）

#### 2.1.1 TerminalPage.tsx
- ✅ 模块级 `TEXT_ENCODER` 常量复用（替换了 10 处 `new TextEncoder()`）
- ✅ `tRef` 引入 + `checkAssistTrigger` 闭包稳定化（去除 deps 中的 `t`）
- ✅ `checkAssistTriggerRef` 引入 + 从 Effect 2 deps 中移除
- ✅ `assistCheckScheduledRef` + `queueMicrotask` 替换 `setTimeout(..., 0)` 快路径
- ✅ Effect 2 deps 仅保留 `[sessionId, hostId, tabId, updateTabState]`

#### 2.1.2 hooks/useMacroRunner.ts
- ✅ 模块级 `TEXT_ENCODER` 常量复用
- ✅ `writeText` 使用共享编码器

#### 2.1.3 src-tauri/src/core/ssh.rs
- ✅ `connect()` 改为先建 `TcpStream` + `set_nodelay(true)` 再 `connect_stream`
- ✅ `connect_with_fingerprint()` 同样处理
- ✅ TCP_NODELAY 失败时仅 warn，不阻塞连接

### 2.2 切片 1：predictiveEcho.ts

#### 2.2.1 已实现接口
```ts
class PredictiveEcho {
  constructor(term: Terminal, options?: { maxQueueSize?: number })

  // 用户按键路径调用
  onUserInput(data: string): void

  // 远程输出路径调用，返回应交给 xterm 显示的剩余文本
  onRemoteOutput(text: string): string

  // 重置内部状态（sessionId 切换 / 重连 / 关闭开关）
  reset(): void

  // 仅供调试
  _debugState(): { state, queueSize, pendingRemote, nextSeq }
}

// dev 验证入口
export function selfCheck(): { passed: boolean, results: string[] }
```

#### 2.2.2 切片 1 已支持
- ✅ 普通可见 ASCII 字符（0x20 ~ 0x7E）预测
- ✅ FIFO 队列管理（入队 / 部分匹配缓存 / 命中确认 / 失配回滚）
- ✅ 智能失配处理：先消化前缀命中部分，再回滚剩余队列（不是朴素全队回滚）
- ✅ 队列饱和保护（默认 100，可通过 `maxQueueSize` 配置）
- ✅ 部分匹配缓存（`pendingRemote`）+ 缓存上限 256 字节保护
- ✅ selfCheck 33/33 通过（10 个测试场景）

#### 2.2.3 切片 1 还没有的（切片 2/3/4 处理）
- ❌ 状态机（当前只有"始终 Active"）
- ❌ dim 视觉样式（当前直接写普通字符）
- ❌ OSC 133 / 启发式 prompt 检测
- ❌ ESC / Ctrl / Enter 冻结
- ❌ 退格预测
- ❌ alternate screen 检测
- ❌ UI 开关
- ❌ 监控指标

---

## 3. 未完成工作（按切片）

### 3.1 切片 2：接入 + dim + 行编辑检测（下一步）

详见 §5。

### 3.2 切片 3：退格 + alt screen + 队列保护

详见 §6。

### 3.3 切片 4：UI 开关 + 引导 + 指标（已完成，代码层）

详见 §7。状态：代码 + selfCheck 104/104 + tsc + vite build 全绿；手测待验收。

---

## 4. 接手指南

### 4.1 第一步：在新会话中加载上下文

新会话第一条消息建议这样说：

> 我要接着开发 Predictive Echo 阶段 1 切片 2。请先读：
> 1. `docs/predictive-echo-phase1-progress.md`（接力文档，包含进度和 TODO）
> 2. `docs/predictive-echo-phase1-plan.md`（设计契约）
> 3. `app/src/features/terminal/predictiveEcho.ts`（切片 1 实现）
> 然后按接力文档 §5 的 TODO 开始切片 2.1。

### 4.2 验证切片 1 仍正常的方法

**方法 A：跑 selfCheck（推荐，纯逻辑验证，无需启动应用）**
```bash
cd /Users/hanyongding/project/rust/shell/app
npx -y tsx -e "
import { selfCheck } from './src/features/terminal/predictiveEcho';
const r = selfCheck();
process.exit(r.passed ? 0 : 1);
"
```
预期：33/33 通过，退出码 0。

**方法 B：编译验证**
```bash
cd /Users/hanyongding/project/rust/shell/app
npx tsc --noEmit
```
预期：无错误。

### 4.3 开发期工作流（适用于每个切片）

1. 读 §5/§6/§7 对应的 TODO 清单
2. 用 `TaskCreate` 工具登记子任务
3. 改代码 → `tsc --noEmit` → 跑 selfCheck → `vite build` → 手测
4. 完成后更新本文档把对应切片打 ✅

### 4.4 严守的工程纪律（来自 CLAUDE.md）

- 修改前必须先 Read 当前文件，基于真实内容操作
- diff 最小化，不顺手优化无关代码
- 失败两次就换路，不硬刚
- 切片之间独立验证，不跨切片提交

---

## 5. 切片 2 详细 TODO（已完成，代码层）

> 目标：让预测层在 dev 环境通过 sessionStorage 开关启用后，普通命令打字即时反馈，vim 等场景自动冻结
> 状态：代码与 selfCheck 完成，14.4 手测待验收。

### 5.1 任务 #12（切片 2.1）：扩展 PredictiveEcho 类

#### 5.1.1 状态机重构
- [x] 状态从"始终 Active"改为完整四态：`Disabled` / `Cold` / `Active` / `Frozen`
- [x] 实例化时默认 `Cold`（开启但等 prompt 确认）
- [x] `reset()` 回到 `Cold`（仅在不在 Disabled 时；Disabled 状态保留）
- [x] `setEnabled(enabled: boolean)` 方法：true 仅在 Disabled 时切到 Cold；false 整队回滚 + Disabled

#### 5.1.2 prompt 信号接口（外部调用，不在内部解析 OSC）
新增公开方法：
- [x] `onPromptStart()`：OSC 133;A，state ≠ Disabled 时整队回滚 + 切换到 Cold（保守起见，A 表示 prompt 开始还未结束）
- [x] `onPromptReady()`：OSC 133;B，state ≠ Disabled 时切换到 Active
- [x] `onCommandStart()`：OSC 133;C，整队回滚 + Frozen
- [x] `onCommandEnd()`：OSC 133;D，state ≠ Disabled 时切换到 Cold
- [x] `onAlternateScreenEnter()`：整队回滚 + Frozen（切片 2 已实现，CSI handler 由切片 3 注册）
- [x] `onAlternateScreenLeave()`：保持 Frozen，等下个 prompt 信号
- [x] `freeze(reason?: string)`：通用冻结入口（整队回滚 + 切到 Frozen）

#### 5.1.3 输入侧冻结策略
在 `onUserInput` 里：
- [x] 检测到 `\r` / `\n`（回车）→ `freeze("enter")`，不预测此键
- [x] 检测到 `\x1b`（ESC）→ `freeze("esc")`
- [x] 检测到 `\x09`（Tab）→ `freeze("tab")`
- [x] 检测到 `< 0x20` 范围内的 Ctrl 组合 → `freeze("ctrl")`
- [x] 检测到 `\x7f` / `\b`（退格）→ `freeze("backspace")`（切片 3 接管前先冻结）
- [x] 上述触发后**不再像切片 1 那样默默 rollbackQueue**，而是经过 `freeze()` 统一处理（含 reason）

#### 5.1.4 dim 视觉样式
- [x] 入队时把屏幕写从 `term.write(ch)` 改为 `term.write(ANSI_DIM_ON + ch + ANSI_DIM_OFF)`
- [x] **重要**：`expectedEcho` 仍然只匹配纯字符（远程 echo 不会带 dim 序列），不要把 dim 字节算入 expectedEcho
- [x] **重要**：`undoSequence` 仍然是 `\b \b`（光标已经因为预测前进了一格，远程 echo 不影响光标位置）
- [x] **命中确认转正色**：实际实现偏离文档原方案——文档原片段 `\x1b[${len}D\x1b[22m{echo}` 在多字符飞行命中时会覆盖错位置（左移只到上一个 dim 字符前，而非队首字符前）。修正方案：
  ```ts
  // shift 之前队首字符距离光标 = (剩余队列 echo 长度 + 当前命中长度)
  const echoLen = head.expectedEcho.length;
  const offsetAfter = this.totalRemainingEchoLength();
  const totalBack = echoLen + offsetAfter;
  let seq = `\x1b[${totalBack}D${ANSI_DIM_OFF}${head.expectedEcho}`;
  if (offsetAfter > 0) seq += `\x1b[${offsetAfter}C`;
  this.term.write(seq);
  ```
- [x] 失配回滚仍用 `\b \b`（空格以正常色覆盖 dim 字符）

#### 5.1.5 selfCheck 同步
- [x] 既有 T1/T2/T2b/T3/T4/T5/T6/T8/T9/T10 用例开头加 `pe.onPromptReady()`（T7 不动，因为不调 onUserInput）
- [x] T1 / T8 调整 dim 序列断言（writes[i] === "\x1b[2mX\x1b[22m"）
- [x] T2 调整命中转正 + 回滚序列断言
- [x] 新增 T11：Cold 状态下 onUserInput 不预测
- [x] 新增 T12：onPromptReady() 后切到 Active 可预测
- [x] 新增 T13：onCommandStart() 整队回滚 + Frozen + Frozen 状态下不预测
- [x] 新增 T14：onPromptStart() 后回 Cold（保守起见）
- [x] 新增 T15：setEnabled(false) 切 Disabled、所有信号失效；setEnabled(true) 从 Disabled 回 Cold
- [x] **额外补丁**：失配 `handleMismatch` 也需切 Frozen（状态机一致性，文档未明示，selfCheck T2/T2b 暴露后已补）
- [x] 验收：50/50 断言全绿

### 5.2 任务 #13（切片 2.2）：TerminalPage.tsx 接入预测层

#### 5.2.1 实例化
- [x] `predictiveEchoRef = useRef<PredictiveEcho | null>(null)`（TerminalPage.tsx:136）
- [x] Effect 1（xterm 创建）实例化并赋值 ref（TerminalPage.tsx:580-599）
- [x] Effect 1 cleanup 清空 ref（TerminalPage.tsx:633）
- [x] Effect 2（sessionId 切换）调 `reset()`（TerminalPage.tsx:642-643）

#### 5.2.2 onData 接入点
- [x] 在所有现有逻辑（cmdBuffer 维护、命令助手、危险命令、sessionWrite、assist 检查）跑完之后调用
- [x] IME composing / 危险命令对话框 / assist Enter/Tab/Esc 接管 等"业务路径已 return"的分支不会触发预测（return 前置生效）
- [x] 在 onData 末尾调用 `predictiveEchoRef.current?.onUserInput(data)`（TerminalPage.tsx:752-758）

#### 5.2.3 session:output 接入点
- [x] 在 `filterMacroInternalChunk`（宏过滤）之后、`term.write` 之前调用
- [x] `const remaining = predictiveEchoRef.current?.onRemoteOutput(safeText) ?? safeText; if (remaining) term.write(remaining);`（TerminalPage.tsx:786-794）
- [x] 保留外层 `if (safeText)` 快速路径——空 chunk 进入预测层会污染 pendingRemote
- [x] 宏 token 不会与预测 expectedEcho 冲突（宏 token 是 ANSI / 特殊序列，预测只匹配可见字符）

#### 5.2.4 OSC 133 注册
- [x] Effect 1 内 `term.parser.registerOscHandler(133, ...)`（TerminalPage.tsx:588-603，紧邻 OSC 7）
- [x] A/B/C/D 分别调对应方法
- [x] 永远 `return false`（不消费序列，让 xterm 继续处理）
- [x] cleanup 调 `osc133Disposable.dispose()`（TerminalPage.tsx:631）

#### 5.2.5 弱启发式 prompt 检测
- [x] **按文档备选方案推迟到切片 3**——切片 2 仅依赖 OSC 133。没装 OSC 133 的 shell 在切片 2 阶段几乎不预测（保守可接受行为）。

### 5.3 任务 #14（切片 2.3）：feature flag + 编译验证

#### 5.3.1 sessionStorage 开关
- [x] 实例化后读 `sessionStorage.getItem("predictiveEcho.enabled") === "true"`，否则立刻 `setEnabled(false)`（TerminalPage.tsx:589-598）
- [x] `try/catch` 包裹 sessionStorage 防御（沙箱环境兼容）
- [x] dev console 切换：`sessionStorage.setItem("predictiveEcho.enabled", "true"); location.reload();`

#### 5.3.2 编译/构建验证
- [x] `npx tsc --noEmit` 0 错误
- [x] selfCheck 50/50 通过
- [x] `npx vite build` 1.77s 通过（仅原有的 chunk size warning，与本次改动无关）

#### 5.3.3 手测验收
- [x] 关闭开关：行为完全等同切片 1 之前
- [x] 开启开关、bash（无 OSC 133）：因为切片 2 推迟了启发式，预测**几乎不发生**——但不破坏现有功能即合格
- [x] 开启开关、装了 OSC 133 的 zsh：普通输入瞬时反馈
- [x] 开启开关 + OSC 133，敲 vim：进入立刻冻结，无屏幕残留
- [x] 命令助手 // 触发：仍然正常
- [x] 命令宏：仍然正常
- [x] 切换 tab / sessionId：reset 正确

---

## 6. 切片 3 详细 TODO（已完成）

> 目标：补完退格预测 + 边界场景保护
> 状态：代码完成 + selfCheck 89/89 + tsc + vite build 全绿；手测待验收。

### 6.1 退格预测
- [x] `onUserInput` 中 `\x7f` 或 `\b` 进入"退格分支"（前置于 isPredictableChar 检查）
- [x] 仅当队列尾部是 `kind: "char"` 时才预测：
  - 屏幕写 `\b \b` 抹掉那个字符
  - 出队尾部
  - 入队一条 `kind: "backspace"` 的"双 echo 消化"项：`expectedEcho = <原字符 echo> + "\b \b"`，`undoSequence = ""`（无需再撤）
- [x] 队尾不是 char 或队列空 → 整队回滚 + Frozen（不预测）
- [x] **关键修正**：`totalRemainingEchoLength()` 必须跳过 backspace 项（屏幕占 0 格，否则命中转正色光标偏移过大）
- [x] **关键修正**：onRemoteOutput 命中分支只对 `kind === "char"` 写转正序列，backspace 项命中仅 shift

### 6.2 alternate screen 检测
- [x] 在 TerminalPage 紧邻 OSC 133 注册 CSI handler：
  - `prefix: '?', final: 'h'` → 若 params[0] ∈ {1049, 1047, 47} 调 `onAlternateScreenEnter()`
  - `prefix: '?', final: 'l'` → 同上调 `onAlternateScreenLeave()`
  - 永远 `return false`（不消费序列）
  - 注意 params 类型为 `(number | number[])[]`，需 `Array.isArray(p) ? p[0] : p` 解包
- [x] cleanup 时 dispose 两个 handler

### 6.3 队列保护增强
- [x] 在 PredictiveEcho 内加 `private static readonly QUEUE_TIMEOUT_MS = 10_000`
- [x] 加 `private checkTimeout()`：队首 `predictedAt` 距今 > QUEUE_TIMEOUT_MS → `freeze("timeout")`
- [x] 在 `onUserInput` / `onRemoteOutput` 入口顺手调一次（不引入定时器，零开销路径在队列空时直接 return）

### 6.4 启发式 prompt 检测（仅 Cold→Active）
- [x] 加 `private detectPromptHeuristic(text)`：text 末尾为 `"$ "` / `"# "` / `"> "` 且 `state === "Cold"` 时切 Active 并设 `strictRemaining = 3`
- [x] 在 `onRemoteOutput` 入口检查（队列与 pendingRemote 都为空时调用，不干扰预测匹配路径）
- [x] **保守原则**：只做 Cold→Active，不动 Frozen（避免错预测扩散）
- [x] 严格期 strictRemaining：每次命中递减；失配 / freeze / setEnabled(false) / reset 等所有切走 Active 的路径统一归零
- [x] OSC 133;B 是强信号，到达时同步把 strictRemaining 归零（无严格期）

### 6.5 selfCheck 补充
- [x] T16 退格预测正常路径（`abc` + 退格 → 队列 [char,char,backspace] → 远程 `abc\b \b` 全命中）
- [x] T17 队尾非 char（连续退格）→ freeze
- [x] T18 队列空时退格 → freeze
- [x] T19 退格后失配回滚（backspace 项 undoSequence="" 不写额外字节）
- [x] T20 onAlternateScreenEnter/Leave（Enter 整队回滚 + Frozen，Leave 不自动恢复）
- [x] T21 队首超时 → freeze（用 monkey-patch Date.now 模拟时间跳跃）
- [x] T22 弱启发式 Cold→Active + strictRemaining=3，命中递减
- [x] T22b 启发式不动 Frozen→Active（保守）
- [x] T23 严格期失配立刻 Frozen + strictRemaining 归零
- [x] **总计 89/89 通过**（切片 2 时 50 → 切片 3 +39）

---

## 7. 切片 4 详细 TODO（已完成）

> 目标：发布到正式用户
> 状态：代码 + selfCheck 104/104 + tsc + vite build 全绿；手测待验收。

### 7.1 设置项
- [x] `app/src/features/settings/SettingsPage.tsx` 加 `terminal.predictiveEcho.enabled` 开关
- [x] 默认 false（假设 A2：高延迟用户少数）
- [x] 描述文案（i18n）："预测回显（高延迟链路下减少卡顿感）" + "对普通字符输入和退格做即时显示，远程实际回显在后台校验。在 vim、tmux 等场景自动关闭。**实验性功能**。"（实际文案见 `app/src/lib/i18n.ts` 中 `settings.predictiveEcho` / `settings.predictiveEchoDesc`）
- [x] PredictiveEcho 实例化时改为读这个设置（替代 sessionStorage）——`api.settingGet("terminal.predictiveEcho.enabled")` + `terminal:settings-changed` 事件订阅，sessionStorage 临时方案完全删除

### 7.2 一次性引导
- [x] localStorage 标记 `terminal.predictiveEcho.guidanceShown`
- [x] 第一次启用时 toast：（中英 i18n，key=`settings.predictiveEchoGuidance`）
  > "预测回显已开启。预测中的字符显示为浅色，确认后转为正常色。如遇异常请在设置中关闭。"

### 7.3 监控指标
- [x] PredictiveEcho 内部加计数器：`predictionCount` / `confirmCount` / `mismatchCount`
- [x] 加方法 `getMetrics()` 返回 + 命中率（hitRate = confirm/(confirm+mismatch)，分母 0 返回 null）
- [x] dev 模式下每 60s console.debug 一次（通过 `import.meta.env.DEV` 守卫，生产构建死代码消除）
- [x] selfCheck T24/T25/T26/T27 覆盖：初始零、命中递增、失配递增、hitRate 边界（104/104 通过）

### 7.4 文档
- [x] 更新接力文档（本文档 §1.2/§1.3/§3.3/§7/§10/§11）
- [x] 更新 i18n 文案（3 条 key 中英双语）
- [x] 更新 README（已在根 `README.md` 的 §2 SSH 终端章节追加"预测回显（实验性，默认关闭）"条目）
- [ ] 在设置页加"了解更多"链接（可选）——延后

---

## 8. 关键决策记录

> 这些决策在新会话中如果有疑问可以参考

| 决策 | 选择 | 理由 |
|---|---|---|
| 默认开关状态 | 关闭 | 假设 A2，高延迟用户少数 |
| 视觉样式 | dim (`\x1b[2m`) | 用户能看到"哪些已确认"，标准 ANSI 兼容 |
| 失配处理 | 智能前缀消化 + 剩余回滚 | 比朴素全队回滚少抖动 |
| 启发式范围 | 切片 2 仅 OSC 133，启发式推迟到切片 3 | 保守原则，宁少预测不错预测 |
| 队列上限 | 100 | 2000ms RTT × 10 cps = 20 飞行，留 5× 余量 |
| 退格预测策略 | 只回退队列里未确认字符 | 避免"删已确认字符"的复杂场景 |
| 状态机 | 4 态（Disabled/Cold/Active/Frozen） | 边界清晰，每个边界有明确转换条件 |

---

## 9. selfCheck 当前状态（切片 4 完成时）

| Test | Coverage | Status |
|---|---|---|
| T1 | 完整命中确认 + dim 序列断言 | ✓ |
| T2 | 前缀命中转正 + 队尾失配 + Frozen | ✓ |
| T2b | 第一字符就失配（整队回滚 + Frozen） | ✓ |
| T3a/b | 部分匹配跨调用 | ✓ |
| T4 | 不可预测字符（\r）触发 freeze + Frozen | ✓ |
| T5 | reset 清空状态 + 回 Cold | ✓ |
| T6 | 多余字节透传 | ✓ |
| T7 | 队列空时透传 | ✓ |
| T8 | 队列饱和保护 + dim 序列断言 | ✓ |
| T9a-e | 远程分批 echo | ✓ |
| T10 | 失配后 pendingRemote 清空 | ✓ |
| T11 | Cold 状态下不预测 | ✓ |
| T12 | onPromptReady → Active → 可预测 | ✓ |
| T13 | onCommandStart 整队回滚 + Frozen + Frozen 下不预测 | ✓ |
| T14 | onPromptStart 后回 Cold（保守） | ✓ |
| T15 | setEnabled(false) → Disabled，所有信号 no-op；setEnabled(true) 从 Disabled 回 Cold | ✓ |
| **T16** | **退格预测正常路径（abc + 退格 → [char,char,backspace] → 远程 `abc\b \b` 全命中）** | ✓ |
| **T17** | **队尾非 char（连续退格）→ freeze** | ✓ |
| **T18** | **队列空时退格 → freeze** | ✓ |
| **T19** | **退格后失配回滚（backspace 项 undoSequence="" 不写额外字节）** | ✓ |
| **T20** | **onAlternateScreenEnter 整队回滚 + Frozen，Leave 不自动恢复** | ✓ |
| **T21** | **队首超时 → freeze（monkey-patch Date.now）** | ✓ |
| **T22** | **弱启发式 Cold→Active + strictRemaining=3，命中递减** | ✓ |
| **T22b** | **启发式不动 Frozen→Active** | ✓ |
| **T23** | **严格期失配立刻 Frozen + strictRemaining 归零** | ✓ |
| **T24** | **getMetrics 初始全 0，hitRate=null（分母 0）** | ✓ |
| **T25** | **预测命中递增 predictionCount + confirmCount，hitRate 正确** | ✓ |
| **T26** | **失配递增 mismatchCount，hitRate 加权** | ✓ |
| **T27** | **reset/setEnabled 不重置 metrics（跨会话累计观察）** | ✓ |

**总断言数**：104/104 通过（切片 3 时 89/89，本切片 +15）。

---

## 10. 风险点与陷阱

### 10.1 切片 2 接入时容易踩的坑

| 陷阱 | 现象 | 防御 |
|---|---|---|
| onData 接入点放在了"业务短路 return"前面 | 危险命令对话期间也预测，画面错乱 | 必须放在所有 return 之后，仅"普通输入"分支调 |
| onRemoteOutput 接入在 macroFilter 之前 | 宏 token 进入预测匹配 | 必须在 macroFilter **之后**调 |
| OSC 133 handler 返回 true | xterm 不再处理该 OSC | 永远 `return false` |
| dim 序列被算入 expectedEcho | 永远失配（远程 echo 不会回 dim） | expectedEcho 仅含纯字符 |
| reset 时机错过 sessionId 切换 | 跨会话状态串台 | Effect 2 deps 包含 sessionId，确保切换时调 reset |
| feature flag 不读取就实例化 | 默认 Active 影响所有用户 | 实例化后立刻根据开关 setEnabled |

### 10.1bis 切片 2 实际遇到的坑（开发期发现）

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **文档原命中转正序列在多字符飞行时错位** | 队列 [a,b,c] 命中 a 时，文档 `\x1b[1D\x1b[22ma` 只左移到 c 之前，写 a 会覆盖 c | 改为 `\x1b[(echoLen+offsetAfter)D\x1b[22m{echo}\x1b[offsetAfterC`，offsetAfter = shift 后剩余队列 echo 长度 |
| **handleMismatch 仅回滚不切 Frozen** | 远程失配后状态留在 Active，下一字符还会预测，再次失配反复抖动 | 在 handleMismatch 内补 `if (state !== "Disabled") state = "Frozen"` |
| **空 chunk 进入 onRemoteOutput 会破坏 pendingRemote** | filterMacroInternalChunk 可能返回 safeText=""，若直接传入 onRemoteOutput，pendingRemote 会被清空但循环不消费数据 | session:output 接入处保留外层 `if (safeText)` 快速路径 |
| **reset 强制回 Cold 会让关闭开关后切 sessionId 自动开启** | sessionId 切换调用 reset，若实现是无条件回 Cold，原来 Disabled 状态会丢失 | reset 内部判 `if (state !== "Disabled") state = "Cold"`，Disabled 状态保留 |

### 10.1ter 切片 3 实际遇到的坑（开发期发现）

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **totalRemainingEchoLength 把 backspace 项算进去** | 队列 [char(a), backspace(c=4字节)] 命中 a 时 totalBack = 1+4 = 5，光标左移 5 格越界（a 实际只在前 1 格） | totalRemainingEchoLength 仅累加 `kind === "char"` 的项；backspace 项屏幕占 0 格不计入 |
| **退格分支被 isPredictableChar 提前拦截** | `\x7f` (0x7f) 不在 0x20-0x7e 范围内，原有 `!isPredictableChar` 分支会调 freeze("backspace")，吃掉所有退格能力 | 退格分支前置于 `isPredictableChar` 检查；命中 `ch === "\x7f" \|\| ch === "\b"` 直接走专属逻辑 |
| **命中转正序列对 backspace 项无意义** | backspace 项命中后写转正序列会乱画屏幕（屏幕原本无 dim 字符可转正） | 命中分支用 `if (head.kind === "char")` 包裹转正写；backspace 项命中仅 shift 出队 |
| **CSI ?h/l handler params 类型** | xterm typings 的 params 是 `(number \| number[])[]`，子参数（如 `?1049:1h`）会变 number[]，直接 === 比较失败 | 加解包工具 `Array.isArray(p) ? p[0] : p` 再比对 1049/1047/47 |
| **OSC 133;B 与启发式严格期冲突** | OSC 133;B 是强信号，但若与启发式共用 strictRemaining=3 会让强信号场景误进严格期 | onPromptReady 时显式把 strictRemaining 归零；只有 detectPromptHeuristic 的 Cold→Active 路径设 3 |
| **Date.now mock 测试需还原** | T21 monkey-patch 后若不还原会污染后续测试 / 真实运行 | `try/finally` 包裹，finally 里恢复 originalDateNow |

### 10.1quater 切片 4 实际遇到的坑（开发期发现）

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **metrics 在 reset/setEnabled 中是否清零的语义选择** | 若清零，dev 60s console.debug 永远只看到当前会话的瞬时统计；若累计，可观察"账号生命周期内整体健康度" | 选择**累计**（不清零）。理由：跨会话累计才能暴露"某些用户/链路稳态命中率低"的长期问题；瞬时观察可由 dev 自己重启 Tab |
| **监控 console.debug 在生产构建是否需移除** | 用户控制台被定时日志污染 | 用 `if (import.meta.env.DEV)` 守卫整个 setInterval 注册，生产 Vite 构建会做死代码消除，零开销 |
| **toast 引导 i18n key 命名冲突** | settings 域已有 `predictiveEcho` / `predictiveEchoDesc`，新增引导文案命名 | 用 `settings.predictiveEchoGuidance` 与开关同域，避免 toast 域膨胀 |
| **设置变更如何让所有打开的终端实时同步** | 切换设置后已开终端仍按旧状态运行 | 走 `window.dispatchEvent(new CustomEvent("terminal:settings-changed"))`，TerminalPage Effect 内 addEventListener 重新读 setting；与 commandAssist 现有方案一致 |
| **sessionStorage 临时方案要彻底删除** | 残留代码可能让用户在控制台手动开启绕过设置项 | 完全删除 sessionStorage 读取分支，持久化设置成单一来源；setEnabled 默认 false，settingGet 失败保留 Disabled |
| **长字符串 Edit 容易匹配失败** | docs/progress.md 一次性大块 Edit 报 "String to replace not found" | 分小颗粒度 Edit；遇到失败先 Read 精确行范围确认字符 |

### 10.2 切片 2 兼容性核对清单

逐项验证（开启预测 vs 关闭预测两种状态都过）：
- [x] 命令助手 // 触发
- [x] 命令助手 Enter/Tab 接管
- [x] 危险命令拦截
- [x] 命令历史
- [x] 宏运行
- [x] 宏输出过滤
- [x] IME 输入
- [x] Quick Edit 选区
- [x] 切换 tab / sessionId
- [x] 重连
- [x] 关闭终端

---

## 11. 给新会话的开场白模板（阶段 1 验收 / 后续阶段接力）

> 切片 1-4 代码全部完成（手测待验收），阶段 1 已闭环。下一会话若做手测验收 / 阶段 2 规划，复制以下模板：

> 我之前完成了 Predictive Echo 阶段 1 切片 1-4 的全部代码（selfCheck 104/104 + tsc + vite build 全绿，手测待验收）。请按以下顺序加载上下文：
>
> 1. 读 `docs/predictive-echo-phase1-progress.md`（接力文档，重点 §1.2 进度、§7 切片 4 验收清单、§10 陷阱清单含切片 2/3/4 实际遇到的坑）
> 2. 读 `docs/predictive-echo-phase1-plan.md`（设计契约，重点 §7 开关与灰度、§13 已确认的开放问题答案）
> 3. 读 `app/src/features/terminal/predictiveEcho.ts`（切片 1-4 完整实现，含 metrics + getMetrics）
> 4. 读 `app/src/features/terminal/TerminalPage.tsx`（接入点：实例化 + OSC 133 + CSI alt screen + 持久化设置读取 + `terminal:settings-changed` 订阅 + dev metrics 60s console.debug）
> 5. 读 `app/src/features/settings/SettingsPage.tsx`（"预测回显（实验）" 开关 + 一次性 toast 引导 + 立即写入 + dispatchEvent）
> 6. 用 selfCheck 验证仍正常：
>    ```bash
>    cd /Users/hanyongding/project/rust/shell/app && npx -y tsx -e "import { selfCheck } from './src/features/terminal/predictiveEcho'; const r = selfCheck(); process.exit(r.passed ? 0 : 1);"
>    ```
>    预期：104/104 通过。
> 7. 我说 "开始" 你再动手——可能的方向：（a）走 §7.4 README 与"了解更多"链接收尾；（b）阶段 2 规划（CPR 同步、行编辑高级场景、IME 协同）；（c）手测验收后回填 §1.2 切片 4 状态从"代码完成（手测待验收）"为"已完成"
>
> 严守工程纪律：先 Read 再 Edit，diff 最小化，失败两次换路。

---

> 文档结束。下一次更新本文档：手测全过后把 §1.2 切片 3/4 行从"代码完成（手测待验收）"改为"已完成"；进入阶段 2 时新建 `predictive-echo-phase2-progress.md`，本文档归档为"阶段 1 完整记录"。
