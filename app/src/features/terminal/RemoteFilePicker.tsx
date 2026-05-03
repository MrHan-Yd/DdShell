import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Clock, FileText, Folder, FolderOpen, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import { getRemoteDirPath, recordQuickEditPickerDir } from "@/lib/quickEditPickerDir";
import { readQuickEditRecents } from "@/lib/quickEditRecent";
import type { FileEntry, QuickEditRecentItem } from "@/types";
import { getParentDir } from "./cwdInfer";

export interface RemoteFilePickerProps {
  open: boolean;
  sessionId: string;
  hostId?: string | null;
  hostName: string;
  /** 起点目录；空或失败时 fallback 到 "/" */
  initialPath: string;
  /** 进入目录后若列表中存在该名，则预选 */
  prefilterFileName?: string | null;
  /** 用户选定文件后回调：传出绝对路径 */
  onPick: (absolutePath: string) => void;
  onClose: () => void;
}

const ROOT = "/";
const isMac = navigator.platform.toUpperCase().includes("MAC");

function normalizeDir(input: string): string {
  if (!input) return ROOT;
  let s = input.trim();
  if (s === "~" || s.startsWith("~/") || s.startsWith("$")) return s;
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s || ROOT;
}

async function expandSimpleEnvPath(sessionId: string, path: string): Promise<string> {
  if (path.includes("$(") || path.includes("`")) return path;

  const names = Array.from(new Set(
    Array.from(path.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g), (match) => match[1]),
  ));
  let expanded = path;
  for (const name of names) {
    const value = await api.sshEnvGet(sessionId, name).catch(() => null);
    if (!value) continue;
    expanded = expanded.replace(new RegExp(`\\$${name}(?=\\/|$)`, "g"), value);
  }
  return expanded;
}

function joinPath(dir: string, name: string): string {
  return dir === ROOT ? `/${name}` : `${dir}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function sortEntries(entries: FileEntry[], showHidden: boolean): FileEntry[] {
  const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  return filtered.slice().sort((a, b) => {
    // 目录在前；symlink 与 file 同级
    const aDir = a.fileType === "dir";
    const bDir = b.fileType === "dir";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function fuzzyMatch(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = value.toLowerCase();
  let pos = 0;
  for (const char of needle) {
    pos = haystack.indexOf(char, pos);
    if (pos === -1) return false;
    pos += 1;
  }
  return true;
}

export function RemoteFilePicker({
  open,
  sessionId,
  hostId,
  hostName,
  initialPath,
  prefilterFileName,
  onPick,
  onClose,
}: RemoteFilePickerProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>(() => normalizeDir(initialPath || ROOT));
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(currentPath);
  const [query, setQuery] = useState("");
  const [recentItems, setRecentItems] = useState<QuickEditRecentItem[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);

  const listRef = useRef<HTMLDivElement | null>(null);
  // 进场后第一次加载需要应用 prefilterFileName，加载完成消费一次后清掉
  const pendingPrefilterRef = useRef<string | null>(prefilterFileName ?? null);

  const sortedEntries = useMemo(() => sortEntries(entries, showHidden), [entries, showHidden]);
  const visibleEntries = useMemo(
    () => sortedEntries.filter((entry) => fuzzyMatch(entry.name, query)),
    [sortedEntries, query],
  );

  const loadDir = useCallback(
    async (target: string, options?: { preserveForwardStack?: boolean }) => {
      let norm = normalizeDir(target);
      setLoading(true);
      setError(null);
      try {
        if (norm === "~" || norm.startsWith("~/")) {
          norm = await api.sftpCanonicalize(sessionId, norm);
        } else if (norm.startsWith("$")) {
          norm = normalizeDir(await expandSimpleEnvPath(sessionId, norm));
        }
        const list = await api.sftpListDir(sessionId, norm);
        setEntries(list);
        setCurrentPath(norm);
        recordQuickEditPickerDir({ hostId, sessionId, path: norm });
        if (!options?.preserveForwardStack) setForwardStack([]);
        // 若有 prefilter 命中则预选；否则选第一项
        const sorted = sortEntries(list, showHidden);
        const wantName = pendingPrefilterRef.current;
        const idx = wantName ? sorted.findIndex((e) => e.name === wantName) : -1;
        setSelectedIndex(idx >= 0 ? idx : 0);
        setQuery("");
        pendingPrefilterRef.current = null;
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [hostId, sessionId, showHidden],
  );

  // 进场动画 + 初次加载
  useEffect(() => {
    if (!open) {
      setShow(false);
      return;
    }
    requestAnimationFrame(() => setShow(true));
    pendingPrefilterRef.current = prefilterFileName ?? null;
    setRecentItems(readQuickEditRecents().filter((item) => !hostId || item.hostId === hostId));
    void loadDir(initialPath || ROOT);
    // 仅在 open 翻转或起点变化时重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPath, prefilterFileName]);

  // 选中行滚动可见
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, visibleEntries.length]);

  useEffect(() => {
    setSelectedIndex((idx) => Math.min(idx, Math.max(0, visibleEntries.length - 1)));
  }, [visibleEntries.length]);

  const goParent = useCallback(() => {
    if (currentPath === ROOT) return;
    setForwardStack((items) => [currentPath, ...items.filter((item) => item !== currentPath)].slice(0, 20));
    void loadDir(getParentDir(currentPath), { preserveForwardStack: true });
  }, [currentPath, loadDir]);

  const goForward = useCallback(() => {
    const next = forwardStack[0];
    if (!next) return false;
    setForwardStack((items) => items.slice(1));
    void loadDir(next, { preserveForwardStack: true });
    return true;
  }, [forwardStack, loadDir]);

  const enterEntry = useCallback(
    (entry: FileEntry) => {
      const fullPath = joinPath(currentPath, entry.name);
      if (entry.fileType === "dir") {
        void loadDir(fullPath);
        return;
      }
      // file 或 symlink：交给上层（symlink 指向目录的情况后端 read_text 会报错，再交还用户）
      recordQuickEditPickerDir({ hostId, sessionId, path: getRemoteDirPath(fullPath) });
      onPick(fullPath);
    },
    [currentPath, hostId, loadDir, onPick, sessionId],
  );

  const submitPathInput = useCallback(() => {
    const next = normalizeDir(pathDraft);
    setPathEditing(false);
    if (next !== currentPath) void loadDir(next);
    else setPathDraft(currentPath);
  }, [pathDraft, currentPath, loadDir]);

  // 键盘事件：在浮层根上捕获
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // 路径输入框聚焦时不拦截上下导航/回退
      if (pathEditing) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setPathEditing(false);
          setPathDraft(currentPath);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Cmd/Ctrl+. 切换隐藏文件
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setShowHidden((v) => !v);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(visibleEntries.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowLeft" || (e.key === "Backspace" && document.activeElement === document.body)) {
        e.preventDefault();
        e.stopPropagation();
        goParent();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (goForward()) return;
        const entry = visibleEntries[selectedIndex];
        if (entry) enterEntry(entry);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
          const entry = visibleEntries[selectedIndex];
          if (entry) enterEntry(entry);
          return;
        }
      };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, pathEditing, visibleEntries, selectedIndex, currentPath, enterEntry, goParent, goForward, onClose]);

  if (!open) return null;

  const pathSegments = (() => {
    if (currentPath === ROOT) return [{ label: "/", path: ROOT }];
    const parts = currentPath.split("/").filter(Boolean);
    const segs: Array<{ label: string; path: string }> = [{ label: "/", path: ROOT }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      segs.push({ label: p, path: acc });
    }
    return segs;
  })();

  return (
    <div
      data-remote-file-picker
      className={cn(
        "fixed inset-0 z-[120] flex items-center justify-center transition-opacity duration-200 ease-[var(--ease-smooth)]",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "glass-card relative z-10 flex w-[640px] max-w-[92vw] flex-col rounded-[var(--radius-popover)] border border-[var(--color-border)] shadow-[var(--shadow-modal)]",
          "transition-all duration-[280ms] ease-[var(--ease-spring)]",
          show ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        )}
        style={{ height: "min(560px, 80vh)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <button
            type="button"
            onClick={goParent}
            disabled={currentPath === ROOT || loading}
            className={cn(
              "btn-press flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
              currentPath === ROOT || loading
                ? "opacity-40"
                : "hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
            )}
            aria-label={t("terminalPicker.parent")}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] truncate">
              {t("terminalPicker.title", { host: hostName })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadDir(currentPath)}
            disabled={loading}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
            aria-label={t("terminalPicker.refresh")}
          >
            {loading ? (
              <span className="flex h-5 w-5 items-center justify-center">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </span>
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
        </div>

        {/* Path bar */}
        <div className="px-4 pb-2">
          {pathEditing ? (
            <input
              data-quick-editor-root="true"
              autoFocus
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitPathInput();
                }
              }}
              onBlur={submitPathInput}
              className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border-focus)] bg-[var(--color-bg-elevated)] px-3 font-mono text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)]/30"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setPathDraft(currentPath);
                setPathEditing(true);
              }}
              className="flex h-8 w-full items-center gap-0.5 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-left font-mono text-[var(--font-size-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              title={t("terminalPicker.editPath")}
            >
              {pathSegments.map((seg, i) => (
                <span
                  key={i}
                  className={cn(
                    "truncate",
                    i === pathSegments.length - 1
                      ? "text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-muted)]",
                  )}
                >
                  {i === 0 ? "/" : `${seg.label}${i < pathSegments.length - 1 ? "/" : ""}`}
                </span>
              ))}
            </button>
          )}
        </div>

        {/* Search + recent edits */}
        <div className="space-y-2 px-4 pb-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              data-quick-editor-root="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("terminalPicker.search")}
              className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-8 pr-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)]/30"
            />
          </div>

          {recentItems.length > 0 && !query && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]/60 px-2 py-1.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                <Clock size={11} />
                {t("quickEdit.recent")}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {recentItems.slice(0, 6).map((item) => (
                  <button
                    key={`${item.hostId ?? "global"}:${item.remotePath}`}
                    type="button"
                    onClick={() => onPick(item.remotePath)}
                    className="max-w-[180px] shrink-0 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2 py-1 text-left hover:bg-[var(--color-bg-hover)]"
                    title={item.remotePath}
                  >
                    <div className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{item.fileName}</div>
                    <div className="truncate text-[10px] text-[var(--color-text-muted)]">{item.remotePath}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto border-t border-[var(--color-border)] py-1"
          tabIndex={-1}
        >
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-[var(--font-size-sm)] text-[var(--color-error)]">{t("terminalPicker.loadFailed")}</p>
              <p className="font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{error}</p>
              <button
                type="button"
                onClick={() => loadDir(currentPath)}
                className="btn-press mt-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1 text-[var(--font-size-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {t("terminalPicker.retry")}
              </button>
              {currentPath !== ROOT && (
                <button
                  type="button"
                  onClick={goParent}
                  className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline"
                >
                  {t("terminalPicker.goParent")}
                </button>
              )}
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              {t("terminalPicker.empty")}
            </div>
          ) : (
            visibleEntries.map((entry, idx) => {
              const isDir = entry.fileType === "dir";
              const isSym = entry.fileType === "symlink";
              const Icon = isDir ? Folder : isSym ? FolderOpen : FileText;
              const selected = idx === selectedIndex;
              const dim = entry.name.startsWith(".");
              return (
                <button
                  key={`${entry.name}-${idx}`}
                  type="button"
                  data-row-index={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => enterEntry(entry)}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-1.5 text-left text-[var(--font-size-sm)] transition-colors duration-100",
                    selected
                      ? "bg-[var(--color-accent)]/12 text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
                    dim && !selected && "opacity-60",
                  )}
                >
                  <Icon
                    size={14}
                    className={cn(
                      "shrink-0",
                      isDir
                        ? "text-[var(--color-accent)]"
                        : isSym
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--color-text-muted)]",
                    )}
                  />
                  <span className="flex-1 truncate font-mono">{entry.name}</span>
                  {!isDir && (
                    <span className="shrink-0 font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {formatSize(entry.size)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>↑↓ {t("terminalPicker.hintNav")}</span>
            <span>↵ {t("terminalPicker.hintEnter")}</span>
            <span>← {t("terminalPicker.hintBack")}</span>
            <span>→ {t("terminalPicker.hintForward")}</span>
            <span>{isMac ? "⌘." : "Ctrl+."} {t("terminalPicker.hintToggleHidden")}</span>
            <span>Esc {t("terminalPicker.hintClose")}</span>
          </div>
          {showHidden && <span className="text-[var(--color-accent)]">{t("terminalPicker.showingHidden")}</span>}
        </div>
      </div>
    </div>
  );
}
