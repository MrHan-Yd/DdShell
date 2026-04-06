import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { FitAddon } from "@xterm/addon-fit";
import { X, Plus, History, Search, SplitSquareHorizontal, SplitSquareVertical, XCircle, Zap, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import * as api from "@/lib/tauri";
import type { CommandHistoryItem } from "@/types";
import { useT } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import { CommandAssist } from "./CommandAssist";
import type { AssistPosition } from "./CommandAssist";
import { useCommandAssistStore } from "@/stores/commandAssist";
import "@xterm/xterm/css/xterm.css";

const DEFAULT_DANGEROUS_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:",
  "shutdown",
  "poweroff",
  "reboot",
  "init 0",
  "init 6",
  "drop database",
  "truncate table",
];

/** Strip ANSI escape sequences and trim whitespace */
function cleanSelection(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function TerminalInstance({
  tabId,
  sessionId,
  hostId,
  termSettings,
}: {
  tabId: string;
  sessionId: string;
  hostId: string;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const updateTabState = useTerminalStore((s) => s.updateTabState);
  const reconnectSession = useTerminalStore((s) => s.reconnectSession);
  const tabState = useTerminalStore(
    (s) => s.tabs.find((t) => t.id === tabId)?.state,
  );
  const [reconnecting, setReconnecting] = useState(false);
  const cmdBufferRef = useRef<string>("");
  const dangerousCmdPendingRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const termSettingsRef = useRef(termSettings);
  termSettingsRef.current = termSettings;
  const t = useT();

  // ── Command Assist state ──
  const [assistVisible, setAssistVisible] = useState(false);
  const [assistQuery, setAssistQuery] = useState("");
  const [assistEnabled, setAssistEnabled] = useState(false);
  const [assistConfirmKey, setAssistConfirmKey] = useState<"tab" | "enter">("tab");
  const [assistPosition, setAssistPosition] = useState<AssistPosition>("bottom-left");
  // Cursor position relative to the terminal container (not screen)
  const [cursorPos, setCursorPos] = useState<{ col: number; row: number; charW: number; charH: number; offsetX: number; offsetY: number }>({ col: 0, row: 0, charW: 8, charH: 18, offsetX: 0, offsetY: 0 });
  const geoRef = useRef({ charW: 8, charH: 18, offsetX: 0, offsetY: 0 });
  const cursorRafRef = useRef<number | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [osType, setOsType] = useState<string | null>(null);
  const assistVisibleRef = useRef(false);
  const composingRef = useRef(false);

  // Load command assist settings
  useEffect(() => {
    const load = async () => {
      try {
        const [enabled, confirmKeyVal, positionVal] = await Promise.all([
          api.settingGet("commandAssist.enabled"),
          api.settingGet("commandAssist.confirmKey"),
          api.settingGet("commandAssist.position"),
        ]);
        setAssistEnabled(enabled === "true");
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

  const assistConfirmKeyRef = useRef(assistConfirmKey);
  useEffect(() => {
    assistConfirmKeyRef.current = assistConfirmKey;
  }, [assistConfirmKey]);

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
            toast.info(t("commandAssist.enableHint"));
          }
        }
      }
      return;
    }

    // Find last occurrence of //
    const slashPos = buffer.lastIndexOf("//");
    if (slashPos < 0) {
      if (assistVisibleRef.current) {
        setAssistVisible(false);
        setAssistQuery("");
      }
      return;
    }

    // Exclusion rules
    // 1. :// (URL protocol)
    if (slashPos > 0 && buffer[slashPos - 1] === ":") return;
    // 2. /// (path-like)
    if (slashPos + 2 < buffer.length && buffer[slashPos + 2] === "/") return;
    // 3. \\ (UNC path) — check surrounding context
    if (buffer.includes("\\\\")) return;

    const afterSlash = buffer.substring(slashPos + 2);

    // Need at least 1 non-whitespace char after //
    if (afterSlash.length < 1 || afterSlash.trim().length < 1) {
      if (assistVisibleRef.current) {
        setAssistVisible(false);
        setAssistQuery("");
      }
      return;
    }

    // Trigger!
    assistVisibleRef.current = true;
    const term = termRef.current;
    const { charW, charH, offsetX, offsetY } = geoRef.current;
    // Batch all state updates together to avoid multiple renders
    setAssistQuery(afterSlash.trim());
    setAssistVisible(true);
    if (term) {
      setCursorPos({
        col: term.buffer.active.cursorX,
        row: term.buffer.active.cursorY,
        charW, charH, offsetX, offsetY,
      });
    }
  }, [t]);

  // ── Command Assist: handle selection ──
  const handleAssistSelect = useCallback((command: string, id: string) => {
    const buffer = cmdBufferRef.current;
    const slashPos = buffer.lastIndexOf("//");
    if (slashPos < 0) return;

    // Calculate the text to replace: everything from // to end of buffer
    const textToReplace = buffer.substring(slashPos);

    // Send backspaces to erase the // prefix + query, then type the command
    const encoder = new TextEncoder();

    // Erase: send backspace for each char of the trigger text
    const backspaces = "\x7f".repeat(textToReplace.length);
    const eraseBytes = Array.from(encoder.encode(backspaces));
    api.sessionWrite(sessionIdRef.current, eraseBytes).catch(() => {});

    // Type the command
    setTimeout(() => {
      const cmdBytes = Array.from(encoder.encode(command));
      api.sessionWrite(sessionIdRef.current, cmdBytes).catch(() => {});
    }, 20);

    // Update buffer
    cmdBufferRef.current = buffer.substring(0, slashPos) + command;

    // Update weight — also update local store weight
    api.commandAssistWeightUpdate(id).catch(() => {});
    useCommandAssistStore.getState().updateLocalWeight(id);

    // Close assist
    setAssistVisible(false);
    setAssistQuery("");
  }, []);

  const handleAssistClose = useCallback(() => {
    setAssistVisible(false);
    assistVisibleRef.current = false;
    setAssistQuery("");
  }, []);

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

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    fitAddon.fit();
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
    const resizeObserver = new ResizeObserver((entries) => {
      // Skip fit when container is hidden (width/height = 0) to avoid
      // sending bogus resize sequences that show up as visible characters
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
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
      window.removeEventListener("terminal:clear", handleClear);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: Bind session I/O (re-runs when sessionId changes, keeps xterm alive)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

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
            setAssistVisible(false);
            setAssistQuery("");
          }
        } else if (ch === "\x7f" || ch === "\b") {
          cmdBufferRef.current = cmdBufferRef.current.slice(0, -1);
        } else if (ch === "\x03") {
          cmdBufferRef.current = "";
          // Close assist on Ctrl+C
          if (assistVisibleRef.current) {
            setAssistVisible(false);
            setAssistQuery("");
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
            assistVisibleRef.current = false;
            setAssistVisible(false);
            setAssistQuery("");
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
        if (patterns.length) {
          const cmdLower = pendingCommand.toLowerCase();
          const matched = patterns.some((p) => cmdLower.includes(p.toLowerCase()));
          if (matched) {
            dangerousCmdPendingRef.current = true;
            confirm({
              title: t("settings.cmdConfirmTitle"),
              description: t("settings.cmdConfirmDesc").replace("{cmd}", pendingCommand),
            }).then((ok) => {
              dangerousCmdPendingRef.current = false;
              if (ok) {
                const encoder = new TextEncoder();
                const bytes = Array.from(encoder.encode(data));
                api.sessionWrite(sid, bytes).catch((err) => toast.error(String(err)));
              } else {
                api.sessionWrite(sid, [3]).catch(() => {});
              }
            });
            return;
          }
        }
      }

      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      api.sessionWrite(sid, bytes).catch((err) => toast.error(String(err)));

      // Check for // trigger after sending data (async to avoid blocking input)
      setTimeout(() => checkAssistTrigger(cmdBufferRef.current), 0);
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
          term.write(bytes);
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
          const encoder = new TextEncoder();
          const bytes = Array.from(encoder.encode(cleaned));
          api.sessionWrite(sessionIdRef.current, bytes).catch((err) => toast.error(String(err)));
        }
      }
    };
    window.addEventListener("terminal:insert-selection", handleInsertSelection);

    // IME composition handling
    const termEl = term.element;
    const handleCompositionStart = () => { composingRef.current = true; };
    const handleCompositionEnd = () => { composingRef.current = false; };
    termEl?.addEventListener("compositionstart", handleCompositionStart);
    termEl?.addEventListener("compositionend", handleCompositionEnd);

    // Middle-click paste (via Tauri clipboard plugin, no permission prompt)
    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      readText().then((text) => {
        if (text) {
          const encoder = new TextEncoder();
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
      termEl?.removeEventListener("compositionstart", handleCompositionStart);
      termEl?.removeEventListener("compositionend", handleCompositionEnd);
      termElForMouse?.removeEventListener("mousedown", handleMiddleClick);
    };
  }, [sessionId, hostId, tabId, updateTabState, checkAssistTrigger]);

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
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60">
          <Zap size={40} className="mb-3 text-yellow-400" />
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            {t("term.disconnected")}
          </p>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-60"
          >
            <Zap size={16} />
            {reconnecting ? t("term.reconnecting") : t("term.reconnect")}
          </button>
        </div>
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
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const closeSplit = useTerminalStore((s) => s.closeSplit);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const [showHistory, setShowHistory] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const dragStartXRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const ignoreClickRef = useRef(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);

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
        ]);
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
        });
      } catch {
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

      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(command));
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

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--font-size-lg)] font-medium text-[var(--color-text-secondary)]">
            {t("term.noActiveSessions")}
          </p>
          <p className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("term.goToConnections")}
          </p>
          <button
            onClick={goToConnections}
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[var(--font-size-sm)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Plus size={16} />
            {t("term.openConnections")}
          </button>
        </div>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const hasBgImage = termSettings?.bgSource === "image" && termSettings?.bgImagePath;
  const bgOpacity = (termSettings?.bgOpacity ?? 100) / 100;
  const bgBlur = termSettings?.bgBlur ?? 0;

  return (
    <div className="flex flex-1 overflow-hidden" style={{ userSelect: "text" }}>
      <div className="flex flex-1 flex-col overflow-hidden">
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
          className="flex h-[var(--height-tabbar)] border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]"
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
          <div className="flex h-[var(--height-tabbar)] flex-1 items-center gap-1 overflow-x-auto px-2 min-w-0">
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
                  "group flex h-7 items-center gap-2 px-3 text-[var(--font-size-xs)] select-none rounded-[var(--radius-control)]",
                  tab.id === activeTabId
                    ? "bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border border-[var(--color-border)] shadow-[var(--shadow-card)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]",
                  draggingTabId === tab.id && "opacity-90 z-10",
                )}
                style={{
                  width: 120,
                  flexShrink: 0,
                  ...(draggingTabId ? (() => {
                    const fromIndex = tabs.findIndex((t) => t.id === draggingTabId);
                    const toIndex = dragOverIndex ?? fromIndex;
                    const TAB_WIDTH = 120;
                    const TAB_GAP = 4;

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
                        // Dragging right: tabs between from and to shift left
                        if (index > fromIndex && index <= toIndex) {
                          shift = -(TAB_WIDTH + TAB_GAP);
                        }
                      } else if (toIndex < fromIndex) {
                        // Dragging left: tabs between to and from shift right
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
                }}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    tab.state === "connected"
                    ? "bg-[var(--color-success)]"
                    : tab.state === "failed"
                      ? "bg-[var(--color-error)]"
                      : "bg-[var(--color-text-muted)]",
                )}
              />
              <span className="flex-1 truncate">{tab.title}</span>
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
                className="ml-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label={t("confirm.closeSessionTitle")}
              >
                <X size={12} />
              </button>
              </div>
            </div>
          ))}
          </div>

          {/* Right controls - fixed */}
          <div className="flex h-[var(--height-tabbar)] shrink-0 items-center px-1">

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
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[var(--font-size-xs)] transition-colors",
              showHistory
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
            )}
          >
            <History size={14} />
            {!showHistory && <span>{t("term.history")}</span>}
          </button>
        </div>
        </div>

        {/* Terminal area */}
        <div
          ref={containerRef}
          className={cn(
            "relative flex-1 overflow-hidden",
            splitDirection === "horizontal" ? "flex flex-col" : "flex flex-row",
          )}
          style={{
            backgroundColor: hasBgImage ? "transparent" : (termSettings?.bgColor ?? "#0F1115"),
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
          {/* Primary pane */}
          <div
            className="relative z-10 overflow-hidden"
            style={
              splitDirection
                ? splitDirection === "horizontal"
                  ? { height: `${splitRatio * 100}%` }
                  : { width: `${splitRatio * 100}%` }
                : { width: "100%", height: "100%" }
            }
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "h-full w-full",
                  tab.id === activeTabId ? "block" : "hidden",
                )}
              >
                {termSettings && (
                  <TerminalInstance key={`${tab.id}-${settingsVersion}`} tabId={tab.id} sessionId={tab.sessionId} hostId={tab.hostId} termSettings={termSettings} />
                )}
              </div>
            ))}
          </div>

          {/* Resize handle + second pane */}
          {splitDirection && splitSessionId && (
            <>
              <ResizeHandle direction={splitDirection} onResize={handleResize} />
              <div
                className="relative z-10 overflow-hidden"
                style={
                  splitDirection === "horizontal"
                    ? { height: `${(1 - splitRatio) * 100}%` }
                    : { width: `${(1 - splitRatio) * 100}%` }
                }
              >
                {termSettings && (
                  <TerminalInstance
                    key={`split-${splitSessionId}-${settingsVersion}`}
                    tabId={activeTab?.id ?? ""}
                    sessionId={splitSessionId}
                    hostId={activeTab?.hostId ?? ""}
                    termSettings={termSettings}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Command History Panel */}
      <div
        className={cn(
          "shrink-0 overflow-hidden transition-[width] duration-[var(--duration-panel)] ease-[var(--ease-smooth)]",
          showHistory ? "w-[280px]" : "w-0",
        )}
      >
        {showHistory && (
          <CommandHistoryPanel
            onInsert={handleInsertCommand}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
    </div>
  );
}
