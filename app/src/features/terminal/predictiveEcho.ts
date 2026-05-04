import type { Terminal } from "@xterm/xterm";

/**
 * Predictive Echo（预测回显）阶段 1 实现（切片 1 + 2 + 3 + 4）
 * ────────────────────────────────────────────────────────────
 *
 * 目标：在高延迟 SSH 链路下（RTT 400-2000ms），让"普通命令行打字"的视觉
 * 反馈接近 0ms。用户按键时立即在 xterm 上画出该字符（预测），等远程 echo
 * 真实回来后做一致性校验：一致则"确认"，不一致则整队回滚到 Frozen 状态。
 *
 * 设计文档：docs/predictive-echo-phase1-plan.md
 *
 * ── 切片 1+2+3+4 已支持 ──
 *   ✓ 普通可见 ASCII 字符预测（0x20 ~ 0x7E）
 *   ✓ 队列管理（入队 / 部分匹配缓存 / 命中确认 / 失配回滚）
 *   ✓ 智能失配（前缀命中消化 + 剩余整队回滚）
 *   ✓ dim 视觉样式 + 命中转正色
 *   ✓ 四态状态机（Disabled / Cold / Active / Frozen）
 *   ✓ OSC 133 信号接口（外部解析后调用）
 *   ✓ 退格预测（仅回退队列里未被远程确认的字符）
 *   ✓ alternate screen 进入信号（外部 CSI handler 调用）
 *   ✓ 队列超时保护（队首入队 > 10s 未确认 → freeze）
 *   ✓ 弱启发式 prompt 检测（仅 Cold→Active；前 3 项严格期）
 *   ✓ 监控指标（切片 4：getMetrics 暴露累计计数 + 命中率）
 *   ↳ UI 设置开关 / 一次性引导（切片 4，由 SettingsPage / TerminalPage 接入）
 *
 * ── 与现有功能的契约 ──
 *   • 不接管 onData 业务逻辑（命令助手、危险命令、命令历史、IME）——预测
 *     层只在 onData 末尾被调用一次，决定"是否在屏幕上抢先画"
 *   • 不接管 session:output 业务逻辑（宏过滤等）——预测层只决定"哪些 echo
 *     字节已经被画过、应该从远程数据里吃掉"
 *   • 预测失败永远只影响"屏幕预测显示"，不影响数据流到远程的传输
 */

// ── ANSI 转义序列 ──

/** 退格 + 空格 + 退格：抹掉一个字符且光标回到原位 */
const ANSI_UNDO_CHAR = "\b \b";

/** SGR dim（半亮）开 / 关。预测字符以 dim 显示，命中后写正常色覆盖 */
const ANSI_DIM_ON = "\x1b[2m";
const ANSI_DIM_OFF = "\x1b[22m";

// ── 类型 ──

/** 队列中的一条预测项 */
interface Prediction {
  /** 单调递增序号（仅供调试 / 未来对账使用） */
  seq: number;
  /**
   * 预测种类：
   *   • "char"：普通字符预测，屏幕已写 dim 字符，命中后转正色
   *   • "backspace"：退格消化项，屏幕在入队时已通过 \b \b 抹掉了对应字符；
   *     此项只负责"消化远程将要 echo 出来的那个字符 + 退格 echo"，本身
   *     不在屏幕上占位
   */
  kind: "char" | "backspace";
  /** 预测的字符（仅 kind === "char" 时有意义） */
  char?: string;
  /**
   * 远程 echo 用于匹配的"期望字节"。
   *   • char 项：通常等于 char 本身
   *   • backspace 项：被退字符的 echo + 退格自身的 echo（默认 "\b \b"）
   *
   * 注意：阶段 1 切片 3 仅支持 bash 默认的 "\b \b" 退格 echo。zsh 在某些
   * ANSI 模式下回 "\x1b[D \x1b[D" 不被识别，会触发失配回滚 + Frozen。
   */
  expectedEcho: string;
  /**
   * 撤销序列：把这次预测的画面操作还原。
   *   • char 项：ANSI_UNDO_CHAR（"\b \b"）
   *   • backspace 项：""（屏幕在入队时已抹掉，无需再撤）
   */
  undoSequence: string;
  /** 入队时间戳（切片 3 超时检测用） */
  predictedAt: number;
}

/** 预测层运行状态。切片 1 简化为始终 Active；切片 2 引入完整状态机 */
type State = "Disabled" | "Cold" | "Active" | "Frozen";

export interface PredictiveEchoOptions {
  /** 队列容量上限。超过则停止预测（仍照常发送到远程）。默认 100 */
  maxQueueSize?: number;
}

const DEFAULT_OPTIONS: Required<PredictiveEchoOptions> = {
  maxQueueSize: 100,
};

// ── 工具函数 ──

/**
 * 判断字符是否为"普通可见 ASCII"——可预测的安全集合。
 *
 * 我们故意排除：
 *   • 控制字符（< 0x20）：\r \n \t \b ESC 等，这些会改变 shell 状态或光标
 *   • DEL（0x7F）：退格，切片 3 单独处理
 *   • 非 ASCII（>= 0x80）：多字节字符 / IME 输入，复杂度大幅提升
 *
 * 切片 1 的稳妥原则：宁可少预测、不要错预测。
 */
function isPredictableChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}

/**
 * 把不可预测字符归类为 freeze reason，仅作语义留痕。
 * 切片 3 接退格预测后，0x7f 会从这里分流出去单独处理。
 */
function classifyControlChar(ch: string): string {
  if (ch === "\r" || ch === "\n") return "enter";
  if (ch === "\x1b") return "esc";
  if (ch === "\x09") return "tab";
  if (ch === "\x7f" || ch === "\b") return "backspace";
  const code = ch.charCodeAt(0);
  if (code < 0x20) return "ctrl";
  return "other";
}

// ── PredictiveEcho ──

/**
 * 与 xterm Terminal 实例 1:1 绑定的预测回显层。
 * 由 TerminalInstance 在 useEffect 里实例化，sessionId 切换时调用 reset()。
 */
export class PredictiveEcho {
  private readonly term: Terminal;
  private readonly opts: Required<PredictiveEchoOptions>;

  /**
   * 切片 2：默认 Cold——开关启用后等 prompt 信号（OSC 133;B / 启发式）
   * 才转 Active。Disabled 表示功能完全关闭（feature flag off）。
   */
  private state: State = "Cold";

  /** 飞行中的预测队列。FIFO 消化 */
  private queue: Prediction[] = [];

  /** 单调递增的预测序号 */
  private nextSeq = 0;

  /**
   * 部分匹配缓存：远程 echo 可能分包到达。当队首预测的 expectedEcho 比
   * 当前可见远程数据长，且当前数据是 expectedEcho 的前缀时，把它缓存到
   * 下一次 onRemoteOutput 调用时再 prepend 重新匹配。
   */
  private pendingRemote = "";

  /**
   * 严格期剩余次数（切片 3）：从 Cold 经启发式提升到 Active 后，前 N 次
   * 命中按"严格模式"对待——任意失配立刻 Frozen（已是 freeze 默认行为，
   * 此字段仅作语义留痕，每次命中递减；归零后启发式信任度提升，
   * 可视未来切片接入更激进策略）。
   */
  private strictRemaining = 0;

  /**
   * 累计监控计数（切片 4）。生命周期内累加，reset() / setEnabled() 不重置——
   * 跨会话观察整体健康度更有价值。
   *   • predictionCount：char 项入队数（backspace 消化项不计——它是"已预测字符
   *     的退回"而非新预测，重复计数会扭曲命中率分母）
   *   • confirmCount：队首项命中出队数（char 与 backspace 都计——退格 echo 双消化
   *     的命中也是预测假设正确性的体现）
   *   • mismatchCount：handleMismatch 触发次数（一次失配 +1，与队列里被回滚的
   *     字符数无关——失配的代价主要是"一次屏幕抖动 + 进入 Frozen"）
   */
  private metrics = {
    predictionCount: 0,
    confirmCount: 0,
    mismatchCount: 0,
  };

  /** 队列超时阈值（毫秒）。队首入队超过此值仍未确认，触发 freeze("timeout") */
  private static readonly QUEUE_TIMEOUT_MS = 10_000;

  constructor(term: Terminal, options: PredictiveEchoOptions = {}) {
    this.term = term;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 用户按键路径调用。约定：调用方仍需照常 sessionWrite 把数据发到远程。
   * 本方法只决定"是否在屏幕上抢先画"。
   *
   * 调用顺序建议：在 onData 现有逻辑（cmdBuffer 维护、命令助手、sessionWrite）
   * 全部跑完之后调用，避免影响业务路径。
   */
  onUserInput(data: string): void {
    if (this.state !== "Active") return;
    this.checkTimeout();

    for (const ch of data) {
      // 退格分支（切片 3）：必须前置，否则 isPredictableChar 会把 0x7f / \b
      // 走 freeze 路径，丢失"回退本地预测"的能力。
      if (ch === "\x7f" || ch === "\b") {
        const tail = this.queue[this.queue.length - 1];
        if (!tail || tail.kind !== "char") {
          // 队列空或队尾是 backspace 项 / 其他不可回退情况：
          // 屏幕上前面的字符可能已被远程确认为正常色，本地无法安全回退，
          // 转为 freeze，让远程实际 echo 来驱动屏幕。
          this.freeze("backspace");
          return;
        }
        // 屏幕抹掉队尾那个 dim 字符（\b \b 的空格用普通色覆盖 dim）
        this.term.write(ANSI_UNDO_CHAR);
        // 出队尾部 char，入队 backspace 消化项
        const removed = this.queue.pop()!;
        this.queue.push({
          seq: this.nextSeq++,
          kind: "backspace",
          // 双 echo 消化：远程会先回退掉那个字符的 echo，再回退格 echo。
          // 二者按字节顺序拼接即可。
          expectedEcho: removed.expectedEcho + ANSI_UNDO_CHAR,
          undoSequence: "",
          predictedAt: Date.now(),
        });
        continue;
      }

      if (!isPredictableChar(ch)) {
        // 不可预测字符（Enter/ESC/Tab/Ctrl 组合等）——
        // 切片 2 起统一走 freeze()，整队回滚 + 切到 Frozen，
        // 等下次 prompt 信号才恢复。reason 仅用于语义留痕。
        this.freeze(classifyControlChar(ch));
        return;
      }

      if (this.queue.length >= this.opts.maxQueueSize) {
        // 饱和保护：停止新预测，让远程 echo 自然消化已有队列。
        return;
      }

      const p: Prediction = {
        seq: this.nextSeq++,
        kind: "char",
        char: ch,
        expectedEcho: ch,
        undoSequence: ANSI_UNDO_CHAR,
        predictedAt: Date.now(),
      };
      this.queue.push(p);
      this.metrics.predictionCount++;

      // 切片 2：以 dim 写入屏幕，让用户视觉上区分"已确认"与"预测中"。
      // 注意 expectedEcho 仍是纯字符——远程 echo 不会带 dim 序列。
      this.term.write(`${ANSI_DIM_ON}${ch}${ANSI_DIM_OFF}`);
    }
  }

  /**
   * 远程输出路径调用。返回经过预测层"消化"后的、应交给 xterm 显示的剩余文本。
   *
   * 调用顺序建议：在现有的 macroFilter / decoder 之后调用，确保进入预测层
   * 的数据已经是"准备显示给用户的纯文本"。
   *
   * 返回值含义：
   *   • 空字符串 → 远程数据完全被预测层消化（命中 + 部分匹配缓存），
   *     调用方不需要再 term.write
   *   • 非空字符串 → 调用方需要 term.write 这部分内容
   */
  onRemoteOutput(text: string): string {
    this.checkTimeout();
    if (this.queue.length === 0 && this.pendingRemote.length === 0) {
      // 队列空：尝试启发式 prompt 检测（仅 Cold→Active）
      this.detectPromptHeuristic(text);
      return text;
    }

    let remaining = this.pendingRemote + text;
    this.pendingRemote = "";

    while (this.queue.length > 0 && remaining.length > 0) {
      const head = this.queue[0];

      if (remaining.startsWith(head.expectedEcho)) {
        // 命中：消费掉远程 echo 中对应的字节，出队
        remaining = remaining.slice(head.expectedEcho.length);
        this.queue.shift();
        this.metrics.confirmCount++;
        if (head.kind === "char") {
          // char 项命中：把屏幕上那个 dim 字符"原位转正常色"。
          // shift 之前队首字符距离光标 = (后续 char 项 echo 长度 + 当前命中长度)。
          // 注意 backspace 项屏幕占 0 格，不计入光标偏移。
          //   1. 光标左移 totalBack 到队首字符位置之前
          //   2. 写 \x1b[22m + echo（覆盖为正常色，光标前进 echo 长度）
          //   3. 若剩余 char 项非空，光标右移回原位
          const echoLen = head.expectedEcho.length;
          const offsetAfter = this.totalRemainingEchoLength();
          const totalBack = echoLen + offsetAfter;
          let seq = `\x1b[${totalBack}D${ANSI_DIM_OFF}${head.expectedEcho}`;
          if (offsetAfter > 0) {
            seq += `\x1b[${offsetAfter}C`;
          }
          this.term.write(seq);
        }
        // backspace 项命中：屏幕上无 dim 字符可转正，仅需出队消化 echo。
        // 严格期计数：每次成功命中递减
        if (this.strictRemaining > 0) this.strictRemaining--;
        continue;
      }

      if (head.expectedEcho.startsWith(remaining)) {
        // 部分匹配：远程 echo 还在分批到达。缓存当前数据，等下一波。
        // 容量保护：如果挂起数据过大说明 expectedEcho 异常，按失配处理。
        if (remaining.length > 256) {
          return this.handleMismatch(remaining);
        }
        this.pendingRemote = remaining;
        return "";
      }

      // 失配：远程 echo 与队首预测明确不一致
      return this.handleMismatch(remaining);
    }

    // 队列已空 / 远程剩余字节交给调用方
    return remaining;
  }

  /**
   * 重置内部状态。在以下时机调用：
   *   • TerminalInstance 切换 sessionId（Effect 2 重建时）
   *   • 用户主动重连
   *
   * 注意：reset() 不改变 enabled/disabled 状态——
   *   • 若当前是 Disabled（开关关闭），保持 Disabled
   *   • 否则回到 Cold，等下次 prompt 信号再 Active
   * 关闭开关请用 setEnabled(false)。
   */
  reset(): void {
    this.queue.length = 0;
    this.pendingRemote = "";
    this.nextSeq = 0;
    this.strictRemaining = 0;
    if (this.state !== "Disabled") {
      this.state = "Cold";
    }
  }

  /**
   * 切换 feature flag。
   *   • setEnabled(false)：整队回滚 + 切到 Disabled，后续 onUserInput 不预测
   *   • setEnabled(true)：仅在当前 Disabled 时切到 Cold；其他状态保持不变
   *     （避免运行中误调降级 Active → Cold）
   */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.state === "Disabled") {
        this.state = "Cold";
      }
      return;
    }
    this.rollbackQueue();
    this.pendingRemote = "";
    this.strictRemaining = 0;
    this.state = "Disabled";
  }

  // ── prompt / 命令边界信号（由 TerminalPage 解析 OSC 133 后调用） ──

  /**
   * OSC 133;A — prompt 即将打印（还未 ready）。
   * 保守策略：无论之前在哪个 enabled 子状态，都回 Cold 等 ;B 才转 Active。
   * 这样 ;A 之后的"prompt 自身字节"不会被错误地纳入预测匹配。
   */
  onPromptStart(): void {
    if (this.state === "Disabled") return;
    this.rollbackQueue();
    this.pendingRemote = "";
    this.strictRemaining = 0;
    this.state = "Cold";
  }

  /** OSC 133;B — prompt 打印完毕，可以接受用户输入命令。 */
  onPromptReady(): void {
    if (this.state === "Disabled") return;
    this.state = "Active";
    // OSC 133;B 是强信号，无需严格期
    this.strictRemaining = 0;
  }

  /**
   * OSC 133;C — 命令开始执行。后续输出可能是 TUI / 多行混杂，
   * 不再适合预测，整队回滚并冻结。
   */
  onCommandStart(): void {
    if (this.state === "Disabled") return;
    this.freeze("commandStart");
  }

  /** OSC 133;D — 命令执行结束，回到 Cold 等下一个 prompt。 */
  onCommandEnd(): void {
    if (this.state === "Disabled") return;
    this.rollbackQueue();
    this.pendingRemote = "";
    this.strictRemaining = 0;
    this.state = "Cold";
  }

  /**
   * 进入 alternate screen（vim / less / tmux / man 等）。
   * 屏幕语义完全不同，必须冻结，等离开后下一个 prompt 信号再恢复。
   */
  onAlternateScreenEnter(): void {
    if (this.state === "Disabled") return;
    this.freeze("altScreenEnter");
  }

  /**
   * 退出 alternate screen。
   * 保持 Frozen，等下个 prompt 信号（OSC 133;B 或启发式）才转 Active。
   */
  onAlternateScreenLeave(): void {
    // no-op：刻意保持 Frozen，由后续 prompt 信号驱动恢复
  }

  /**
   * 通用冻结入口：整队回滚 + 切到 Frozen。
   * 输入侧不可预测信号（Enter/ESC/Tab/Ctrl）走这条路统一处理。
   * Disabled 状态下不切换（开关关闭时不应被覆盖）。
   *
   * @param reason 仅作语义留痕，未来切片 4 接监控指标时记录
   */
  freeze(reason?: string): void {
    void reason;
    if (this.state === "Disabled") return;
    this.rollbackQueue();
    this.pendingRemote = "";
    this.strictRemaining = 0;
    this.state = "Frozen";
  }

  /**
   * 仅供测试 / 调试观察内部状态。生产路径不应依赖此方法。
   */
  _debugState(): {
    state: State;
    queueSize: number;
    pendingRemote: string;
    nextSeq: number;
    strictRemaining: number;
    queueKinds: ("char" | "backspace")[];
  } {
    return {
      state: this.state,
      queueSize: this.queue.length,
      pendingRemote: this.pendingRemote,
      nextSeq: this.nextSeq,
      strictRemaining: this.strictRemaining,
      queueKinds: this.queue.map((p) => p.kind),
    };
  }

  /**
   * 累计监控指标快照（切片 4）。供 dev 控制台 / 未来打点接入。
   *
   * hitRate = confirmCount / (confirmCount + mismatchCount)。分母为 0 时返回
   * null（首次运行尚未发生任何确认/失配），由调用方决定如何展示（如 "n/a"）。
   *
   * 计数语义详见 metrics 字段定义；本方法只读，不修改任何状态。
   */
  getMetrics(): {
    predictionCount: number;
    confirmCount: number;
    mismatchCount: number;
    hitRate: number | null;
  } {
    const denom = this.metrics.confirmCount + this.metrics.mismatchCount;
    return {
      predictionCount: this.metrics.predictionCount,
      confirmCount: this.metrics.confirmCount,
      mismatchCount: this.metrics.mismatchCount,
      hitRate: denom === 0 ? null : this.metrics.confirmCount / denom,
    };
  }

  // ── 私有方法 ──

  /** 当前队列里所有未确认 char 项在屏幕上占据的总字符宽度。
   *  backspace 项屏幕占 0 格（入队时已 \b \b 抹掉），不计入。 */
  private totalRemainingEchoLength(): number {
    let total = 0;
    for (const p of this.queue) {
      if (p.kind === "char") total += p.expectedEcho.length;
    }
    return total;
  }

  /**
   * 队首超时检查（切片 3）。在 onUserInput / onRemoteOutput 入口顺手调一次，
   * 不引入定时器。队首入队 > QUEUE_TIMEOUT_MS 仍未被远程 echo 消化（可能是
   * 网络断流 / 远程卡死 / 启发式误判），整队回滚 + Frozen，等下次 prompt
   * 信号恢复。
   */
  private checkTimeout(): void {
    if (this.queue.length === 0) return;
    const head = this.queue[0];
    if (Date.now() - head.predictedAt > PredictiveEcho.QUEUE_TIMEOUT_MS) {
      this.freeze("timeout");
    }
  }

  /**
   * 弱启发式 prompt 检测（切片 3）。仅在 Cold 状态、队列空、远程 text 末尾
   * 形如 "$ " / "# " / "> " 时把状态提升为 Active，并设置严格期 strictRemaining=3。
   *
   * 保守原则：
   *   • 只做 Cold→Active，不动 Frozen→Active（避免错预测扩散）
   *   • OSC 133 是更强的信号，外部已经调 onPromptReady() 时本路径不会触发
   *     （state 已经是 Active）
   *   • 文档已警告启发式可能误判（如 prompt 字符出现在命令输出尾部）。配合
   *     严格期 + 失配 freeze，单次误判最多带来一次 freeze、视觉略抖一下，
   *     不影响功能正确性。
   */
  private detectPromptHeuristic(text: string): void {
    if (this.state !== "Cold") return;
    if (text.length < 2) return;
    // 检查末尾两字节
    const tail = text.slice(-2);
    if (tail === "$ " || tail === "# " || tail === "> ") {
      this.state = "Active";
      this.strictRemaining = 3;
    }
  }

  /**
   * 失配处理：整队回滚到屏幕、清空队列、切到 Frozen，把远程 echo 原样返回。
   * 失配意味着预测假设错了——保守起见冻结，等下次 prompt 信号才恢复 Active。
   */
  private handleMismatch(remoteText: string): string {
    this.metrics.mismatchCount++;
    this.rollbackQueue();
    this.pendingRemote = "";
    this.strictRemaining = 0;
    if (this.state !== "Disabled") {
      this.state = "Frozen";
    }
    return remoteText;
  }

  /**
   * 把队列里所有预测字符在屏幕上撤销，然后清空队列。
   * 不向远程发送任何额外数据。
   */
  private rollbackQueue(): void {
    if (this.queue.length === 0) return;
    const undo = this.buildBulkUndoSequence();
    this.queue.length = 0;
    if (undo.length > 0) {
      this.term.write(undo);
    }
  }

  /** 构造批量撤销序列。从队尾向队首撤销（最后预测的最先撤销）。 */
  private buildBulkUndoSequence(): string {
    let undo = "";
    for (let i = this.queue.length - 1; i >= 0; i--) {
      undo += this.queue[i].undoSequence;
    }
    return undo;
  }
}

// ──────────────────────────────────────────────────────────────
// selfCheck：切片 1 验证用，使用 mock Terminal 不依赖真实 xterm
// 切片 4 收尾时随 dev-only 代码一起移除（或迁到独立测试文件）
// 在 dev console 里手动调用：
//   import { selfCheck } from "@/features/terminal/predictiveEcho";
//   selfCheck();
// ──────────────────────────────────────────────────────────────

interface SelfCheckResult {
  passed: boolean;
  results: string[];
}

/**
 * 用 mock Terminal 验证 PredictiveEcho 的核心数据流。
 * 切片 1 验收依据。返回值供调用方判断 pass/fail。
 */
export function selfCheck(): SelfCheckResult {
  const results: string[] = [];
  let allPass = true;

  function assert(condition: boolean, msg: string) {
    results.push(`${condition ? "✓" : "✗"} ${msg}`);
    if (!condition) allPass = false;
  }

  function makeMockTerm() {
    const writes: string[] = [];
    const mock = {
      buffer: { active: { cursorX: 0, cursorY: 0 } },
      write: (data: string) => {
        writes.push(data);
      },
    } as unknown as Terminal;
    return { term: mock, writes };
  }

  // T1: 入队 abc，echo "abc" 全部命中确认（屏幕以 dim 写入，命中转正）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady(); // Cold → Active
    pe.onUserInput("abc");
    assert(pe._debugState().queueSize === 3, "T1: 三字符预测后队列大小为 3");
    assert(writes.length === 3, "T1: 入队阶段 term.write 被调用 3 次");
    assert(
      writes[0] === "\x1b[2ma\x1b[22m" &&
        writes[1] === "\x1b[2mb\x1b[22m" &&
        writes[2] === "\x1b[2mc\x1b[22m",
      "T1: 入队阶段每次写 dim 包裹的字符",
    );

    const passthrough = pe.onRemoteOutput("abc");
    assert(passthrough === "", "T1: echo 与预测一致，无剩余字节透传");
    assert(pe._debugState().queueSize === 0, "T1: 队列已清空");
  }

  // T2: 失配整队回滚（前缀命中 'a' 触发转正、'b'/'c' 队尾失配回滚）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    const beforeMismatch = writes.length;

    // 远程 echo "axc"：'a' 与队首 'a' 命中（写转正序列），'x' 与队首 'b' 失配。
    // 命中转正：shift 前队列长度 3 → totalBack=1+2=3，offsetAfter=2，
    //   序列 = "\x1b[3D\x1b[22ma\x1b[2C"
    // 失配回滚：剩余队列 [b,c] 整队回滚 → "\b \b\b \b"
    const passthrough = pe.onRemoteOutput("axc");
    assert(passthrough === "xc", "T2: 命中 'a' 后失配，剩余 'xc' 透传");
    assert(pe._debugState().queueSize === 0, "T2: 失配后队列清空");
    assert(pe._debugState().state === "Frozen", "T2: 失配后状态切 Frozen");

    const tail = writes.slice(beforeMismatch).join("");
    assert(
      tail === "\x1b[3D\x1b[22ma\x1b[2C\b \b\b \b",
      "T2: 命中转正序列 + 队尾两项回滚",
    );
  }

  // T2b: 第一字符就失配（纯整队回滚）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    const beforeMismatch = writes.length;

    // echo "XYZ" 与队首 'a' 完全不一致——队首失配立即整队回滚
    const passthrough = pe.onRemoteOutput("XYZ");
    assert(passthrough === "XYZ", "T2b: 第一字符失配后 echo 原样透传");
    assert(pe._debugState().queueSize === 0, "T2b: 队列清空");
    assert(pe._debugState().state === "Frozen", "T2b: 失配后状态切 Frozen");

    const undo = writes.slice(beforeMismatch).join("");
    assert(
      undo === "\b \b\b \b\b \b",
      "T2b: 撤销 3 项（\\b \\b × 3）",
    );
  }

  // T3: 部分匹配（远程 echo 分批到达）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");

    const r1 = pe.onRemoteOutput("a");
    assert(r1 === "", "T3a: 第一段 'a' 命中第一个预测，无剩余");
    assert(pe._debugState().queueSize === 2, "T3a: 队列剩 2");

    const r2 = pe.onRemoteOutput("bc");
    assert(r2 === "", "T3b: 第二段 'bc' 命中后两个预测");
    assert(pe._debugState().queueSize === 0, "T3b: 队列清空");
  }

  // T4: 不可预测字符（\r）触发 freeze（整队回滚 + 切 Frozen）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab");
    const beforeRollback = writes.length;
    pe.onUserInput("\r");
    assert(pe._debugState().queueSize === 0, "T4: \\r 触发整队回退后队列空");
    assert(pe._debugState().state === "Frozen", "T4: \\r 触发 freeze 切 Frozen");
    const undo = writes.slice(beforeRollback).join("");
    assert(undo === "\b \b\b \b", "T4: 写入了 2 次撤销序列");
  }

  // T5: reset 清空状态（state 回到 Cold）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    pe.reset();
    const s = pe._debugState();
    assert(s.queueSize === 0, "T5: reset 后队列空");
    assert(s.pendingRemote === "", "T5: reset 后部分匹配缓存空");
    assert(s.nextSeq === 0, "T5: reset 后序号归零");
    assert(s.state === "Cold", "T5: reset 后状态回 Cold");
  }

  // T6: 远程输出比预测多——多余字节透传
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab");
    const r = pe.onRemoteOutput("abXYZ");
    assert(r === "XYZ", "T6: 命中后多余字节 'XYZ' 透传");
    assert(pe._debugState().queueSize === 0, "T6: 队列清空");
  }

  // T7: 队列空时直接透传（无意外消费）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    const r = pe.onRemoteOutput("hello");
    assert(r === "hello", "T7: 队列空时远程输出原样透传");
    assert(pe._debugState().pendingRemote === "", "T7: 不污染部分匹配缓存");
  }

  // T8: 队列饱和保护
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term, { maxQueueSize: 3 });
    pe.onPromptReady();
    pe.onUserInput("abcde");
    assert(pe._debugState().queueSize === 3, "T8: 超过 maxQueueSize 后停止预测");
    // 前 3 字符应该被预测画到屏幕（dim 包裹），后 2 字符不被画
    assert(writes.length === 3, "T8: 仅前 3 字符被画到屏幕");
    assert(
      writes[0] === "\x1b[2ma\x1b[22m" &&
        writes[1] === "\x1b[2mb\x1b[22m" &&
        writes[2] === "\x1b[2mc\x1b[22m",
      "T8: 画的是前 3 字符（dim 包裹）",
    );
  }

  // T9: 部分匹配缓存跨调用累积
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("hello");
    // 远程分 5 次单字符 echo
    assert(pe.onRemoteOutput("h") === "", "T9a: 'h' 命中");
    assert(pe.onRemoteOutput("e") === "", "T9b: 'e' 命中");
    assert(pe.onRemoteOutput("l") === "", "T9c: 'l1' 命中");
    assert(pe.onRemoteOutput("l") === "", "T9d: 'l2' 命中");
    assert(pe.onRemoteOutput("o") === "", "T9e: 'o' 命中");
    assert(pe._debugState().queueSize === 0, "T9: 队列清空");
  }

  // T10: 失配后 pendingRemote 也被清空
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    pe.onRemoteOutput("a"); // 命中第一项
    // 现在再来一段失配
    const r = pe.onRemoteOutput("XX");
    assert(r === "XX", "T10: 失配后透传");
    assert(pe._debugState().pendingRemote === "", "T10: 失配后 pendingRemote 被清空");
  }

  // T11: Cold 状态下 onUserInput 不预测
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    // 默认 Cold，未调 onPromptReady
    pe.onUserInput("abc");
    assert(pe._debugState().queueSize === 0, "T11: Cold 状态下不入队");
    assert(writes.length === 0, "T11: Cold 状态下无屏幕写");
    assert(pe._debugState().state === "Cold", "T11: 状态保持 Cold");
  }

  // T12: onPromptReady() 后切到 Active，可以预测
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    assert(pe._debugState().state === "Cold", "T12: 初始状态 Cold");
    pe.onPromptReady();
    assert(pe._debugState().state === "Active", "T12: onPromptReady 后切 Active");
    pe.onUserInput("a");
    assert(pe._debugState().queueSize === 1, "T12: Active 下可预测");
  }

  // T13: onCommandStart() 触发整队回滚 + Frozen
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab");
    const beforeCmd = writes.length;
    pe.onCommandStart();
    assert(pe._debugState().queueSize === 0, "T13: CommandStart 清空队列");
    assert(pe._debugState().state === "Frozen", "T13: 状态切到 Frozen");
    const undo = writes.slice(beforeCmd).join("");
    assert(undo === "\b \b\b \b", "T13: 回滚 2 项");
    // Frozen 后 onUserInput 不再预测
    pe.onUserInput("c");
    assert(pe._debugState().queueSize === 0, "T13: Frozen 状态下不预测");
  }

  // T14: onPromptStart 后回 Cold（保守起见，等 ;B 才转 Active）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    pe.onPromptStart();
    assert(pe._debugState().state === "Cold", "T14: PromptStart 后回 Cold");
    assert(pe._debugState().queueSize === 0, "T14: PromptStart 清空队列");
  }

  // T15: setEnabled(false) 切 Disabled，所有信号失效
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setEnabled(false);
    assert(pe._debugState().state === "Disabled", "T15: setEnabled(false) 切 Disabled");
    pe.onPromptReady();
    assert(pe._debugState().state === "Disabled", "T15: Disabled 下 onPromptReady 无效");
    pe.onUserInput("abc");
    assert(pe._debugState().queueSize === 0, "T15: Disabled 下不预测");
    pe.setEnabled(true);
    assert(pe._debugState().state === "Cold", "T15: setEnabled(true) 从 Disabled 回 Cold");
  }

  // ── 切片 3 用例 ──

  // T16: 退格预测正常路径
  // 流程：abc → 退格 → 队列变 [char(a), char(b), backspace(c)]，屏幕已抹掉 c。
  // 远程 echo "abc\b \b" 全命中，队列空、状态 Active。
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    const beforeBs = writes.length;
    pe.onUserInput("\x7f"); // 退格
    assert(pe._debugState().queueSize === 3, "T16: 退格后队列仍 3 项（char/char/backspace）");
    assert(
      pe._debugState().queueKinds.join(",") === "char,char,backspace",
      "T16: 队列结构为 [char, char, backspace]",
    );
    // 退格分支应只写一次 \b \b
    assert(
      writes.slice(beforeBs).join("") === "\b \b",
      "T16: 退格分支屏幕写 \\b \\b 抹掉队尾 dim 字符",
    );

    // 远程 echo "abc\b \b" 一次性回来
    const passthrough = pe.onRemoteOutput("abc\b \b");
    assert(passthrough === "", "T16: 远程双 echo 全部被消化");
    assert(pe._debugState().queueSize === 0, "T16: 队列清空");
    assert(pe._debugState().state === "Active", "T16: 状态保持 Active");
  }

  // T17: 队尾不是 char（连续退格第二次）→ freeze
  // 第一次退格成功（队列变 [backspace]），第二次退格队尾是 backspace 项 → freeze
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    pe.onUserInput("\x7f"); // 第一次：a 被退掉，队列 [backspace]
    assert(pe._debugState().queueSize === 1, "T17: 第一次退格后队列 [backspace]");
    assert(pe._debugState().state === "Active", "T17: 第一次退格仍 Active");

    pe.onUserInput("\x7f"); // 第二次：队尾不是 char → freeze
    assert(pe._debugState().state === "Frozen", "T17: 第二次退格触发 freeze");
    assert(pe._debugState().queueSize === 0, "T17: freeze 清空队列");
  }

  // T18: 队列空时退格 → freeze（不预测）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    const before = writes.length;
    pe.onUserInput("\x7f"); // 队列本就空
    assert(pe._debugState().state === "Frozen", "T18: 队列空时退格 → Frozen");
    // freeze 时队列空，rollbackQueue 不写任何东西
    assert(writes.length === before, "T18: 队列空时退格不产生屏幕写");
  }

  // T19: 退格预测后远程乱回 echo 失配 → 整队回滚 + Frozen
  // backspace 项 undoSequence="" 不输出额外撤销字节
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    pe.onUserInput("\x7f"); // 队列 [backspace]
    const beforeMis = writes.length;

    const passthrough = pe.onRemoteOutput("XX"); // 与 "a\b \b" 完全不一致
    assert(passthrough === "XX", "T19: 失配后远程数据原样透传");
    assert(pe._debugState().state === "Frozen", "T19: 失配切 Frozen");
    assert(pe._debugState().queueSize === 0, "T19: 队列清空");
    // rollback 时队列只剩 backspace 项，undoSequence="" → 不应产生额外写
    assert(
      writes.slice(beforeMis).length === 0,
      "T19: backspace 项 rollback 不写任何字节",
    );
  }

  // T20: alternate screen Enter / Leave
  // Enter → 整队回滚 + Frozen；Leave → 仍 Frozen（不自动恢复）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab");
    const beforeAlt = writes.length;
    pe.onAlternateScreenEnter();
    assert(pe._debugState().state === "Frozen", "T20: AltScreenEnter 切 Frozen");
    assert(pe._debugState().queueSize === 0, "T20: AltScreenEnter 清空队列");
    const undo = writes.slice(beforeAlt).join("");
    assert(undo === "\b \b\b \b", "T20: 回滚 2 项 dim 字符");

    pe.onUserInput("c");
    assert(pe._debugState().queueSize === 0, "T20: Frozen 下退出全屏前不预测");

    pe.onAlternateScreenLeave();
    assert(pe._debugState().state === "Frozen", "T20: AltScreenLeave 不自动恢复 Active");
  }

  // T21: 队首超时 → freeze("timeout")
  // 通过 monkey-patch Date.now 模拟时间跳跃，避免依赖真实计时。
  {
    const originalDateNow = Date.now;
    let mockNow = 1_000_000;
    Date.now = () => mockNow;
    try {
      const { term, writes } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onPromptReady();
      pe.onUserInput("a"); // predictedAt = 1_000_000
      const beforeTimeout = writes.length;

      mockNow += 11_000; // +11s，超过 QUEUE_TIMEOUT_MS (10s)
      pe.onRemoteOutput(""); // 入口的 checkTimeout 触发 freeze

      assert(pe._debugState().state === "Frozen", "T21: 队首超时切 Frozen");
      assert(pe._debugState().queueSize === 0, "T21: 超时清空队列");
      // freeze 走 rollback，写 \b \b
      assert(
        writes.slice(beforeTimeout).join("") === "\b \b",
        "T21: 超时回滚写 \\b \\b",
      );
    } finally {
      Date.now = originalDateNow;
    }
  }

  // T22: 弱启发式 prompt（队列空 + Cold + 末尾 "$ "）→ Active
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    assert(pe._debugState().state === "Cold", "T22: 初始 Cold");
    const r = pe.onRemoteOutput("user@host:~$ ");
    assert(r === "user@host:~$ ", "T22: 远程数据原样透传给 xterm");
    assert(pe._debugState().state === "Active", "T22: 启发式提升到 Active");
    assert(pe._debugState().strictRemaining === 3, "T22: 严格期 strictRemaining=3");

    // 命中一次后 strictRemaining 递减
    pe.onUserInput("x");
    pe.onRemoteOutput("x");
    assert(pe._debugState().strictRemaining === 2, "T22: 命中一次 strictRemaining → 2");
  }

  // T22b: 启发式不动 Frozen→Active（保守原则）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.freeze("manual");
    assert(pe._debugState().state === "Frozen", "T22b: 进入 Frozen");
    pe.onRemoteOutput("user@host:~$ ");
    assert(pe._debugState().state === "Frozen", "T22b: Frozen 下启发式不生效");
  }

  // T23: 严格期内失配立刻 Frozen + strictRemaining 归零
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onRemoteOutput("user@host:~$ "); // Cold → Active, strictRemaining=3
    pe.onUserInput("a");
    const r = pe.onRemoteOutput("X"); // 失配
    assert(r === "X", "T23: 失配数据透传");
    assert(pe._debugState().state === "Frozen", "T23: 失配切 Frozen");
    assert(pe._debugState().strictRemaining === 0, "T23: 失配后严格期归零");
  }

  // ── 切片 4 用例：监控计数器 ──

  // T24: 全部命中 → predictionCount=3 confirmCount=3 mismatchCount=0
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    pe.onRemoteOutput("abc");
    const m = pe.getMetrics();
    assert(m.predictionCount === 3, "T24: 入队 3 字符 predictionCount=3");
    assert(m.confirmCount === 3, "T24: 全部命中 confirmCount=3");
    assert(m.mismatchCount === 0, "T24: 无失配 mismatchCount=0");
    assert(m.hitRate === 1, "T24: 命中率 100%");
  }

  // T25: 部分失配 → predictionCount=3 confirmCount=1 mismatchCount=1
  // 失配只 +1（与队列回滚字符数无关），命中率 = 1 / (1 + 1) = 0.5
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    pe.onRemoteOutput("axc"); // 命中 a，b 失配
    const m = pe.getMetrics();
    assert(m.predictionCount === 3, "T25: 入队 3 字符 predictionCount=3");
    assert(m.confirmCount === 1, "T25: 仅 a 命中 confirmCount=1");
    assert(m.mismatchCount === 1, "T25: 一次失配 mismatchCount=1");
    assert(m.hitRate === 0.5, "T25: 命中率 50%");
  }

  // T26: 退格分支 — backspace 入队不算 prediction，但命中算 confirm
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");          // predictionCount=1
    pe.onUserInput("\x7f");       // 退格：队列变 [backspace]，predictionCount 不增
    pe.onRemoteOutput("a\b \b");  // 双 echo 命中 → confirmCount=1
    const m = pe.getMetrics();
    assert(m.predictionCount === 1, "T26: backspace 消化项不计入 predictionCount");
    assert(m.confirmCount === 1, "T26: backspace 项命中也计入 confirmCount");
    assert(m.mismatchCount === 0, "T26: 无失配");
  }

  // T27: hitRate 在分母为 0 时返回 null（无任何确认 / 失配）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a"); // 仅入队，没有 onRemoteOutput
    const m = pe.getMetrics();
    assert(m.predictionCount === 1, "T27: predictionCount=1");
    assert(m.confirmCount === 0, "T27: 尚无命中");
    assert(m.mismatchCount === 0, "T27: 尚无失配");
    assert(m.hitRate === null, "T27: 分母 0 时 hitRate=null");
  }

  // eslint-disable-next-line no-console
  console.log(
    `[PredictiveEcho selfCheck] ${allPass ? "PASS" : "FAIL"}\n${results.join("\n")}`,
  );
  return { passed: allPass, results };
}
