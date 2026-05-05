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
 *   ✓ 中文宽字符预测（切片 8：CJK Unified / Ext A / Punctuation / Fullwidth ASCII，
 *     按 2 列宽计算光标偏移与撤销序列）
 *   ✓ 光标对账（切片 9：维护预测光标位置 predictedCursor + 周期真实光标读取
 *     与预测光标对账，失败整队回滚 + Frozen；Frozen + 队列空时对账成功自动恢复
 *     Active。CPR 应答入口仍保留给切片 5 初始化兜底，为 Ctrl+A/E + 左右箭头编辑
 *     预留基础设施）
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
   *   • "char"：普通字符预测，屏幕已写 dim 字符，命中后转正色。含 ASCII（1 列宽，
   *     undoSequence "\b \b"）与 CJK 宽字符（切片 8，2 列宽，undoSequence
   *     "\b \b\b \b"）；屏幕占 charDisplayWidth(char) 列，光标偏移与 echoLen 计算
   *     必须用 charDisplayWidth 而非 expectedEcho.length。
   *   • "backspace"：退格消化项，屏幕在入队时已通过 \b \b 抹掉了对应字符；
   *     此项只负责"消化远程将要 echo 出来的那个字符 + 退格 echo"，本身
   *     不在屏幕上占位
   *   • "kill-line"（切片 6）：Ctrl+U 清行消化项，入队前已把队列里所有 char
   *     项 pop 掉、屏幕通过 \b \b × N 抹掉对应 dim 字符；本项消化远程 echo 的
   *     N 次 \b \b。屏幕占 0 格。
   *   • "kill-word"（切片 6）：Ctrl+W 删词消化项，与 kill-line 同构，但 N 是
   *     按 readline 分词算法（先跳尾空格再到上一空格）算出的字符数。
   */
  kind: "char" | "backspace" | "kill-line" | "kill-word";
  /** 预测的字符（仅 kind === "char" 时有意义） */
  char?: string;
  /**
   * 远程 echo 用于匹配的"期望字节"。
   *   • char 项：通常等于 char 本身
   *   • backspace 项：被退字符的 echo + 退格自身的 echo（默认 "\b \b"）
   *   • kill-line / kill-word 项：N 次 "\b \b" 拼接（N 由入队时计算）
   *
   * 注意：阶段 1 切片 3 仅支持 bash 默认的 "\b \b" 退格 echo。zsh 在某些
   * ANSI 模式下回 "\x1b[D \x1b[D" 不被识别，会触发失配回滚 + Frozen。
   * 切片 6 的 Ctrl+U/W 同样仅支持 "\b \b" × N 模式；远程实际是 \x1b[K 等
   * 其他清行序列时会失配 freeze（切片 7 多模式匹配统一处理）。
   */
  expectedEcho: string;
  /**
   * 撤销序列：把这次预测的画面操作还原。
   *   • char 项：ANSI_UNDO_CHAR（"\b \b"）
   *   • backspace 项：""（屏幕在入队时已抹掉，无需再撤）
   *   • kill-line / kill-word 项：""（同 backspace，屏幕已抹掉；失配场景让
   *     远程 echo 自然驱动屏幕，不重画 dim 字符）
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
  /** 切片 9：光标对账周期（毫秒）。默认 5000。selfCheck 可注入小值验证 timer。 */
  cprAuditIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<PredictiveEchoOptions> = {
  maxQueueSize: 100,
  cprAuditIntervalMs: 5000,
};

// ── 工具函数 ──

/**
 * 判断字符是否为"普通可见 ASCII"——可预测的安全集合。
 *
 * 我们故意排除：
 *   • 控制字符（< 0x20）：\r \n \t \b ESC 等，这些会改变 shell 状态或光标
 *   • DEL（0x7F）：退格，切片 3 单独处理
 *   • 非 ASCII（>= 0x80）：多字节字符 / IME 输入；切片 8 起 CJK 宽字符由
 *     isCJKWideChar 单独分流到 onUserInput 的 CJK 预测分支，俄/希腊/阿拉伯等
 *     非 CJK 非 ASCII 字符仍按 freeze 处理
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

/**
 * 判断字符是否为"中文宽字符"（切片 8）。范围严格按 plan 定义，仅含 2 列宽段，
 * 显式排除 1 列宽的混淆段（如半角片假名 U+FF61-FFDC）和 supplementary plane
 * （需 surrogate pair，char.length=2）。
 *
 * 覆盖范围：
 *   • U+4E00-9FFF  CJK Unified Ideographs（中日韩统一汉字，含简繁中文 95%+）
 *   • U+3400-4DBF  CJK Extension A（罕见汉字）
 *   • U+3000-303F  CJK Symbols and Punctuation（「，。！？」等中文标点）
 *   • U+FF00-FF60  Fullwidth ASCII Forms（全角 ASCII，「Ｂ」「！」等）
 *
 * 显式排除：U+FF61-FFEF（半角片假名 1 列宽）、U+3040-30FF（hiragana/katakana）、
 * U+1100-115F + U+AC00-D7AF（韩文）、U+20000+（Extension B-F）。这些字符在
 * onUserInput 内会落到 freeze 分支——是设计预期，不是 bug。
 */
function isCJKWideChar(ch: string): boolean {
  if (ch.length !== 1) return false; // 排除 surrogate pair（supplementary plane）
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xff60)
  );
}

/**
 * 字符屏幕显示列宽（切片 8）。CJK 宽字符 2 列；ASCII 1 列。
 * 调用方约定：仅对已确认可预测的 char 项的 char 字段调用——backspace / kill-line
 * / kill-word 项的 char 为 undefined，会被 `?? ""` 兜底为空串返回 1（无意义但不崩）。
 */
function charDisplayWidth(ch: string): number {
  return isCJKWideChar(ch) ? 2 : 1;
}

/**
 * 从 text 开头扫描，跳过 SGR 序列（\x1b[...m），累计 targetCharLen 个非 SGR 字符，
 * 返回总消费字节数（含跳过的 SGR）。如果非 SGR 字符不足 targetCharLen，返回 -1。
 *
 * 切片 7.1 用途：onRemoteOutput SGR 剥离命中后，反推应消费 remaining 多少字节。
 * 与 PredictiveEcho.SGR_STRIP_REGEX 的格式定义保持一致（\x1b[ + 数字/分号 + m）。
 * 其他 CSI 序列（如光标移动 \x1b[5D）不跳过，会落到普通字符计数——切片 7.1
 * 只覆盖 alias 着色 / zsh-syntax-highlighting 这类纯 SGR 包裹场景，光标定位
 * 序列出现时按失配处理（由切片 7.3 PROMPT_COMMAND 重绘分支专门覆盖）。
 */
function consumeBytesWithSgrSkip(text: string, targetCharLen: number): number {
  let i = 0;
  let charCount = 0;
  while (i < text.length && charCount < targetCharLen) {
    if (text.charCodeAt(i) === 0x1b && text.charCodeAt(i + 1) === 0x5b /* [ */) {
      let j = i + 2;
      let isSgr = false;
      while (j < text.length) {
        const c = text.charCodeAt(j);
        if (c === 0x6d /* m */) {
          isSgr = true;
          break;
        }
        if (!((c >= 0x30 && c <= 0x39) /* 0-9 */ || c === 0x3b /* ; */)) {
          break;
        }
        j++;
      }
      if (isSgr) {
        i = j + 1;
        continue;
      }
    }
    charCount++;
    i++;
  }
  return charCount === targetCharLen ? i : -1;
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
    /** 切片 9：光标对账次数（含成功与失败）。 */
    cprAuditCount: 0,
    /** 切片 9：光标对账失败次数（触发 freeze("cprAuditFail") 的次数）。 */
    cprMismatchCount: 0,
  };

  /**
   * 切片 9：预测光标位置——"队列全部入队后假设的"列/行坐标。
   *   • 起点：onPromptReady / 首次 onCursorPosition(Active) 时从 xterm.buffer.active 读取
   *   • 每次 char 入队 predictedCursor.col += charDisplayWidth(ch)
   *   • 每次 backspace / Ctrl+U / Ctrl+W 入队 predictedCursor.col -= 对应宽度
   *   • 命中转正不改 predictedCursor（入队时已前进）
   *   • freeze / reset / setEnabled(false) 清零
   * 不变量：真实光标列 = predictedCursor.col - totalRemainingEchoLength()
   * null 表示尚未初始化（Cold / Frozen / Disabled 状态 / 未获得真实光标起点）
   */
  private predictedCursor: { col: number; row: number } | null = null;

  /**
   * 切片 9：真实光标读取器（调用方注入）。返回 xterm 当前光标位置 (cursorX, cursorY)。
   * onPromptReady / 首次 onCursorPosition(Active) / Frozen→Active 时调用以获取起点。
   * null 表示未注入——selfCheck 默认场景 / 集成测试跳过光标对账。
   */
  private realCursorReader: (() => { col: number; row: number }) | null = null;

  /** 切片 9：光标对账 timer 句柄。Active / Frozen 下启用，Disabled 清理。 */
  private cprAuditTimer: ReturnType<typeof setInterval> | null = null;

  /** 切片 9：对账 tick 执行中的短暂保护标记，避免重入。 */
  private cprAuditPending = false;

  /** 队列超时阈值（毫秒）。队首入队超过此值仍未确认，触发 freeze("timeout") */
  private static readonly QUEUE_TIMEOUT_MS = 10_000;

  /**
   * SGR 序列剥离正则（切片 5）。仅用于 prompt 启发式判定时去掉颜色序列后做
   * 后缀匹配，屏幕写入路径完全不动。注意：String.prototype.replace 不使用
   * RegExp.lastIndex，static /g 实例可安全跨调用复用。
   */
  private static readonly SGR_STRIP_REGEX = /\x1b\[[\d;]*m/g;

  /**
   * 扩展 prompt 后缀字符集合（切片 5）。末尾必跟一个空格才算命中。
   * 包含 bash/zsh 默认 ($/#/>) + starship/p10k (❯/➜) + 其他常见 (λ/%/→)。
   */
  private static readonly PROMPT_TAIL_CHARS = new Set([
    "$", "#", ">", "❯", "➜", "λ", "%", "→",
  ]);

  /**
   * CSI 序列正则（切片 7.3）。匹配 \x1b[ + 参数（数字/分号/?）+ 最终字节（A-Z/a-z）。
   * 用于 isHeavyRedraw 扫描——排除 SGR（m 收尾）后剩余的非 m CSI 视为"光标定位/
   * 清屏/清行"等重绘信号。
   */
  private static readonly CSI_SEQUENCE_REGEX = /\x1b\[[\d;?]*([A-Za-z])/g;

  /**
   * 重绘阈值（切片 7.3）。单次 onRemoteOutput 中非 SGR CSI 数量 ≥ 此值时，
   * 视为 PROMPT_COMMAND 重绘类场景，整队回滚 + Frozen。
   * 阈值 5 来自 phase2-plan §4.3 方案 C；保守取值，简单命令 echo 不会触发，
   * 仅 PROMPT_COMMAND 一次性重画整行 prompt 的场景才会达到。
   */
  private static readonly HEAVY_REDRAW_THRESHOLD = 5;

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
        // 屏幕抹掉队尾那个 dim 字符（\b \b 的空格用普通色覆盖 dim）。
        // 切片 8：CJK 宽字符占 2 列，ANSI_UNDO_CHAR 重复 2 次；ASCII 重复 1 次。
        const removed = this.queue.pop()!;
        const width = charDisplayWidth(removed.char ?? "");
        this.term.write(ANSI_UNDO_CHAR.repeat(width));
        this.advancePredictedCursor(-width);
        // 出队尾部 char（已 pop），入队 backspace 消化项
        this.queue.push({
          seq: this.nextSeq++,
          kind: "backspace",
          // 双 echo 消化：远程会先回退掉那个字符的 echo，再回退格 echo。
          // 二者按字节顺序拼接即可。CJK 字符的远程退格 echo 也按 2 列重复。
          expectedEcho: removed.expectedEcho + ANSI_UNDO_CHAR.repeat(width),
          undoSequence: "",
          predictedAt: Date.now(),
        });
        continue;
      }

      if (!isPredictableChar(ch)) {
        // Ctrl+U 清行分支（切片 6，0x15）：必须在 isPredictableChar 之前，
        // 0x15 < 0x20 会被拒绝走 freeze 路径丢失预测能力。
        if (ch === "\x15") {
          // 守卫：队列空或含非 char 项（backspace/kill-line/kill-word）一律 freeze。
          // 保守原则：不处理"队列尾部混杂消化项"的复杂场景，等远程 echo 驱动。
          if (
            this.queue.length === 0 ||
            !this.queue.every((p) => p.kind === "char")
          ) {
            this.freeze("kill-line");
            return;
          }
          // 屏幕：抹掉所有 dim 字符（切片 8 按总显示宽度算 \b \b 重复，CJK 占 2 列）。
          // 收集被删字符的 echo（远程仍会回这些字节，已在路上无法取消）。
          // 守卫保证队列全是 char 项，expectedEcho 累加即等于字符串。
          let killedEcho = "";
          let totalWidth = 0;
          for (const p of this.queue) {
            killedEcho += p.expectedEcho;
            totalWidth += charDisplayWidth(p.char ?? "");
          }
          this.term.write(ANSI_UNDO_CHAR.repeat(totalWidth));
          this.advancePredictedCursor(-totalWidth);
          // 整队替换为单个 kill-line 消化项。
          // expectedEcho = 被删字符的 echo + 远程的"总列宽次" \b \b 退格回显。
          this.queue.length = 0;
          this.queue.push({
            seq: this.nextSeq++,
            kind: "kill-line",
            expectedEcho: killedEcho + ANSI_UNDO_CHAR.repeat(totalWidth),
            undoSequence: "",
            predictedAt: Date.now(),
          });
          continue;
        }

        // Ctrl+W 删词分支（切片 6，0x17）：标准 readline 行为——
        // 先跳过尾部连续空格，再删到上一空格（按 ASCII space 分词）。
        if (ch === "\x17") {
          if (
            this.queue.length === 0 ||
            !this.queue.every((p) => p.kind === "char")
          ) {
            this.freeze("kill-word");
            return;
          }
          // 守卫已保证队列里都是 char 项，char 字段必定存在；
          // undefined === " " 为 false 不影响逻辑（理论上不会出现）。
          let i = this.queue.length;
          // 1. 跳过尾部连续空格
          while (i > 0 && this.queue[i - 1].char === " ") i--;
          // 2. 跳过非空格字符（一个 word 长度）
          while (i > 0 && this.queue[i - 1].char !== " ") i--;
          const m = this.queue.length - i;
          if (m === 0) {
            // 兜底：队列非空但删 0 字符不应发生（守卫已排除 length=0），
            // 防御性 freeze 避免入队空 echo 项。
            this.freeze("kill-word");
            return;
          }
          // 屏幕：抹掉尾部 dim 字符（切片 8 按删除段总显示宽度算 \b \b 重复，CJK 占 2 列）。
          // 收集被删字符的 echo（远程 echo 仍会回这部分字节）。
          let killedEcho = "";
          let totalWidth = 0;
          for (let j = i; j < this.queue.length; j++) {
            killedEcho += this.queue[j].expectedEcho;
            totalWidth += charDisplayWidth(this.queue[j].char ?? "");
          }
          this.term.write(ANSI_UNDO_CHAR.repeat(totalWidth));
          this.advancePredictedCursor(-totalWidth);
          // 出队尾部 m 个 char，入队单个 kill-word 消化项。
          // expectedEcho = 被删字符的 echo + 远程的"总列宽次" \b \b 退格回显。
          this.queue.length = i;
          this.queue.push({
            seq: this.nextSeq++,
            kind: "kill-word",
            expectedEcho: killedEcho + ANSI_UNDO_CHAR.repeat(totalWidth),
            undoSequence: "",
            predictedAt: Date.now(),
          });
          continue;
        }

        // 切片 8：中文宽字符预测分支——CJK 字符占 2 列宽，与 ASCII 路径同构入队。
        // 位置约束：必须在 Ctrl+U/W 分支之后（0x15/0x17 也是 isPredictableChar=false
        // 但属行编辑，须先分流），freeze 之前（俄/希腊等非 CJK 非 ASCII 字符走
        // freeze 兜底，与阶段 1 行为一致）。
        if (isCJKWideChar(ch)) {
          if (this.queue.length >= this.opts.maxQueueSize) {
            return;
          }
          const p: Prediction = {
            seq: this.nextSeq++,
            kind: "char",
            char: ch,
            expectedEcho: ch,
            undoSequence: ANSI_UNDO_CHAR.repeat(2), // CJK 2 列宽
            predictedAt: Date.now(),
          };
          this.queue.push(p);
          this.metrics.predictionCount++;
          this.term.write(`${ANSI_DIM_ON}${ch}${ANSI_DIM_OFF}`);
          this.advancePredictedCursor(2); // 切片 9：CJK 2 列
          continue;
        }

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
      this.advancePredictedCursor(1); // 切片 9：ASCII 1 列
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

    // 切片 7.3：检测 PROMPT_COMMAND 重绘类场景（连续非 SGR CSI 序列堆积）。
    // 装了 OSC 133 的 shell 走 §A/B/C/D 信号已覆盖此类场景；本分支兜底裸 bash
    // + PROMPT_COMMAND，远程一次性重画整行 prompt 时整队回滚避免失配雪崩。
    if (this.isHeavyRedraw(remaining)) {
      return this.handleMismatch(remaining);
    }

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
          // 切片 8：echoLen 必须按 charDisplayWidth 算（CJK 字符占 2 列），
          // 而非 expectedEcho.length（UTF-16 长度对 BMP CJK 仍是 1，会算错列偏移）。
          const echoLen = charDisplayWidth(head.char ?? "");
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
        // 切片 6 提到 512：kill-line/word 项 expectedEcho 包含被删字符 echo +
        // \b \b × N（远程退格回显），最长可达 4 * maxQueueSize（默认 100）= 400，
        // 留余量到 512 避免长 Ctrl+U 触发误判。
        if (remaining.length > 512) {
          return this.handleMismatch(remaining);
        }
        this.pendingRemote = remaining;
        return "";
      }

      // 切片 7.1：SGR 剥离命中（alias 着色 / zsh-syntax-highlighting 等带色 echo）。
      // 严格相等失败时尝试剥离 SGR 后再 startsWith；屏幕仍写带色字节，着色不丢。
      // 仅对 char 项启用——backspace / kill-line / kill-word 的 expectedEcho 含
      // \b \b 等控制序列，远程 echo 不会带色，也不应走剥离路径。
      if (head.kind === "char") {
        const stripped = remaining.replace(PredictiveEcho.SGR_STRIP_REGEX, "");
        if (stripped.startsWith(head.expectedEcho)) {
          const consumed = consumeBytesWithSgrSkip(
            remaining,
            head.expectedEcho.length,
          );
          if (consumed < 0) {
            // 安全网：stripped startsWith 已确认有足够普通字符，理论不应到此。
            return this.handleMismatch(remaining);
          }
          const remoteConsumed = remaining.slice(0, consumed);
          remaining = remaining.slice(consumed);
          this.queue.shift();
          this.metrics.confirmCount++;
          // 与严格命中转正同构：写"远程带色字节"代替 expectedEcho 纯字符——
          // 关 dim 后远程 SGR 决定字符渲染，着色保留。光标偏移按"普通字符数"算
          // （SGR 序列不占屏幕格），所以 echoLen / offsetAfter 与原路径同义。
          // 切片 8：与严格命中分支同步——echoLen 必须按 charDisplayWidth 算
          // （CJK 字符占 2 列），不能用 expectedEcho.length（BMP CJK UTF-16 长度仍为 1）。
          const echoLen = charDisplayWidth(head.char ?? "");
          const offsetAfter = this.totalRemainingEchoLength();
          const totalBack = echoLen + offsetAfter;
          let seq = `\x1b[${totalBack}D${ANSI_DIM_OFF}${remoteConsumed}`;
          if (offsetAfter > 0) {
            seq += `\x1b[${offsetAfter}C`;
          }
          this.term.write(seq);
          if (this.strictRemaining > 0) this.strictRemaining--;
          continue;
        }
        // 剥离后是 expectedEcho 真前缀 → SGR 序列分包到达，缓存等下一波。
        // 与原部分匹配同构，复用 512 容量保护。
        if (
          stripped.length < head.expectedEcho.length &&
          head.expectedEcho.startsWith(stripped)
        ) {
          if (remaining.length > 512) {
            return this.handleMismatch(remaining);
          }
          this.pendingRemote = remaining;
          return "";
        }
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
    this.predictedCursor = null;
    this.stopCprAuditTimer();
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
    this.predictedCursor = null;
    this.stopCprAuditTimer();
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
    this.predictedCursor = null;
    this.state = "Cold";
  }

  /** OSC 133;B — prompt 打印完毕，可以接受用户输入命令。 */
  onPromptReady(): void {
    if (this.state === "Disabled") return;
    // OSC 133;B 是强信号，无需严格期
    this.promoteActive(0, this.realCursorReader?.() ?? null);
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
    this.predictedCursor = null;
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
   * CPR（Cursor Position Report）应答接收口。
   *
   * TerminalPage 在远程连接建立后保留一次 \x1b[6n 查询（切片 5 初始化兜底）。
   * 远端 PTY 把应答 \x1b[<row>;<col>R 经 SSH 通道回传，由 TerminalPage 注册的
   * CSI final='R' handler 解析后调用本方法。注意 ANSI CPR 坐标是 1-based，
   * 本方法会转换成 xterm buffer 使用的 0-based row/col。
   *
   * 切片 9 的周期对账不再向远端注入 \x1b[6n，改为直接读取 xterm buffer 光标，
   * 避免控制序列落入 shell/readline 输入流。
   *
   * 按 state 分流行为：
   *   • Cold（切片 5 路径）：单次应答即认定 prompt ready，进 Active + strictRemaining=5
   *   • Active（切片 9 对账）：对比 predictedCursor - totalRemainingEchoLength 与真实光标。
   *     一致 → 仅 cprAuditCount++ 不变 state；不一致 → cprMismatchCount++ + freeze。
   *     predictedCursor 为 null 时以真实光标作为起点初始化。
   *   • Frozen（切片 9 恢复）：若队列空则自动 Frozen→Active（对账隐式成功），
   *     predictedCursor 从真实光标设置；队列非空保持 Frozen（不可安全恢复）。
   *   • Disabled：忽略。
   */
  onCursorPosition(row: number, col: number): void {
    if (this.state === "Disabled") return;
    const actual = PredictiveEcho.fromCprPosition(row, col);

    // 切片 5 路径：Cold → Active 兜底（保留）
    if (this.state === "Cold") {
      this.promoteActive(5, actual);
      return;
    }

    // 切片 9：Active 状态对账
    if (this.state === "Active") {
      this.auditCursor(actual);
      return;
    }

    // 切片 9：Frozen 恢复路径
    if (this.state === "Frozen") {
      this.auditCursor(actual);
      return;
    }
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
    // 切片 9：清零预测光标，等下次 prompt 信号或 Frozen→Active 路径从真实光标重建
    this.predictedCursor = null;
    this.state = "Frozen";
  }

  /**
   * 切片 9：注入真实光标读取器。TerminalPage 传入后，onPromptReady / Active
   * 首次对账 / Frozen 恢复时会调用此函数获取 xterm 真实光标作为预测起点。
   * selfCheck 默认不注入——predictedCursor 保持 null，advancePredictedCursor
   * 作空操作，onCursorPosition Active 分支首次对账也以 null 为起点初始化。
   */
  setRealCursorReader(reader: () => { col: number; row: number }): void {
    this.realCursorReader = reader;
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
    queueKinds: ("char" | "backspace" | "kill-line" | "kill-word")[];
    predictedCursor: { col: number; row: number } | null;
    cprAuditPending: boolean;
    cprAuditTimerActive: boolean;
  } {
    return {
      state: this.state,
      queueSize: this.queue.length,
      pendingRemote: this.pendingRemote,
      nextSeq: this.nextSeq,
      strictRemaining: this.strictRemaining,
      queueKinds: this.queue.map((p) => p.kind),
      predictedCursor:
        this.predictedCursor === null ? null : { ...this.predictedCursor },
      cprAuditPending: this.cprAuditPending,
      cprAuditTimerActive: this.cprAuditTimer !== null,
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
    cprAuditCount: number;
    cprMismatchCount: number;
  } {
    const denom = this.metrics.confirmCount + this.metrics.mismatchCount;
    return {
      predictionCount: this.metrics.predictionCount,
      confirmCount: this.metrics.confirmCount,
      mismatchCount: this.metrics.mismatchCount,
      hitRate: denom === 0 ? null : this.metrics.confirmCount / denom,
      cprAuditCount: this.metrics.cprAuditCount,
      cprMismatchCount: this.metrics.cprMismatchCount,
    };
  }

  // ── 私有方法 ──

  /** 当前队列里所有未确认 char 项在屏幕上占据的总字符宽度。
   *  backspace 项屏幕占 0 格（入队时已 \b \b 抹掉），不计入。
   *  切片 8：CJK 字符占 2 列，按 charDisplayWidth 算；ASCII 字符占 1 列。 */
  private totalRemainingEchoLength(): number {
    let total = 0;
    for (const p of this.queue) {
      if (p.kind === "char") total += charDisplayWidth(p.char ?? "");
    }
    return total;
  }

  /** ANSI CPR 使用 1-based row/col；xterm buffer 使用 0-based cursorX/cursorY。 */
  private static fromCprPosition(row: number, col: number): { col: number; row: number } {
    return {
      col: Math.max(0, col - 1),
      row: Math.max(0, row - 1),
    };
  }

  /** 统一 Active 入口，确保所有路径都初始化预测光标并启动对账 timer。 */
  private promoteActive(strictRemaining: number, cursor: { col: number; row: number } | null): void {
    this.state = "Active";
    this.strictRemaining = strictRemaining;
    if (cursor !== null) {
      this.predictedCursor = { ...cursor };
    }
    this.startCprAuditTimer();
  }

  /** 切片 9：使用 xterm 0-based 真实光标执行一次对账或 Frozen 恢复。 */
  private auditCursor(actual: { col: number; row: number }): void {
    if (this.state === "Active") {
      this.cprAuditPending = false;
      this.metrics.cprAuditCount++;
      if (this.predictedCursor === null) {
        this.predictedCursor = { ...actual };
        return;
      }
      const expectedRealCol = this.predictedCursor.col - this.totalRemainingEchoLength();
      if (
        expectedRealCol < 0 ||
        actual.col !== expectedRealCol ||
        actual.row !== this.predictedCursor.row
      ) {
        this.metrics.cprMismatchCount++;
        this.freeze("cprAuditFail");
      }
      return;
    }

    if (this.state === "Frozen") {
      this.cprAuditPending = false;
      if (this.queue.length === 0) {
        this.promoteActive(5, actual);
      }
    }
  }

  /**
   * 切片 9：预测光标列方向平移。入队 dim 字符时 delta=+width，退格/Ctrl+U/W 时 delta=-width。
   * predictedCursor 为 null（尚未从真实光标初始化）时静默忽略——等下一次
   * onPromptReady / onCursorPosition(Active) 设置起点后才开始追踪。
   * 本方法只修改 col；row 由 CPR 应答重置（阶段范围内不处理跨行换行）。
   */
  private advancePredictedCursor(delta: number): void {
    if (this.predictedCursor === null) return;
    this.predictedCursor = {
      col: this.predictedCursor.col + delta,
      row: this.predictedCursor.row,
    };
  }

  /**
   * 切片 9：启动光标周期对账 timer。幂等——重复调用不会启动多个 timer。
   * 仅在 realCursorReader 已注入时启动。每次 tick：
   *   • cprAuditPending 为 true（上一轮仍在执行）→ 跳过本次
   *   • state 为 Disabled / Cold → 跳过（Cold 由切片 5 一次性 CPR 驱动）
   *   • 其他情况 → 读取 xterm 真实光标并走同一套对账/恢复逻辑
   */
  private startCprAuditTimer(): void {
    if (this.cprAuditTimer !== null) return;
    if (this.realCursorReader === null) return;
    this.cprAuditTimer = setInterval(() => {
      if (this.cprAuditPending) return;
      if (this.state === "Disabled") return;
      if (this.state === "Cold") return;
      this.cprAuditPending = true;
      const cursor = this.realCursorReader?.();
      if (cursor === undefined) {
        this.cprAuditPending = false;
        return;
      }
      this.auditCursor(cursor);
    }, this.opts.cprAuditIntervalMs);
  }

  /** 切片 9：停止光标周期对账 timer 并清零 cprAuditPending。 */
  private stopCprAuditTimer(): void {
    if (this.cprAuditTimer !== null) {
      clearInterval(this.cprAuditTimer);
      this.cprAuditTimer = null;
    }
    this.cprAuditPending = false;
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
   * 弱启发式 prompt 检测（切片 3 引入；切片 5 扩展）。仅在 Cold 状态、队列空、
   * 远程 text 剥离 SGR 颜色序列后末尾形如 "<C> " 时（C ∈ PROMPT_TAIL_CHARS，
   * 含 $/#/>/❯/➜/λ/%/→）把状态提升为 Active，并设置严格期 strictRemaining=5。
   *
   * 保守原则：
   *   • 只做 Cold→Active，不动 Frozen→Active（避免错预测扩散）
   *   • OSC 133 是更强的信号，外部已经调 onPromptReady() 时本路径不会触发
   *     （state 已经是 Active）
   *   • 文档已警告启发式可能误判（如 prompt 字符出现在命令输出尾部）。配合
   *     严格期 + 失配 freeze，单次误判最多带来一次 freeze、视觉略抖一下，
   *     不影响功能正确性。
   *
   * 切片 5 扩展点：
   *   • 先 replace(SGR_STRIP_REGEX, "") 去掉 SGR 颜色序列，带色 prompt 也能命中
   *   • 后缀字符从 3 个 ($/#/>) 扩展到 8 个，覆盖 starship/p10k/fish 常见样式
   *   • strictRemaining 由 3 提升到 5（模式更松，需要更长严格期）
   */
  /**
   * 切片 7.3：检测 text 是否构成"重绘类"输出。
   * 标准：单次 text 中非 SGR CSI 序列（光标定位 H/A/B/C/D、清屏 J、清行 K 等，
   * 排除 m 收尾的 SGR 颜色序列）数量 ≥ HEAVY_REDRAW_THRESHOLD。
   *
   * 触发后调用方应整队回滚 + Frozen——PROMPT_COMMAND 一次性重画整行 prompt
   * 的场景不可能与队首 expectedEcho 字节序匹配，逐字节比对必然失配雪崩，
   * 不如直接回滚一次。
   *
   * 误判风险：
   *   • SGR 着色场景（如 ls --color）含 m 收尾的 CSI，本算法显式排除，不触发
   *   • zsh autosuggest 撤销+重 echo 单轮含 1-2 个非 SGR CSI（CSI K 等），
   *     不会触达阈值 5
   *   • vim/less 等 alt screen 已由切片 1 alt screen handler 提前 freeze，
   *     不会到 onRemoteOutput 命中分支
   */
  private isHeavyRedraw(text: string): boolean {
    let nonSgrCount = 0;
    PredictiveEcho.CSI_SEQUENCE_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PredictiveEcho.CSI_SEQUENCE_REGEX.exec(text)) !== null) {
      if (m[1] !== "m") {
        nonSgrCount++;
        if (nonSgrCount >= PredictiveEcho.HEAVY_REDRAW_THRESHOLD) {
          PredictiveEcho.CSI_SEQUENCE_REGEX.lastIndex = 0;
          return true;
        }
      }
    }
    PredictiveEcho.CSI_SEQUENCE_REGEX.lastIndex = 0;
    return false;
  }

  private detectPromptHeuristic(text: string): void {
    if (this.state !== "Cold") return;
    // 切片 5：先剥离 SGR 颜色序列再做后缀匹配，避免带色 prompt 不命中
    const stripped = text.replace(PredictiveEcho.SGR_STRIP_REGEX, "");
    if (stripped.length < 2) return;
    const lastChar = stripped[stripped.length - 1];
    const secondLast = stripped[stripped.length - 2];
    if (lastChar === " " && PredictiveEcho.PROMPT_TAIL_CHARS.has(secondLast)) {
      this.promoteActive(5, this.realCursorReader?.() ?? null);
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
    this.predictedCursor = null;
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
    assert(pe._debugState().strictRemaining === 5, "T22: 严格期 strictRemaining=5");

    // 命中一次后 strictRemaining 递减
    pe.onUserInput("x");
    pe.onRemoteOutput("x");
    assert(pe._debugState().strictRemaining === 4, "T22: 命中一次 strictRemaining → 4");
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
    pe.onRemoteOutput("user@host:~$ "); // Cold → Active, strictRemaining=5
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

  // ── 切片 5 用例：Shell 兼容性扩展（启发式扩展 + CPR）──

  // T28: 含 SGR 的 prompt 剥离 SGR 后正确匹配
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    // \x1b[32m...\x1b[0m 是常见带色 PS1，剥离后是 "user@host:~$ "
    pe.onRemoteOutput("\x1b[32muser\x1b[0m@host:~$ ");
    assert(pe._debugState().state === "Active", "T28: SGR 剥离后启发式命中");
    assert(pe._debugState().strictRemaining === 5, "T28: strictRemaining=5");
  }

  // T29: 扩展字符 ❯ 触发（starship / p10k）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onRemoteOutput("~/project ❯ ");
    assert(pe._debugState().state === "Active", "T29: ❯ 末尾触发 Active");
    assert(pe._debugState().strictRemaining === 5, "T29: strictRemaining=5");
  }

  // T30: 其他扩展字符参数化覆盖
  {
    for (const tail of ["% ", "λ ", "→ ", "➜ ", "# ", "> "]) {
      const { term } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onRemoteOutput("xxx" + tail);
      assert(pe._debugState().state === "Active", `T30: "${tail}" 末尾触发 Active`);
    }
  }

  // T31: onCursorPosition 在 Cold 下触发 Cold → Active
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    assert(pe._debugState().state === "Cold", "T31: 初始 Cold");
    pe.onCursorPosition(1, 5);
    assert(pe._debugState().state === "Active", "T31: CPR 应答推到 Active");
    assert(pe._debugState().strictRemaining === 5, "T31: strictRemaining=5");
  }

  // T32: onCursorPosition 在 Frozen 下，切片 9 起 CPR 触发自动恢复（队列空时）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.freeze("manual");
    assert(pe._debugState().state === "Frozen", "T32: 进入 Frozen");
    pe.onCursorPosition(2, 10);
    assert(pe._debugState().state === "Active", "T32: 切片 9 Frozen+空队列 CPR 自动恢复 Active");
  }

  // T33: onCursorPosition 在 Active 下不重置 strictRemaining
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onRemoteOutput("user@host:~$ "); // Cold → Active, strictRemaining=5
    pe.onUserInput("x");
    pe.onRemoteOutput("x"); // 命中，strictRemaining=4
    assert(pe._debugState().state === "Active", "T33: 已 Active");
    assert(pe._debugState().strictRemaining === 4, "T33: 命中后 strictRemaining=4");
    pe.onCursorPosition(1, 1);
    // CPR 不应在 Active 下重置 strictRemaining 回 5
    assert(pe._debugState().state === "Active", "T33: 仍 Active");
    assert(pe._debugState().strictRemaining === 4, "T33: CPR 不重置 strictRemaining");
  }

  // T34: strictRemaining=5 命中 5 次后归零
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onRemoteOutput("user@host:~$ "); // strictRemaining=5
    for (let i = 0; i < 5; i++) {
      pe.onUserInput("x");
      pe.onRemoteOutput("x");
    }
    assert(pe._debugState().strictRemaining === 0, "T34: 命中 5 次后归零");
  }

  // T35: 边界 — 不触发的场景
  {
    // T35a: 单字符不触发
    {
      const { term } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onRemoteOutput("$");
      assert(pe._debugState().state === "Cold", "T35a: 单字符不触发");
    }
    // T35b: 仅 SGR（剥离后空）不触发
    {
      const { term } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onRemoteOutput("\x1b[0m\x1b[32m");
      assert(pe._debugState().state === "Cold", "T35b: 仅 SGR 不触发");
    }
    // T35c: 末尾非空格不触发
    {
      const { term } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onRemoteOutput("$$");
      assert(pe._debugState().state === "Cold", "T35c: 末尾非空格不触发");
    }
    // T35d: 倒数第二非 prompt 字符不触发
    {
      const { term } = makeMockTerm();
      const pe = new PredictiveEcho(term);
      pe.onRemoteOutput("ab ");
      assert(pe._debugState().state === "Cold", "T35d: 倒数第二非 prompt 字符不触发");
    }
  }

  // ==========================================================================
  // 切片 5 端到端场景测试（T36-T39）
  // 替代手测场景 A/B/C/D：从 prompt 字节流 → 用户敲键 → 远程 echo 回传 → 验证最终序列
  // ==========================================================================

  // T36（场景 A 等价 / G1 闭合）：裸 bash + 含 SGR 彩色 PS1 完整链路
  // 关键：SGR 重置码 \x1b[0m 在 "$ " 之后，切片 4 末尾 2 字节匹配会拿到 "0m" 失败；
  // 切片 5 剥离 SGR 后正确命中。
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);

    // 1. 远程 prompt 字节流到达（含 SGR 颜色，重置码在 "$ " 之后）
    const promptText = "\x1b[32muser@host\x1b[0m:~$ \x1b[0m";
    const r1 = pe.onRemoteOutput(promptText);
    assert(r1 === promptText, "T36: prompt 字节流原样透传给 xterm（不被预测层吃掉）");
    assert(
      pe._debugState().state === "Active",
      "T36: 切片 5 SGR 剥离后启发式命中 → Active",
    );
    assert(pe._debugState().strictRemaining === 5, "T36: 严格期 strictRemaining=5");

    // 2. 用户敲 ls — 预测入队 + dim 写入
    const beforeInput = writes.length;
    pe.onUserInput("ls");
    assert(pe._debugState().queueSize === 2, "T36: 队列入 2 项预测");
    const dimWrites = writes.slice(beforeInput);
    assert(
      dimWrites.length === 2 &&
        dimWrites[0] === "\x1b[2ml\x1b[22m" &&
        dimWrites[1] === "\x1b[2ms\x1b[22m",
      "T36: 用户敲 ls 屏幕立即写出 dim 序列",
    );

    // 3. 远程 echo "ls" 回传 — 命中转正色
    const r2 = pe.onRemoteOutput("ls");
    assert(r2 === "", "T36: echo 与预测一致，无剩余字节透传");
    assert(pe._debugState().queueSize === 0, "T36: 队列清空（全部确认）");
    assert(pe._debugState().state === "Active", "T36: 命中后仍保持 Active");

    // 4. metrics 验证 — hitRate=1
    const m = pe.getMetrics();
    assert(m.predictionCount === 2, "T36: predictionCount=2");
    assert(m.confirmCount === 2, "T36: confirmCount=2");
    assert(m.mismatchCount === 0, "T36: mismatchCount=0");
    assert(m.hitRate === 1, "T36: hitRate=100% — G1 闭合");
  }

  // T37（场景 B 等价 / G1 闭合）：starship 风格 prompt（❯ 扩展字符）完整链路
  // 关键：❯ 是切片 5 PROMPT_TAIL_CHARS 新增字符，切片 4 完全不识别。
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);

    // 1. starship 风格 prompt 字节流（含 ❯ 扩展字符）
    const promptText = "user@host ~ ❯ ";
    const r1 = pe.onRemoteOutput(promptText);
    assert(r1 === promptText, "T37: starship prompt 字节流原样透传");
    assert(
      pe._debugState().state === "Active",
      "T37: 切片 5 扩展字符 ❯ 触发 → Active",
    );

    // 2. 用户敲 ls — 立即出 dim
    const beforeInput = writes.length;
    pe.onUserInput("ls");
    const dimWrites = writes.slice(beforeInput);
    assert(
      dimWrites.length === 2 && dimWrites[0] === "\x1b[2ml\x1b[22m",
      "T37: dim 'l' 写入屏幕",
    );

    // 3. 远程 echo "ls" 命中
    const r2 = pe.onRemoteOutput("ls");
    assert(r2 === "", "T37: echo 命中无剩余");
    assert(pe._debugState().queueSize === 0, "T37: 队列清空");
    assert(pe.getMetrics().hitRate === 1, "T37: hitRate=100% — starship 路径闭合");
  }

  // T38（场景 C 等价 / 切片 5 误判保护）：扩展字符误判 → 严格期保护立即 Frozen
  // 关键：切片 5 启发式更宽松（如 "% " 也认为是 prompt），可能把命令输出误判为 prompt。
  // 验证 strictRemaining=5 严格期保护机制对扩展字符仍然有效。
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);

    // 1. 命令输出尾部形似 prompt（含切片 5 扩展字符 % ）
    //    现实场景：echo "Total: 100% " 或类似命令输出
    const fakePrompt = "Total: 100% ";
    pe.onRemoteOutput(fakePrompt);
    assert(
      pe._debugState().state === "Active",
      "T38: 启发式无法区分真假 prompt → 误判进 Active",
    );
    assert(
      pe._debugState().strictRemaining === 5,
      "T38: 严格期就位（保护机制）",
    );

    // 2. 用户敲 a — 预测入队（误判后果开始体现）
    const beforeInput = writes.length;
    pe.onUserInput("a");
    assert(pe._debugState().queueSize === 1, "T38: 误判期间预测照常入队");

    // 3. 远程实际不是 echo "a"，而是命令输出剩余字节 → 失配
    const fakeRemote = "Errors: 0";
    const r = pe.onRemoteOutput(fakeRemote);
    assert(
      pe._debugState().state === "Frozen",
      "T38: 严格期内首次失配立即切 Frozen（核心保护）",
    );
    assert(
      pe._debugState().strictRemaining === 0,
      "T38: 失配后 strictRemaining 归零",
    );
    assert(pe._debugState().queueSize === 0, "T38: 失配回滚清空队列");
    assert(r === fakeRemote, "T38: 失配后远程数据完整透传给 xterm");
    // 验证 dim 'a' 已被回滚（写入 \b \b 抹掉）
    const tail = writes.slice(beforeInput).join("");
    assert(tail.includes("\b \b"), "T38: 失配回滚序列 \\b \\b 写出");
  }

  // T39（场景 D 等价 / CPR 路径闭合）：onCursorPosition 替代 prompt 检测的兜底路径
  // 关键：不发任何 prompt 字节流，仅靠 CPR 应答让预测层进入 Active —
  // 这是切片 5 对"完全无法识别 prompt 的环境"的兜底。
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);

    // 1. 不发 prompt，CPR 应答到达（来自 \x1b[6n 查询响应）
    assert(pe._debugState().state === "Cold", "T39: 初始 Cold（无任何 prompt 信号）");
    pe.onCursorPosition(1, 5);
    assert(
      pe._debugState().state === "Active",
      "T39: CPR 应答单触发 Cold→Active（兜底路径）",
    );
    assert(pe._debugState().strictRemaining === 5, "T39: 严格期就位");

    // 2. 用户敲 a — 立即预测出 dim
    const beforeInput = writes.length;
    pe.onUserInput("a");
    assert(
      writes.slice(beforeInput).join("") === "\x1b[2ma\x1b[22m",
      "T39: dim 序列写入屏幕",
    );

    // 3. 远程 echo "a" 命中转正色
    const r = pe.onRemoteOutput("a");
    assert(r === "", "T39: echo 命中无剩余");
    assert(pe._debugState().queueSize === 0, "T39: 队列清空");
    assert(pe.getMetrics().hitRate === 1, "T39: hitRate=100% — CPR 兜底路径闭合");
  }

  // ── 切片 6 用例（Ctrl+U / Ctrl+W）──

  // T40: Ctrl+U 正常路径端到端
  // 入 abc → 队列 [char,char,char] → Ctrl+U → 队列 [kill-line]，屏幕 \b \b × 3
  // → 远程发 "abc\b \b\b \b\b \b" (15 字节: 3 char echo + 3 退格回显) → 命中
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("abc");
    const beforeKill = writes.length;
    pe.onUserInput("\x15"); // Ctrl+U
    assert(pe._debugState().queueSize === 1, "T40: Ctrl+U 后队列变 1 项");
    assert(
      pe._debugState().queueKinds.join(",") === "kill-line",
      "T40: 队列结构 [kill-line]",
    );
    assert(
      writes.slice(beforeKill).join("") === "\b \b\b \b\b \b",
      "T40: Ctrl+U 屏幕写 \\b \\b × 3 抹掉 dim 字符",
    );

    // 远程 echo = 被删字符 "abc"（已在路上）+ \b \b × 3 退格回显
    const passthrough = pe.onRemoteOutput("abc\b \b\b \b\b \b");
    assert(passthrough === "", "T40: 远程 echo 全部被消化");
    assert(pe._debugState().queueSize === 0, "T40: 队列清空");
    assert(pe._debugState().state === "Active", "T40: 状态保持 Active");
  }

  // T41: Ctrl+U 队列空 → freeze（保守）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    const before = writes.length;
    pe.onUserInput("\x15");
    assert(pe._debugState().state === "Frozen", "T41: Ctrl+U 队列空切 Frozen");
    assert(pe._debugState().queueSize === 0, "T41: 队列保持空");
    assert(writes.length === before, "T41: Ctrl+U 队列空时不写屏幕");
  }

  // T42: Ctrl+U 队列含 backspace 项 → freeze（保守）
  // 流程：a → 退格（队列 [backspace]）→ Ctrl+U
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    pe.onUserInput("\x7f"); // 队列 [backspace]
    assert(pe._debugState().queueSize === 1, "T42: 退格后队列 [backspace]");
    pe.onUserInput("\x15"); // Ctrl+U
    assert(pe._debugState().state === "Frozen", "T42: 队尾非 char 触发 freeze");
    assert(pe._debugState().queueSize === 0, "T42: freeze 清空队列");
  }

  // T43: Ctrl+W 正常路径端到端
  // 入 "ls foo" → 队列 6 char → Ctrl+W → 队列 [l,s,space,kill-word]，删 "foo"
  // → 远程 echo "ls foo\b \b\b \b\b \b" 一次性回 → 全部命中
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ls foo");
    const beforeW = writes.length;
    pe.onUserInput("\x17"); // Ctrl+W
    assert(pe._debugState().queueSize === 4, "T43: Ctrl+W 后队列剩 4 项");
    assert(
      pe._debugState().queueKinds.join(",") === "char,char,char,kill-word",
      "T43: 队列结构 [char,char,char,kill-word]（保留 'ls '）",
    );
    assert(
      writes.slice(beforeW).join("") === "\b \b\b \b\b \b",
      "T43: Ctrl+W 屏幕写 \\b \\b × 3 抹掉 'foo'",
    );

    const passthrough = pe.onRemoteOutput("ls foo\b \b\b \b\b \b");
    assert(passthrough === "", "T43: 远程 echo 全部被消化");
    assert(pe._debugState().queueSize === 0, "T43: 队列清空");
    assert(pe._debugState().state === "Active", "T43: 状态保持 Active");
  }

  // T44: Ctrl+W 跳尾空格删一词（标准 readline 行为）
  // 入 "ls foo  " (2 尾空格) → 队列 8 char → Ctrl+W → 删 "foo  " (M=5)
  // → 队列 [l,s,space,kill-word]
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ls foo  ");
    const beforeW = writes.length;
    pe.onUserInput("\x17");
    assert(pe._debugState().queueSize === 4, "T44: 跳尾空格后队列剩 4 项");
    assert(
      pe._debugState().queueKinds.join(",") === "char,char,char,kill-word",
      "T44: 队列结构 [char,char,char,kill-word]（保留 'ls '）",
    );
    assert(
      writes.slice(beforeW).join("") === "\b \b".repeat(5),
      "T44: 屏幕写 \\b \\b × 5（跳 2 尾空格 + 删 'foo' + 前空格）",
    );
  }

  // T45: Ctrl+W 队列无空格 → 删全队
  // 入 "ls" → 队列 [l,s] → Ctrl+W → 队列 [kill-word]
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ls");
    const beforeW = writes.length;
    pe.onUserInput("\x17");
    assert(pe._debugState().queueSize === 1, "T45: 删全队后剩 1 项");
    assert(
      pe._debugState().queueKinds.join(",") === "kill-word",
      "T45: 队列结构 [kill-word]",
    );
    assert(
      writes.slice(beforeW).join("") === "\b \b\b \b",
      "T45: 屏幕写 \\b \\b × 2 抹掉 'ls'",
    );
  }

  // T46: Ctrl+W 队列空 → freeze
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    const before = writes.length;
    pe.onUserInput("\x17");
    assert(pe._debugState().state === "Frozen", "T46: Ctrl+W 队列空切 Frozen");
    assert(pe._debugState().queueSize === 0, "T46: 队列保持空");
    assert(writes.length === before, "T46: Ctrl+W 队列空时不写屏幕");
  }

  // T47: Ctrl+W 队列含 backspace 项 → freeze
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    pe.onUserInput("\x7f"); // 队列 [backspace]
    pe.onUserInput("\x17"); // Ctrl+W
    assert(pe._debugState().state === "Frozen", "T47: 队尾非 char 触发 freeze");
    assert(pe._debugState().queueSize === 0, "T47: freeze 清空队列");
  }

  // T48: 连续 Ctrl+W → 第二次 freeze（队尾是 kill-word）
  // 入 "ab" → Ctrl+W (队列 [kill-word]) → Ctrl+W (队尾非 char → freeze)
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab");
    pe.onUserInput("\x17");
    assert(pe._debugState().queueSize === 1, "T48: 第一次 Ctrl+W 后 [kill-word]");
    assert(pe._debugState().state === "Active", "T48: 第一次仍 Active");
    pe.onUserInput("\x17");
    assert(pe._debugState().state === "Frozen", "T48: 第二次 Ctrl+W 触发 freeze");
    assert(pe._debugState().queueSize === 0, "T48: freeze 清空队列");
  }

  // T49: Ctrl+U 长队列分包到达（验证 D5 容量保护 512 不误判）
  // 入 80 个 'a' → Ctrl+U → kill-line 项 expectedEcho = "a"×80 + "\b \b"×80 = 320 字节
  // 远程分两包：先 200 字节（部分匹配缓存）→ 再 120 字节（完全命中）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a".repeat(80));
    pe.onUserInput("\x15");
    assert(pe._debugState().queueSize === 1, "T49: Ctrl+U 后 [kill-line]");

    const expected = "a".repeat(80) + "\b \b".repeat(80); // 320 字节
    // 第一包 200 字节 → 部分匹配（200 < 512 不触发容量保护）
    const r1 = pe.onRemoteOutput(expected.slice(0, 200));
    assert(r1 === "", "T49: 第一包部分匹配缓存，无剩余");
    assert(
      pe._debugState().pendingRemote.length === 200,
      "T49: pendingRemote 缓存 200 字节",
    );
    assert(pe._debugState().state === "Active", "T49: 部分匹配不切 Frozen");

    // 第二包 120 字节 → 拼接 200 + 120 = 320 完整命中
    const r2 = pe.onRemoteOutput(expected.slice(200));
    assert(r2 === "", "T49: 第二包命中无剩余");
    assert(pe._debugState().queueSize === 0, "T49: 队列清空");
    assert(pe._debugState().state === "Active", "T49: 命中后状态保持 Active");
  }

  // ── 切片 7.1：SGR 剥离命中（T50-T54）──

  // T50: SGR 剥离单字符命中 + 转正序列保留远程带色字节
  // alias 着色场景：远程 echo 把字符裹在 SGR 中
  // 注：命中只消费到字符末尾，紧跟的尾部 reset (\x1b[0m) 留在返回值里
  // 由调用方透传给 xterm（不破坏已渲染字符，且不影响后续 dim 入队）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("l");
    writes.length = 0; // 清掉 dim 入队的 write 记录，仅观察命中后转正序列
    const r = pe.onRemoteOutput("\x1b[31ml\x1b[0m");
    assert(r === "\x1b[0m", "T50: 命中消费到字符末尾，尾部 reset 透传给调用方");
    assert(pe._debugState().queueSize === 0, "T50: 命中后队列清空");
    assert(pe._debugState().state === "Active", "T50: 命中后保持 Active");
    const wrote = writes.join("");
    assert(
      wrote.includes("\x1b[31ml"),
      "T50: 转正序列保留远程带色起始 SGR + 字符",
    );
    assert(wrote.includes(ANSI_DIM_OFF), "T50: 转正序列含关 dim");
    assert(pe.getMetrics().confirmCount === 1, "T50: confirmCount=1");
  }

  // T51: SGR 剥离多字符连续命中（zsh-syntax-highlighting 风格）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("l");
    pe.onUserInput("s");
    // 远程把 ls 重新着色为红色
    const r = pe.onRemoteOutput("\x1b[31ml\x1b[0m\x1b[31ms\x1b[0m");
    // 两次命中各消费到字符末尾，最末尾的 \x1b[0m 留作返回值
    assert(r === "\x1b[0m", "T51: 多字符连续命中后尾部 reset 透传");
    assert(pe._debugState().queueSize === 0, "T51: 队列全部清空");
    assert(pe._debugState().state === "Active", "T51: 多字符命中后 Active");
    assert(pe.getMetrics().confirmCount === 2, "T51: 两次 confirm");
  }

  // T52: 严格相等优先（无 SGR 时走原命中路径）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    const r = pe.onRemoteOutput("a");
    assert(r === "", "T52: 严格相等命中无剩余");
    assert(pe._debugState().queueSize === 0, "T52: 队列清空");
    assert(pe.getMetrics().confirmCount === 1, "T52: confirmCount=1");
    assert(pe._debugState().state === "Active", "T52: 严格命中保持 Active");
  }

  // T53: SGR 剥离后仍失配 → handleMismatch + Frozen
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    // 远程是 X 不是 a，即使剥离 SGR 也不命中
    const r = pe.onRemoteOutput("\x1b[31mX\x1b[0m");
    assert(r.length > 0, "T53: 失配整队回滚有剩余字节传给调用方");
    assert(pe._debugState().state === "Frozen", "T53: 失配切 Frozen");
    assert(pe._debugState().queueSize === 0, "T53: 失配后队列清空");
    assert(pe.getMetrics().mismatchCount === 1, "T53: mismatchCount=1");
  }

  // T54: SGR 序列分包到达不误失配（剥离后是真前缀 → 缓存 pendingRemote）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    // 第一包仅 SGR，无字符 → stripped="" 是 "a" 的真前缀
    const r1 = pe.onRemoteOutput("\x1b[31m");
    assert(r1 === "", "T54: 纯 SGR 包缓存 pendingRemote");
    assert(pe._debugState().state === "Active", "T54: SGR 分包不切 Frozen");
    assert(
      pe._debugState().pendingRemote.length > 0,
      "T54: pendingRemote 缓存了 SGR 字节",
    );
    // 第二包字符 + 收尾 SGR → 拼接后剥离 SGR = "a" 完整命中
    const r2 = pe.onRemoteOutput("a\x1b[0m");
    // 命中消费 "\x1b[31m" + "a" = 8 字节，尾部 "\x1b[0m" 透传
    assert(r2 === "\x1b[0m", "T54: 拼接后命中，尾部 reset 透传");
    assert(pe._debugState().queueSize === 0, "T54: 命中后队列清空");
    assert(pe._debugState().state === "Active", "T54: 命中后保持 Active");
  }

  // ── 切片 7.2：autosuggest 灰色追加透传（T55-T57）──
  // 关键契约：autosuggest 追加字节由 onRemoteOutput 返回值透传给调用方写到 xterm，
  // 不被预测层吞掉。否则 zsh autosuggest 在开预测回显后会失效（用户敲字后看不到灰色建议）。
  // 设计上由 7.1 严格相等命中分支 + SGR 剥离命中分支自然支持，本组用例固化契约防回归。

  // T55: 严格相等命中后，autosuggest 灰色追加透传
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("g");
    // 远程 echo 'g'（命中）+ 灰色 ' it status'（autosuggest 追加）
    const r = pe.onRemoteOutput("g\x1b[90m it status\x1b[39m");
    // 命中消费 'g'（1 字节），剩余灰色建议透传
    assert(
      r === "\x1b[90m it status\x1b[39m",
      "T55: 严格命中后 autosuggest 字节透传给调用方",
    );
    assert(pe._debugState().queueSize === 0, "T55: 命中后队列清空");
    assert(pe._debugState().state === "Active", "T55: 命中后保持 Active");
    assert(pe.getMetrics().mismatchCount === 0, "T55: autosuggest 不计失配");
  }

  // T56: SGR 剥离命中后，autosuggest 灰色追加透传
  // 远程把命中字符也着色（zsh-syntax-highlighting）+ 追加 autosuggest
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("g");
    // 红色 g（命中）+ 灰色 ' push'（autosuggest）
    const r = pe.onRemoteOutput("\x1b[31mg\x1b[39m\x1b[90m push\x1b[39m");
    // 剥离命中消费到字符末尾（'\x1b[31mg' 共 6 字节），剩余 SGR + 灰色建议透传
    assert(
      r === "\x1b[39m\x1b[90m push\x1b[39m",
      "T56: 剥离命中后 autosuggest + 收尾 SGR 透传",
    );
    assert(pe._debugState().queueSize === 0, "T56: 命中后队列清空");
    assert(pe._debugState().state === "Active", "T56: 命中后保持 Active");
    assert(pe.getMetrics().mismatchCount === 0, "T56: 不计失配");
  }

  // T57: autosuggest 不影响后续预测（透传不破坏预测层状态）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("g");
    // 第一字符命中 + autosuggest 透传
    pe.onRemoteOutput("g\x1b[90m it\x1b[39m");
    assert(pe._debugState().state === "Active", "T57: 透传后仍 Active 可继续预测");
    // 用户继续敲第二字符
    pe.onUserInput("i");
    assert(pe._debugState().queueSize === 1, "T57: 后续预测正常入队");
    // 远程仅回 'i'（autosuggest 在用户敲字时被 zsh 撤销了，简化场景）
    const r2 = pe.onRemoteOutput("i");
    assert(r2 === "", "T57: 后续严格命中无剩余");
    assert(pe._debugState().queueSize === 0, "T57: 队列清空");
  }

  // ── 切片 7.3：PROMPT_COMMAND 重绘整队回滚（T58-T60）──

  // T58: 连续 5 个非 SGR CSI 触发 isHeavyRedraw → 整队回滚 + Frozen
  // 模拟裸 bash + PROMPT_COMMAND 一次性重画整行 prompt 的场景
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    // 5 个非 SGR CSI:清屏 J + 光标 H + 清行 K + 上移 A + 下移 B
    const heavy = "\x1b[2J\x1b[H\x1b[K\x1b[1A\x1b[1B";
    const r = pe.onRemoteOutput(heavy);
    assert(r === heavy, "T58: 重绘场景整段透传给调用方");
    assert(pe._debugState().state === "Frozen", "T58: 重绘触发 Frozen");
    assert(pe._debugState().queueSize === 0, "T58: 队列回滚清空");
    assert(pe.getMetrics().mismatchCount === 1, "T58: 计入 mismatch");
  }

  // T59: 4 个非 SGR CSI 不触发(< 阈值 5),走原失配路径
  // 验证阈值精确,边界场景不误判
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("a");
    // 4 个非 SGR CSI(刚好少于阈值 5)
    const lighter = "\x1b[K\x1b[1A\x1b[1B\x1b[1C";
    const r = pe.onRemoteOutput(lighter);
    // 不走 isHeavyRedraw,走严格相等失配路径
    assert(r.length > 0, "T59: < 阈值不触发重绘检测,走原失配路径");
    assert(pe._debugState().state === "Frozen", "T59: 失配仍切 Frozen");
  }

  // T60: SGR 着色场景含多个 m 收尾 CSI 不触发(显式排除 SGR)
  // 防回归:7.1 alias 着色场景不能被 7.3 误判为重绘
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("l");
    pe.onUserInput("s");
    // 双字符着色:含 4 个 SGR(m 收尾),不算重绘
    const colored = "\x1b[31ml\x1b[39m\x1b[31ms\x1b[39m";
    const r = pe.onRemoteOutput(colored);
    assert(r === "\x1b[39m", "T60: 着色多字符命中,尾部 reset 透传");
    assert(pe._debugState().queueSize === 0, "T60: 着色场景命中清空队列");
    assert(pe._debugState().state === "Active", "T60: 着色不被误判为重绘");
    assert(pe.getMetrics().confirmCount === 2, "T60: 两次 confirm");
    assert(pe.getMetrics().mismatchCount === 0, "T60: 着色不计 mismatch");
  }

  // ── 切片 8：中文 IME 协同（T61-T70）──

  // T61: 单汉字预测全程命中（与 T1 同构，但所有列宽计算按 2 列）
  // 入队 "中" → 队列 [char(中, 2col)] → 远程 echo "中"
  // shift 后队列空，echoLen=2，offsetAfter=0，totalBack=2
  //   命中转正序列 = "\x1b[2D\x1b[22m中"（无尾部光标右移）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中");
    assert(pe._debugState().queueSize === 1, "T61: 单汉字预测后队列 1 项");
    assert(
      pe._debugState().queueKinds.join(",") === "char",
      "T61: 队列结构 [char]",
    );
    assert(writes.length === 1, "T61: 入队阶段 term.write 调用 1 次");
    assert(writes[0] === "\x1b[2m中\x1b[22m", "T61: dim 包裹中文字符");

    const beforeHit = writes.length;
    const passthrough = pe.onRemoteOutput("中");
    assert(passthrough === "", "T61: 远程 echo 全部消化");
    assert(pe._debugState().queueSize === 0, "T61: 队列清空");
    assert(
      writes.slice(beforeHit).join("") === "\x1b[2D\x1b[22m中",
      "T61: 命中转正按 2 列回退（\\x1b[2D 而非 \\x1b[1D）",
    );
  }

  // T62: 多汉字 commit 一次性入队（compositionend 后 onData 一次给多字符）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中文测试");
    assert(pe._debugState().queueSize === 4, "T62: 多汉字 commit 队列 4 项");
    assert(
      pe._debugState().queueKinds.join(",") === "char,char,char,char",
      "T62: 4 项 char",
    );
    assert(writes.length === 4, "T62: 入队阶段 term.write 调用 4 次");
    assert(
      writes[0] === "\x1b[2m中\x1b[22m" &&
        writes[1] === "\x1b[2m文\x1b[22m" &&
        writes[2] === "\x1b[2m测\x1b[22m" &&
        writes[3] === "\x1b[2m试\x1b[22m",
      "T62: 每个汉字独立 dim 写入（顺序保持）",
    );
  }

  // T63: ASCII + CJK 混合（"ab中文" → 4 项入队，顺序与列宽混合）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ab中文");
    assert(pe._debugState().queueSize === 4, "T63: 混合 4 项入队");
    assert(writes.length === 4, "T63: 4 次 dim 写入");
    assert(
      writes[0] === "\x1b[2ma\x1b[22m" &&
        writes[1] === "\x1b[2mb\x1b[22m" &&
        writes[2] === "\x1b[2m中\x1b[22m" &&
        writes[3] === "\x1b[2m文\x1b[22m",
      "T63: ASCII 与 CJK 顺序保持",
    );
  }

  // T64: CJK 命中转正序列光标偏移按 2 列计算
  // 入队 "中文" → 远程 echo "中"（仅命中第一项）
  // shift 后队列 [文]，echoLen=2，offsetAfter=2，totalBack=4
  //   命中转正 = "\x1b[4D\x1b[22m中\x1b[2C"（关键：4D / 2C 而非 2D / 1C）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中文");
    const beforeHit = writes.length;

    const passthrough = pe.onRemoteOutput("中");
    assert(passthrough === "", "T64: 命中第一项后无剩余");
    assert(pe._debugState().queueSize === 1, "T64: 队列剩 1 项");
    assert(
      writes.slice(beforeHit).join("") === "\x1b[4D\x1b[22m中\x1b[2C",
      "T64: totalBack=4 (echoLen 2 + offsetAfter 2)，尾部 2C 回原位",
    );
  }

  // T65: CJK 失配整队回滚（每项 undoSequence = "\b \b\b \b" 6 字节）
  // 入队 "中文" → 远程 "X" 第一字符就失配 → 整队回滚
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中文");
    const beforeMismatch = writes.length;

    const passthrough = pe.onRemoteOutput("X");
    assert(passthrough === "X", "T65: 第一字符失配后 X 透传");
    assert(pe._debugState().state === "Frozen", "T65: 失配切 Frozen");
    assert(pe._debugState().queueSize === 0, "T65: 队列清空");
    assert(
      writes.slice(beforeMismatch).join("") === "\b \b\b \b\b \b\b \b",
      "T65: 两项 CJK 回滚 12 字节（每项 \\b \\b × 2，从队尾撤销）",
    );
  }

  // T66: CJK 退格预测（输入「中」+ \x7f）
  // 队列变 [backspace]，backspace.expectedEcho = "中" + "\b \b\b \b"
  // （远程实际 echo 中文字符 + 4 字节双退格回显）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中");
    const beforeBs = writes.length;
    pe.onUserInput("\x7f");
    assert(pe._debugState().queueSize === 1, "T66: 退格后队列 [backspace]");
    assert(
      pe._debugState().queueKinds.join(",") === "backspace",
      "T66: 队列结构 [backspace]",
    );
    assert(
      writes.slice(beforeBs).join("") === "\b \b\b \b",
      "T66: 退格屏幕写 \\b \\b × 2（按 CJK 2 列宽）",
    );

    // 远程 echo = 中文字符 echo + 4 字节退格回显
    const passthrough = pe.onRemoteOutput("中\b \b\b \b");
    assert(passthrough === "", "T66: 远程双 echo 全部消化");
    assert(pe._debugState().queueSize === 0, "T66: 队列清空");
  }

  // T67: CJK + Ctrl+U 清行
  // 队列 [char(中), char(文)] → \x15 → totalWidth=4，屏幕写 \b \b × 4
  // expectedEcho = "中文" + "\b \b" × 4 = 12 字节远程双退格回显
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("中文");
    const beforeKill = writes.length;
    pe.onUserInput("\x15");
    assert(pe._debugState().queueSize === 1, "T67: Ctrl+U 后队列 [kill-line]");
    assert(
      pe._debugState().queueKinds.join(",") === "kill-line",
      "T67: 队列结构 [kill-line]",
    );
    assert(
      writes.slice(beforeKill).join("") === "\b \b\b \b\b \b\b \b",
      "T67: Ctrl+U 屏幕写 \\b \\b × 4（CJK 总列宽 2+2=4）",
    );
  }

  // T68: 中文标点支持（U+3000-303F，「。」U+3002）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("。");
    assert(pe._debugState().queueSize === 1, "T68: 中文句号入队");
    assert(
      pe._debugState().queueKinds.join(",") === "char",
      "T68: 标点是 char 项",
    );
    assert(writes[0] === "\x1b[2m。\x1b[22m", "T68: 标点 dim 写入");

    const beforeHit = writes.length;
    pe.onRemoteOutput("。");
    assert(
      writes.slice(beforeHit).join("") === "\x1b[2D\x1b[22m。",
      "T68: 标点命中转正按 2 列回退",
    );
  }

  // T69: 全角符号支持（U+FF00-FF60，全角逗号「，」U+FF0C）
  {
    const { term, writes } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("，");
    assert(pe._debugState().queueSize === 1, "T69: 全角逗号入队");
    assert(
      pe._debugState().queueKinds.join(",") === "char",
      "T69: 全角符号是 char 项",
    );
    assert(writes[0] === "\x1b[2m，\x1b[22m", "T69: 全角符号 dim 写入");
  }

  // T70: 显式排除范围继续 freeze（半角片假名 U+FF71 / 俄文 U+0430）
  // 半角片假名仅 1 列宽，必须排除以避免列偏移误算；非 CJK 非 ASCII 同走 freeze
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("ｱ"); // U+FF71 半角片假名
    assert(pe._debugState().state === "Frozen", "T70a: 半角片假名 freeze");
    assert(pe._debugState().queueSize === 0, "T70a: 队列空（freeze）");
  }
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.onPromptReady();
    pe.onUserInput("а"); // U+0430 俄文 a
    assert(pe._debugState().state === "Frozen", "T70b: 俄文字符 freeze");
    assert(pe._debugState().queueSize === 0, "T70b: 队列空（freeze）");
  }

  // ── 切片 9 用例：光标对账（predictedCursor + 周期真实光标同步）──

  // T71: predictedCursor 入队跟踪（ASCII 每字符 +1 列）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    assert(
      pe._debugState().predictedCursor?.col === 10 &&
        pe._debugState().predictedCursor?.row === 5,
      "T71: onPromptReady 从 realCursorReader 读取起点 (10,5)",
    );
    pe.onUserInput("abc");
    assert(
      pe._debugState().predictedCursor?.col === 13 &&
        pe._debugState().predictedCursor?.row === 5,
      "T71: 输入 abc 后 predictedCursor 列前进到 13",
    );
  }

  // T72: 命中转正后 predictedCursor 不变（入队时已前进）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.onUserInput("abc");
    pe.onRemoteOutput("abc"); // 全部命中
    assert(
      pe._debugState().predictedCursor?.col === 13 &&
        pe._debugState().predictedCursor?.row === 5,
      "T72: 命中转正不改 predictedCursor，仍 (13,5)",
    );
    assert(pe._debugState().queueSize === 0, "T72: 命中后队列清空");
  }

  // T73: backspace 回退 predictedCursor 列
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.onUserInput("ab");
    assert(pe._debugState().predictedCursor?.col === 12, "T73: 输入 ab 后 col=12");
    pe.onUserInput("\x7f"); // 退格
    assert(pe._debugState().predictedCursor?.col === 11, "T73: 退格后 col=11");
  }

  // T74: CJK 入队按 2 列
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.onUserInput("中");
    assert(pe._debugState().predictedCursor?.col === 12, "T74: CJK 2 列，col 从 10→12");
  }

  // T75: onCursorPosition Cold→Active 路径未回归（切片 5 行为保留）
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    assert(pe._debugState().state === "Cold", "T75: 初始 Cold");
    pe.onCursorPosition(6, 21);
    assert(pe._debugState().state === "Active", "T75: Cold 下 CPR 推到 Active");
    assert(pe._debugState().strictRemaining === 5, "T75: strictRemaining=5");
    assert(
      pe._debugState().predictedCursor?.col === 20 &&
        pe._debugState().predictedCursor?.row === 5,
      "T75: CPR 1-based 坐标转换为 xterm 0-based (20,5)",
    );
  }

  // T76: Active 对账成功——真实光标 = predictedCursor.col - totalRemainingEchoLength
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.onUserInput("ab");
    // predictedCursor=(12,5), queue=[a,b] totalRemaining=2, 真实光标应在 (10,5)
    pe.onCursorPosition(6, 11);
    assert(pe._debugState().state === "Active", "T76: 对账成功保持 Active");
    assert(pe._debugState().queueSize === 2, "T76: 对账成功不动队列");
    assert(pe.getMetrics().cprAuditCount === 1, "T76: cprAuditCount++");
    assert(pe.getMetrics().cprMismatchCount === 0, "T76: 无对账失败");
  }

  // T77: Active 对账失败——真实光标位置错位 → freeze + cprMismatchCount++
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.onUserInput("ab"); // predictedCursor=(12,5) 预期真实光标 (10,5)
    pe.onCursorPosition(6, 12); // 真实光标在 (11,5)——错位 1
    assert(pe._debugState().state === "Frozen", "T77: 对账失败 freeze");
    assert(pe._debugState().queueSize === 0, "T77: freeze 清空队列");
    assert(pe.getMetrics().cprAuditCount === 1, "T77: cprAuditCount=1");
    assert(pe.getMetrics().cprMismatchCount === 1, "T77: cprMismatchCount=1");
    assert(
      pe._debugState().predictedCursor === null,
      "T77: freeze 清零 predictedCursor",
    );
  }

  // T78: Frozen + 队列空 → 对账成功自动恢复 Active
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.freeze("test"); // 进入 Frozen，队列空
    assert(pe._debugState().state === "Frozen", "T78 前置: Frozen");
    pe.onCursorPosition(6, 21);
    assert(pe._debugState().state === "Active", "T78: Frozen 队列空，对账成功恢复 Active");
    assert(
      pe._debugState().predictedCursor?.col === 20 &&
        pe._debugState().predictedCursor?.row === 5,
      "T78: predictedCursor 从真实光标初始化 (20,5)",
    );
    assert(pe._debugState().strictRemaining === 5, "T78: 严格期 strictRemaining=5");
  }

  // T79: Frozen + CPR 应答恢复时使用 1-based → 0-based 坐标
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term);
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    pe.freeze("test");
    pe.onCursorPosition(6, 11);
    assert(pe._debugState().cprAuditPending === false, "T79: Frozen 分支清 cprAuditPending");
    assert(
      pe._debugState().predictedCursor?.col === 10 &&
        pe._debugState().predictedCursor?.row === 5,
      "T79: Frozen 恢复坐标为 (10,5)",
    );
  }

  // T80: startCprAuditTimer 注入 realCursorReader 后启停正常
  {
    const { term } = makeMockTerm();
    const pe = new PredictiveEcho(term, { cprAuditIntervalMs: 30 });
    pe.setRealCursorReader(() => ({ col: 10, row: 5 }));
    pe.onPromptReady();
    assert(pe._debugState().cprAuditTimerActive, "T80: onPromptReady 启动 timer");
    // 关闭 timer 避免泄漏到后续用例
    pe.setEnabled(false);
    assert(
      pe._debugState().cprAuditTimerActive === false,
      "T80: setEnabled(false) 停止 timer",
    );
    assert(
      pe._debugState().predictedCursor === null,
      "T80: setEnabled(false) 清零 predictedCursor",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[PredictiveEcho selfCheck] ${allPass ? "PASS" : "FAIL"}\n${results.join("\n")}`,
  );
  return { passed: allPass, results };
}
