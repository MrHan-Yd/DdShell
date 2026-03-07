import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { FitAddon } from "@xterm/addon-fit";
import { X, Plus, History, Search, SplitSquareHorizontal, SplitSquareVertical, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import * as api from "@/lib/tauri";
import type { CommandHistoryItem } from "@/types";
import { useT } from "@/lib/i18n";
import "@xterm/xterm/css/xterm.css";

/** Strip ANSI escape sequences and trim whitespace */
function cleanSelection(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function TerminalInstance({
  sessionId,
  hostId,
  termSettings,
}: {
  sessionId: string;
  hostId: string;
  termSettings?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
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
  const updateTabState = useTerminalStore((s) => s.updateTabState);
  const cmdBufferRef = useRef<string>("");

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: termSettings?.fontSize ?? 14,
      fontFamily: termSettings?.fontFamily ?? "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontWeight: (termSettings?.fontWeight ?? 400) as any,
      lineHeight: termSettings?.lineHeight ?? 1.4,
      allowTransparency: true,
      allowProposedApi: true,
      theme: {
        background: termSettings?.bgSource === "image" && termSettings?.bgImagePath
          ? "#00000000"
          : (termSettings?.bgColor ?? "#0F1115"),
        foreground: termSettings?.foreground ?? "#E5E7EB",
        cursor: termSettings?.cursor ?? "#3B82F6",
        selectionBackground: termSettings?.selectionBg ?? "rgba(59, 130, 246, 0.3)",
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

    // Load addons
    // WebGL addon does not support transparent backgrounds, skip it when using bg image
    const usesBgImage = termSettings?.bgSource === "image" && termSettings?.bgImagePath;
    if (!usesBgImage) {
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL fallback: canvas renderer is fine
      }
    }
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;

    // Fit terminal to container and keep it fitted on resize
    fitAddon.fit();
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore if disposed */ }
    });
    resizeObserver.observe(containerRef.current);

    // Handle user input -> SSH
    const onData = term.onData((data) => {
      // Track command input for history
      if (data === "\r" || data === "\n") {
        const cmd = cmdBufferRef.current.trim();
        if (cmd.length > 0) {
          api.commandHistoryInsert(sessionId, hostId, cmd).catch(() => {});
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
      api.sessionWrite(sessionId, bytes).catch(() => {});
    });

    // Handle resize -> SSH
    const onResize = term.onResize(({ cols, rows }) => {
      api.sessionResize(sessionId, cols, rows).catch(() => {});
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
          if (
            event.payload.state === "disconnected" ||
            event.payload.state === "failed"
          ) {
            term.write(
              `\r\n\x1b[31m[Session ${event.payload.state}]\x1b[0m\r\n`,
            );
          }
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
          api.sessionWrite(sessionId, bytes).catch(() => {});
        }
      }
    };
    window.addEventListener("terminal:insert-selection", handleInsertSelection);

    // Listen for clear shortcut event (Cmd+L)
    const handleClear = () => {
      term.clear();
    };
    window.addEventListener("terminal:clear", handleClear);

    // Initial resize notification
    api.sessionResize(sessionId, term.cols, term.rows).catch(() => {});

    // Focus terminal
    term.focus();

    return () => {
      resizeObserver.disconnect();
      onData.dispose();
      onResize.dispose();
      unlisten.then((fn) => fn());
      unlistenState.then((fn) => fn());
      window.removeEventListener("terminal:insert-selection", handleInsertSelection);
      window.removeEventListener("terminal:clear", handleClear);
      term.dispose();
    };
  }, [sessionId, hostId, updateTabState, termSettings]);

  const hasBgImage = termSettings?.bgSource === "image" && termSettings?.bgImagePath;

  return (
    <div
      ref={containerRef}
      className={cn("h-full w-full", hasBgImage && "xterm-bg-transparent")}
      style={{ padding: "2px 4px 0" }}
    />
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

  return (
    <div className="flex w-[280px] flex-col border-l border-[var(--color-border)] glass-surface">
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

      <div className="flex-1 overflow-y-auto">
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
  const splitDirection = useTerminalStore((s) => s.splitDirection);
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const splitPane = useTerminalStore((s) => s.splitPane);
  const closeSplit = useTerminalStore((s) => s.closeSplit);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const [showHistory, setShowHistory] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load terminal settings from backend
  const [termSettings, setTermSettings] = useState<Record<string, any> | undefined>(undefined);
  useEffect(() => {
    (async () => {
      try {
        const [
          fontFamily, fontSize, fontWeight, lineHeight,
          foreground, cursor, selectionBg,
          bgSource, bgColor, bgImagePath, bgOpacity, bgBlur,
        ] = await Promise.all([
          api.settingGet("terminal.fontFamily"),
          api.settingGet("terminal.fontSize"),
          api.settingGet("terminal.fontWeight"),
          api.settingGet("terminal.lineHeight"),
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
    })();
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
        <div className="flex h-[var(--height-tabbar)] items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "group flex h-8 items-center gap-2 rounded-t-lg px-3 text-[var(--font-size-xs)] transition-colors cursor-default",
                tab.id === activeTabId
                  ? "bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]",
              )}
              onClick={() => setActiveTab(tab.id)}
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
              <span className="max-w-[120px] truncate">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(tab.id);
                }}
                className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-bg-hover)] transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          <div className="flex-1" />

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
                <TerminalInstance sessionId={tab.sessionId} hostId={tab.hostId} termSettings={termSettings} />
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
                <TerminalInstance
                  sessionId={splitSessionId}
                  hostId={activeTab?.hostId ?? ""}
                  termSettings={termSettings}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Command History Panel */}
      {showHistory && (
        <CommandHistoryPanel
          onInsert={handleInsertCommand}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
