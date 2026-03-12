import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { FitAddon } from "@xterm/addon-fit";
import { X, Plus, History, Search, SplitSquareHorizontal, SplitSquareVertical, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import * as api from "@/lib/tauri";
import type { CommandHistoryItem } from "@/types";
import { useT } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
import "@xterm/xterm/css/xterm.css";

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
    selectionBg?: string;
    bgSource?: string;
    bgColor?: string;
    bgImagePath?: string | null;
    bgOpacity?: number;
    bgBlur?: number;
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
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const termSettingsRef = useRef(termSettings);
  termSettingsRef.current = termSettings;
  const t = useT();

  // Effect 1: Create xterm instance (once, independent of sessionId)
  useEffect(() => {
    if (!containerRef.current) return;

    const ts = termSettingsRef.current;
    const term = new Terminal({
      cursorBlink: true,
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
        black: "#1B2130",
        red: "#EF4444",
        green: "#22C55E",
        yellow: "#F59E0B",
        blue: "#3B82F6",
        magenta: "#A855F7",
        cyan: "#06B6D4",
        white: "#E5E7EB",
        brightBlack: "#6B7280",
        brightRed: "#F87171",
        brightGreen: "#4ADE80",
        brightYellow: "#FBBF24",
        brightBlue: "#60A5FA",
        brightMagenta: "#C084FC",
        brightCyan: "#22D3EE",
        brightWhite: "#F9FAFB",
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
    const resizeObserver = new ResizeObserver((entries) => {
      // Skip fit when container is hidden (width/height = 0) to avoid
      // sending bogus resize sequences that show up as visible characters
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      try { fitAddon.fit(); } catch { /* ignore if disposed */ }
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
      const sid = sessionIdRef.current;
      if (data === "\r" || data === "\n") {
        const cmd = cmdBufferRef.current.trim();
        if (cmd.length > 0) {
          api.commandHistoryInsert(sid, hostId, cmd).then(() => {
            window.dispatchEvent(new Event("command-history-updated"));
          }).catch(() => {});
        }
        cmdBufferRef.current = "";
      } else if (data === "\x7f" || data === "\b") {
        cmdBufferRef.current = cmdBufferRef.current.slice(0, -1);
      } else if (data === "\x03") {
        cmdBufferRef.current = "";
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        cmdBufferRef.current += data;
      }

      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      api.sessionWrite(sid, bytes).catch(() => {});
    });

    // Handle resize -> SSH (skip when container is hidden)
    const onResize = term.onResize(({ cols, rows }) => {
      if (cols <= 1 || rows <= 1) return;
      api.sessionResize(sessionIdRef.current, cols, rows).catch(() => {});
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
          api.sessionWrite(sessionIdRef.current, bytes).catch(() => {});
        }
      }
    };
    window.addEventListener("terminal:insert-selection", handleInsertSelection);

    // Middle-click paste (via Tauri clipboard plugin, no permission prompt)
    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      readText().then((text) => {
        if (text) {
          const encoder = new TextEncoder();
          const bytes = Array.from(encoder.encode(text));
          api.sessionWrite(sessionIdRef.current, bytes).catch(() => {});
        }
      }).catch(() => {});
    };
    const termEl = term.element;
    termEl?.addEventListener("mousedown", handleMiddleClick);

    // Initial resize notification
    api.sessionResize(sessionId, term.cols, term.rows).catch(() => {});

    term.focus();

    return () => {
      onData.dispose();
      onResize.dispose();
      unlisten.then((fn) => fn());
      unlistenState.then((fn) => fn());
      window.removeEventListener("terminal:insert-selection", handleInsertSelection);
      termEl?.removeEventListener("mousedown", handleMiddleClick);
    };
  }, [sessionId, hostId, tabId, updateTabState]);

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

  const fetchHistory = useCallback(async () => {
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
  }, [activeTab?.hostId, searchQuery]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-scroll to bottom when items change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items]);

  // Listen for new commands inserted (use ref to avoid stale closures)
  const fetchRef = useRef(fetchHistory);
  fetchRef.current = fetchHistory;
  useEffect(() => {
    const handler = () => fetchRef.current();
    window.addEventListener("command-history-updated", handler);
    return () => window.removeEventListener("command-history-updated", handler);
  }, []);

  return (
    <div className="flex h-full w-[280px] flex-col border-l border-[var(--color-border)] glass-surface">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-[var(--font-size-sm)] font-medium">{t("term.history")}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 hover:bg-[var(--color-bg-hover)]"
        >
          <X size={14} />
        </button>
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
          foreground, cursor, selectionBg,
          bgSource, bgColor, bgImagePath, bgOpacity, bgBlur,
        ] = await Promise.all([
          api.settingGet("terminal.fontFamily"),
          api.settingGet("terminal.fontSize"),
          api.settingGet("terminal.fontWeight"),
          api.settingGet("terminal.lineHeight"),
          api.settingGet("terminal.fontLigatures"),
          api.settingGet("terminal.foreground"),
          api.settingGet("terminal.cursor"),
          api.settingGet("terminal.selectionBg"),
          api.settingGet("terminal.bgSource"),
          api.settingGet("terminal.bgColor"),
          api.settingGet("terminal.bgImagePath"),
          api.settingGet("terminal.bgOpacity"),
          api.settingGet("terminal.bgBlur"),
        ]);
        setTermSettings({
          fontFamily: fontFamily || undefined,
          fontSize: fontSize ? parseInt(fontSize) : undefined,
          fontWeight: fontWeight ? parseInt(fontWeight) : undefined,
          lineHeight: lineHeight ? parseFloat(lineHeight) : undefined,
          fontLigatures: fontLigatures === "true",
          foreground: foreground || undefined,
          cursor: cursor || undefined,
          selectionBg: selectionBg || undefined,
          bgSource: bgSource || undefined,
          bgColor: bgColor || undefined,
          bgImagePath: bgImagePath || null,
          bgOpacity: bgOpacity ? parseInt(bgOpacity) : undefined,
          bgBlur: bgBlur ? parseInt(bgBlur) : undefined,
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
      api.sessionWrite(activeTab.sessionId, bytes).catch(() => {});
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
    <div className="flex flex-1 overflow-hidden">
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
            setIsDropping(false);
          }}
          onMouseLeave={() => {
            if (!draggingTabId) return;
            setDraggingTabId(null);
            setDragOverIndex(null);
            setDragDeltaX(0);
            dragStartXRef.current = null;
            dragMovedRef.current = false;
            setIsDropping(false);
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
