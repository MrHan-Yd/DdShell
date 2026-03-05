import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import * as api from "@/lib/tauri";
import "@xterm/xterm/css/xterm.css";

function TerminalInstance({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const updateTabState = useTerminalStore((s) => s.updateTabState);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0F1115",
        foreground: "#E5E7EB",
        cursor: "#3B82F6",
        selectionBackground: "rgba(59, 130, 246, 0.3)",
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
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL fallback: canvas renderer is fine
    }
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    termRef.current = term;

    // Handle user input -> SSH
    const onData = term.onData((data) => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      api.sessionWrite(sessionId, bytes).catch(() => {
        // write failure handled by state events
      });
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

    // Initial resize notification
    api.sessionResize(sessionId, term.cols, term.rows).catch(() => {});

    // Focus terminal
    term.focus();

    return () => {
      onData.dispose();
      onResize.dispose();
      unlisten.then((fn) => fn());
      unlistenState.then((fn) => fn());
      term.dispose();
    };
  }, [sessionId, updateTabState]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: "4px 8px" }}
    />
  );
}

export function TerminalPage() {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  const goToConnections = useCallback(() => {
    setCurrentPage("connections");
  }, [setCurrentPage]);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--font-size-lg)] font-medium text-[var(--color-text-secondary)]">
            No active sessions
          </p>
          <p className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            Go to Connections to connect to a host.
          </p>
          <button
            onClick={goToConnections}
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[var(--font-size-sm)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Plus size={16} />
            Open Connections
          </button>
        </div>
      </div>
    );
  }

  return (
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
      </div>

      {/* Terminal area */}
      <div className="flex-1 overflow-hidden bg-[#0F1115]">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "h-full w-full",
              tab.id === activeTabId ? "block" : "hidden",
            )}
          >
            <TerminalInstance sessionId={tab.sessionId} />
          </div>
        ))}
      </div>
    </div>
  );
}
