import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Folder, Loader2, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import type { FileEntry } from "@/types";
import { getParentDir } from "./cwdInfer";

export interface RemoteDirectoryPickerProps {
  open: boolean;
  sessionId: string;
  hostName: string;
  initialPath: string;
  title: string;
  confirmLabel: string;
  onPick: (absolutePath: string) => void;
  onClose: () => void;
}

const ROOT = "/";

function normalizeDir(input: string): string {
  if (!input) return ROOT;
  let value = input.trim();
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value || ROOT;
}

function joinPath(dir: string, name: string): string {
  return dir === ROOT ? `/${name}` : `${dir}/${name}`;
}

function fuzzyMatch(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return value.toLowerCase().includes(needle);
}

export function RemoteDirectoryPicker({
  open,
  sessionId,
  hostName,
  initialPath,
  title,
  confirmLabel,
  onPick,
  onClose,
}: RemoteDirectoryPickerProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [currentPath, setCurrentPath] = useState(() => normalizeDir(initialPath || ROOT));
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(currentPath);

  const directories = useMemo(
    () =>
      entries
        .filter((entry) => entry.fileType === "dir" && fuzzyMatch(entry.name, query))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    [entries, query],
  );

  const loadDir = useCallback(
    async (target: string) => {
      const normalized = normalizeDir(target);
      setLoading(true);
      setError(null);
      try {
        const list = await api.sftpListDir(sessionId, normalized);
        setEntries(list);
        setCurrentPath(normalized);
        setPathDraft(normalized);
        setQuery("");
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!open) {
      setShow(false);
      return;
    }
    requestAnimationFrame(() => setShow(true));
    void loadDir(initialPath || ROOT);
  }, [open, initialPath, loadDir]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (pathEditing) {
          setPathEditing(false);
          setPathDraft(currentPath);
        } else {
          onClose();
        }
        return;
      }

      if (pathEditing) return;

      if (event.key === "Backspace" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        if (currentPath !== ROOT) void loadDir(getParentDir(currentPath));
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [currentPath, loadDir, onClose, open, pathEditing]);

  const pathSegments = useMemo(() => {
    if (currentPath === ROOT) return [{ label: "/", path: ROOT }];
    const parts = currentPath.split("/").filter(Boolean);
    const segments: Array<{ label: string; path: string }> = [{ label: "/", path: ROOT }];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      segments.push({ label: part, path: acc });
    }
    return segments;
  }, [currentPath]);

  const submitPathInput = useCallback(() => {
    const next = normalizeDir(pathDraft);
    setPathEditing(false);
    if (next !== currentPath) void loadDir(next);
  }, [currentPath, loadDir, pathDraft]);

  if (!open) return null;

  return (
    <div
      data-remote-directory-picker
      className={cn(
        "fixed inset-0 z-[125] flex items-center justify-center transition-opacity duration-200 ease-[var(--ease-smooth)]",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "glass-card relative z-10 flex w-[560px] max-w-[92vw] flex-col rounded-[var(--radius-popover)] border border-[var(--color-border)] shadow-[var(--shadow-modal)]",
          "transition-all duration-[280ms] ease-[var(--ease-spring)]",
          show ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        )}
        style={{ height: "min(500px, 78vh)" }}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <button
            type="button"
            onClick={() => currentPath !== ROOT && void loadDir(getParentDir(currentPath))}
            disabled={currentPath === ROOT || loading}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
            aria-label={t("terminalPicker.parent")}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {title}
            </div>
            <div className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {hostName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadDir(currentPath)}
            disabled={loading}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
            aria-label={t("terminalPicker.refresh")}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            aria-label={t("terminalPicker.hintClose")}
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-4 pb-2">
          {pathEditing ? (
            <input
              autoFocus
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPathInput();
                }
              }}
              onBlur={submitPathInput}
              className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border-focus)] bg-[var(--color-bg-elevated)] px-3 font-mono text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:outline-none"
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
              {pathSegments.map((segment, index) => (
                <span
                  key={segment.path}
                  className={cn(
                    "truncate",
                    index === pathSegments.length - 1
                      ? "text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-muted)]",
                  )}
                >
                  {index === 0 ? "/" : `${segment.label}${index < pathSegments.length - 1 ? "/" : ""}`}
                </span>
              ))}
            </button>
          )}
        </div>

        <div className="relative px-4 pb-2">
          <Search size={13} className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("terminalFileManager.searchFolders")}
            className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-8 pr-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focus)] focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto border-t border-[var(--color-border)] py-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-[var(--font-size-sm)] text-[var(--color-error)]">{t("terminalPicker.loadFailed")}</span>
              <span className="font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{error}</span>
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : directories.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              {t("terminalFileManager.noFolders")}
            </div>
          ) : (
            directories.map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => loadDir(joinPath(currentPath, entry.name))}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[var(--font-size-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              >
                <Folder size={14} className="shrink-0 text-[var(--color-accent)]" />
                <span className="flex-1 truncate font-mono">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-2">
          <span className="min-w-0 truncate font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {currentPath}
          </span>
          <button
            type="button"
            onClick={() => onPick(currentPath)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
