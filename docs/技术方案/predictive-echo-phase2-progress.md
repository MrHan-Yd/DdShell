# Predictive Echo 阶段 2 接力文档

> 用途：阶段 2 切片实施进度 + 接手指南
> 阅读顺序：§1 总览 → §2 已完成 → §3 待开发 → §4 接手指南
> 关联文档：
> - [`predictive-echo-phase2-plan.md`](./predictive-echo-phase2-plan.md)（阶段 2 设计契约 + 转正路径）
> - [`predictive-echo-phase1-progress.md`](./predictive-echo-phase1-progress.md)（阶段 1 完整记录）
> - [`predictive-echo-phase1-plan.md`](./predictive-echo-phase1-plan.md)（阶段 1 设计契约）

---

## 1. 总览

### 1.1 当前位置

里程碑：**M0 实验性 → M1 默认开启候选**（进行中）

| 切片 | 状态 | 关闭的缺口 | 备注 |
|---|---|---|---|
| 5 — Shell 兼容性扩展 | ✅ 已完成（2026-05-04） | G1（裸 bash + 自定义 prompt） | 启发式扩展 + CPR 主动探测 |
| 6 — 行编辑高级场景 | ✅ 已完成（2026-05-04） | G2（Ctrl+W/U） | readline 分词 + 双 echo 消化 |
| 7 — 失配模式针对性处理 | ✅ 代码完成（2026-05-05），dogfood 待做 | G3（着色 / autosuggest / PROMPT_COMMAND 重绘） | SGR 剥离命中 + autosuggest 透传 + 重绘检测 |
| 8 — 中文 IME 协同 | ✅ 代码完成（2026-05-05），dogfood 待做 | G4（中文 IME 输入） | CJK 宽字符 2 列宽路径 + 简繁中文 + 标点 + 全角符号 |
| 9 — 光标对账（周期同步） | ✅ 代码完成（2026-05-05），dogfood 待做 | G5（网络抖动失配雪崩 + Frozen 自动恢复） | 预测光标 + 5s xterm 光标对账 + Frozen→Active 自动恢复；CPR 仅保留初始化兜底 |

### 1.2 转正路径进度

```
   M0 实验性                  M1 默认开启              M2 正式功能
   (当前)                     (切片 7/8/9 dogfood + 跨越) (30 天观察 + 文案)
   ────────────              ────────────             ────────────
   切片 5  ✅ 已完成          + 30 天观察              去「实验」标签
   切片 6  ✅ 已完成          + hitRate ≥ 90%          + 阶段 1/2 文档归档
   切片 7  ✅ 代码完成
    切片 8  ✅ 代码完成（提前于 M1，仅简繁中文）
    切片 9  ✅ 代码完成（光标对账）
   + dogfood 1 周（待做）
```

### 1.3 M0 退出条件核对（来自 phase2-plan §3.1）

- [x] 切片 5 完成 → G1 缺口闭合（自动化 + dogfood 双确认 2026-05-04）
- [x] 切片 6 完成 → G2 缺口闭合（自动化 + dogfood 双确认 2026-05-04）
- [x] 切片 7 完成（代码层）→ G3 缺口闭合（自动化 248/248 通过 2026-05-05；dogfood 待做）
- [x] 切片 8 完成（代码层，提前于 M1）→ G4 缺口闭合（自动化 288/288 通过 2026-05-05；dogfood 待做）
- [x] selfCheck 在新切片完成后保持全绿（317/317）
- [ ] 至少 1 周内部 dogfood，无致命 bug
- [ ] **可选**：metrics 上报机制 — 不做也能进 M1

---

## 2. 已完成

### 2.1 切片 5：Shell 兼容性扩展（2026-05-04）

**目标**：关闭 G1 缺口——让裸 bash + 自定义 prompt 用户也能预测。

**修改清单**：

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | `detectPromptHeuristic` 扩展（SGR 剥离 + PROMPT_TAIL_CHARS 8 字符）+ 新增 `onCursorPosition` 公共方法 + selfCheck T28-T39（含 4 条端到端场景） | +~200 行 |
| `app/src/features/terminal/TerminalPage.tsx` | 注册 CSI `final='R'` handler（拦截 CPR 应答）+ 远程连接建立 ~1.1s 后注入 `\x1b[6n` | +~20 行 |
| `app/scripts/test-predictive-echo.ts` | 新建 selfCheck runner | 新文件 |
| `app/package.json` | 新增 `npm run test:predictive-echo` script | +1 行 |

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| CPR 应答策略 | **D1-A**：单次触发即认定 prompt ready | 简化，不做"列位置稳定 ≥ 200ms"多次比对 |
| Shell 白名单 | **D2-A**：先实现观察，异常再加 | 多数 shell 对 CPR 反应一致；维护白名单负担大 |
| CPR 注入时机 | 仅远程连接建立后一次 | 避免和 OSC 133 / 启发式机制重复触发 |
| 启发式严格期 | strictRemaining 由 3 提升到 5 | 启发式更宽松，需要更多严格期保护 |
| 自动化测试范围 | selfCheck T36-T39 端到端场景集成 | 替代手测场景 A/B/C/D 的逻辑等价路径 |

**验证状态**：

- ✅ selfCheck T1-T39 全绿（**161/161 assertions, 0 failures**；2026-05-04 用户本地 `npm run test:predictive-echo` 复现通过）
- ✅ `npx tsc --noEmit` 无错
- ✅ `npx vite build` 通过
- ✅ 应用内 dogfood — 用户跑完 5 步极简清单无问题（2026-05-04）
- ✅ G1 缺口闭合确认 — 切片 5 收尾

**自动化入口**：

```bash
cd /Users/hanyongding/project/rust/shell/app
npm run test:predictive-echo
```

预期：`PASS — 161 assertions, 0 failures`，退出码 0。

---

### 2.2 切片 6：行编辑高级场景（2026-05-04）

**目标**：关闭 G2 缺口——让 Ctrl+U 清行 / Ctrl+W 删词也能预测。

**修改清单**：

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | `Prediction.kind` 扩展为 4 种（新增 `kill-line` / `kill-word`）+ `onUserInput` 新增 Ctrl+U/W 分支 + selfCheck T40-T49 + pendingRemote 容量 256→512 | +~210 行 |

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| Ctrl+W 分词算法 | **D1**：标准 readline 行为（跳尾空格 + 删到上一空格）| 与 bash/zsh 默认一致 |
| 队列含非 char 项时 | **D2**：一律 freeze（保守）| 不处理混杂消化项的复杂场景 |
| `undoSequence` for kill-line/word | **D3**：`""` | 同 backspace 项；rollback 不重画 dim 字符，让远程 echo 自然驱动 |
| metrics 计数 | **D4**：kill-* 项不计 predictionCount，命中计 confirmCount | 与 backspace 同语义（消化项非新预测）|
| pendingRemote 容量 | **D5**：256 → 512 | kill-line expectedEcho 含被删字符 echo + N 退格回显，最长 4*100=400，留余量 |
| selfCheck 编号 | **D6**：T40-T49（plan 文档 T36-T44 编号过期） | T1-T39 已被切片 1-5 用满 |

**关键设计点**：kill-line/word 项的 `expectedEcho` 必须包含**被删字符的 echo + N 次 \b \b 退格回显**——因为远程 echo 是异步的，用户敲 Ctrl+U/W 时，被删字符的 echo 可能仍在路上未到达。这与 backspace 项的"双 echo 消化"同构（参见 `Prediction.expectedEcho` 注释）。

**验证状态**：

- ✅ selfCheck T1-T49 全绿（**201/201 assertions, 0 failures**；2026-05-04 `npm run test:predictive-echo` 通过）
- ✅ `npx tsc --noEmit` 无错
- ✅ `npx vite build` 通过
- ✅ 应用内 dogfood — 用户跑完 §4.3 增量步骤 6/7/8 无问题（2026-05-04）
- ✅ G2 缺口闭合确认 — 切片 6 收尾

**自动化入口**：

```bash
cd /Users/hanyongding/project/rust/shell/app
npm run test:predictive-echo
```

预期：`PASS — 201 assertions, 0 failures`，退出码 0。

---

### 2.3 切片 7：失配模式针对性处理（2026-05-05 代码层完成）

**目标**：关闭 G3 缺口——让 alias 着色 / zsh-syntax-highlighting / zsh autosuggest / 裸 bash PROMPT_COMMAND 重绘场景不再触发失配雪崩。

**修改清单**：

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | 模块级 `consumeBytesWithSgrSkip`（SGR 跳过字节扫描器）+ `onRemoteOutput` SGR 剥离命中分支 + SGR 分包缓存分支 + 新增静态常量 `CSI_SEQUENCE_REGEX` / `HEAVY_REDRAW_THRESHOLD` + 私有方法 `isHeavyRedraw` + `onRemoteOutput` 入口重绘检测 + selfCheck T50-T60（47 项 assertion） | +~190 行 |

**子任务拆分**：

| 子任务 | 范围 | selfCheck 增量 |
|---|---|---|
| 7.1 SGR 剥离多模式命中（方案 A） | 严格相等失败时剥离 SGR 后再 startsWith；屏幕仍写带色字节，着色保留；SGR 分包缓存 | T50-T54（24 项） |
| 7.2 autosuggest 灰色追加透传（方案 B） | **无 production 改动**——契约已由 7.1 严格命中分支自然支持；用例固化防回归 | T55-T57（12 项） |
| 7.3 PROMPT_COMMAND 重绘整队回滚（方案 C） | `isHeavyRedraw` 检测非 SGR CSI 数 ≥ 5 的重绘场景，触发整队 freeze | T58-T60（11 项） |

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| SGR 剥离命中范围 | 仅 `kind === "char"` 项 | backspace/kill-line/kill-word 的 expectedEcho 含控制序列，远程不会带色，剥离不适用 |
| 命中消费长度 | 字节扫描跳过 SGR，消费到 `expectedEcho.length` 个普通字符即停 | 字符后紧跟的尾部 reset SGR 留作 remaining 透传给调用方写到 xterm；不破坏已渲染字符，且不影响后续 dim 入队 |
| 转正序列里写什么 | 远程的 `consumed` 字节段（含 SGR）而非 `expectedEcho` 纯字符 | 关 dim 后远程 SGR 决定字符渲染，着色自然保留；光标偏移按"普通字符数"算（SGR 序列不占屏幕格），与原命中转正同构 |
| SGR 分包缓存判定 | `stripped.length < expectedEcho.length && expectedEcho.startsWith(stripped)` | 远程仅发出半段 SGR（纯 SGR 包）时缓存 pendingRemote，等下一波拼接；复用原 512 容量保护 |
| 其他 CSI 序列处理 | 7.1 字节扫描器**不跳过**，落到普通字符计数 → 失配 → 7.3 重绘检测兜底 | 切片 7.1 仅覆盖纯 SGR 包裹场景；光标定位类失配由 7.3 专门处理 |
| 严格相等优先级 | SGR 剥离分支放在严格相等 + 部分匹配**之后** | 无 SGR 场景走原快路径，零回归；有 SGR 才进剥离逻辑，性能影响仅限着色场景 |
| 重绘检测阈值 | 非 SGR CSI 数 ≥ 5 触发 | 简单命令 echo 不会触发；zsh autosuggest 撤销+重 echo 单轮 1-2 个非 SGR CSI 不达阈值；仅 PROMPT_COMMAND 重画整行才达到 |
| 重绘检测时机 | onRemoteOutput 入口（pendingRemote 拼接后、while 之前） | 一次性回滚比逐字节比对失配雪崩省视觉抖动 |

**关键设计点**：autosuggest 透传**无需新代码**——zsh autosuggest 在用户敲字后追加灰色建议（`\x1b[90m<建议>\x1b[39m`），第一字符严格相等命中后，剩余建议字节自然作为 `onRemoteOutput` 返回值由调用方写到 xterm，不被预测层吞掉。7.2 子任务以 T55-T57 固化此契约防止后续误改回归。

**验证状态**：

- ✅ selfCheck T1-T60 全绿（**248/248 assertions, 0 failures**；2026-05-05 `npm run test:predictive-echo` 通过）
- ✅ `npx tsc --noEmit` 无错
- ✅ `npx vite build` 通过（1.81s）
- ⏳ 应用内 dogfood — 待用户在裸 bash + alias 着色 / zsh autosuggest / bash PROMPT_COMMAND 三类环境实跑
- ⏳ G3 缺口闭合确认 — 待 dogfood 后

**自动化入口**：

```bash
cd /Users/hanyongding/project/rust/shell/app
npm run test:predictive-echo
```

预期：`PASS — 248 assertions, 0 failures`，退出码 0。

---

### 2.4 切片 8：中文 IME 协同（2026-05-05 代码层完成）

**目标**：关闭 G4 缺口——让简体中文 + 繁体中文（含汉字、中文标点、全角符号）也能预测，与 ASCII 路径体验等同。

**范围决策**（用户确认 2026-05-05）：
- ✅ 简体中文 + 繁体中文（CJK Unified U+4E00-9FFF + CJK Ext A U+3400-4DBF）
- ✅ 中文标点（U+3000-303F，「。」「、」「《」等）
- ✅ 全角符号（U+FF00-FF60，「，」「Ｂ」等）
- ❌ 半角片假名（U+FF61-FFEF，1 列宽，显式排除）
- ❌ 日文 hiragana/katakana / 韩文 hangul（用户活动场景占比低，留未来切片）
- ❌ Supplementary plane CJK（Ext B-F，需 surrogate pair 处理，留未来切片）

**修改清单**：

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | 模块级 `isCJKWideChar` + `charDisplayWidth` 工具函数 + `onUserInput` CJK 分支 + 退格 / Ctrl+U / Ctrl+W 按列宽计算 + `onRemoteOutput` 严格命中与 SGR 剥离命中 echoLen 改 `charDisplayWidth(head.char)` + `totalRemainingEchoLength` 改按列宽汇总 + selfCheck T61-T70（40 项 assertion） | +~150 行 |
| `app/src/features/terminal/TerminalPage.tsx` | **不改动**——现有 `composingRef` + `compositionstart/end` 监听 + `onData` 短路已正确支持方案 A | 0 |

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| 实施时机 | **提前于 M1 起手**（原计划 M1 后做）| 切片 7 dogfood 期间正好可与切片 8 dogfood 并行；用户范围确认仅简繁中文，工时压缩到 1 日内 |
| 字符范围边界 | **严格收紧到 4 个 BMP 段** | 显式排除 U+FF61-FFEF 半角片假名（1 列宽混用会误算列偏移）；显式排除 supplementary plane（surrogate pair 处理） |
| Surrogate pair 兜底 | `isCJKWideChar` 入口判 `ch.length !== 1` 直接 return false | char.length === 2 的 supplementary plane CJK 走 freeze 兜底，不诱导出错 |
| 列宽抽象 | 模块级 `charDisplayWidth(ch)` 函数（CJK=2 / ASCII=1）| 集中所有"1 字符 = 1 列"假设的破口；4 处调用点（onUserInput 退格 / Ctrl+U / Ctrl+W + onRemoteOutput 严格命中 + onRemoteOutput SGR 剥离命中 + totalRemainingEchoLength）一致替换 |
| undoSequence | `ANSI_UNDO_CHAR.repeat(2)`（"\b \b\b \b" 6 字节）| 与 ASCII 路径"\b \b"同构，按列数重复；xterm Unicode11Addon 渲染时第一次 \b \b 抹右半，第二次抹左半 |
| 方案选择 | **方案 A：commit 后预测** | 与现有 IME 短路路径自然对接（compositionend → 普通 onData）；不监听 compositionupdate（候选词预测失配率高） |
| TerminalPage 改动 | **0 行**——所有改动收敛在 predictiveEcho.ts | 现有 `composingRef` 短路已正确；commit 文本走 onData → onUserInput 即可分流到新 CJK 分支 |
| 命中转正 echoLen | `charDisplayWidth(head.char)` 而非 `expectedEcho.length` | BMP CJK 在 UTF-16 下 `expectedEcho.length === 1` 与 ASCII 同，会算错列偏移；必须用 charDisplayWidth |

**关键设计点**：CJK char 项与 ASCII char 项的差异**仅在屏幕列宽**。expectedEcho 仍是字符本身（远程发回的字节，UTF-8 由 xterm 解码后等同输入字符），但 `echoLen / undoSequence / totalRemainingEchoLength` 的"1 字符 = 1 列"假设必须由 `charDisplayWidth` 抽象。这是切片 8 主要的内部脆弱点——任何遗漏的"假设 1 列"代码点都会导致 CJK 场景下命中转正光标错位。selfCheck T64 显式断言 `\x1b[4D...\x1b[2C`（4D / 2C 而非 2D / 1C）固化此契约。

**验证状态**：

- ✅ selfCheck T1-T70 全绿（**288/288 assertions, 0 failures**；2026-05-05 `npm run test:predictive-echo` 通过）
- ✅ `npx tsc --noEmit` 无错
- ✅ `npx vite build` 通过（1.73s）
- ⏳ 应用内 dogfood — 待用户在 macOS 系统中文 IME（拼音/注音）实跑
- ⏳ G4 缺口闭合确认 — 待 dogfood 后

**自动化入口**：

```bash
cd /Users/hanyongding/project/rust/shell/app
npm run test:predictive-echo
```

预期：`PASS — 288 assertions, 0 failures`，退出码 0。

---

### 2.5 切片 9：光标对账（周期同步）（2026-05-05）

**目标**：关闭 G5 缺口——预测队列在网络抖动、远端重绘或局部失配后，不应长期停留在 Frozen；预测光标必须能和真实终端光标周期对账。

**修改清单**：

| 文件 | 改动 | 说明 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | 新增 `predictedCursor`、周期光标对账、Frozen 自动恢复、metrics 与 selfCheck T71-T80 | 光标对账使用 xterm 0-based 坐标；ANSI CPR 应答入口统一转换 1-based → 0-based |
| `app/src/features/terminal/TerminalPage.tsx` | 注入 `realCursorReader` | 周期对账直接读 xterm buffer 光标，不再周期性向远端 shell 注入 `\x1b[6n` |

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| 周期对账来源 | 直接读取 xterm buffer 光标 | 避免 `\x1b[6n` 控制序列进入 shell/readline 输入流 |
| CPR 坐标基准 | 统一从 ANSI 1-based 转成 xterm 0-based | `xterm.buffer.active.cursorX/Y` 是 0-based，直接比较会稳定错位 |
| Active 入口 | `onPromptReady`、启发式 prompt、Cold CPR 兜底、Frozen 恢复统一走 `promoteActive` | 保证预测光标初始化和 timer 启动路径一致 |
| Frozen 恢复 | 队列为空且光标对账成功时恢复 Active + strictRemaining=5 | 队列非空时无法安全恢复，必须继续保守冻结 |

**验证状态**：

- ✅ selfCheck T1-T80 全绿（**317/317 assertions, 0 failures**；2026-05-05 `pnpm test:predictive-echo` 通过）
- ✅ `pnpm build` 通过
- ⏳ 应用内 dogfood — 待做

---

## 3. 待开发

当前阶段 2 代码切片 5-9 均已完成；剩余工作集中在 dogfood、指标观察和转正判断。

---

## 4. 接手指南

### 4.1 在新会话中加载上下文

复制以下模板：

> 我要继续 Predictive Echo 阶段 2 的开发。请按以下顺序加载上下文：
>
> 1. `docs/技术方案/predictive-echo-phase2-progress.md`（本接力文档，重点 §1.1 当前位置、§2 已完成切片）
> 2. `docs/技术方案/predictive-echo-phase2-plan.md`（设计契约，重点 §4 切片设计、§5 排期建议）
> 3. `docs/技术方案/predictive-echo-phase1-progress.md`（阶段 1 完整记录，重点 §10 陷阱清单）
> 4. `app/src/features/terminal/predictiveEcho.ts`（核心实现，含 selfCheck）
> 5. `app/src/features/terminal/TerminalPage.tsx`（接入点）
>
> 用 selfCheck 验证仍正常：
>
> ```bash
> cd /Users/hanyongding/project/rust/shell/app && npm run test:predictive-echo
> ```
>
> 预期：317/317 通过。
>
> 我说"开始"你再动手。严守工程纪律：先 Read 再 Edit，diff 最小化，失败两次换路。

### 4.2 验证当前状态

```bash
cd /Users/hanyongding/project/rust/shell/app
pnpm test:predictive-echo     # 317 assertions
npx tsc --noEmit              # 无错
```

### 4.3 dogfood 极简清单（5 步 + 切片 6/7/8/9 增量）

> ✅ 状态：步骤 1-5（切片 5）+ 步骤 6/7/8（切片 6 增量）已 dogfood 通过 2026-05-04，G1/G2 缺口闭合。
> ⏳ 状态：步骤 9-11（切片 7 增量）+ 步骤 12-17（切片 8 增量）+ 步骤 18-20（切片 9 增量）待 dogfood，G3/G4/G5 缺口闭合需此步通过。
> 后人接手时仍建议复跑确认环境无回归。

应用启动 + 设置开"预测回显（实验）"后：

1. **最简验证**：连服务器，敲 `ls` → 期望先浅后正
2. **starship 场景**：连装了 starship/oh-my-zsh 的机器，敲 `ls`
3. **vim 进出**：`vim test.txt` → `:q` → 再敲 `ls`，期望画面干净
4. **退格连击**：`echo hello` + 5 次退格，期望瞬时反馈
5. **频繁打字**：`ls && cd ~ && git status && pwd` 连跑
6. **切片 6 增量 — Ctrl+U 清行**：敲 `echo hello world` 后立即按 Ctrl+U，期望整行瞬间消失（不等远程 echo），随后远程 echo 到达画面无抖动
7. **切片 6 增量 — Ctrl+W 删词**：敲 `ls foo bar baz` 后连按 3 次 Ctrl+W，期望每次按下立即删一词（按空格分），最终留 `ls`
8. **切片 6 增量 — Ctrl+W 跳尾空格**：敲 `ls foo  ` (foo 后两空格) 后按 Ctrl+W，期望删 `foo` 和它前面的空格 + 两个尾空格，留 `ls`
9. **切片 7 增量 — alias 着色**：装 `alias ls='ls --color=auto'` 的机器，敲 `ls`，期望 dim → 命中后变正常色（不闪烁回滚）
10. **切片 7 增量 — zsh autosuggest**：装 zsh-autosuggestions 的机器敲 `g`，期望立即看到 dim `g` + 灰色建议（`it status` 等），灰色建议**不被预测层吞掉**
11. **切片 7 增量 — bash PROMPT_COMMAND**：连配置 PROMPT_COMMAND 重画 prompt 的裸 bash，敲 Enter 触发重绘，期望整队回滚一次后画面干净（不抖动雪崩）
12. **切片 8 增量 — 中文 IME 单字预测**：macOS 切到拼音/注音输入法，连 SSH，敲「中」字 → 期望 dim 中文 → 远程 echo 后转正色
13. **切片 8 增量 — 中文多字 commit**：敲「你好世界」一次性 commit → 期望 4 个汉字依次 dim 显示 → 远程 echo 后逐个转正
14. **切片 8 增量 — ASCII 中文混合**：敲 `ls 中文` → 期望 ls 命中后中文继续 dim → 远程 echo 中文转正
15. **切片 8 增量 — 中文标点 + 全角符号**：敲「中文，全角符号」（含 U+3000-303F 与 U+FF00-FF60 段）→ 期望全部预测命中
16. **切片 8 增量 — 中文退格**：敲「中文」后按退格 → 期望立即抹掉「文」字（按 2 列宽）
17. **切片 8 增量 — 半角片假名 freeze**（如有日文输入法）：敲 `ｱ`（U+FF71，半角片假名）→ 期望 freeze 整队回滚（这是设计预期，不是 bug）
18. **切片 9 增量 — 光标对账稳定性**：高延迟连接下连续输入 `abcdefghijklmnopqrstuvwxyz`，期望 dim → 正色连续命中，控制台 `cprMismatchCount` 不持续增长
19. **切片 9 增量 — Frozen 自动恢复**：触发一次不可预测场景（如进入/退出 `vim` 或执行会重绘 prompt 的命令）后等待 5s，再输入 `ls`，期望无需重连即可恢复预测
20. **切片 9 增量 — CPR 兜底坐标**：裸 bash / 无 OSC 133 环境下首次连接后输入 `ls`，期望初始 CPR 兜底仍能进入 Active，且不会因 1-based/0-based 坐标错位反复 Frozen

观察项：
- 视觉：dim → 正色过渡是否自然，无闪烁
- 切片 6：Ctrl+U/W 后立刻看到字符消失（不等远程 echo），随后远程 echo 到达不重画
- 切片 7：着色场景命中后字符直接变成远程指定的颜色（不是 dim 后变默认色再被远程覆盖）；autosuggest 灰字保留；PROMPT_COMMAND 重绘整队回滚仅一次
- 切片 8：中文字符 dim 显示按 2 列宽占位（与远程 echo 后正色字符列宽一致）；命中后无视觉抖动；中文与 ASCII 混合时光标位置正确
- 切片 9：光标对账不应把控制序列写进 shell/readline；`cprAuditCount` 可增长，`cprMismatchCount` 不应持续增长
- dev console：60s 后自动打印 `[PredictiveEcho metrics]`，hitRate ≥ 0.9

出意外快速回退：设置里关闭"预测回显（实验）"开关。

---

## 5. selfCheck 用例分布

| 用例段 | 范围 | 数量 |
|---|---|---|
| T1-T15 | 阶段 1 基础队列 + 状态机 | 55 项 |
| T16-T23 | 阶段 1 退格 + alt screen + 弱启发式 | 34 项 |
| T24-T27 | 阶段 1 metrics | 15 项 |
| T28-T35 | 阶段 2 切片 5 单点（启发式扩展 + CPR）| 24 项 |
| T36-T39 | 阶段 2 切片 5 端到端场景（A/B/C/D 等价）| 33 项 |
| T40-T49 | 阶段 2 切片 6（Ctrl+U/W 行编辑）| 40 项 |
| T50-T54 | 阶段 2 切片 7.1（SGR 剥离命中 + 分包缓存）| 24 项 |
| T55-T57 | 阶段 2 切片 7.2（autosuggest 透传契约）| 12 项 |
| T58-T60 | 阶段 2 切片 7.3（PROMPT_COMMAND 重绘检测）| 11 项 |
| T61-T70 | 阶段 2 切片 8（中文 IME 协同：CJK 宽字符 + 标点 + 全角 + 退格 + Ctrl+U + 标点 + 全角 + 排除范围）| 40 项 |
| T71-T80 | 阶段 2 切片 9（预测光标 + 周期光标对账 + Frozen 自动恢复）| 29 项 |
| **合计** | | **317 assertions** |

---

## 6. 关键文件清单

| 路径 | 状态 | 说明 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | 切片 9 完成 | 核心实现，含 selfCheck T1-T80 |
| `app/src/features/terminal/TerminalPage.tsx` | 切片 9 完成 | 接入点：实例化 + OSC 133 + CSI ?h/l + CSI R + 初始 CPR + xterm 光标读取器 |
| `app/src/features/settings/SettingsPage.tsx` | 阶段 1 完成 | 「预测回显（实验）」开关 |
| `app/scripts/test-predictive-echo.ts` | 切片 5 新建 | selfCheck runner |
| `app/package.json` | 切片 5 新增 script | `npm run test:predictive-echo` |
| `app/src/lib/i18n.ts` | 阶段 1 完成 | 3 条 key（中英）|

---

## 7. 风险点与陷阱

### 7.1 切片 5 实施时遇到的

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **PROMPT_TAIL_CHARS 必须仅是 BMP 字符** | 若加 emoji 等 surrogate pair 字符，`text[length-2]` 取到的是半个 code unit | 当前 8 个字符（`$#>❯➜λ%→`）全部 < U+FFFF，安全；后续如要扩展须验证 |
| **CPR handler 必须 `return true` 消费应答** | 否则 `\x1b[<row>;<col>R` 字面写到屏幕上 | TerminalPage CSI `final='R'` handler 显式 `return true` |
| **CPR 注入时机不能太早** | sessionWrite 早于远端 PTY 就绪，应答永远不回 | 在 sessionResize 800ms 后追加 300ms（合计 ~1.1s）|
| **启发式扩展更宽松带来更多误判** | 命令输出形似 prompt（如 `Total: 100% `）误判进 Active | strictRemaining 从 3 提到 5；T38 验证严格期保护对扩展字符仍生效 |
| **SGR 剥离不应改变屏幕写入** | 如果剥离后字符串被写到屏幕，颜色丢失 | 剥离结果**仅用于启发式判定**，原字节流仍透传给 xterm |

### 7.2 切片 6 实施时遇到的

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **kill-line/word 项 expectedEcho 漏算被删字符 echo** | 远程实际发 "abc\b \b\b \b\b \b" 但预测层只期望 "\b \b\b \b\b \b" → 失配 freeze | expectedEcho 必须 = 被删字符 echo（仍在路上）+ N 次 \b \b 退格回显，与 backspace 项"双 echo 消化"同构 |
| **pendingRemote 容量保护 256 不够长 Ctrl+U** | 100 char + Ctrl+U 时 expectedEcho 长 400 字节，部分匹配可能撞 256 上限误判 | 容量保护提到 512（4 * maxQueueSize 留余量）|
| **Ctrl+W 分词差异** | bash/zsh 默认按空格分词；用户自定义 WORDCHARS 可能改成"按非字母分词" | 仅支持空格分词；其他场景失配 freeze 即可，不影响功能正确性 |

阶段 1 既有陷阱（见 phase1-progress §10）在切片 5/6/7 期间未触发新问题。

### 7.3 切片 7 实施时遇到的

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **剥离命中后尾部 reset SGR 该消化还是透传** | 远程 echo `\x1b[31ml\x1b[0m`，命中字符消费后 `\x1b[0m` 留在 remaining，是吞掉还是透传？ | 透传给调用方写到 xterm。reset 不破坏已渲染字符（属性已固化），且不影响后续 dim 入队（每次入队显式发 ANSI_DIM_ON）。selfCheck T50/T51/T54 显式断言 `r === "\x1b[0m"` 固化此契约 |
| **isHeavyRedraw 误判 SGR 着色场景** | 7.1 alias 着色多字符 echo 含多个 m 收尾 CSI（`\x1b[31ml\x1b[39m\x1b[31ms\x1b[39m`），若误算入重绘阈值会让正常着色场景被回滚 | `CSI_SEQUENCE_REGEX` 捕获 final byte，过滤 `m[1] !== "m"` 才计数。T60 显式断言"双字符着色不触发重绘"防回归 |
| **autosuggest "无需新代码"的认知陷阱** | plan §4.3 方案 B 写了独立检测逻辑，看似要新增"超出期望范围 → 标记 autosuggest"代码 | 实际上严格相等命中分支天然支持——剩余字节作为 onRemoteOutput 返回值由调用方透传，不被吞掉。7.2 仅补 selfCheck T55-T57 固化契约，无 production 改动 |
| **CSI_SEQUENCE_REGEX 全局正则的 lastIndex 风险** | `String.matchAll` / `regex.exec` 配合 /g 标志时 lastIndex 跨调用会污染 | `isHeavyRedraw` 内部进入时 `lastIndex = 0`，提前 return 时也显式重置。与 SGR_STRIP_REGEX 用 `replace`（不依赖 lastIndex）的策略不同 |

### 7.4 切片 8 实施时遇到的

| 陷阱 | 现象 | 防御 / 修复 |
|---|---|---|
| **echoLen 用 `expectedEcho.length` 在 BMP CJK 下静默错误** | UTF-16 下汉字 `"中".length === 1`，与 ASCII `"a".length === 1` 同；改造前命中转正光标只回退 1 列而非 2 列，远程 echo 后字符叠在一起 | 严格命中分支 + SGR 剥离命中分支的 echoLen 必须用 `charDisplayWidth(head.char)`；T64 显式断言 `\x1b[4D...\x1b[2C`（4D / 2C）固化契约 |
| **半角片假名 U+FF61-FFEF 列宽与全角符号不同** | 若 isCJKWideChar 范围扩到 U+FF00-FFEF，半角片假名（1 列宽）会被误算 2 列 → 退格 / Ctrl+U 多抹一格 | 范围严格收紧到 U+FF00-FF60；T70a 显式断言 `ｱ`（U+FF71）走 freeze 防回归 |
| **Supplementary plane CJK（Ext B-F）UTF-16 surrogate pair** | `"𠮷".length === 2`（U+20BB7）；按"一字符"逻辑处理会越界 | `isCJKWideChar` 入口 `if (ch.length !== 1) return false` 兜底，supplementary plane CJK 走 freeze（与俄文等同） |
| **CJK 退格 expectedEcho 容易少算字节** | 汉字"中"远程 echo 后跟 4 字节双退格回显（"\b \b\b \b"），不是 ASCII 路径的 2 字节 | backspace 项 expectedEcho = `removed.expectedEcho + ANSI_UNDO_CHAR.repeat(width)`，width 由 `charDisplayWidth` 决定；T66 验证 |
| **Ctrl+U 总列宽计算遗漏 CJK 项** | 若用 `n = queue.length` 算屏幕抹除字节数，CJK 队列只抹 `\b \b × n` 而非 `\b \b × totalWidth`，多余空格留在屏幕 | Ctrl+U/W 改用 `for (const p of queue) totalWidth += charDisplayWidth(p.char ?? "")` 统计；T67 验证 |
| **TerminalPage 改动诱惑** | composition API 调研期间一度想给 TerminalPage 加 compositionupdate 监听 | 方案 A（commit 后预测）天然不需要 update；现有 composingRef 短路 + compositionend 后走 onData → onUserInput 已正确，0 行改动收敛复杂度 |

---

## 8. 任务追踪

当前 task list（参考用，TaskList 工具看实时状态）：

- #1 切片 5 实施 — ✅ completed（2026-05-04）
- #4 切片 5 前置调研 — ✅ completed
- #8 切片 5 自动化测试 — ✅ completed
- #5 切片 6 实施 — ✅ completed（2026-05-04）
- #6 切片 7 实施 — ✅ completed（代码层 2026-05-05；dogfood 待做）
- #2 切片 8 实施 — ✅ completed（代码层 2026-05-05，提前于 M1；dogfood 待做）
- #7 M0 → M1 跨越 — ⏳ pending（**待切片 7/8/9 dogfood 1 周**）
- #3 M1 → M2 跨越 — ⏳ pending（blocked by #7）

---

> 文档结束。下次更新本文档：
> - 切片 7/8/9 dogfood 通过后：§1.1 切片 7/8/9 状态改 ✅ 已完成（dogfood 双确认）；§1.3 dogfood 行打勾；§2.3/2.4/2.5 验证状态 dogfood 改 ✅；§4.3 切片 7/8/9 增量步骤标记完成
> - 进入 M1 时：§1.2 转正路径阶段切换
> - 进入 M2 时：本文档与 phase1-progress.md 一并归档到 `docs/archive/predictive-echo-phase{1,2}/`
