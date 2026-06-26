import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { FitAddon } from "@xterm/addon-fit";
import { PredictiveEcho } from "./predictiveEcho";
import { X, Plug, History, Search, SplitSquareHorizontal, SplitSquareVertical, XCircle, Zap, Trash2, Bookmark, FolderOpen, Star, Sparkles, Loader2, Square, Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_DANGEROUS_COMMANDS, isCommandDangerous } from "@/lib/constants";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import * as api from "@/lib/tauri";
import type { CommandHistoryItem, TerminalBookmark, WorkflowRecipe } from "@/types";
import { useT } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import { CommandAssist } from "./CommandAssist";
import { DEFAULT_COMMAND_ASSIST_MODE, type AssistPosition, type CommandAssistMode } from "./CommandAssist";
import { useCommandAssistStore } from "@/stores/commandAssist";
import { useWorkflowsStore } from "@/stores/workflows";
import { useMacroRunner } from "./hooks/useMacroRunner";
import { MacroQuickPanel } from "./components/MacroQuickPanel";
import { RemoteFilePicker } from "./RemoteFilePicker";
import { TerminalFileManagerDrawer } from "./TerminalFileManagerDrawer";
import { TerminalAiAssist } from "./TerminalAiAssist";
import { cleanSelectedPath, extractAbsolutePathFromSelection, inferCwdFromBuffer } from "./cwdInfer";
import { openQuickEditWindow } from "@/lib/quickEditWindow";
import { getRemoteDirPath, readQuickEditPickerDir, recordQuickEditPickerDir } from "@/lib/quickEditPickerDir";
import { recordQuickEditRecent } from "@/lib/quickEditRecent";
import "@xterm/xterm/css/xterm.css";

// Module-level TextEncoder singleton. TextEncoder is stateless and safe to
// share; constructing one per keystroke / per IPC write is wasted work on the
// hot input path.
const TEXT_ENCODER = new TextEncoder();
const FILE_MANAGER_DRAWER_TRANSITION_MS = 320;

/** Strip ANSI escape sequences and trim whitespace */
function cleanSelection(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function getPathName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteShellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

function getTrailingPrefixLength(text: string, pattern: string): number {
  const max = Math.min(text.length, pattern.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(pattern.slice(0, len))) {
      return len;
    }
  }
  return 0;
}

function getCommandAssistSlashPos(buffer: string): number {
  const slashPos = buffer.lastIndexOf("//");
  if (slashPos < 0) return -1;
  if (slashPos > 0 && buffer[slashPos - 1] === ":") return -1;
  if (slashPos + 2 < buffer.length && buffer[slashPos + 2] === "/") return -1;
  if (buffer.includes("\\\\")) return -1;
  return slashPos;
}

function filterMacroInternalChunk(
  text: string,
  macroOutputFilter: { runId: string } | null,
): { safeText: string; remain: string } {
  if (!macroOutputFilter) {
    return {
      safeText: text.replace(/stty -echo\r?\n?/g, "").replace(/stty echo\r?\n?/g, ""),
      remain: "",
    };
  }

  const tokenPrefix = `__MACRO_EC__:${macroOutputFilter.runId}:`;
  let sanitized = text
    .replace(/stty -echo\r?\n?/g, "")
    .replace(/stty echo\r?\n?/g, "")
    .replace(new RegExp(`${escapeRegex(tokenPrefix)}[^:\\s\\r\\n]+:\\d+\\r?\\n?`, "g"), "");

  let safeEnd = sanitized.length;
  const pendingTokenStart = sanitized.lastIndexOf(tokenPrefix);
  if (pendingTokenStart >= 0) {
    safeEnd = Math.min(safeEnd, pendingTokenStart);
  }

  const pendingTokenPrefixLength = getTrailingPrefixLength(sanitized, tokenPrefix);
  if (pendingTokenPrefixLength > 0) {
    safeEnd = Math.min(safeEnd, sanitized.length - pendingTokenPrefixLength);
  }

  return {
    safeText: sanitized.slice(0, safeEnd),
    remain: sanitized.slice(safeEnd),
  };
}

function TerminalInstance({
  tabId,
  sessionId,
  hostId,
  macroOutputFilter,
  termSettings,
  suspendResize = false,
  onFocusSession,
  onCwdChange,
}: {
  tabId: string;
  sessionId: string;
  hostId: string;
  macroOutputFilter?: { runId: string; stepId: string; displayCommand: string } | null;
  termSettings?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    fontLigatures?: boolean;
    foreground?: string;
    cursor?: string;
    cursorStyle?: "block" | "underline" | "bar";
    cursorWidth?: number;
    selectionBg?: string;
    bgSource?: string;
    bgColor?: string;
    bgImagePath?: string | null;
    bgOpacity?: number;
    bgBlur?: number;
    ansiColors?: Record<string, string>;
    dangerousCmdProtection?: boolean;
    disabledBuiltinCmds?: string[];
    customDangerousCommands?: string[];
  };
  suspendResize?: boolean;
  onFocusSession?: (sessionId: string, cwd: string | null) => void;
  onCwdChange?: (sessionId: string, cwd: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const predictiveEchoRef = useRef<PredictiveEcho | null>(null);
  const suspendResizeRef = useRef(suspendResize);
  const pendingResizeFitRef = useRef(false);
  const pendingResizeFrameRef = useRef<number | null>(null);
  const updateGeoRef = useRef<() => void>(() => {});
  const updateTabState = useTerminalStore((s) => s.updateTabState);
  const reconnectSession = useTerminalStore((s) => s.reconnectSession);
  const tabState = useTerminalStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.state,
  );
  const [reconnecting, setReconnecting] = useState(false);
  const cmdBufferRef = useRef<string>("");
  const dangerousCmdPendingRef = useRef(false);
  const sessionOutputDecoderRef = useRef(new TextDecoder());
  const macroFilterBufferRef = useRef("");
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  suspendResizeRef.current = suspendResize;
  const onFocusSessionRef = useRef(onFocusSession);
  onFocusSessionRef.current = onFocusSession;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const macroOutputFilterRef = useRef<{ runId: string; stepId: string; displayCommand: string } | null>(macroOutputFilter ?? null);
  macroOutputFilterRef.current = macroOutputFilter ?? null;
  const lastMacroDisplayKeyRef = useRef<string | null>(null);
  const termSettingsRef = useRef(termSettings);
  termSettingsRef.current = termSettings;
  const t = useT();
  // useT() returns a fresh closure on every render. We never want a translator
  // change to invalidate hot-path callbacks (checkAssistTrigger / Effect 2),
  // so we read it through a ref. Translation isn't on the keystroke fast path.
  const tRef = useRef(t);
  tRef.current = t;

  // Quick Edit picker（仅活动面板响应快捷键）
  const hostName = useTerminalStore((s) => s.tabs.find((tb) => tb.id === tabId)?.title) ?? "";
  const [picker, setPicker] = useState<{
    initialPath: string;
    prefilterFileName: string | null;
  } | null>(null);
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = picker !== null;
  const oscCwdRef = useRef<string | null>(null);
  const hostNameRef = useRef(hostName);
  hostNameRef.current = hostName;

  useEffect(() => {
    const handler = () => {
      const term = termRef.current;
      if (!term) return;
      if (pickerOpenRef.current) return;
      // 仅活动面板响应：当前 term DOM 必须拥有焦点（多面板下天然只有一个 term focus）
      const termEl = term.element;
      if (!termEl?.contains(document.activeElement)) return;

      const sel = term.getSelection();
      const cleaned = cleanSelectedPath(sel);
      const selectedAbsolutePath = extractAbsolutePathFromSelection(sel);

      // 选区是绝对路径，或命令片段中只有一个明确绝对路径 → 直接打开 Quick Edit
      if (selectedAbsolutePath) {
        void openQuickEditWindow({
          sessionId: sessionIdRef.current,
          hostId,
          hostName: hostNameRef.current,
          remotePath: selectedAbsolutePath,
        });
        recordQuickEditRecent({
          hostId,
          sessionId: sessionIdRef.current,
          remotePath: selectedAbsolutePath,
          fileName: getPathName(selectedAbsolutePath),
          updatedAt: Date.now(),
        });
        recordQuickEditPickerDir({
          hostId,
          sessionId: sessionIdRef.current,
          path: getRemoteDirPath(selectedAbsolutePath),
        });
        return;
      }

      // 否则推断 cwd 起点 + 弹文件选择器
      const cwd = oscCwdRef.current ?? inferCwdFromBuffer(term);
      const initialPath = cwd ?? readQuickEditPickerDir(sessionIdRef.current, hostId) ?? "/";

      // 选区是单一文件名（不含 / 与空白且长度合理）→ 用作预选高亮
      const looksLikeFileName =
        !!cleaned && !cleaned.includes("/") && !cleaned.includes(" ") && cleaned.length <= 256;
      const prefilter = looksLikeFileName ? cleaned : null;

      setPicker({ initialPath, prefilterFileName: prefilter });
    };
    window.addEventListener("terminal:open-quick-edit", handler);
    return () => window.removeEventListener("terminal:open-quick-edit", handler);
  }, [hostId]);

  useEffect(() => {
    if (!macroOutputFilter) {
      macroFilterBufferRef.current = "";
      lastMacroDisplayKeyRef.current = null;
      return;
    }

    const term = termRef.current;
    if (!term) return;

    const displayKey = `${macroOutputFilter.runId}:${macroOutputFilter.stepId}`;
    if (lastMacroDisplayKeyRef.current === displayKey) return;

    lastMacroDisplayKeyRef.current = displayKey;
    const displayText = macroOutputFilter.displayCommand.replace(/\r?\n/g, "\r\n");
    term.write(`${displayText}\r\n`);
  }, [macroOutputFilter]);

  // ── Command Assist state ──
  const [assistVisible, setAssistVisible] = useState(false);
  const [assistQuery, setAssistQuery] = useState("");
  const [assistEnabled, setAssistEnabled] = useState(false);
  const [assistMode, setAssistMode] = useState<CommandAssistMode>(DEFAULT_COMMAND_ASSIST_MODE);
  const [assistConfirmKey, setAssistConfirmKey] = useState<"tab" | "enter">("tab");
  const [assistPosition, setAssistPosition] = useState<AssistPosition>("bottom-left");
  // Cursor position relative to the terminal container (not screen)
  const [cursorPos, setCursorPos] = useState<{ col: number; row: number; charW: number; charH: number; offsetX: number; offsetY: number }>({ col: 0, row: 0, charW: 8, charH: 18, offsetX: 0, offsetY: 0 });
  const geoRef = useRef({ charW: 8, charH: 18, offsetX: 0, offsetY: 0 });
  const cursorRafRef = useRef<number | null>(null);
  // Re-entrancy guard for queued command-assist checks. Lets us coalesce
  // bursts of keystrokes into a single microtask-scheduled trigger check.
  const assistCheckScheduledRef = useRef(false);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [osType, setOsType] = useState<string | null>(null);
  const osTypeRef = useRef<string | null>(null);
  const assistVisibleRef = useRef(false);
  const composingRef = useRef(false);

  // Load command assist settings
  useEffect(() => {
    const load = async () => {
      try {
        const [enabled, modeVal, confirmKeyVal, positionVal] = await Promise.all([
          api.settingGet("commandAssist.enabled"),
          api.settingGet("commandAssist.mode"),
          api.settingGet("commandAssist.confirmKey"),
          api.settingGet("commandAssist.position"),
        ]);
        setAssistEnabled(enabled === "true");
        setAssistMode(modeVal === "slash" || modeVal === "listview" ? modeVal : DEFAULT_COMMAND_ASSIST_MODE);
        if (confirmKeyVal === "tab" || confirmKeyVal === "enter") {
          setAssistConfirmKey(confirmKeyVal);
        }
        if (positionVal === "bottom-left" || positionVal === "bottom-right" || positionVal === "follow-cursor") {
          setAssistPosition(positionVal);
        }
      } catch {
        // ignore
      }
    };
    load();

    // Listen for settings changes
    const handler = () => load();
    window.addEventListener("terminal:settings-changed", handler);
    return () => window.removeEventListener("terminal:settings-changed", handler);
  }, []);

  // Detect OS type after connection (delay to let shell stabilize)
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      api.systemDetect(sessionId).then((info) => {
        const distro = info.distro?.toLowerCase() ?? "";
        if (distro.includes("ubuntu") || distro.includes("debian")) {
          setOsType("ubuntu");
        } else if (distro.includes("centos") || distro.includes("rhel") || distro.includes("red hat") || distro.includes("fedora") || distro.includes("rocky") || distro.includes("alma")) {
          setOsType("centos");
        } else {
          setOsType(null);
        }
      }).catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [sessionId]);

  // Keep ref in sync
  useEffect(() => {
    assistVisibleRef.current = assistVisible;
  }, [assistVisible]);

  // Use ref for assistEnabled to avoid stale closure in onData
  const assistEnabledRef = useRef(assistEnabled);
  useEffect(() => {
    assistEnabledRef.current = assistEnabled;
  }, [assistEnabled]);

  const assistModeRef = useRef<CommandAssistMode>(assistMode);
  useEffect(() => {
    assistModeRef.current = assistMode;
  }, [assistMode]);

  const assistConfirmKeyRef = useRef(assistConfirmKey);
  useEffect(() => {
    assistConfirmKeyRef.current = assistConfirmKey;
  }, [assistConfirmKey]);

  useEffect(() => {
    osTypeRef.current = osType;
  }, [osType]);

  const closeAssist = useCallback(() => {
    assistVisibleRef.current = false;
    setAssistVisible(false);
    setAssistQuery("");
  }, []);

  const showAssistForQuery = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      closeAssist();
      return;
    }

    const result = useCommandAssistStore.getState().search(trimmed, osTypeRef.current, 0);
    if (result.total === 0) {
      closeAssist();
      return;
    }

    assistVisibleRef.current = true;
    const term = termRef.current;
    const { charW, charH, offsetX, offsetY } = geoRef.current;
    setAssistQuery(trimmed);
    setAssistVisible(true);
    if (term) {
      setCursorPos({
        col: term.buffer.active.cursorX,
        row: term.buffer.active.cursorY,
        charW, charH, offsetX, offsetY,
      });
    }
  }, [closeAssist]);

  // ── Command Assist: extract // trigger from buffer ──
  const checkAssistTrigger = useCallback((buffer: string) => {
    if (!assistEnabledRef.current) {
      // If disabled but user typed //, show one-time hint
      if (buffer.includes("//") && !buffer.includes("://") && !buffer.includes("///")) {
        const slashPos = buffer.lastIndexOf("//");
        const afterSlash = buffer.substring(slashPos + 2);
        if (afterSlash.length >= 1 && afterSlash.trim().length >= 1) {
          // Show hint toast once
          const hintShown = sessionStorage.getItem("commandAssist.hintShown");
          if (!hintShown) {
            sessionStorage.setItem("commandAssist.hintShown", "1");
            toast.info(tRef.current("commandAssist.enableHint"));
          }
        }
      }
      return;
    }

    if (assistModeRef.current === "listview") {
      if (buffer.includes("://") || buffer.includes("\\\\")) {
        closeAssist();
        return;
      }
      showAssistForQuery(buffer);
      return;
    }

    const slashPos = getCommandAssistSlashPos(buffer);
    if (slashPos < 0) {
      if (assistVisibleRef.current) {
        closeAssist();
      }
      return;
    }

    const afterSlash = buffer.substring(slashPos + 2);

    // Need at least 1 non-whitespace char after //
    if (afterSlash.length < 1 || afterSlash.trim().length < 1) {
      if (assistVisibleRef.current) {
        closeAssist();
      }
      return;
    }

    // Trigger!
    showAssistForQuery(afterSlash);
  }, [closeAssist, showAssistForQuery]);

  // Hold the latest checkAssistTrigger in a ref so Effect 2 (session I/O
  // bindings) doesn't have to depend on it. This keeps onData / onResize /
  // session:output listeners stable across re-renders.
  const checkAssistTriggerRef = useRef(checkAssistTrigger);
  checkAssistTriggerRef.current = checkAssistTrigger;

  // ── Command Assist: handle selection ──
  const handleAssistSelect = useCallback((command: string, id: string) => {
    const buffer = cmdBufferRef.current;
    const slashPos = getCommandAssistSlashPos(buffer);
    const isListView = assistModeRef.current === "listview";
    if (!isListView && slashPos < 0) return;

    // Slash mode replaces //query. ListView mode replaces the whole command line.
    const textToReplace = isListView ? buffer : buffer.substring(slashPos);

    // Send backspaces to erase the target text, then type the command.
    const encoder = TEXT_ENCODER;

    // Erase: send backspace for each char being replaced.
    const backspaces = "\x7f".repeat(textToReplace.length);
    const eraseBytes = Array.from(encoder.encode(backspaces));
    api.sessionWrite(sessionIdRef.current, eraseBytes).catch(() => {});

    // Type the command
    setTimeout(() => {
      const cmdBytes = Array.from(encoder.encode(command));
      api.sessionWrite(sessionIdRef.current, cmdBytes).catch(() => {});
    }, 20);

    // Update buffer
    cmdBufferRef.current = isListView ? command : buffer.substring(0, slashPos) + command;

    // Update weight — also update local store weight
    api.commandAssistWeightUpdate(id).catch(() => {});
    useCommandAssistStore.getState().updateLocalWeight(id);

    // Close assist
    closeAssist();
  }, [closeAssist]);

  const handleAssistClose = useCallback(() => {
    closeAssist();
  }, [closeAssist]);

  // Effect 1: Create xterm instance (once, independent of sessionId)
  useEffect(() => {
    if (!containerRef.current) return;

    const ts = termSettingsRef.current;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: (ts?.cursorStyle ?? "bar") as "block" | "underline" | "bar",
      cursorWidth: ts?.cursorWidth ?? 2,
      fontSize: ts?.fontSize ?? 14,
      fontFamily: ts?.fontFamily ?? "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontWeight: (ts?.fontWeight ?? 400) as any,
      lineHeight: ts?.lineHeight ?? 1.4,
      allowTransparency: true,
      allowProposedApi: true,
      theme: {
        background: ts?.bgSource === "image" && ts?.bgImagePath
          ? "#00000000"
          : (ts?.bgColor ?? "#0F1115"),
        foreground: ts?.foreground ?? "#E5E7EB",
        cursor: ts?.cursor ?? "#3B82F6",
        selectionBackground: ts?.selectionBg ?? "rgba(59, 130, 246, 0.3)",
        black: ts?.ansiColors?.black ?? "#1B2130",
        red: ts?.ansiColors?.red ?? "#EF4444",
        green: ts?.ansiColors?.green ?? "#22C55E",
        yellow: ts?.ansiColors?.yellow ?? "#F59E0B",
        blue: ts?.ansiColors?.blue ?? "#3B82F6",
        magenta: ts?.ansiColors?.magenta ?? "#A855F7",
        cyan: ts?.ansiColors?.cyan ?? "#06B6D4",
        white: ts?.ansiColors?.white ?? "#E5E7EB",
        brightBlack: ts?.ansiColors?.brightBlack ?? "#6B7280",
        brightRed: ts?.ansiColors?.brightRed ?? "#F87171",
        brightGreen: ts?.ansiColors?.brightGreen ?? "#4ADE80",
        brightYellow: ts?.ansiColors?.brightYellow ?? "#FBBF24",
        brightBlue: ts?.ansiColors?.brightBlue ?? "#60A5FA",
        brightMagenta: ts?.ansiColors?.brightMagenta ?? "#C084FC",
        brightCyan: ts?.ansiColors?.brightCyan ?? "#22D3EE",
        brightWhite: ts?.ansiColors?.brightWhite ?? "#F9FAFB",
      },
    });

    term.open(containerRef.current);

    const usesBgImage = ts?.bgSource === "image" && ts?.bgImagePath;
    const usesLigatures = ts?.fontLigatures === true;
    // WebGL renderer uses its own texture atlas for glyphs, bypassing CSS
    // font-feature-settings, so ligatures won't render under WebGL.
    if (!usesBgImage && !usesLigatures) {
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL fallback: DOM renderer is fine
      }
    }
    // xterm 6.x uses a DOM renderer by default. Enable ligatures by:
    // 1. Setting CSS font-feature-settings on the terminal element
    // 2. Registering a character joiner so multi-char ligatures are
    //    placed in the same DOM span (required for cross-element ligatures)
    // 3. Using MutationObserver to fix letter-spacing on joined spans
    //    (the DOM renderer adds letter-spacing for monospace alignment,
    //     but this breaks ligature glyphs by inserting space between chars)
    if (usesLigatures) {
      if (term.element) {
        term.element.style.fontFeatureSettings = '"calt" on';
      }
      const LIGATURE_PATTERNS = [
        "<---", "--->", "<-->", "<==>", "<===>",
        "<--", "-->", "<->", "<=>", "===>",
        "<==", "==>", "<<=", ">>=",
        "<<-", "->>",
        "===", "!==", "!===",
        "<-", "->", "<=", ">=", "=>",
        "==", "!=", "/=", "~=", "<>",
        "::", ":::", "<~~", "~~>",
        "</", "/>", "</>",
        "<:", ":=", "*=", "*+",
        "<*", "<*>", "*>",
        "<|", "<|>", "|>",
        "+*", "=*", "=:", ":>",
        "/*", "*/", "+++",
        "<!--", "<!---",
      ].sort((a, b) => b.length - a.length);

      const ligatureSet = new Set(LIGATURE_PATTERNS);

      term.registerCharacterJoiner((text: string) => {
        const ranges: [number, number][] = [];
        for (let i = 0; i < text.length; i++) {
          for (const pat of LIGATURE_PATTERNS) {
            if (text.startsWith(pat, i)) {
              ranges.push([i, i + pat.length]);
              i += pat.length - 1;
              break;
            }
          }
        }
        return ranges;
      });

      // Fix letter-spacing on joined spans: the DOM renderer adds
      // letter-spacing to the row container for monospace alignment, but for
      // ligature spans the extra spacing breaks the combined glyph.
      // We observe DOM mutations and reset letter-spacing to 0 on spans
      // whose text content matches a known ligature pattern.
      const rowsEl = term.element?.querySelector('.xterm-rows');
      if (rowsEl) {
        const fixLigatureSpans = (root: Element) => {
          const spans = root.getElementsByTagName('span');
          for (let i = 0; i < spans.length; i++) {
            const text = spans[i].textContent || '';
            if (text.length >= 2 && ligatureSet.has(text)) {
              spans[i].style.letterSpacing = '0px';
            }
          }
        };
        const observer = new MutationObserver(() => {
          fixLigatureSpans(rowsEl);
        });
        observer.observe(rowsEl, { childList: true, subtree: true, characterData: true });
        fixLigatureSpans(rowsEl);
      }
    }
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    const osc7Disposable = term.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data);
        if (url.protocol !== "file:") return false;
        const decodedPath = decodeURIComponent(url.pathname);
        if (decodedPath.startsWith("/")) {
          oscCwdRef.current = decodedPath;
          onCwdChangeRef.current?.(sessionIdRef.current, decodedPath);
          return true;
        }
      } catch {
        // Ignore malformed OSC 7 payloads from remote shells.
      }
      return false;
    });

    // OSC 133 — shell prompt / command boundary signals (FinalTerm spec).
    // We never consume the sequence (return false) so xterm continues normal
    // processing. Only the first character matters (A/B/C/D); some shells
    // append extra fields (e.g. "D;0"), which we ignore.
    const osc133Disposable = term.parser.registerOscHandler(133, (data) => {
      const marker = data.charAt(0);
      const pe = predictiveEchoRef.current;
      if (pe) {
        switch (marker) {
          case "A": pe.onPromptStart(); break;
          case "B": pe.onPromptReady(); break;
          case "C": pe.onCommandStart(); break;
          case "D": pe.onCommandEnd(); break;
        }
      }
      return false;
    });

    // CSI ?{1049,1047,47}{h,l} — alternate screen toggles.
    // We don't consume (return false) so xterm continues to switch the buffer
    // normally; we only forward the signal to PredictiveEcho so it can freeze
    // before vim/less/tmux paint over the predicted dim characters.
    const isAltScreenParam = (p: number | number[]): boolean => {
      const n = Array.isArray(p) ? p[0] : p;
      return n === 1049 || n === 1047 || n === 47;
    };
    const csiAltEnterDisposable = term.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      (params) => {
        if (params.length > 0 && isAltScreenParam(params[0])) {
          predictiveEchoRef.current?.onAlternateScreenEnter();
        }
        return false;
      },
    );
    const csiAltLeaveDisposable = term.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      (params) => {
        if (params.length > 0 && isAltScreenParam(params[0])) {
          predictiveEchoRef.current?.onAlternateScreenLeave();
        }
        return false;
      },
    );

    // CSI <row>;<col>R — Cursor Position Report 应答（响应 \x1b[6n 查询）。
    // 切片 5：远程连接建立时注入一次 \x1b[6n，远端 PTY 把应答 \x1b[<row>;<col>R
    // 经 SSH 通道回传到这里。我们消费（return true）避免应答字面写到屏幕；
    // 解析出的 row/col 转给 PredictiveEcho.onCursorPosition，在 Cold 状态下
    // 推到 Active。
    const csiCprDisposable = term.parser.registerCsiHandler(
      { final: "R" },
      (params) => {
        const first = params.length > 0 ? params[0] : 0;
        const second = params.length > 1 ? params[1] : 0;
        const toNum = (v: number | number[]): number =>
          typeof v === "number" ? v : Array.isArray(v) && v.length > 0 ? (v[0] ?? 0) : 0;
        predictiveEchoRef.current?.onCursorPosition(toNum(first), toNum(second));
        return true;
      },
    );

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    // Predictive Echo: bind to xterm lifecycle. The instance is always created
    // (cheap) so OSC 133 / session:output hooks can reference predictiveEchoRef
    // without null-guard explosions; setEnabled(false) puts it in Disabled
    // state where every public method is a no-op.
    //
    // The flag lives in the persistent settings store under
    // `terminal.predictiveEcho.enabled` and is mirrored across all open
    // terminals via the `terminal:settings-changed` event the settings page
    // dispatches on toggle. We start Disabled and flip once the async read
    // resolves — persisted `false` stays off, missing values fall back to the
    // M1 default-on behavior without ever becoming optimistically Active.
    const pe = new PredictiveEcho(term);
    predictiveEchoRef.current = pe;
    pe.setEnabled(false);
    pe.setRealCursorReader(() => ({
      col: term.buffer.active.cursorX,
      row: term.buffer.active.cursorY,
    }));

    const loadPredictiveEcho = async () => {
      try {
        const v = await api.settingGet("terminal.predictiveEcho.enabled");
        pe.setEnabled(v !== "false");
      } catch {
        // Read failure → stay Disabled. Safer than silently enabling an
        // experimental feature when storage is unhappy.
      }
    };
    void loadPredictiveEcho();
    const handlePredictiveEchoChanged = () => {
      void loadPredictiveEcho();
    };
    window.addEventListener("terminal:settings-changed", handlePredictiveEchoChanged);

    // Dev-only metrics dump: log accumulated counters once a minute. The
    // `import.meta.env.DEV` check is statically resolved by Vite, so the entire
    // block (timer + handle) gets dead-code-eliminated in production builds.
    let predictiveEchoMetricsTimer: ReturnType<typeof setInterval> | null = null;
    if (import.meta.env.DEV) {
      predictiveEchoMetricsTimer = setInterval(() => {
        const m = predictiveEchoRef.current?.getMetrics();
        // Skip when nothing happened — keeps the dev console quiet during idle.
        if (!m || m.predictionCount === 0) return;
        const rate = m.hitRate === null ? "n/a" : `${(m.hitRate * 100).toFixed(1)}%`;
        // eslint-disable-next-line no-console
        console.debug(
          `[PredictiveEcho] predictions=${m.predictionCount} confirms=${m.confirmCount} mismatches=${m.mismatchCount} hitRate=${rate}`,
        );
      }, 60_000);
    }

    fitAddon.fit();
    const handleTermFocus = () => {
      onFocusSessionRef.current?.(sessionIdRef.current, oscCwdRef.current ?? inferCwdFromBuffer(term));
    };
    term.element?.addEventListener("focusin", handleTermFocus);
    const updateGeo = () => {
      if (!containerRef.current || !term.element) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const termRect = term.element.getBoundingClientRect();
      geoRef.current = {
        charW: termRect.width / term.cols,
        charH: termRect.height / term.rows,
        offsetX: termRect.left - containerRect.left,
        offsetY: termRect.top - containerRect.top,
      };
    };
    updateGeoRef.current = updateGeo;
    const resizeObserver = new ResizeObserver((entries) => {
      // Skip fit when container is hidden (width/height = 0) to avoid
      // sending bogus resize sequences that show up as visible characters
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      if (suspendResizeRef.current) {
        pendingResizeFitRef.current = true;
        return;
      }
      try { fitAddon.fit(); } catch { /* ignore if disposed */ }
      setContainerSize({ w: width, h: height });
      updateGeo();
    });
    resizeObserver.observe(containerRef.current);

    const handleClear = () => {
      term.clear();
    };
    window.addEventListener("terminal:clear", handleClear);

    term.focus();

    return () => {
      resizeObserver.disconnect();
      term.element?.removeEventListener("focusin", handleTermFocus);
      window.removeEventListener("terminal:clear", handleClear);
      window.removeEventListener("terminal:settings-changed", handlePredictiveEchoChanged);
      if (predictiveEchoMetricsTimer !== null) clearInterval(predictiveEchoMetricsTimer);
      osc7Disposable.dispose();
      osc133Disposable.dispose();
      csiAltEnterDisposable.dispose();
      csiAltLeaveDisposable.dispose();
      csiCprDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      predictiveEchoRef.current = null;
      updateGeoRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (suspendResize || !pendingResizeFitRef.current) return;
    pendingResizeFitRef.current = false;
    if (pendingResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingResizeFrameRef.current);
    }
    pendingResizeFrameRef.current = window.requestAnimationFrame(() => {
      pendingResizeFrameRef.current = null;
      const container = containerRef.current;
      const fitAddon = fitAddonRef.current;
      if (!container || !fitAddon) return;
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      try { fitAddon.fit(); } catch { /* ignore if disposed */ }
      setContainerSize({ w: width, h: height });
      updateGeoRef.current();
    });
  }, [suspendResize]);

  useEffect(() => {
    return () => {
      if (pendingResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingResizeFrameRef.current);
        pendingResizeFrameRef.current = null;
      }
    };
  }, []);

  // Effect 2: Bind session I/O (re-runs when sessionId changes, keeps xterm alive)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    sessionOutputDecoderRef.current = new TextDecoder();
    macroFilterBufferRef.current = "";
    // Predictive Echo: clear queue and return to Cold so a stale prediction
    // from the previous session can't bleed into the new one.
    predictiveEchoRef.current?.reset();

    // Handle user input -> SSH
    const onData = term.onData((data) => {
      // Block all input while dangerous command dialog is pending
      if (dangerousCmdPendingRef.current) return;

      // Skip if IME is composing
      if (composingRef.current) return;

      const sid = sessionIdRef.current;

      let pendingCommand = "";

      // Process each character for command history buffering
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          // If assist is visible and confirmKey is enter, don't send enter to terminal
          // (handled by CommandAssist keydown handler)
          if (assistVisibleRef.current && assistConfirmKeyRef.current === "enter") {
            return;
          }
          pendingCommand = cmdBufferRef.current.trim();
          if (pendingCommand.length > 0) {
            api.commandHistoryInsert(sid, hostId, pendingCommand).then(() => {
              window.dispatchEvent(new Event("command-history-updated"));
            }).catch(() => {});
          }
          cmdBufferRef.current = "";
          // Close assist on enter
          if (assistVisibleRef.current) {
            closeAssist();
          }
        } else if (ch === "\x7f" || ch === "\b") {
          cmdBufferRef.current = cmdBufferRef.current.slice(0, -1);
        } else if (ch === "\x03") {
          cmdBufferRef.current = "";
          // Close assist on Ctrl+C
          if (assistVisibleRef.current) {
            closeAssist();
          }
        } else if (ch === "\t") {
          // If assist is visible and confirmKey is tab, don't send tab to terminal
          // (handled by CommandAssist keydown handler)
          if (assistVisibleRef.current && assistConfirmKeyRef.current === "tab") {
            return;
          }
        } else if (ch === "\x1b") {
          // Esc — close assist if visible
          if (assistVisibleRef.current) {
            closeAssist();
            return;
          }
        } else if (ch.charCodeAt(0) >= 32) {
          cmdBufferRef.current += ch;
        }
      }

      // Check dangerous command protection
      const ts = termSettingsRef.current;
      if (pendingCommand && ts?.dangerousCmdProtection) {
        const disabled = new Set(ts.disabledBuiltinCmds ?? []);
        const patterns = [
          ...DEFAULT_DANGEROUS_COMMANDS.filter((c) => !disabled.has(c)),
          ...(ts.customDangerousCommands ?? []),
        ];
        if (patterns.length && isCommandDangerous(pendingCommand, patterns)) {
            dangerousCmdPendingRef.current = true;
            confirm({
              title: t("settings.cmdConfirmTitle"),
              description: t("settings.cmdConfirmDesc").replace("{cmd}", pendingCommand),
            }).then((ok) => {
              dangerousCmdPendingRef.current = false;
              if (ok) {
                const encoder = TEXT_ENCODER;
                const bytes = Array.from(encoder.encode(data));
                api.sessionWrite(sid, bytes).catch((err) => toast.error(String(err)));
              } else {
                api.sessionWrite(sid, [3]).catch(() => {});
              }
            });
            return;
          }
       }

      const encoder = TEXT_ENCODER;
      const bytes = Array.from(encoder.encode(data));
      api.sessionWrite(sid, bytes).catch((err) => toast.error(String(err)));

      // Command-assist trigger check: slash mode keeps the existing // fast
      // path; ListView mode checks ordinary command buffers locally so the
      // suggestion list doesn't wait for remote echo.
      const buf = cmdBufferRef.current;
      const shouldCheckAssist =
        assistVisibleRef.current ||
        (assistModeRef.current === "listview"
          ? assistEnabledRef.current && buf.trim().length > 0
          : buf.indexOf("//") >= 0);
      if (
        !assistCheckScheduledRef.current &&
        shouldCheckAssist
      ) {
        assistCheckScheduledRef.current = true;
        queueMicrotask(() => {
          assistCheckScheduledRef.current = false;
          checkAssistTriggerRef.current(cmdBufferRef.current);
        });
      }

      // Predictive Echo: hook in only on the "normal input" path, after all
      // business short-circuits (IME / dangerous cmd dialog / assist enter or
      // tab takeover / Esc-closes-assist) have already returned. Predicts
      // visible chars locally for instant feedback; control chars (Enter/
      // ESC/Tab/Ctrl) trigger freeze inside PredictiveEcho.
      predictiveEchoRef.current?.onUserInput(data);
    });

    // Handle resize -> SSH (skip when container is hidden)
    const onResize = term.onResize(({ cols, rows }) => {
      if (cols <= 1 || rows <= 1) return;
      api.sessionResize(sessionIdRef.current, cols, rows).catch(() => {});
    });

    // Track cursor movement for follow-cursor command assist positioning
    const onCursorMove = term.onCursorMove(() => {
      if (!assistVisibleRef.current) return;
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null;
        const { charW, charH, offsetX, offsetY } = geoRef.current;
        setCursorPos({
          col: term.buffer.active.cursorX,
          row: term.buffer.active.cursorY,
          charW, charH, offsetX, offsetY,
        });
      });
    });

    // Listen for SSH output events
    const unlisten = listen<{ sessionId: string; data: number[] }>(
      "session:output",
      (event) => {
        if (event.payload.sessionId === sessionId) {
          const bytes = new Uint8Array(event.payload.data);
          const text = sessionOutputDecoderRef.current.decode(bytes, { stream: true });
          const activeFilter = macroOutputFilterRef.current;
          const combined = macroFilterBufferRef.current + text;
          const { safeText, remain } = filterMacroInternalChunk(combined, activeFilter);
          macroFilterBufferRef.current = remain;
          if (safeText) {
            // Predictive Echo runs AFTER macro filtering so macro tokens
            // (which are stripped by filterMacroInternalChunk) never reach
            // the prediction layer. The remote bytes that match in-flight
            // predictions are consumed inside; only the leftover portion
            // (or the original chunk if PE is disabled / refs not yet set)
            // is written to xterm.
            const remaining =
              predictiveEchoRef.current?.onRemoteOutput(safeText) ?? safeText;
            if (remaining) term.write(remaining);
          }
        }
      },
    );

    // Listen for session state events
    const unlistenState = listen<{ sessionId: string; state: string }>(
      "session:state_changed",
      (event) => {
        if (event.payload.sessionId === sessionId) {
          updateTabState(
            sessionId,
            event.payload.state as "connected" | "disconnected" | "failed",
          );
        }
      },
    );

    // FR-34: Listen for "insert selection" shortcut event (Alt+Enter)
    const handleInsertSelection = () => {
      const sel = term.getSelection();
      if (sel) {
        const cleaned = cleanSelection(sel);
        if (cleaned) {
          const encoder = TEXT_ENCODER;
          const bytes = Array.from(encoder.encode(cleaned));
          api.sessionWrite(sessionIdRef.current, bytes).catch((err) => toast.error(String(err)));
        }
      }
    };
    window.addEventListener("terminal:insert-selection", handleInsertSelection);

    const handleInsertText = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; text?: string }>).detail;
      if (!detail?.text || detail.sessionId !== sessionIdRef.current) return;

      const encoder = TEXT_ENCODER;
      const bytes = Array.from(encoder.encode(detail.text));
      api.sessionWrite(sessionIdRef.current, bytes).catch((err) => toast.error(String(err)));
      term.focus();
    };
    window.addEventListener("terminal:insert-text", handleInsertText);

    // Cross-window variant (e.g. from the Quick Edit window). Tauri global
    // events fan out to every webview, so we filter by sessionId.
    let unlistenInsertText: (() => void) | null = null;
    void (async () => {
      unlistenInsertText = await listen<{ sessionId?: string; text?: string }>(
        "terminal:insert-text",
        (event) => {
          const payload = event.payload;
          if (!payload?.text || payload.sessionId !== sessionIdRef.current) return;
          const encoder = TEXT_ENCODER;
          const bytes = Array.from(encoder.encode(payload.text));
          api.sessionWrite(sessionIdRef.current, bytes).catch((err) => toast.error(String(err)));
          term.focus();
        },
      );
    })();

    // IME composition handling
    const termEl = term.element;
    const handleCompositionStart = () => {
      composingRef.current = true;
      closeAssist();
    };
    const handleCompositionEnd = () => { composingRef.current = false; };
    termEl?.addEventListener("compositionstart", handleCompositionStart);
    termEl?.addEventListener("compositionend", handleCompositionEnd);

    // Middle-click paste (via Tauri clipboard plugin, no permission prompt)
    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      readText().then((text) => {
        if (text) {
          const encoder = TEXT_ENCODER;
          const bytes = Array.from(encoder.encode(text));
          api.sessionWrite(sessionIdRef.current, bytes).catch((err) => toast.error(String(err)));
        }
      }).catch(() => {});
    };
    const termElForMouse = term.element;
    termElForMouse?.addEventListener("mousedown", handleMiddleClick);

    // Initial resize notification — delay slightly so the server has time
    // to finish sending MOTD/login banner before we trigger a redraw that
    // causes some shells to re-emit the prompt and corrupt the display.
    setTimeout(() => {
      api.sessionResize(sessionId, term.cols, term.rows).catch(() => {});
    }, 800);

    // CPR probe (切片 5): 连接建立稳定后注入一次 \x1b[6n。远端 PTY 应答经 SSH
    // 回传，由 csiCprDisposable 拦截 → predictiveEchoRef.current.onCursorPosition
    // → PredictiveEcho 在 Cold 状态下推到 Active（启发式扩展之外的兜底通道）。
    // 不维护超时 timer——sessionWrite 失败被 .catch 吞掉；超时无应答的语义就是
    // "PredictiveEcho 仍在 Cold，等启发式或 OSC 133 触发"，不需要主动清理。
    setTimeout(() => {
      api.sessionWrite(
        sessionId,
        Array.from(TEXT_ENCODER.encode("\x1b[6n")),
      ).catch(() => {});
    }, 300);

    term.focus();

    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      onData.dispose();
      onResize.dispose();
      onCursorMove.dispose();
      unlisten.then((fn) => fn());
      unlistenState.then((fn) => fn());
      window.removeEventListener("terminal:insert-selection", handleInsertSelection);
      window.removeEventListener("terminal:insert-text", handleInsertText);
      unlistenInsertText?.();
      termEl?.removeEventListener("compositionstart", handleCompositionStart);
      termEl?.removeEventListener("compositionend", handleCompositionEnd);
      termElForMouse?.removeEventListener("mousedown", handleMiddleClick);
    };
  }, [sessionId, hostId, tabId, updateTabState, closeAssist]);

  const hasBgImage = termSettings?.bgSource === "image" && termSettings?.bgImagePath;
  const isDisconnected = tabState === "disconnected" || tabState === "failed";

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await reconnectSession(tabId);
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className={cn("h-full w-full", hasBgImage && "xterm-bg-transparent")}
        style={{ padding: "2px 4px 0" }}
      />
      {/* Command Assist floating panel */}
      <CommandAssist
        visible={assistVisible}
        query={assistQuery}
        osType={osType}
        position={assistPosition}
        cursorCol={cursorPos.col}
        cursorRow={cursorPos.row}
        charW={cursorPos.charW}
        charH={cursorPos.charH}
        offsetX={cursorPos.offsetX}
        offsetY={cursorPos.offsetY}
        containerWidth={containerSize.w || (containerRef.current?.clientWidth ?? 0)}
        containerHeight={containerSize.h || (containerRef.current?.clientHeight ?? 0)}
        confirmKey={assistConfirmKey}
        onSelect={handleAssistSelect}
        onClose={handleAssistClose}
      />
      {isDisconnected && (
        <div className="terminal-disconnect-overlay" role="status" aria-live="polite">
          <div className="terminal-disconnect-card">
            <span className="terminal-disconnect-icon" aria-hidden="true">
              <Zap size={26} />
            </span>
            <div className="terminal-disconnect-message">
              {t("term.disconnected")}
            </div>
            <button
              type="button"
              onClick={handleReconnect}
              disabled={reconnecting}
              className="terminal-reconnect-button"
            >
              <Zap size={15} />
              {reconnecting ? t("term.reconnecting") : t("term.reconnect")}
            </button>
          </div>
        </div>
      )}
      {picker && (
        <RemoteFilePicker
          open
          sessionId={sessionId}
          hostId={hostId}
          hostName={hostName}
          initialPath={picker.initialPath}
          prefilterFileName={picker.prefilterFileName}
          onPick={(absolutePath) => {
            void openQuickEditWindow({
              sessionId,
              hostId,
              hostName,
              remotePath: absolutePath,
            });
            recordQuickEditRecent({
              hostId,
              sessionId,
              remotePath: absolutePath,
              fileName: getPathName(absolutePath),
              updatedAt: Date.now(),
            });
            recordQuickEditPickerDir({
              hostId,
              sessionId,
              path: getRemoteDirPath(absolutePath),
            });
            setPicker(null);
            termRef.current?.focus();
          }}
          onClose={() => {
            setPicker(null);
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

// ── Command History Panel ──

function CommandHistoryPanel({
  onInsert,
  onClose,
}: {
  onInsert: (command: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [items, setItems] = useState<CommandHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const listRef = useRef<HTMLDivElement>(null);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Debounce search to avoid too many API calls
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.commandHistoryList(
          activeTab?.hostId ?? null,
          searchQuery || null,
          200,
        );
        setItems(result);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 150);
  }, [activeTabId, searchQuery]);

  // Auto-scroll to bottom when items change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items]);

  // Listen for new commands inserted
  useEffect(() => {
    const handler = async () => {
      // Immediately fetch without debounce when new command is added
      setLoading(true);
      try {
        const result = await api.commandHistoryList(
          activeTab?.hostId ?? null,
          searchQuery || null,
          200,
        );
        setItems(result);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    window.addEventListener("command-history-updated", handler);
    return () => window.removeEventListener("command-history-updated", handler);
  }, [activeTabId, searchQuery]);

  // Clear history for current host
  const handleClearHistory = async () => {
    if (items.length === 0) return;
    const ok = await confirm({
      title: t("term.clearHistory"),
      description: t("term.clearHistoryConfirm"),
      confirmLabel: t("term.clear"),
      cancelLabel: t("term.cancel"),
    });
    if (!ok) return;
    try {
      await api.commandHistoryClear(activeTab?.hostId ?? null);
      setItems([]);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full w-[280px] flex-col border-l border-[var(--color-border)] glass-surface">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-[var(--font-size-sm)] font-medium">{t("term.history")}</span>
        </div>
        <div className="flex items-center gap-1">
          {items.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="rounded p-0.5 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              title={t("term.clearHistory")}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-0.5 hover:bg-[var(--color-bg-hover)]"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("term.searchCommands")}
            className="h-7 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-8 pr-3 text-[var(--font-size-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focus)] focus:outline-none"
          />
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-center text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("conn.loading")}
          </p>
        )}

        {!loading && items.length === 0 && (
          <p className="p-4 text-center text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("term.noCommands")}
          </p>
        )}

        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onInsert(item.command)}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[var(--font-size-xs)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <code className="flex-1 break-all font-mono text-[var(--color-text-primary)]">
              {item.command}
            </code>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Bookmark Panel ──

function BookmarkPanel({
  hostId,
  sessionId,
  onNavigate,
  onClose,
}: {
  hostId: string;
  sessionId: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [bookmarks, setBookmarks] = useState<TerminalBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [addLabel, setAddLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const loadBookmarks = useCallback(async () => {
    try {
      const result = await api.terminalBookmarkList(hostId);
      setBookmarks(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    setLoading(true);
    loadBookmarks();
  }, [hostId, loadBookmarks]);

  const handleAdd = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    try {
      const marker = `__BOOKMARK_PWD__:${crypto.randomUUID()}:`;
      const path = await new Promise<string | null>((resolve) => {
        let settled = false;
        let cleanBuffer = "";
        let unlistenOutput: null | (() => void) = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (unlistenOutput) unlistenOutput();
          resolve(value);
        };

        timer = setTimeout(() => {
          finish(null);
        }, 3000);

        void listen<{ sessionId: string; data: number[] }>("session:output", (event) => {
          if (settled) return;
          if (event.payload.sessionId !== sessionId) return;

          const text = new TextDecoder().decode(new Uint8Array(event.payload.data));
          // eslint-disable-next-line no-control-regex
          cleanBuffer += text
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
            .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "");

          const lines = cleanBuffer.split(/\r?\n/);
          cleanBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const markerIndex = line.indexOf(marker);
            if (markerIndex >= 0) {
              const resolvedPath = line.slice(markerIndex + marker.length).trimEnd();
              finish(resolvedPath || null);
              return;
            }
          }
        }).then((unlisten) => {
          if (settled) {
            unlisten();
            return;
          }
          unlistenOutput = unlisten;
          const encoder = TEXT_ENCODER;
          api.sessionWrite(
            sessionId,
            Array.from(encoder.encode(`printf '${marker}%s\\n' "$PWD"\r`)),
          ).catch(() => {
            finish(null);
          });
        }).catch(() => {
          finish(null);
        });
      });

      if (!path) {
        toast.error(t("term.bookmarkAddFailed"));
        return;
      }

      await api.terminalBookmarkAdd(hostId, path, addLabel.trim() || undefined);
      setAddLabel("");
      await loadBookmarks();
    } catch {
      toast.error(t("term.bookmarkAddFailed"));
    } finally {
      setAdding(false);
    }
  }, [adding, hostId, sessionId, addLabel, loadBookmarks, t]);

  const handleRemove = async (id: string) => {
    const ok = await confirm({
      title: t("term.removeBookmark"),
      description: t("term.removeBookmarkConfirm"),
      confirmLabel: t("term.delete"),
      cancelLabel: t("term.cancel"),
    });
    if (!ok) return;
    try {
      await api.terminalBookmarkRemove(id);
      await loadBookmarks();
    } catch {
      // ignore
    }
  };

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmStartRef = useRef<number>(0);

  const handleBookmarkClick = useCallback((id: string, path: string) => {
    if (confirmId === id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmId(null);
      onNavigate(path);
    } else {
      setConfirmId(id);
      confirmStartRef.current = Date.now();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmId(null);
      }, 2000);
    }
  }, [confirmId, onNavigate]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col glass-surface">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Bookmark size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-[var(--font-size-sm)] font-medium">{t("term.bookmarks")}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 hover:bg-[var(--color-bg-hover)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2 flex gap-1.5 items-center">
        <input
          value={addLabel}
          onChange={(e) => setAddLabel(e.target.value)}
          placeholder={t("term.bookmarkLabelPlaceholder")}
          className="h-7 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 text-[var(--font-size-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focus)] focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button
          onClick={handleAdd}
          disabled={adding}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors",
            !adding
              ? "bg-[var(--color-accent)] text-white hover:opacity-90"
              : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] cursor-not-allowed",
          )}
          title={t("term.addBookmark")}
        >
          <Star size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-center text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("conn.loading")}
          </p>
        )}

        {!loading && bookmarks.length === 0 && (
          <p className="p-4 text-center text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("term.noBookmarks")}
          </p>
        )}

        {bookmarks.map((bm) => (
          <div
            key={bm.id}
            className="group relative flex items-center gap-2 px-3 py-1.5 text-[var(--font-size-xs)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer select-none"
            onClick={() => handleBookmarkClick(bm.id, bm.path)}
          >
            {confirmId === bm.id && (
              <div
                className="absolute left-0 bottom-0 h-[2px] bg-[var(--color-accent)] rounded-full"
                style={{
                  animation: "bookmark-confirm 2s linear forwards",
                }}
              />
            )}
            <FolderOpen size={13} className="flex-shrink-0 text-[var(--color-text-muted)]" />
            <div className="flex-1 min-w-0">
              {bm.label ? (
                <div className="truncate text-[var(--color-text-primary)] font-medium">{bm.label}</div>
              ) : null}
              <div className={cn("truncate font-mono", bm.label ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-primary)]")} title={bm.path}>
                {bm.path}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(bm.id); }}
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 rounded p-0.5 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all"
              title={t("term.removeBookmark")}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Resize Handle ──

function ResizeHandle({
  direction,
  onResize,
}: {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = direction === "horizontal" ? e.clientY : e.clientX;

      const handleMouseMove = (e: MouseEvent) => {
        const currentPos = direction === "horizontal" ? e.clientY : e.clientX;
        onResize(currentPos - startPos);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = direction === "horizontal" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [direction, onResize],
  );

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className={cn(
        "flex-shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors",
        direction === "horizontal"
          ? "h-1 w-full cursor-row-resize"
          : "h-full w-1 cursor-col-resize",
      )}
    />
  );
}

export function TerminalPage() {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const moveTab = useTerminalStore((s) => s.moveTab);
  const splitDirection = useTerminalStore((s) => s.splitDirection);
  const splitTabId = useTerminalStore((s) => s.splitTabId);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const closeSplit = useTerminalStore((s) => s.closeSplit);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const recipes = useWorkflowsStore((s) => s.recipes);
  const fetchRecipes = useWorkflowsStore((s) => s.fetchRecipes);
  const [showHistory, setShowHistory] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMacroPanel, setShowMacroPanel] = useState(false);
  const [showAiAssist, setShowAiAssist] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [renderFileManager, setRenderFileManager] = useState(false);
  const [fileManagerEnabled, setFileManagerEnabled] = useState(true);
  const [fileManagerHeight, setFileManagerHeight] = useState(320);
  const [isFileManagerResizing, setIsFileManagerResizing] = useState(false);
  const [lastFocusedSessionId, setLastFocusedSessionId] = useState<string | null>(null);
  const [sessionCwdMap, setSessionCwdMap] = useState<Record<string, string>>({});
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const dragStartXRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const fileManagerResizeFrameRef = useRef<number | null>(null);
  const fileManagerResizeEndFrameRef = useRef<number | null>(null);
  const fileManagerResizeHeightRef = useRef(fileManagerHeight);
  const fileManagerResizeCleanupRef = useRef<(() => void) | null>(null);
  const ignoreClickRef = useRef(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const termMainRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarkDrawerRef = useRef<HTMLDivElement>(null);
  const historyDrawerRef = useRef<HTMLDivElement>(null);
  const fileManagerShellRef = useRef<HTMLDivElement>(null);
  const bookmarkToggleRef = useRef<HTMLButtonElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const {
    activeMacroRun,
    macroOutputFilter,
    recentMacroIds,
    lastRunAtMap,
    progressText,
    startRun,
    stopRun,
    handleSessionOutput,
    handleSessionStateChanged,
    clearFailedBadge,
  } = useMacroRunner();

  useEffect(() => {
    if (!showBookmarks && !showHistory) return;
    const handler = (e: PointerEvent) => {
      const confirmEl = document.querySelector("[data-confirm-dialog]");
      if (confirmEl) return;
      const target = e.target as Node;
      if (bookmarkToggleRef.current?.contains(target) || historyToggleRef.current?.contains(target)) {
        return;
      }
      if (showBookmarks && bookmarkDrawerRef.current && !bookmarkDrawerRef.current.contains(target)) {
        setShowBookmarks(false);
      }
      if (showHistory && historyDrawerRef.current && !historyDrawerRef.current.contains(target)) {
        setShowHistory(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handler);
    };
  }, [showBookmarks, showHistory]);

  useEffect(() => {
    fetchRecipes().catch(() => {});
  }, [fetchRecipes]);

  useEffect(() => {
    const unlistenOutput = listen<{ sessionId: string; data: number[] }>("session:output", (event) => {
      void handleSessionOutput(event.payload.sessionId, event.payload.data);
    });

    const unlistenState = listen<{ sessionId: string; state: "connected" | "disconnected" | "failed" }>(
      "session:state_changed",
      (event) => {
        handleSessionStateChanged(event.payload.sessionId, event.payload.state);
      },
    );

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenState.then((fn) => fn());
    };
  }, [handleSessionOutput, handleSessionStateChanged]);

  // Load terminal settings from backend
  const [termSettings, setTermSettings] = useState<Record<string, any> | undefined>(undefined);
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [
          fontFamily, fontSize, fontWeight, lineHeight, fontLigatures,
          foreground, cursor, cursorStyle, cursorWidth, selectionBg,
          bgSource, bgColor, bgImagePath, bgOpacity, bgBlur,
          ansiColors, dangerousCmdProtection, disabledBuiltinCmds, customDangerousCommands,
          fileManagerDrawerEnabled,
        ] = await Promise.all([
          api.settingGet("terminal.fontFamily"),
          api.settingGet("terminal.fontSize"),
          api.settingGet("terminal.fontWeight"),
          api.settingGet("terminal.lineHeight"),
          api.settingGet("terminal.fontLigatures"),
          api.settingGet("terminal.foreground"),
          api.settingGet("terminal.cursor"),
          api.settingGet("terminal.cursorStyle"),
          api.settingGet("terminal.cursorWidth"),
          api.settingGet("terminal.selectionBg"),
          api.settingGet("terminal.bgSource"),
          api.settingGet("terminal.bgColor"),
          api.settingGet("terminal.bgImagePath"),
          api.settingGet("terminal.bgOpacity"),
          api.settingGet("terminal.bgBlur"),
          api.settingGet("terminal.ansiColors"),
          api.settingGet("terminal.dangerousCmdProtection"),
          api.settingGet("terminal.disabledBuiltinCmds"),
          api.settingGet("terminal.customDangerousCommands"),
          api.settingGet("terminal.fileManagerDrawer.enabled"),
        ]);
        const fileManagerEnabledNext = fileManagerDrawerEnabled !== "false";
        setFileManagerEnabled(fileManagerEnabledNext);
        if (!fileManagerEnabledNext) setShowFileManager(false);
        setTermSettings({
          fontFamily: fontFamily || undefined,
          fontSize: fontSize ? parseInt(fontSize) : undefined,
          fontWeight: fontWeight ? parseInt(fontWeight) : undefined,
          lineHeight: lineHeight ? parseFloat(lineHeight) : undefined,
          fontLigatures: fontLigatures === "true",
          foreground: foreground || undefined,
          cursor: cursor || undefined,
          cursorStyle: (cursorStyle === "block" || cursorStyle === "underline" || cursorStyle === "bar") ? cursorStyle : undefined,
          cursorWidth: cursorWidth ? parseInt(cursorWidth) : undefined,
          selectionBg: selectionBg || undefined,
          bgSource: bgSource || undefined,
          bgColor: bgColor || undefined,
          bgImagePath: bgImagePath || null,
          bgOpacity: bgOpacity ? parseInt(bgOpacity) : undefined,
          bgBlur: bgBlur ? parseInt(bgBlur) : undefined,
          ansiColors: (() => { try { return JSON.parse(ansiColors || ""); } catch { return undefined; } })(),
          dangerousCmdProtection: dangerousCmdProtection !== "false",
          disabledBuiltinCmds: (() => { try { const arr = JSON.parse(disabledBuiltinCmds || ""); return Array.isArray(arr) ? arr : undefined; } catch { return undefined; } })(),
          customDangerousCommands: (() => { try { const arr = JSON.parse(customDangerousCommands || ""); return Array.isArray(arr) ? arr : undefined; } catch { return undefined; } })(),
          fileManagerDrawerEnabled: fileManagerEnabledNext,
        });
      } catch {
        setFileManagerEnabled(true);
        setTermSettings({});
      }
    };

    loadSettings();

    const handleSettingsChanged = () => {
      loadSettings();
      setSettingsVersion((v) => v + 1);
    };
    window.addEventListener("terminal:settings-changed", handleSettingsChanged);
    return () => {
      window.removeEventListener("terminal:settings-changed", handleSettingsChanged);
    };
  }, []);

  const goToConnections = useCallback(() => {
    setCurrentPage("connections");
  }, [setCurrentPage]);

  const handleInsertCommand = useCallback(
    (command: string) => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return;

      const encoder = TEXT_ENCODER;
      const bytes = Array.from(encoder.encode(command));
      api.sessionWrite(activeTab.sessionId, bytes).catch((err) => toast.error(String(err)));
    },
    [tabs, activeTabId],
  );

  const handleAiRunCommand = useCallback(
    (command: string, appendEnter: boolean) => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return;

      const write = () => {
        const text = appendEnter ? `${command}\r` : command;
        const bytes = Array.from(TEXT_ENCODER.encode(text));
        api.sessionWrite(activeTab.sessionId, bytes).catch((err) => toast.error(String(err)));
      };

      if (appendEnter && termSettings?.dangerousCmdProtection) {
        const disabled = new Set(termSettings.disabledBuiltinCmds ?? []);
        const patterns = [
          ...DEFAULT_DANGEROUS_COMMANDS.filter((c) => !disabled.has(c)),
          ...(termSettings.customDangerousCommands ?? []),
        ];
        if (patterns.length && isCommandDangerous(command, patterns)) {
          confirm({
            title: t("settings.cmdConfirmTitle"),
            description: t("settings.cmdConfirmDesc").replace("{cmd}", command),
          }).then((ok) => {
            if (ok) write();
          });
          return;
        }
      }

      write();
    },
    [tabs, activeTabId, termSettings, t],
  );

  const handleNavigateToDir = useCallback(
    (path: string) => {
      const activeTab = tabs.find((t) => t.id === activeTabId);
      if (!activeTab) return;

      const encoder = TEXT_ENCODER;
      const bytes = Array.from(encoder.encode(`cd ${quoteShellArg(path)}\r`));
      api.sessionWrite(activeTab.sessionId, bytes).catch((err) => toast.error(String(err)));
    },
    [tabs, activeTabId],
  );

  const handleResize = useCallback(
    (delta: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalSize = splitDirection === "horizontal" ? rect.height : rect.width;
      if (totalSize <= 0) return;
      setSplitRatio((prev) => {
        const newRatio = prev + delta / totalSize;
        return Math.max(0.2, Math.min(0.8, newRatio));
      });
    },
    [splitDirection],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const splitTab = splitTabId ? tabs.find((t) => t.id === splitTabId) ?? null : null;
  const fileManagerTab = useMemo(() => {
    const focused = lastFocusedSessionId
      ? tabs.find((tab) => tab.sessionId === lastFocusedSessionId && tab.state === "connected")
      : null;
    if (focused) return focused;
    return tabs.find((tab) => tab.id === activeTabId && tab.state === "connected") ?? null;
  }, [activeTabId, lastFocusedSessionId, tabs]);
  const fileManagerInitialPath = fileManagerTab
    ? sessionCwdMap[fileManagerTab.sessionId] ?? "/"
    : "/";
  const fileManagerSessionId = fileManagerTab?.sessionId ?? null;
  const fileManagerOpen = showFileManager && fileManagerEnabled && fileManagerSessionId !== null;
  const shouldRenderFileManager = renderFileManager && fileManagerEnabled && fileManagerTab !== null;
  const fileManagerLayoutHeight = fileManagerOpen ? fileManagerHeight : 0;
  const fileManagerRenderedHeight = isFileManagerResizing ? fileManagerResizeHeightRef.current : fileManagerLayoutHeight;

  const handleTerminalFocus = useCallback((sessionId: string, cwd: string | null) => {
    setLastFocusedSessionId(sessionId);
    if (cwd) {
      setSessionCwdMap((prev) => ({ ...prev, [sessionId]: cwd }));
    }
  }, []);

  const handleTerminalCwdChange = useCallback((sessionId: string, cwd: string) => {
    setSessionCwdMap((prev) => ({ ...prev, [sessionId]: cwd }));
  }, []);

  const handleToggleFileManager = useCallback(() => {
    if (!fileManagerEnabled) return;
    if (!fileManagerTab) {
      toast.error(t("term.disconnected"));
      return;
    }
    setShowHistory(false);
    setShowBookmarks(false);
    if (showFileManager) {
      setShowFileManager(false);
      return;
    }
    if (termMainRef.current) {
      const rect = termMainRef.current.getBoundingClientRect();
      const defaultHeight = Math.round(rect.height * 0.4);
      setFileManagerHeight(Math.max(260, Math.min(defaultHeight, Math.round(rect.height * 0.7))));
    }
    setRenderFileManager(true);
    window.requestAnimationFrame(() => setShowFileManager(true));
  }, [fileManagerEnabled, fileManagerTab, showFileManager, t]);

  const handleFileManagerResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = fileManagerHeight;
    const totalHeight = termMainRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const minHeight = Math.min(260, Math.max(180, Math.round(totalHeight * 0.35)));
    const maxHeight = Math.max(minHeight, Math.round(totalHeight * 0.7));
    const abortController = new AbortController();

    fileManagerResizeCleanupRef.current?.();
    if (fileManagerResizeEndFrameRef.current !== null) {
      window.cancelAnimationFrame(fileManagerResizeEndFrameRef.current);
      fileManagerResizeEndFrameRef.current = null;
    }
    fileManagerResizeHeightRef.current = startHeight;
    termMainRef.current?.setAttribute("data-file-manager-resizing", "true");
    fileManagerShellRef.current?.setAttribute("data-resizing", "true");
    setIsFileManagerResizing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      fileManagerResizeHeightRef.current = Math.max(minHeight, Math.min(maxHeight, startHeight + delta));
      if (fileManagerResizeFrameRef.current !== null) return;
      fileManagerResizeFrameRef.current = window.requestAnimationFrame(() => {
        fileManagerResizeFrameRef.current = null;
        const height = fileManagerResizeHeightRef.current;
        const shell = fileManagerShellRef.current;
        if (shell) {
          shell.style.height = `${height}px`;
          shell.style.flex = `0 0 ${height}px`;
        }
        if (termMainRef.current) {
          termMainRef.current.style.gridTemplateRows = `var(--tabbar-h) minmax(0, 1fr) ${height}px`;
        }
      });
    };

    const cleanupResize = () => {
      abortController.abort();
      if (fileManagerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(fileManagerResizeFrameRef.current);
        fileManagerResizeFrameRef.current = null;
      }
      fileManagerResizeCleanupRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handleMouseUp = () => {
      const finalHeight = fileManagerResizeHeightRef.current;
      cleanupResize();
      setFileManagerHeight(finalHeight);
      fileManagerResizeEndFrameRef.current = window.requestAnimationFrame(() => {
        fileManagerResizeEndFrameRef.current = null;
        setIsFileManagerResizing(false);
      });
    };

    fileManagerResizeCleanupRef.current = cleanupResize;
    document.addEventListener("mousemove", handleMouseMove, { signal: abortController.signal });
    document.addEventListener("mouseup", handleMouseUp, { signal: abortController.signal });
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [fileManagerHeight]);

  useEffect(() => {
    return () => {
      fileManagerResizeCleanupRef.current?.();
      if (fileManagerResizeEndFrameRef.current !== null) {
        window.cancelAnimationFrame(fileManagerResizeEndFrameRef.current);
        fileManagerResizeEndFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (showFileManager && (!fileManagerEnabled || !fileManagerTab)) {
      setShowFileManager(false);
    }
  }, [fileManagerEnabled, fileManagerTab, showFileManager]);

  useEffect(() => {
    if (showFileManager && fileManagerEnabled && fileManagerSessionId) {
      setRenderFileManager(true);
      return;
    }
    if (!renderFileManager) return;
    const timer = window.setTimeout(() => {
      setRenderFileManager(false);
    }, FILE_MANAGER_DRAWER_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [fileManagerEnabled, fileManagerSessionId, renderFileManager, showFileManager]);

  const hasBgImage = termSettings?.bgSource === "image" && termSettings?.bgImagePath;
  const bgOpacity = (termSettings?.bgOpacity ?? 100) / 100;
  const bgBlur = termSettings?.bgBlur ?? 0;
  const recentMacros = useMemo(() => {
    return recentMacroIds
      .map((id) => recipes.find((recipe) => recipe.id === id) ?? null)
      .filter((recipe): recipe is WorkflowRecipe => Boolean(recipe));
  }, [recentMacroIds, recipes]);
  const macroState = activeMacroRun?.state ?? "idle";
  const macroRunning = macroState === "running" || macroState === "cancelling";
  const macroButtonDisabled = !activeTab;

  const handleToggleMacroPanel = useCallback(() => {
    if (!activeTab) {
      toast.error(t("macro.noActiveTab"));
      return;
    }
    setShowMacroPanel((prev) => {
      const next = !prev;
      if (next) clearFailedBadge();
      return next;
    });
  }, [activeTab, clearFailedBadge, t]);

  const handleRunMacro = useCallback(async (recipeId: string, runtimeParams?: Record<string, string>) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe) return;

    if (!activeTab) {
      toast.error(t("macro.noActiveTab"));
      return;
    }
    if (activeTab.state !== "connected") {
      toast.error(t("macro.sessionDisconnected"));
      return;
    }

    const protectionOn = termSettings?.dangerousCmdProtection !== false;
    const disabledBuiltin = Array.isArray(termSettings?.disabledBuiltinCmds) ? termSettings?.disabledBuiltinCmds : [];
    const customDangerous = Array.isArray(termSettings?.customDangerousCommands)
      ? termSettings?.customDangerousCommands.filter((item): item is string => typeof item === "string")
      : [];
    const dangerousList = [...DEFAULT_DANGEROUS_COMMANDS, ...customDangerous].filter(
      (item) => !disabledBuiltin.includes(item),
    );

    const errorKey = await startRun({
      recipe,
      sessionId: activeTab.sessionId,
      sessionState: activeTab.state,
      runtimeParams,
      confirmDangerousCommands: protectionOn
        ? async (commands) => {
          const hasDangerous = commands.some((cmd) => isCommandDangerous(cmd, dangerousList));
          if (!hasDangerous) return true;
          return confirm({
            title: t("macro.dangerTitle"),
            description: t("macro.dangerDesc"),
            confirmLabel: t("macro.run"),
          });
        }
        : undefined,
    });

    if (errorKey) {
      if (errorKey === "macro.cancelled") {
        return;
      }
      if (errorKey.startsWith("macro.requiredParamMissing:")) {
        const key = errorKey.split(":")[1] || "";
        toast.error(t("macro.requiredParamMissing", { key }));
      } else {
        const message = errorKey === "macro.runAlreadyRunning"
          ? t("macro.runAlreadyRunning")
          : errorKey === "macro.sessionDisconnected"
            ? t("macro.sessionDisconnected")
            : errorKey === "macro.noExecutableSteps"
              ? t("macro.noExecutableSteps")
              : errorKey === "macro.startFailed"
                ? t("macro.startFailed")
                : errorKey;
        toast.error(message);
      }
      return;
    }

    setShowMacroPanel(false);
  }, [activeTab, recipes, startRun, t, termSettings]);

  useEffect(() => {
    if (!activeTab && showMacroPanel) {
      setShowMacroPanel(false);
    }
  }, [activeTab, showMacroPanel]);

  if (tabs.length === 0) {
    return (
      <div className="terminal-empty flex flex-1 items-center justify-center">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
            <TerminalIcon size={28} strokeWidth={1.8} />
          </span>
          <p className="text-[var(--font-size-lg)] font-medium text-[var(--color-text-secondary)]">
            {t("term.noActiveSessions")}
          </p>
          <div className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("term.goToConnections")}
          </div>
          <button
            onClick={goToConnections}
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] !bg-[image:var(--color-accent-gradient)] !px-4 !py-2 text-[var(--font-size-sm)] !text-[var(--color-fg-on-accent)] shadow-[var(--shadow-accent-glow)] hover:brightness-[1.08] transition-[filter] duration-[var(--duration-base)]"
          >
            <Plug size={16} />
            {t("term.openConnections")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page flex flex-1 overflow-hidden" style={{ userSelect: "text" }}>
      <div
        ref={termMainRef}
        className="term-main flex flex-1 flex-col overflow-hidden"
        data-file-manager-resizing={isFileManagerResizing ? "true" : undefined}
        style={shouldRenderFileManager
          ? { gridTemplateRows: `var(--tabbar-h) minmax(0, 1fr) ${fileManagerRenderedHeight}px` }
          : undefined}
      >
        {/* Tab bar */}
        {/* [AI-FEATURE]
            ID: TASK-TERM-TAB-DRAG
            Name: Terminal tab drag reorder within tab rail
            Status: IN_PROGRESS
            Scope: app/src/features/terminal/TerminalPage.tsx, app/src/stores/terminal.ts
            Input: mouse drag within tab bar
            Output: reordered tab list
            Errors: N/A
            Tests: manual drag/reorder
            Updated: 2026-03-11
            Owner: AI
        */}
        <div
          ref={tabBarRef}
          className="term-tabbar flex h-[var(--height-tabbar)] border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]"
          onMouseMove={(e) => {
            if (!draggingTabId || dragStartXRef.current === null) return;
            const delta = e.clientX - dragStartXRef.current;
            if (!dragMovedRef.current && Math.abs(delta) < 4) return;
            dragMovedRef.current = true;
            setDragDeltaX(delta);

            const fromIndex = tabs.findIndex((t) => t.id === draggingTabId);
            if (fromIndex < 0) return;

            // Fixed tab width + gap
            const TAB_WIDTH = 120;
            const TAB_GAP = 4;

            // Calculate target index based on delta
            // Each tab shift equals (TAB_WIDTH + TAB_GAP)
            const shiftAmount = delta > 0 ? delta + TAB_WIDTH / 2 : delta - TAB_WIDTH / 2;
            const indexDelta = Math.round(shiftAmount / (TAB_WIDTH + TAB_GAP));
            let targetIndex = fromIndex + indexDelta;

            // Clamp to valid range [0, tabs.length]
            targetIndex = Math.max(0, Math.min(tabs.length, targetIndex));

            if (targetIndex !== dragOverIndex) setDragOverIndex(targetIndex);
          }}
          onMouseUp={() => {
            if (!draggingTabId) return;
            const fromId = draggingTabId;
            const fromIndex = tabs.findIndex((t) => t.id === fromId);
            const insertIndex = dragOverIndex ?? fromIndex;

            if (fromIndex >= 0 && insertIndex !== fromIndex && dragMovedRef.current) {
              moveTab(fromId, insertIndex);
              ignoreClickRef.current = true;
            }
            setDraggingTabId(null);
            setDragOverIndex(null);
            setDragDeltaX(0);
            dragStartXRef.current = null;
            dragMovedRef.current = false;
          }}
          onMouseLeave={() => {
            if (!draggingTabId) return;
            setDraggingTabId(null);
            setDragOverIndex(null);
            setDragDeltaX(0);
            dragStartXRef.current = null;
            dragMovedRef.current = false;
          }}
        >
          {/* Tab list - scrollable */}
          <div className="tabs flex h-[var(--height-tabbar)] flex-1 items-center overflow-x-auto min-w-0">
            {tabs.map((tab, index) => (
            <div key={tab.id} className="flex items-center">
              <div
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const target = e.target as HTMLElement;
                  if (target.closest("button")) return;
                  dragStartXRef.current = e.clientX;
                  dragMovedRef.current = false;
                  ignoreClickRef.current = false;
                  setDraggingTabId(tab.id);
                  setDragOverIndex(null);
                  setDragDeltaX(0);
                }}
                className={cn(
                    "tab group flex h-[var(--height-tabbar)] items-center gap-1.5 px-3 text-[var(--fs-sm)] select-none",
                    tab.id === activeTabId && "is-active",
                  tab.id === activeTabId
                    ? "text-[var(--fg-primary)]"
                    : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-hover)]",
                  draggingTabId === tab.id && "opacity-90 z-10",
                )}
                style={{
                  width: 168,
                  flexShrink: 0,
                  ...(draggingTabId ? (() => {
                    const fromIndex = tabs.findIndex((t) => t.id === draggingTabId);
                    const toIndex = dragOverIndex ?? fromIndex;
                    const TAB_WIDTH = 168;
                    const TAB_GAP = 0;

                    if (tab.id === draggingTabId) {
                      return {
                        transform: `translateX(${dragDeltaX}px)`,
                        transition: "none",
                      };
                    }

                    // Calculate shift for other tabs
                    let shift = 0;
                    if (fromIndex >= 0) {
                      if (toIndex > fromIndex) {
                        if (index > fromIndex && index <= toIndex) {
                          shift = -(TAB_WIDTH + TAB_GAP);
                        }
                      } else if (toIndex < fromIndex) {
                        if (index >= toIndex && index < fromIndex) {
                          shift = TAB_WIDTH + TAB_GAP;
                        }
                      }
                    }

                    return {
                      transform: shift !== 0 ? `translateX(${shift}px)` : undefined,
                      transition: shift !== 0 ? "transform 320ms cubic-bezier(0.5, 0, 0.2, 1)" : undefined,
                    };
                  })() : undefined),
                }}
                onClick={() => {
                  if (ignoreClickRef.current) {
                    ignoreClickRef.current = false;
                    return;
                  }
                  setActiveTab(tab.id);
                  setLastFocusedSessionId(tab.sessionId);
                }}
              >
                <span
                  className={cn(
                    "tab-dot",
                    tab.state === "connected"
                    ? "dot-success"
                    : tab.state === "failed"
                      ? "dot-danger"
                      : "dot-idle",
                )}
              />
              <span className="tab-label font-medium truncate max-w-[80px]">{tab.title}</span>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await confirm({
                    title: t("confirm.closeSessionTitle"),
                    description: t("confirm.closeSessionDesc"),
                    confirmLabel: t("confirm.close"),
                  });
                  if (!ok) return;
                  closeSession(tab.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="tab-close ml-auto inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[2px] text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-primary)] transition-colors"
                aria-label={t("confirm.closeSessionTitle")}
              >
                <X size={11} strokeWidth={2.2} />
              </button>
              </div>
            </div>
          ))}
          </div>

          {/* Right controls - fixed */}
          <div className="tabbar-actions flex h-[var(--height-tabbar)] shrink-0 items-center gap-1 px-1">

          {/* Split controls */}
          <button
            onClick={() => splitPane("horizontal")}
            className={cn(
              "flex h-7 items-center rounded-[var(--radius-control)] px-1.5 text-[var(--font-size-xs)] transition-colors",
              splitDirection === "horizontal"
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]",
            )}
            title="Split Horizontal (Alt+Shift+-)"
          >
            <SplitSquareHorizontal size={14} />
          </button>
          <button
            onClick={() => splitPane("vertical")}
            className={cn(
              "flex h-7 items-center rounded-[var(--radius-control)] px-1.5 text-[var(--font-size-xs)] transition-colors",
              splitDirection === "vertical"
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]",
            )}
            title="Split Vertical (Alt+Shift+|)"
          >
            <SplitSquareVertical size={14} />
          </button>
          {splitDirection && (
            <button
              onClick={closeSplit}
              className="flex h-7 items-center rounded-[var(--radius-control)] px-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title="Close Split"
            >
              <XCircle size={14} />
            </button>
          )}

          <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />

          {/* History toggle */}
          <button
            ref={historyToggleRef}
            onClick={() => {
              setShowBookmarks(false);
              setShowHistory((v) => !v);
            }}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[var(--font-size-xs)] transition-colors",
              showHistory
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
            )}
          >
            <History size={14} />
            <span>{t("term.history")}</span>
          </button>
        </div>
        </div>

{/* Terminal area */}
        <div
          ref={containerRef}
                  className={cn(
                    "term-panes relative flex-1 overflow-hidden",
                    splitDirection && `is-split is-split-${splitDirection}`,
          )}
          style={{
            backgroundColor: hasBgImage ? "transparent" : (termSettings?.bgColor ?? "#0F1115"),
            ...(splitDirection === "horizontal" ? { gridTemplateRows: `${splitRatio * 100}% 1px ${(1 - splitRatio) * 100}%` } : splitDirection === "vertical" ? { gridTemplateColumns: `${splitRatio * 100}% 1px ${(1 - splitRatio) * 100}%` } : {}),
          }}
        >
          {/* Background image layer (rendered at this level so it covers the entire terminal area) */}
          {hasBgImage && (
            <div
              className="absolute inset-0 z-0"
              style={{
                backgroundImage: `url(${convertFileSrc(termSettings!.bgImagePath!)})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: bgOpacity,
                filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
              }}
            />
          )}
          <div className="terminal-tool-rail" aria-label={t("terminalTool.label")}>
            <div className="terminal-tool-item">
              <button
                className={cn(
                  "terminal-tool-button",
                  showBookmarks && "is-active",
                )}
                ref={bookmarkToggleRef}
                type="button"
                title={t("terminalTool.bookmarks")}
                aria-label={t("terminalTool.bookmarks")}
                disabled={!activeTab}
                onClick={() => {
                  setShowHistory(false);
                  setShowBookmarks((v) => !v);
                }}
              >
                <Bookmark size={15} />
              </button>
            </div>

            <div className="terminal-tool-divider" />

            <div className="terminal-tool-item">
              <button
                className={cn(
                  "terminal-tool-button",
                  showMacroPanel && "is-active",
                  macroButtonDisabled && "is-disabled",
                )}
                type="button"
                title={progressText ? `${t("terminalTool.macro")} · ${progressText}` : t("terminalTool.macro")}
                aria-label={t("terminalTool.macro")}
                disabled={macroButtonDisabled}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setShowHistory(false);
                  setShowBookmarks(false);
                  handleToggleMacroPanel();
                }}
              >
                {macroState === "cancelling" ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
              </button>
              {macroRunning && (
                <button
                  className="terminal-tool-button is-danger"
                  type="button"
                  title={t("macro.stop")}
                  aria-label={t("macro.stop")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    void stopRun();
                  }}
                >
                  <Square size={13} />
                </button>
              )}
              <MacroQuickPanel
                open={showMacroPanel}
                recipes={recipes}
                recentRecipes={recentMacros}
                lastRunAtMap={lastRunAtMap}
                running={macroRunning}
                onRun={(recipe, runtimeParams) => {
                  void handleRunMacro(recipe.id, runtimeParams);
                }}
                onClose={() => setShowMacroPanel(false)}
              />
            </div>

            <div className="terminal-tool-item">
              <button
                className={cn(
                  "terminal-tool-button",
                  showAiAssist && "is-active",
                )}
                type="button"
                title={t("terminalTool.ai")}
                aria-label={t("terminalTool.ai")}
                disabled={!activeTab}
                onClick={() => {
                  setShowHistory(false);
                  setShowBookmarks(false);
                  setShowAiAssist((value) => !value);
                }}
              >
                <Sparkles size={15} />
              </button>
            </div>

            {fileManagerEnabled && (
              <div className="terminal-tool-item">
                <button
                  className={cn(
                    "terminal-tool-button",
                    showFileManager && "is-active",
                  )}
                  type="button"
                  title={t("terminalTool.files")}
                  aria-label={t("terminalTool.files")}
                  disabled={!fileManagerTab}
                  onClick={handleToggleFileManager}
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            )}
          </div>
          {/* Primary pane */}
          <div
            className="term-pane is-active relative z-10 overflow-hidden"
          >
            <div className="pane-bar">
              <svg className="flex-shrink-0" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              <span className="pane-host mono">{activeTab?.title ?? "terminal"}</span>
              <span className="pane-spacer" />
              <span className="pane-tag"><span className={cn("tab-dot", activeTab?.state === "connected" ? "dot-success" : activeTab?.state === "failed" ? "dot-danger" : "dot-idle")} />{activeTab?.state ?? "idle"}</span>
            </div>
            <div className="term-window p-0">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "h-full w-full",
                  tab.id === activeTabId ? "block" : "hidden",
                )}
              >
                {termSettings && (
                  <TerminalInstance
                    key={`${tab.id}-${settingsVersion}`}
                    tabId={tab.id}
                    sessionId={tab.sessionId}
                    hostId={tab.hostId}
                    macroOutputFilter={macroOutputFilter?.sessionId === tab.sessionId ? macroOutputFilter : null}
                    termSettings={termSettings}
                    suspendResize={isFileManagerResizing}
                    onFocusSession={handleTerminalFocus}
                    onCwdChange={handleTerminalCwdChange}
                  />
                )}
              </div>
            ))}
            </div>
          </div>

          {/* Resize handle + second pane */}
          {splitDirection && splitTab && (
            <>
              <ResizeHandle direction={splitDirection} onResize={handleResize} />
              <div
                className="term-pane relative z-10 overflow-hidden"
              >
                <div className="pane-bar">
                  <svg className="flex-shrink-0" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                  <span className="pane-host mono">{splitTab.title}</span>
                  <span className="pane-spacer" />
                  <span className="pane-tag"><span className={cn("tab-dot", splitTab.state === "connected" ? "dot-success" : splitTab.state === "failed" ? "dot-danger" : "dot-idle")} />{splitTab.state}</span>
                </div>
                <div className="term-window p-0">
                  {termSettings && (
                    <TerminalInstance
                      key={`split-${splitTab.id}-${settingsVersion}`}
                      tabId={splitTab.id}
                      sessionId={splitTab.sessionId}
                      hostId={splitTab.hostId}
                      macroOutputFilter={macroOutputFilter?.sessionId === splitTab.sessionId ? macroOutputFilter : null}
                      termSettings={termSettings}
                      suspendResize={isFileManagerResizing}
                      onFocusSession={handleTerminalFocus}
                      onCwdChange={handleTerminalCwdChange}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {/* Bookmark drawer */}
          <div
            ref={bookmarkDrawerRef}
            className="absolute right-0 top-0 bottom-0 z-[15] flex transition-transform duration-[var(--duration-panel)] ease-[var(--ease-smooth)]"
            style={{ transform: showBookmarks ? 'translateX(0)' : 'translateX(280px)' }}
          >
            <div className="w-[280px] border-l border-[var(--color-border)]">
              {activeTab && (
                <BookmarkPanel
                  hostId={activeTab.hostId}
                  sessionId={activeTab.sessionId}
                  onNavigate={handleNavigateToDir}
                  onClose={() => setShowBookmarks(false)}
                />
              )}
            </div>
          </div>

          {/* Command History drawer */}
          <div
            ref={historyDrawerRef}
            className="absolute right-0 top-0 bottom-0 z-[16] flex transition-transform duration-[var(--duration-panel)] ease-[var(--ease-smooth)]"
            style={{ transform: showHistory ? 'translateX(0)' : 'translateX(280px)' }}
          >
            <CommandHistoryPanel
              onInsert={handleInsertCommand}
              onClose={() => setShowHistory(false)}
            />
          </div>

          <TerminalAiAssist
            open={showAiAssist}
            activeTab={activeTab}
            cwd={activeTab ? sessionCwdMap[activeTab.sessionId] ?? null : null}
            onClose={() => setShowAiAssist(false)}
            onRunCommand={handleAiRunCommand}
          />
        </div>
        {shouldRenderFileManager && fileManagerTab && (
          <div
            ref={fileManagerShellRef}
            className="terminal-file-manager-shell"
            data-state={fileManagerOpen ? "open" : "closed"}
            data-resizing={isFileManagerResizing ? "true" : undefined}
            aria-hidden={!fileManagerOpen}
            style={{
              height: fileManagerRenderedHeight,
              flex: `0 0 ${fileManagerRenderedHeight}px`,
            }}
          >
            <div
              className="terminal-file-manager-resize"
              onMouseDown={handleFileManagerResizeStart}
              title={t("terminalFileManager.resize")}
            />
            <TerminalFileManagerDrawer
              open={shouldRenderFileManager}
              sessionId={fileManagerTab.sessionId}
              hostId={fileManagerTab.hostId}
              hostName={fileManagerTab.title}
              initialPath={fileManagerInitialPath}
              onClose={() => setShowFileManager(false)}
              onPathResolved={(path) => {
                setSessionCwdMap((prev) => ({ ...prev, [fileManagerTab.sessionId]: path }));
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
