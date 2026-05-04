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
| 7 — 失配模式针对性处理 | ⏳ 待开发 | G3（alias 着色 / autosuggest） | 阻塞于切片 6 dogfood |
| 8 — IME 协同 | ⏳ M1 后做 | G4（中文/日韩输入） | 阻塞于 M0→M1 跨越 |
| 9 — CPR 完整同步基础设施 | ⏳ M2 后选做 | 完整状态同步 | 不阻塞转正 |

### 1.2 转正路径进度

```
   M0 实验性                  M1 默认开启              M2 正式功能
   (当前)                     (切片 7 + dogfood)       (30 天观察 + 文案)
   ────────────              ────────────             ────────────
   切片 5  ✅ 已完成          切片 8（中文 IME）       去「实验」标签
   切片 6  ✅ 已完成          + 30 天观察              + 阶段 1/2 文档归档
   切片 7  ⏳                 + hitRate ≥ 90%
   + dogfood 1 周
```

### 1.3 M0 退出条件核对（来自 phase2-plan §3.1）

- [x] 切片 5 完成 → G1 缺口闭合（自动化 + dogfood 双确认 2026-05-04）
- [x] 切片 6 完成 → G2 缺口闭合（自动化 + dogfood 双确认 2026-05-04）
- [ ] 切片 7 完成 → G3 缺口闭合
- [x] selfCheck 在新切片完成后保持全绿（201/201）
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

## 3. 待开发

### 3.1 切片 7：失配模式针对性处理

**核心范围**（详见 phase2-plan §4.3）:
- expectedEcho 多模式匹配（剥离 SGR 命中判定）
- autosuggest 灰色追加透传
- PROMPT_COMMAND 重绘整队回滚

**预估工时**：3-5 天

### 3.3 切片 8：IME 协同（M1 后做）

详见 phase2-plan §4.4。**先决调研未做**（xterm composition API 行为）。

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
> 预期：201/201 通过。
>
> 我说"开始"你再动手。严守工程纪律：先 Read 再 Edit，diff 最小化，失败两次换路。

### 4.2 验证当前状态

```bash
cd /Users/hanyongding/project/rust/shell/app
npm run test:predictive-echo  # 201 assertions
npx tsc --noEmit              # 无错
```

### 4.3 dogfood 极简清单（5 步 + 切片 6 增量）

> ✅ 状态：步骤 1-5（切片 5）+ 步骤 6/7/8（切片 6 增量）均已 dogfood 通过 2026-05-04，G1/G2 缺口闭合。后人接手时仍建议复跑确认环境无回归。

应用启动 + 设置开"预测回显（实验）"后：

1. **最简验证**：连服务器，敲 `ls` → 期望先浅后正
2. **starship 场景**：连装了 starship/oh-my-zsh 的机器，敲 `ls`
3. **vim 进出**：`vim test.txt` → `:q` → 再敲 `ls`，期望画面干净
4. **退格连击**：`echo hello` + 5 次退格，期望瞬时反馈
5. **频繁打字**：`ls && cd ~ && git status && pwd` 连跑
6. **切片 6 增量 — Ctrl+U 清行**：敲 `echo hello world` 后立即按 Ctrl+U，期望整行瞬间消失（不等远程 echo），随后远程 echo 到达画面无抖动
7. **切片 6 增量 — Ctrl+W 删词**：敲 `ls foo bar baz` 后连按 3 次 Ctrl+W，期望每次按下立即删一词（按空格分），最终留 `ls`
8. **切片 6 增量 — Ctrl+W 跳尾空格**：敲 `ls foo  ` (foo 后两空格) 后按 Ctrl+W，期望删 `foo` 和它前面的空格 + 两个尾空格，留 `ls`

观察项：
- 视觉：dim → 正色过渡是否自然，无闪烁
- 切片 6：Ctrl+U/W 后立刻看到字符消失（不等远程 echo），随后远程 echo 到达不重画
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
| **合计** | | **201 assertions** |

---

## 6. 关键文件清单

| 路径 | 状态 | 说明 |
|---|---|---|
| `app/src/features/terminal/predictiveEcho.ts` | 切片 6 完成 | 核心实现 ~1480 行，含 selfCheck T1-T49 |
| `app/src/features/terminal/TerminalPage.tsx` | 切片 5 完成 | 接入点：实例化 + OSC 133 + CSI ?h/l + CSI R + CPR 注入 |
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

阶段 1 既有陷阱（见 phase1-progress §10）在切片 5/6 期间未触发新问题。

---

## 8. 任务追踪

当前 task list（参考用，TaskList 工具看实时状态）：

- #1 切片 5 实施 — ✅ completed（2026-05-04）
- #4 切片 5 前置调研 — ✅ completed
- #8 切片 5 自动化测试 — ✅ completed
- #5 切片 6 实施 — ✅ completed（2026-05-04）
- #6 切片 7 实施 — 🟢 pending（**已 unblocked**，可开始）
- #7 M0 → M1 跨越 — ⏳ pending（blocked by #6）
- #2 切片 8 实施 — ⏳ pending（blocked by #7）
- #3 M1 → M2 跨越 — ⏳ pending（blocked by #2）

---

> 文档结束。下次更新本文档：
> - 切片 6 dogfood 通过后：§1.3 切片 6 dogfood 行打勾；§2.2 验证状态 dogfood 改 ✅；§4.3 增量步骤标记完成
> - 进入切片 7 时：§2 加切片 7 子节；§3.1 移除
> - 进入 M1 时：§1.2 转正路径阶段切换；切片 8 提到 §2
> - 进入 M2 时：本文档与 phase1-progress.md 一并归档到 `docs/archive/predictive-echo-phase{1,2}/`
