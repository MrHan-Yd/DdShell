# Predictive Echo 阶段 2 设计 + 转正路径

> 状态：草案，待用户审阅
> 关联文档：[`predictive-echo-phase1-plan.md`](./predictive-echo-phase1-plan.md)（阶段 1 设计契约） / [`predictive-echo-phase1-progress.md`](./predictive-echo-phase1-progress.md)（阶段 1 开发记录）
> 范围：阶段 2 切片设计 + 「实验性 → 正式功能」转正路径
> 不在范围：阶段 1 已闭环的内容（OSC 133 zsh + 普通字符 + 退格 + alt screen + 弱启发式）

---

## 0. 假设（待用户确认）

阶段 2 的优先级排序基于以下假设。**如与实际不符，§5 排期建议会随之调整**。

| # | 假设 | 影响章节 |
|---|---|---|
| B1 | 阶段 1 视觉手测已通过（颜色 dim→正色 + vim 进入画面干净） | 全文前提，已成立（2026-05-04） |
| B2 | 用户群中**裸 bash + 自定义 prompt** 占多数（不能假设都是 zsh + OSC 133） | §4.1 切片 5 优先级最高 |
| B3 | 中文输入用户**占非主流但不可忽略**（IME 缺失会让中文用户感觉"功能没做完"） | §4.4 切片 8 排在切片 6/7 之后但必须做 |
| B4 | 命令行老手大量用 Ctrl+W/U/A/E 编辑，普通用户少用 | §4.2 切片 6 优先级中等 |
| B5 | 转正不接受"凭感觉"——必须有量化退出条件 | §3 转正路径 |

> 这些假设**正是为了讨论而存在**——任何一条被推翻都会改变阶段 2 切片排期。请逐条 review。

---

## 1. 概要

### 1.1 阶段 1 现状（已实现）

| 维度 | 覆盖范围 |
|---|---|
| Shell | zsh + 装了 OSC 133 prompt 标记的环境 |
| 输入字符 | 普通可见 ASCII（0x20-0x7E）+ 退格 |
| 边界保护 | vim/less/htop 等 alternate screen 自动 freeze；ESC/Ctrl/Tab/Enter 立即 freeze |
| 视觉 | dim 预测 → 命中转正色；失配整队回滚 |
| 状态机 | 4 态（Disabled/Cold/Active/Frozen），完整迁移路径已 selfCheck 覆盖 |
| selfCheck | 104/104 全绿 |
| 监控 | `getMetrics()` 暴露 predictionCount / confirmCount / mismatchCount / hitRate |

### 1.2 转正三阶段定义

| 里程碑 | 状态 | 用户感知 | 何时进入 |
|---|---|---|---|
| **M0 — 实验性** | ✅ 当前 | 默认关闭，知情用户主动开 | 阶段 1 视觉验收通过即进入 |
| **M1 — 默认开启候选** | ⏳ 阶段 2 中期 | **默认开启**，仍带"实验"角标 | §3.2 退出条件全部满足 |
| **M2 — 正式功能** | ⏳ 阶段 2 末期 | 设置项改名「预测回显」（无角标） | §3.3 退出条件全部满足 |

### 1.3 阶段 1 与阶段 2 的关系

阶段 1 解决"地板"——让 OSC 133 zsh 用户的普通输入瞬时反馈。
阶段 2 解决"覆盖"——让大多数用户都能享受到这个体验。
**两者合起来才是"敲命令跟手"的完整产品**。阶段 1 不能直接转正，因为它对裸 bash / 中文 / Ctrl+W 等场景**完全不工作**。

---

## 2. 当前跟手缺口

按"用户感知强度"从高到低排：

| # | 场景 | 当前表现 | 影响 | 用户范围 |
|---|---|---|---|---|
| G1 | **裸 bash / 自定义 prompt** | 弱启发式只识别 `$ ` / `# ` / `> ` 结尾，多数自定义 prompt 不命中 → 状态卡 Cold → **完全不预测** | 开了等于没开 | 大（多数 Linux 服务器） |
| G2 | **Ctrl+W 删词、Ctrl+U 清行、Ctrl+A/E 移光标、左右箭头编辑** | 全部触发 freeze → 整队回滚 | "普通字符跟手了，但删词那一下还是卡"——体感断层 | 中（命令行重度用户） |
| G3 | **shell alias 彩色输出 / PROMPT_COMMAND 重绘** | echo 字节里夹了 SGR 序列 → expectedEcho 不命中 → 失配回滚 → 闪烁 | hitRate 偏低，预测反而难受 | 中（启用 ll/grep 着色的用户） |
| G4 | **中文 / 日文 / 韩文 IME 输入** | xterm 走 composition 路径，**完全不进入** `onUserInput` 的预测分支 | 中文用户从无到有 | 大（中文是中文用户必备） |
| G5 | **网络抖动 / 丢包** | 失配回滚频繁 | 偶发"整行字符闪一下"——观感差 | 小（链路质量差时才暴露） |

**G1 与 G4 是"覆盖率缺口"——缺它们，对应用户群体等于没功能。**
**G2 与 G3 是"体感缺口"——已经在用的用户会感觉"做得不到位"。**
**G5 是"鲁棒性缺口"——边角，但解决了能让 hitRate 从 90% 推到 95%+。**

---

## 3. 转正路径

### 3.1 M0 — 实验性（当前位置）

**进入条件**：阶段 1 切片 1-4 全部完成 + 视觉手测通过 ✅

**退出条件**：满足全部 ↓ 即可进入 M1
- [ ] 切片 5（Shell 兼容性扩展）完成 → G1 缺口闭合
- [ ] 切片 6（行编辑高级场景）完成 → G2 缺口闭合
- [ ] 切片 7（失配模式处理）完成 → G3 缺口闭合
- [ ] selfCheck 在三个新切片完成后保持全绿
- [ ] 至少 1 周内部 dogfood，无致命 bug（屏幕错乱 / 数据丢失 / shell 不可用）
- [ ] **可选**：metrics 上报机制（用户主动导出 / 内置匿名遥测）—— 不做也能进入 M1，但 M2 强制要求

**回滚预案**：M0 阶段任何 critical bug → 设置默认值改回 false（已经是默认 false，本质是"不需要回滚"）。

### 3.2 M1 — 默认开启候选（仍标实验）

**进入条件**：§3.1 退出条件全部满足。

**关键变更**：
- 设置项默认值从 `false` 改为 `true`
- 保留「（实验）」角标
- 新增"如遇问题请关闭"的引导（一次性 toast 已就绪）

**退出条件**：满足全部 ↓ 即可进入 M2
- [ ] 默认开启状态稳定运行 30 天，零 critical bug
- [ ] 至少积累 10 次外部反馈（issue / 邮件 / IM），其中正面 ≥ 70%
- [ ] hitRate 中位数 ≥ 90%（基于 metrics 收集，无论用户主动导出还是匿名上报）
- [ ] 切片 8（IME 协同）至少**完成中文 IME 部分**（日韩可选）
- [ ] 兼容性核对清单（progress.md §10.2）在 M1 期间没有新增失败项

**回滚预案**：
- 出现 critical bug → 默认值改回 false，回到 M0
- 出现非致命但广泛的体感差评 → 保持 M1，开技术 issue 调查根因，不强行推进 M2

### 3.3 M2 — 正式功能

**进入条件**：§3.2 退出条件全部满足。

**关键变更**：
- 设置项改名为「预测回显」（去掉「（实验）」字样）
- 描述文案更新（从"减少卡顿感"改为"对高延迟链路自动启用"等中性表述）
- README 把"实验性"段移到"功能"段
- 阶段 1/2 的 plan.md / progress.md 归档到 `docs/archive/predictive-echo-phase{1,2}/`
- **可选**：切片 9（CPR 完整同步基础设施）——M2 后做，进一步提升内功，但不阻塞转正

**回滚预案**：
- M2 之后发现关键回归 → **不回滚到 M0**（用户会困惑），改为打热修补丁
- 必要时设置项加"高级 → 关闭预测回显"路径，但默认仍开启

### 3.4 三个里程碑总览

```
        视觉验收           切片 5/6/7 完成        默认开启稳定 30 天
         (已完成)          + dogfood 1 周         + 反馈 ≥ 10 + hitRate ≥ 90%
            │                    │                       │
            ▼                    ▼                       ▼
   ┌────────────┐       ┌────────────┐         ┌────────────┐
   │ M0 实验性  │ ────► │ M1 默认开启 │  ────► │ M2 正式功能│
   │ (当前)     │       │ (仍标实验) │         │ (去标签)   │
   └────────────┘       └────────────┘         └────────────┘
```

---

## 4. 阶段 2 切片设计

切片之间**独立验证、独立合入**。每个切片闭环 = selfCheck 增量绿 + tsc + vite build 全绿 + 视觉手测对应场景。

### 4.1 切片 5：Shell 兼容性扩展（关闭 G1 缺口）

**问题**：当前弱启发式只识别 `$ ` / `# ` / `> ` 结尾。用户自定义 PS1（含路径、git 分支、emoji、彩色 SGR 序列等）时，prompt 末尾不是这三种结尾 → state 卡在 Cold → 永不预测。

**设计方案**（双管齐下）：

**A. 启发式扩展（轻量）**
- 在 `detectPromptHeuristic` 增加模式：
  - 末尾去掉所有 SGR 序列后再做后缀匹配（`re.sub(/\x1b\[[\d;]*m/g, '')`）
  - 增加 `❯ ` / `➜ ` / `λ ` / `% ` / `→ ` 等常见 prompt 字符
  - 行尾**空格 + 单光标占位**（多数 PS1 都以空格结尾）
- 严格期 strictRemaining 由 3 提升到 5（更宽容，因为模式更松）

**B. CPR 主动探测（精准）**
- 远程刚连上时，由 TerminalPage 注入一次 `\x1b[6n`（CPR 查询）
- xterm 在 onData 上触发回应 `\x1b[<row>;<col>R`，由 PredictiveEcho 暴露 `onCursorPosition(row, col)` 接收
- 当**收到 prompt 行尾且光标列位置稳定不变 ≥ 200ms**，认定 prompt ready → Cold → Active
- 比启发式更精准，但需要 xterm 帮助解析 CPR 应答

**接口变更**：
```ts
class PredictiveEcho {
  onCursorPosition(row: number, col: number): void  // 新增
  // detectPromptHeuristic 内部扩展，无对外接口变更
}
```

**风险**：
- CPR 应答会被 xterm 自动消化吗？需要确认 xterm.parser 是否提供 CSI handler（类似 OSC 133 的注册方式）
- 启发式过宽 → 在命令输出含有 `$ ` 字面量时误判 prompt ready（如 `echo "Total: $0"`）
  - 缓解：strictRemaining 严格期 + 命中后自动归零是已有保护

**工时估计**：1-2 天（启发式 + CPR 应答 handler + selfCheck T28-T35）

**selfCheck 增量**：
- T28：含 SGR 的 prompt 字符串去色后正确匹配
- T29：`❯ ` / `➜ ` 等扩展模式触发 Cold→Active
- T30：onCursorPosition 在光标稳定后切 Active
- T31：CPR 应答与启发式同时触发时，CPR 优先（或互不冲突）
- T32-T35：典型 PS1 case 集（zsh+p10k / oh-my-zsh / 裸 bash 自定义 / fish）

---

### 4.2 切片 6：行编辑高级场景（关闭 G2 缺口）

**问题**：用户敲 Ctrl+W（删词，0x17）/ Ctrl+U（清行，0x15）/ Ctrl+A（行首，0x01）/ Ctrl+E（行尾，0x05）/ 左右箭头（CSI D / CSI C）时，当前一律 freeze。其中 Ctrl+W/U 是高频，对体感影响最大。

**设计方案**（按复杂度递增）：

**A. Ctrl+U（清行）—— 最简单**
- 远程 echo 行为：`\b \b` × N（N = 当前行内容长度）
- 预测：屏幕立即抹掉队列里所有 char 项 + 入队一个 `kind: "kill-line"` 项消化远程 echo
- 队列尾部不必是 char（与退格不同）—— 直接整队回滚屏幕

**B. Ctrl+W（删词）—— 中等**
- 远程 echo 行为：`\b \b` × M（M = 上一空格到当前光标的字符数）
- 需要从队列尾部找"上一空格 char 项"并出队该位置之后的所有 char
- 入队 `kind: "kill-word"` 消化项
- **难点**：队列内容可能被远程已部分确认（队首已 shift），找"上一空格"要扫描已发出但未画到屏幕的 pendingRemote 吗？保守做法：仅当队列**尾部连续 N 个都是 char 项**时预测，其他场景 freeze

**C. Ctrl+A/E（光标到首/尾）—— 复杂**
- 不删字符，仅移光标。但光标位置是"屏幕状态"的一部分
- 预测端没有完整屏幕模型，只知道队列内容
- **建议阶段 2 暂不做**，留到切片 9 CPR 同步时一并处理

**D. 左右箭头（编辑光标内移动）—— 复杂**
- 同 C，依赖屏幕模型
- **暂不做**

**接口变更**：无对外新方法，`onUserInput` 内部新增 Ctrl+U/W 分支。

**风险**：
- 不同 shell 的 Ctrl+W 行为差异（zsh 默认按空格分词，bash 也是，但有人改成"按非字母分词"）
- 远程 echo 可能不是 `\b \b` × N 而是 `\x1b[K`（清到行尾）—— 需要在 expectedEcho 增加多模式匹配

**工时估计**：2-3 天（Ctrl+U → Ctrl+W → selfCheck T36-T44）

**selfCheck 增量**：
- T36：Ctrl+U 清行预测路径全程
- T37：Ctrl+U 在队列空时 freeze（保护）
- T38：Ctrl+W 删词正常路径（队列尾部连续 char）
- T39：Ctrl+W 在队列含非 char 项时 freeze
- T40：远程返回 `\x1b[K` 时正确消化（如果做多模式）
- T41-T44：边界（行首 Ctrl+W / 仅一个空格 / 多空格连续 / Ctrl+W 后再 Ctrl+W）

---

### 4.3 切片 7：失配模式针对性处理（关闭 G3 缺口）

**问题**：远程 echo 在以下情况会带额外字节，导致 expectedEcho 不命中：
1. **alias 着色**：`alias ls='ls --color=auto'` → 输出含 SGR
2. **PROMPT_COMMAND 重绘**：每次回车 bash 重画一遍 prompt（含光标定位序列）
3. **完成提示（zsh autosuggest）**：在用户输入后追加灰色建议字符

**设计方案**（保守优先）：

**A. expectedEcho 多模式匹配**
- 当前 expectedEcho 是字符串严格相等
- 改为支持"前缀匹配 + 跳过 SGR 序列"：
  ```ts
  // 在 onRemoteOutput 命中检查处，先剥离 SGR
  const stripped = remote.replace(/\x1b\[[\d;]*m/g, "");
  if (stripped.startsWith(expectedEcho)) { /* 命中，但保留剥离前的 SGR 写到屏幕 */ }
  ```
- **关键**：剥离仅用于命中判定，**屏幕仍写完整带色 echo**（用户看着色不能丢）

**B. autosuggest 灰色追加**
- zsh autosuggest 在用户输入后追加 `\x1b[90m<建议>\x1b[39m`
- 这部分**不应该被预测层吃掉**，应透传给 xterm
- 检测：剥离 SGR 后剩余字节如果不在期望范围内 → 标记为 autosuggest，停止匹配本轮，剩余字节透传

**C. PROMPT_COMMAND 重绘**
- 每次回车都重画 prompt → 重画期间有大量光标定位序列（CSI H / CSI A 等）
- 阶段 1 的 OSC 133;A/B/C/D 信号在装了 OSC 133 的 shell 上**已经覆盖**这个场景（命令开始 freeze、命令结束回 Cold）
- 没装 OSC 133 的 shell 才有问题。可在 onRemoteOutput 检测连续 ≥ 5 个光标定位序列 → 整队回滚 + Frozen

**接口变更**：无对外接口变更，`onRemoteOutput` 内部命中判定逻辑扩展。

**风险**：
- 剥离 SGR 后误判命中（小概率，但 strictRemaining 已经在第一次失配后归零）
- 多模式匹配性能（每次 onRemoteOutput 调 regex）—— 实测后看是否需要 inline 字节扫描优化

**工时估计**：3-5 天（含失配模式数据采集 + 多模式实现 + selfCheck）

**selfCheck 增量**：
- T45-T48：alias 着色场景（命中带色 echo / 灰色 / 多色组合）
- T49：autosuggest 追加字节透传，不被预测吃掉
- T50：连续光标定位序列触发 freeze
- T51-T55：边界

---

### 4.4 切片 8：IME 协同（关闭 G4 缺口）

**问题**：xterm 的 composition 事件路径（onCompositionStart / onCompositionUpdate / onCompositionEnd）当前**不进入** `onUserInput`。中文用户敲拼音 → 进入 composition → 上屏时一次性塞到 onData。预测层**完全没机会**预测中文字符。

**设计方案**（需要进一步调研，先列假设方案）：

**A. 中文/日韩 commit 后预测**
- 在 onCompositionEnd 时拿到最终上屏字符串（可能是多字符的中文）
- 把整段字符串入队为多个 char 项（每个汉字一个 prediction）
- 每个汉字 expectedEcho = 该字符的 UTF-8 字节
- **难点**：xterm 把汉字渲染为 2 列宽，光标前进 2 格，undoSequence 要写 `\b \b \b \b`（4 字节）

**B. composition 期间不预测**
- composition 进行中（用户还在选词）→ 不预测
- 仅在 commit 后处理
- 这是保守路径，但**用户感受上和阶段 1 一样：选完词上屏**——不算"跟手"提升

**C. 主动 composition 预测（激进）**
- composition 期间也预测 candidate 字符
- 一旦 candidate 变化（用户切候选词）→ 整队回滚
- **风险极高**：失配率会爆炸，可能反而更难受

**接口变更**：
```ts
class PredictiveEcho {
  onComposition(text: string): void  // 新增，等价于 onUserInput 但接受多字符 commit
}
```

**风险**：
- xterm.js 的 composition API 实际行为需要查文档（onComposition* 事件触发顺序、commit text 是否含原始 IME 状态）
- 全角字符光标宽度（CJK 是 2 列）的处理——撤销序列、命中转正序列都要按 2 列计算
- 不同 shell 对中文的回显行为是否一致？（多数 zsh/bash 直接回 UTF-8 原字节）

**工时估计**：1-2 周（含调研 xterm composition API + 实现 + 多 IME 测试）

**selfCheck 增量**：T56-T65（中文 commit 路径、汉字 2 列宽处理、composition 期间不干扰、IME 边界）

**先决调研**（动手前必查）：
1. xterm.js Terminal 是否暴露 `onCompositionStart/Update/End` 事件？
2. TerminalPage 现有 IME 路径是否已经调用 `onUserInput`？（要 grep 确认）

---

### 4.5 切片 9（M2 后选做）：CPR 完整同步基础设施

**目标**：做到 mosh 级别——预测层维护一个"虚拟终端镜像"，用 CPR 周期性和真实终端对账，失配率根本性降低。

**为什么 M2 后才做**：
- 工时大（1-2 周以上）
- 收益相对前 4 个切片不"立竿见影"（用户感觉不到具体哪里变好了，只是稳定）
- 不阻塞转正——M2 不依赖切片 9

**设计方向**（高层）：
- 维护虚拟终端：行内字符状态、光标位置
- 每次 onUserInput 后预测改虚拟终端
- 周期性发 CPR 查询真实光标 → 与虚拟比对 → 不一致整段重绘
- 同时实现切片 6 暂未做的 Ctrl+A/E、左右箭头编辑

**留到 M2 后再展开详细设计。**

---

## 5. 排期建议

### 5.1 标准路径（推荐）

适用于 B2 假设成立（多数用户裸 bash + 自定义 prompt）：

```
切片 5（1-2天）→ 切片 6（2-3天）→ 切片 7（3-5天）→ 内部 dogfood 1 周 → M1
                                                                  ↓
                                            切片 8（1-2 周）→ 30 天观察 → M2
```

总工时：约 4-6 周（不含 30 天观察期）

### 5.2 中文用户优先路径

如果 B3 假设需要修正（中文用户占主流）：

```
切片 5 → 切片 8（中文 IME） → 切片 6 → 切片 7 → M1 → M2
```

把切片 8 提到切片 6 之前，工时不变但中文用户更早受益。

### 5.3 仅修体感路径（zsh 用户为主）

如果实际用户都是 zsh + OSC 133（B2 假设不成立）：

```
切片 6 → 切片 7 → 内部 dogfood → M1 → 切片 5（兜底覆盖）→ 切片 8 → M2
```

把切片 5 推后，因为现有 OSC 133 已经够用。

### 5.4 需要用户决策的关键问题

- [ ] **B2 是否成立？** —— 决定切片 5 是否最优先
- [ ] **B3 是否成立？** —— 决定切片 8 是否提前到切片 6 之前
- [ ] **B4 是否成立？** —— 决定切片 6 优先级
- [ ] M1 期间是否做 metrics 上报？—— 影响切片 8 完成后能否进入 M2

---

## 6. 开放问题与待决策

| # | 问题 | 默认答案（待 review） |
|---|---|---|
| O1 | xterm.js 是否提供 CSI handler 注册（类似 OSC 133）用于解析 CPR 应答？ | 假设是（与切片 3 注册 CSI ?h/l 路径相同），动手前 grep 确认 |
| O2 | xterm.js composition 事件如何获取最终 commit 文本？ | 待调研（onCompositionEnd 的 event 对象） |
| O3 | M1 期间是否需要"复制 metrics 到剪贴板"按钮？ | 推荐做（30 分钟工时，独立于切片 5-8） |
| O4 | M2 是否真的去掉「实验」字样？还是保留低调标识？ | 默认彻底去掉，与转正语义一致 |
| O5 | 切片 5 的 CPR 应答与现有 xterm 行为是否冲突？（xterm 自身可能也用 CPR） | 动手前查 xterm 源码确认 |
| O6 | 切片 7 的多模式匹配性能？regex 每次 onRemoteOutput 调用是否需要优化？ | 实测先行，先用 regex；如 hitRate 路径出现性能 hot spot 再换字节扫描 |

---

## 7. 与阶段 1 的关系

阶段 2 不要求修改阶段 1 已经发布的接口，但以下假设需要更新：

| 阶段 1 假设 | 阶段 2 调整 | 影响 |
|---|---|---|
| 仅 OSC 133 + 弱启发式（保守原则） | 切片 5 加 CPR 主动探测 + 启发式扩展 | progress.md §8 决策记录"启发式范围"行需更新 |
| 退格分支仅支持 `\b \b` echo（zsh `\x1b[D \x1b[D` 触发失配） | 切片 7 多模式匹配可顺手覆盖 | predictiveEcho.ts 顶部 contract 注释更新 |
| backspace 项是唯一的非 char kind | 切片 6 引入 `kill-line` / `kill-word` kind | totalRemainingEchoLength 等内部方法的"仅 char"假设需要扩展 |
| metrics 仅 dev console 可见 | M1 前可能需要"复制到剪贴板"用户路径 | 切片 4 监控章节追加注 |

---

## 8. 验收标准（每个切片合入前必须满足）

阶段 2 切片合入门槛 = 阶段 1 标准 + 增量：

- [ ] selfCheck 全绿（T1-T27 阶段 1 用例 + 该切片新增用例）
- [ ] `npx tsc --noEmit` 无错
- [ ] `npx vite build` 通过
- [ ] 视觉手测对应场景通过（参考 `predictive-echo-phase1-acceptance.md` 的格式补对应章节）
- [ ] 兼容性核对清单（progress.md §10.2）无新增失败项
- [ ] 该切片对应的 G 缺口在「应用内 dogfood」中确认闭合

---

> 文档结束。下一步：用户 review §0 假设 → 调整 §5 排期建议 → 进入切片 5 的实现 plan。
