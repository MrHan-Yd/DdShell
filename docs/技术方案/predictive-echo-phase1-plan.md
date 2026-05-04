# Predictive Echo 阶段 1 设计文档

> 状态：草案，待用户审阅
> 范围：仅阶段 1（普通字符 + 退格 + 行编辑模式）
> 不在范围：vim/less/htop/tmux 全屏程序、密码输入、Tab 补全、Ctrl 组合键、网络断连恢复

---

## 0. 假设（待用户确认）

文档基于以下两条假设展开。如与实际不符，请在审阅时纠正，部分章节会随之调整。

| # | 假设 | 影响 |
|---|---|---|
| A1 | 延迟主因是**网络 RTT**（非服务器 CPU 满载、非 SSH 加密慢） | 影响失配率假设、退化策略 |
| A2 | 长期处于 400ms+ 延迟的用户**占少数** | 默认**关闭**预测，设置里给开关 + 一次性引导 |

> 如果 A2 不成立（高延迟用户占多数）：把默认值改为"开启"，并在首次启动给用户一次性介绍气泡。其余设计不动。

---

## 1. 目标

让客户端在 RTT 400-2000ms 的链路下，**普通命令行打字 + 退格的视觉响应接近 0ms**。具体衡量：

- 用户敲一个字符，**16ms 内**（一帧）该字符可见于屏幕
- 用户敲退格，**16ms 内**前一字符消失
- 远程 echo 实际到达时不应造成屏幕"抖动"或重绘可见瑕疵
- 边界场景（vim/密码/Tab 补全等）**自动退化**到现有行为，不破坏

---

## 2. 总体数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│                            按键路径（写）                              │
└──────────────────────────────────────────────────────────────────────┘

  键盘 ──► xterm.onData ──► PredictiveEcho.onUserInput
                                   │
                                   ├── (1) 现有 cmdBuffer/危险命令/命令助手 等逻辑（不动）
                                   │
                                   ├── (2) 判断"是否可预测"
                                   │       a. 模式机：行编辑模式且未冻结
                                   │       b. 字符可预测：可见 ASCII / 退格
                                   │
                                   ├── (3) 若可预测：
                                   │       ① 入队 PredictionQueue（seq, char, undoOp）
                                   │       ② 立即 term.write(预测字符 + 视觉样式)
                                   │
                                   └── (4) 不论是否预测，都照常 sessionWrite 发到远程

┌──────────────────────────────────────────────────────────────────────┐
│                            回显路径（读）                              │
└──────────────────────────────────────────────────────────────────────┘

  session:output ──► PredictiveEcho.onRemoteOutput(text)
                            │
                            ├── (5) 队列为空：直接 term.write，无事
                            │
                            └── (6) 队列非空：尝试匹配队首预测
                                    a. 匹配（远程 echo 与预测一致）：
                                       ① 出队
                                       ② "确认"——把屏幕上对应位置的预测样式转为正常样式
                                       ③ 远程的这段 echo 字节本身**丢弃**（因为画面已经画过了）
                                    b. 不匹配：
                                       ① 整队冻结 + 整体撤销（一次 term.write 把队列里所有预测字符抹掉）
                                       ② 把远程 echo 原样 term.write 出来
                                       ③ 进入"冻结模式"，停止再预测，直到检测到 prompt 重新出现
```

---

## 3. 核心组件

### 3.1 PredictiveEcho（新模块）

挂在 `TerminalInstance` 内，与 xterm 实例 1:1。生命周期跟随 xterm。

**对外接口**：

```ts
class PredictiveEcho {
  constructor(term: Terminal, options: { enabled: () => boolean })

  // 在现有 onData 里调用：返回 true 表示"已被预测层处理（屏幕已更新）"，
  // 调用方仍需照常 sessionWrite 发到远程。返回 false 表示预测层未处理。
  onUserInput(data: string): void

  // 在现有 session:output 处理里调用：返回"应该交给 xterm 显示的剩余字节"。
  // 预测层会从远程数据里"吃掉"已确认的部分。
  onRemoteOutput(text: string): string

  // 远程明确进入了 alternate screen（vim/less 等）→ 整队回退、冻结预测
  onAlternateScreenEnter(): void
  onAlternateScreenLeave(): void

  // 用户切换会话或关闭 → 清空状态
  reset(): void
}
```

**为什么是"包装"而不是"替换" onData/output**：
- 现有 onData 路径有大量必须保留的逻辑（命令助手 // 触发、危险命令拦截、命令历史、IME、宏过滤）
- 预测层只负责"预测画面更新"和"消化远程 echo"，**不接管**业务逻辑
- 这是与现有功能兼容的关键

### 3.2 PredictionQueue（数据结构）

```ts
interface Prediction {
  seq: number              // 单调递增序号
  kind: "char" | "backspace"
  char?: string            // kind === "char" 时存预测的字符
  // 远程 echo 用于匹配的"期望字节"。普通字符 echo 通常就是字符本身；
  // 退格 echo 通常是 "\b \b" 序列（具体由 shell 决定，下面有讨论）。
  expectedEcho: string
  // 撤销序列：把这次预测的画面操作还原。例如普通字符是 "\b \b"。
  undoSequence: string
  predictedAt: number      // 时间戳，用于超时
}

class PredictionQueue {
  enqueue(p: Prediction): void
  peek(): Prediction | null
  dequeue(): Prediction | null
  size(): number
  clear(): void
  // 一次性获取所有预测的"批量撤销序列"
  buildBulkUndoSequence(): string
}
```

**容量**：硬上限 100 条。超过则停止预测（仍照常发送到远程）。  
理由：2000ms RTT × 极快打字（10 cps）= 20 条飞行；100 条留 5× 余量。

**视觉样式**：阶段 1 用 `\x1b[2m` (dim/faint) 让预测字符显示为暗色，确认后写 `\x1b[22m` 恢复正常。所有终端都支持，无需扩展 xterm。

### 3.3 状态机

```
            ┌───────────────────────────┐
            │  Disabled（设置关闭）     │  ──► 跳过预测层，沿用旧行为
            └───────────────────────────┘
                       ▲ │
   设置开关切换 ────────┘ │
                       ▼
            ┌───────────────────────────┐
            │  Cold（启用但未确认 prompt） │
            └───────────────────────────┘
                       │
   远程 echo 包含 prompt 标记 / 启发式命中
                       ▼
            ┌───────────────────────────┐
            │  Active（行编辑模式，可预测）│
            └───────────────────────────┘
                       │              ▲
   失配 / Alt Screen   │              │ 检测到 prompt 重新出现
   / Ctrl 组合键        ▼              │
            ┌───────────────────────────┐
            │  Frozen（暂停预测，照常发送）│
            └───────────────────────────┘
```

- **Disabled**：用户在设置里关闭 / 阶段 1 默认值
- **Cold**：开启但还没看到 shell prompt，不敢预测；按键直接走旧路径
- **Active**：可以预测的稳态
- **Frozen**：检测到任何"模式可能改变"信号后立刻冻结；恢复条件是再次看到 prompt

---

## 4. 关键算法

### 4.1 字符预测（onUserInput）

```
输入 data:
  for ch in data:
    if state ≠ Active: 不预测，仅维护现有逻辑
    if not isPrintableAscii(ch): 进入 Frozen，不预测此 ch
       (ch 包含 \r, \n, \t, ESC, Ctrl 组合键等)
    if queue.size() ≥ 100: 不预测此 ch（饱和保护）
    
    // 预测可执行
    seq = nextSeq()
    p = {
      seq, kind: "char", char: ch,
      expectedEcho: ch,
      undoSequence: "\b \b",     // 退格 + 空格 + 退格 = 抹掉一字符
      predictedAt: now()
    }
    queue.enqueue(p)
    term.write(`\x1b[2m${ch}`)   // 暗色样式写出去
```

> **注意**：预测字符出去后，光标位置已经前进。远程实际 echo 回来时，**光标已经在预测位置之后了**——不能简单地把 echo 写出去（会重复显示）。这是为什么 `onRemoteOutput` 必须从远程数据里"吃掉"已确认部分。

### 4.2 退格预测

退格在不同 shell 下 echo 不同：
- bash 默认：echo `\b \b`（退一格，写空格，再退一格）
- zsh 默认：echo `\b \b` 或 ANSI 序列
- 部分 shell：echo `\x1b[D \x1b[D`（光标左移 + 空格 + 光标左移）

阶段 1 策略：**只预测"退一个本地预测字符"的情况**——也就是只能撤回还在队列里、未被确认的字符。

```
输入 \x7f 或 \b:
  if state ≠ Active: 不预测
  
  // 查队列尾部是不是一个普通字符预测
  tail = queue.peekTail()
  if tail.kind ≠ "char":
    // 队列尾部不是字符（可能是连续退格或为空）
    进入 Frozen，不预测此退格
    return
  
  // 撤销最后一个预测字符的画面
  term.write(tail.undoSequence)   // 抹掉那个字符
  queue.dequeueTail()
  
  // 注意：远程 echo 路径上，这个字符的真实 echo 还没回来；
  // 退格也还没发出去。我们把它转化为"双向都不发生"——
  // 但实际上退格已经通过 sessionWrite 发到远程了，远程会先 echo 字符，再 echo 退格。
  // 我们需要在 onRemoteOutput 里把这两段 echo 都"吃掉"。
  
  // 入队一条特殊的"双 echo 消化"项
  queue.enqueue({
    seq, kind: "backspace",
    expectedEcho: "<原字符的 echo> + <退格的 echo>",
    undoSequence: "",   // 已在写入时撤销，无需再撤
    predictedAt: now()
  })
```

> **简化策略**：阶段 1 不处理"队列已空时的退格"——这种情况会进入 Frozen，让远程实际 echo 来驱动屏幕。这避免了"删除已经被远程 confirm 的字符"的复杂场景，把范围控制住。

### 4.3 远程 echo 校验与消化（onRemoteOutput）

```
onRemoteOutput(text):
  if queue.empty(): return text   // 没预测，原样交给 xterm
  
  remaining = text
  while not queue.empty() and remaining 非空:
    head = queue.peek()
    
    if remaining.startsWith(head.expectedEcho):
      // 命中：远程 echo 与预测一致
      remaining = remaining.slice(head.expectedEcho.length)
      queue.dequeue()
      
      if head.kind == "char":
        // 把屏幕上那个 dim 字符转为正常颜色：
        // 写 ANSI: 移光标到字符位置 → 重写字符（不带 dim）→ 移回
        // 但更简单的做法：在最初 enqueue 时记录字符的"行/列"位置，
        //                确认时直接重写。
        term.write(buildConfirmSequence(head))
      
      continue
    
    if isPotentialPartialMatch(remaining, head.expectedEcho):
      // 远程 echo 还在分批到达，等下一次 onRemoteOutput
      // 缓存 remaining 到 pendingRemoteRef，下次 prepend
      bufferRemainingForNext(remaining)
      return ""
    
    // 失配
    return handleMismatch(remaining)
  
  return remaining   // 队列已空，剩余原样交给 xterm
```

#### 确认时的"颜色转正"

最稳妥的做法是**重写整行**，但代价大。阶段 1 用一种更轻的方式：

- 入队时，记录该预测字符**写入屏幕时的光标位置**（行 row、列 col），从 xterm `term.buffer.active.cursorY/X` 取
- 确认时：
  ```
  CSI s          // 保存光标
  CSI <row>;<col> H   // 移光标到记录位置
  CSI 22m        // 关闭 dim
  <字符>          // 重写字符（这次是正常颜色）
  CSI u          // 恢复光标
  ```
- 这是 xterm 标准 ANSI，性能良好

#### 部分匹配的判断

远程 echo 可能分批到达（`session:output` 不是按"完整 echo 一次性"返回）。我们需要把"剩余的不完整 echo"缓存起来，下次 prepend：

```
isPotentialPartialMatch(remaining, expected):
  return expected.startsWith(remaining)
```

如果缓冲过大（> 256 字节）仍未对齐，视为失配，进入 Frozen。

### 4.4 失配检测与回滚

进入失配的触发：
- 队首预测的 expectedEcho 与远程 echo 不匹配
- 远程发来 ANSI 序列（CSI / OSC / ESC）打头——说明不是简单字符 echo
- 检测到 alternate screen enter（CSI ?1049h 或类似）
- 收到 Ctrl+C echo（远程会 echo `^C`）

回滚算法：

```
handleMismatch(remoteText):
  // 1. 一次性把队列里所有预测字符抹掉
  bulkUndo = queue.buildBulkUndoSequence()   // 多个 \b \b 拼接
  term.write(bulkUndo)
  queue.clear()
  
  // 2. 进入 Frozen 状态
  state = Frozen
  
  // 3. 远程 echo 原样输出
  return remoteText
```

恢复条件：从 Frozen 回到 Active 需要"明确看到 prompt"。检测见下一节。

### 4.5 行编辑模式检测（保守启发式）

阶段 1 不要求 100% 准确，**宁可少预测、不可错预测**。两层检测：

#### 强信号（首选）
**OSC 133**：现代 shell（fish、zsh、starship 等）支持的 prompt 标记协议：
- `OSC 133;A ST` = prompt 开始
- `OSC 133;B ST` = prompt 结束（命令输入开始）
- `OSC 133;C ST` = 命令执行开始
- `OSC 133;D ST` = 命令执行结束

```
parser.registerOscHandler(133, (data) => {
  const marker = data.charAt(0)
  if (marker === "B") state = Active     // prompt 结束，可预测
  if (marker === "C") state = Frozen     // 命令在跑，不可预测
})
```

#### 弱信号（后备）
没有 OSC 133 的 shell（默认 bash）下，启发式：

- 远程 echo 包含 `$` 或 `#` 字符且后跟空格 → 可能是 prompt
- 用户上次回车后，**第一次收到稳定不变的 echo（300ms 内无新数据）** → 视为 prompt
- 检测到下面这类常见 prompt 形态："`username@host:~$ `"、"`[user@host dir]$ `"

启发式置信度低，搭配以下保护：
- 进入 Active 后，**前 3 个预测**走"严格模式"——任何失配立刻回 Frozen
- 用户敲 ESC、`:`、Ctrl+组合键 → 立刻 Frozen（vim 的入口标志）
- 用户敲回车 → 进入 Frozen 直到下个 prompt（命令执行期间禁预测）

#### 切换 alternate screen
xterm 有事件：
```ts
term.parser.registerCsiHandler({final: 'h'}, (params) => {
  if (params[0] === 1049) predictiveEcho.onAlternateScreenEnter()
  return false   // 不消费，让 xterm 继续处理
})
```

进入 alternate screen → Frozen + 撤销队列。  
离开 alternate screen → 仍保持 Frozen，等 prompt 重现再 Active。

---

## 5. 与现有功能的兼容性（逐项核对）

| 功能 | 兼容做法 |
|---|---|
| **命令助手 // 触发** | 预测层在现有 cmdBufferRef 维护**之后**调用。预测的字符也加入 cmdBufferRef，命令助手照常工作。`//` 出现在预测里不影响 lastIndexOf 检测 |
| **命令助手 Enter/Tab 接管** | 这两个键不可预测（进入 Frozen），原拦截逻辑在循环内仍然执行 |
| **危险命令拦截** | 在 Enter 时触发 confirm。Enter 不预测，与现有逻辑无交互 |
| **命令历史** | Enter 时插入。同上无影响 |
| **宏运行 / 宏输出过滤** | `filterMacroInternalChunk` 在 `session:output` 入口运行，**先于** PredictiveEcho.onRemoteOutput。宏过滤掉的 stty 序列不会进入预测匹配。宏运行期间用户一般不打字，即使打字，宏的 token 序列不会与预测的字符 echo 冲突 |
| **危险命令模式下 onData 短路返回** | 早于预测层判断；危险命令对话期间不预测 |
| **IME 合成中** | composingRef 期间 onData 直接 return。预测层不受影响 |
| **Quick Edit 选区** | 不在 onData 路径，无影响 |
| **退出会话 / 切换 tab** | reset() 清空队列，下次进入重新冷启动 |

**保守原则**：所有现有逻辑**先跑**，预测层**最后**叠加。预测失败永远只影响"屏幕预测显示"，不影响业务数据流。

---

## 6. 视觉反馈

### 阶段 1 方案：dim 样式

- 预测中字符：`\x1b[2m<char>` （ANSI dim/faint）
- 确认后：CSI s + 移光标 + `\x1b[22m<char>` + CSI u

效果：用户看到"刚敲的字符是浅色的，过一会儿变成正常色"——这就是预测可靠性的视觉锚点。RTT 越高，"浅色 → 正常色"的过渡时间越长，用户能直观判断"哪些已确认"。

### 阶段 2 可考虑（不在本期）
- 提供主题选项：dim / 下划线 / 不区分（信任预测）
- 在 statusbar 显示 RTT 估算 + 当前飞行预测数

---

## 7. 开关与灰度

### 设置项

新增设置：`terminal.predictiveEcho.enabled` (bool, 默认 **false**，假设 A2)

设置面板里加一行：
- 标签："预测回显（高延迟链路下减少卡顿感）"
- 描述："对普通字符输入和退格做即时显示，远程实际回显在后台校验。在 vim、tmux 等场景自动关闭。**实验性功能**。"
- 默认值：关闭

### 一次性引导

第一次启用时弹一个 toast：
> "预测回显已开启。预测中的字符显示为浅色，确认后转为正常色。如遇异常请在设置中关闭。"

不强制弹窗，避免打扰。

### 监控指标（建议接入）

加几个轻量计数器，console.debug 输出（生产可改成持久化）：
- `predictionCount`：累计预测次数
- `confirmCount`：累计确认次数
- `mismatchCount`：累计失配次数
- 命中率 = confirm / (confirm + mismatch)

健康指标：命中率 > 95%。低于 90% 说明启发式有问题，应该收紧策略或排查。

---

## 8. 阶段 1 明确不做的事

为防止范围蔓延，下面这些**全部不做**，遇到就退化到 Frozen：

| 场景 | 处理 |
|---|---|
| vim / tmux / less / htop 等全屏程序 | 检测到 alternate screen → Frozen，不预测任何东西 |
| 密码输入（sudo、ssh、su 等） | 检测到 prompt 后但 echo 异常（没 echo 字符）→ 几次失配后 Frozen |
| Tab 补全 | Tab 进入 Frozen，等 echo 完成 |
| Ctrl 组合键（Ctrl+R、Ctrl+L 等） | 任何 Ctrl 组合 → Frozen |
| 方向键（光标移动） | 进入 Frozen |
| 多字节字符 / Unicode 输入 | 阶段 1 只预测 isPrintableAscii，其他不预测（IME 已经被 composingRef 拦截在前面） |
| 网络断连 / 重连 | reset()，让 xterm 走自然路径 |
| 跨服务器粘贴 | 粘贴一般包含 \n，第一个 \n 即进入 Frozen |
| 多面板复制结果一致性 | 不在范围 |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| OSC 133 检测不到（多数 bash 默认无） | 高 | 启发式失败概率上升 | 弱启发式 + 严格的 Frozen 触发，宁失不错；后续可让用户安装 prompt 集成脚本 |
| 失配回滚撤销序列在某些 shell 下产生异常字符 | 中 | 屏幕乱码 | 失配时多写一次 `\r\n` 加 `term.refresh()` 强制重画 |
| 预测字符与 cmdBufferRef 不一致（buffer 被预测后字符污染） | 中 | 命令助手触发位置错乱 | cmdBufferRef 维护逻辑**完全不动**，按原样基于真实输入维护，预测只影响屏幕显示 |
| 队列泄漏（远程长期不 echo） | 低 | 内存增长 + 屏幕长期 dim | 队列容量上限 100；超时（10s 未确认）整队回滚到 Frozen |
| 用户启用后体验反而变差（边界场景多） | 中 | 用户卸载/差评 | 默认关闭 + 引导文案明确说"实验性"；监控命中率，低于阈值在设置里给红色警告 |
| 宏运行期间用户打字与预测冲突 | 低 | 宏过滤序列与预测 expectedEcho 干扰 | `filterMacroInternalChunk` 先于预测层运行，宏 token 不会进入预测匹配 |
| 多 tab 切换时预测状态串台 | 低 | 错误显示 | PredictiveEcho 与 TerminalInstance 1:1 绑定，独立状态 |
| xterm 的 ANSI 撤销序列在某主题下视觉别扭 | 低 | 视觉小瑕疵 | 阶段 1 接受；阶段 2 提供主题选项 |

---

## 10. 实施切片（4 个独立可验证的小步）

每一步独立 PR / 独立 commit / 独立验证。每步完后让用户确认再走下一步。

### 切片 1：骨架 + 仅"普通字符预测 + 朴素失配回滚"
- 新文件 `app/src/features/terminal/predictiveEcho.ts`：实现 PredictiveEcho 类，包含 `onUserInput` / `onRemoteOutput` / `reset` / 简单 enqueue/dequeue
- 仅支持普通可见 ASCII 字符预测
- 简单失配处理：清空队列 + 写远程 echo
- **暂时不接入 UI，写一个 console 测试入口**
- 用 mock 数据手测：`["a","b","c"]` 入队，模拟远程 echo `"abc"` 回来，验证确认；模拟 echo `"axc"`，验证失配回滚
- **阶段 1 切片 1 验收**：单元 / 手测正常，不影响现有终端

### 切片 2：接入 TerminalInstance + dim 样式 + 启发式行编辑检测
- 在 `TerminalPage.tsx` 里实例化 PredictiveEcho（feature flag = false）
- 把 onData 末尾、session:output 开头各加一个调用点
- 实现 OSC 133 强信号 + 弱启发式（prompt 字符识别 + Ctrl/ESC/Enter 冻结）
- 实现 dim 视觉样式 + 确认时的颜色转正
- **可在 dev 环境通过 sessionStorage 临时开启**，正式开关下一步加
- 验收：开启后，普通命令打字"瞬时"，敲 vim 进入立刻冻结、退出后重新工作

### 切片 3：退格预测 + alternate screen 检测 + 队列饱和保护
- 加入退格分支
- 注册 CSI 1049h/l handler 检测 alt screen
- 队列容量 / 超时保护
- 验收：删除字符瞬时；vim 进出无屏幕残留；快速打字 100+ 字符无内存泄漏

### 切片 4：UI 开关 + 一次性引导 + 监控指标
- 在设置面板加 `terminal.predictiveEcho.enabled` 选项 + 描述文案
- 首次启用 toast 引导
- console.debug 命中率
- 文档更新（README / 设置说明）
- 验收：开关切换正常，关闭后等同旧行为；引导只显示一次

---

## 11. 验收标准

阶段 1 完成的判定（按优先级）：

1. **不破坏**：所有现有功能在"开启预测"和"关闭预测"两种状态下都正常工作（命令助手、宏、危险命令、命令历史、IME、Quick Edit）
2. **跟手**：在 RTT 400-2000ms 链路上，普通命令打字 + 退格的视觉响应在一帧内
3. **退化稳健**：vim/less/htop/密码输入/Tab/Ctrl 组合 等场景**没有**屏幕错误显示——要么预测正确，要么进入 Frozen 跟旧行为一致
4. **命中率**：常规打字场景命中率 > 95%（dev 环境 console 观察）
5. **可关闭**：用户在设置里关闭后，所有路径完全等同于阶段 1 之前的行为

---

## 12. 文件改动清单（预估）

新增：
- `app/src/features/terminal/predictiveEcho.ts` （核心模块，预估 ~300 行）

修改：
- `app/src/features/terminal/TerminalPage.tsx` （接入预测层，预估 +30 行）
- `app/src/features/settings/SettingsPage.tsx` （加开关，预估 +15 行，需要看现有结构定位）
- `app/src/lib/i18n.ts` （加文案，预估 +10 行）

不修改：
- Rust 后端任何代码（阶段 1 纯前端）

---

## 13. 待用户确认的开放问题

1. **假设 A1 / A2 是否成立**？
2. **dim 视觉**是否接受？还是希望预测字符**与正常字符无视觉差异**（更激进的"信任预测"）？我推荐 dim，理由是 RTT 高时用户能看到"哪些还没确认"。
3. **设置项的位置**：放在"终端"页签下，还是新开一个"实验性功能"页签？
4. **是否要接入更专业的指标上报**（命中率、失配率落库给后续观察）？阶段 1 推荐只 console.debug，避免引入存储复杂度。

---

> 本文档为阶段 1 的设计契约。代码实施前请审阅并对开放问题给出意见。审阅后我按"实施切片"4 步推进，每步完成各自验证一次。
