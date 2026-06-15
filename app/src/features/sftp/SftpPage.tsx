import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { basename, dirname, downloadDir, join } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Folder,
  File,
  FileSymlink,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  FolderPlus,
  Trash2,
  Pencil,
  ChevronRight,
  X,
  Loader2,
  HardDrive,
  Upload,
  Monitor,
  Star,
  StarOff,
  Clock,
  FolderOpen,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/themed/Input";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/utils";
import { useSftpStore, initSftpListeners } from "@/stores/sftp";
import { useTerminalStore } from "@/stores/terminal";
import { useConnectionsStore } from "@/stores/connections";
import * as api from "@/lib/tauri";
import type { LocalFileEntry } from "@/lib/tauri";
import { toast } from "@/stores/toast";
import { confirm, useConfirmStore } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
import type { FileEntry, TransferTask, FavoritePath, RecentPath, QuickEditRecentItem } from "@/types";
import { openQuickEditWindow } from "@/lib/quickEditWindow";
import { clearQuickEditRecents, readQuickEditRecents, recordQuickEditRecent } from "@/lib/quickEditRecent";

type UploadTask = {
  localPaths: string[];
  remoteDir: string;
};

type Translate = ReturnType<typeof useT>;

const OVERWRITE_PREVIEW_LIMIT = 5;
const QUICK_EDIT_MAX_BYTES = 1024 * 1024;
const QUICK_EDIT_TEXT_EXTENSIONS = new Set([
  ".conf",
  ".config",
  ".cfg",
  ".cnf",
  ".css",
  ".csv",
  ".env",
  ".gitignore",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".lua",
  ".md",
  ".mjs",
  ".properties",
  ".py",
  ".rs",
  ".scss",
  ".service",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const QUICK_EDIT_TEXT_FILENAMES = new Set([
  ".bash_profile",
  ".bashrc",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.example",
  ".gitconfig",
  ".npmrc",
  ".profile",
  ".zprofile",
  ".zshrc",
  "dockerfile",
  "hosts",
  "makefile",
  "nginx.conf",
]);

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}

function joinRemotePath(dir: string, name: string): string {
  if (dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function getRemoteDirPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}

function isLikelyQuickEditFile(entry: FileEntry): boolean {
  if (entry.fileType !== "file") return false;
  if (entry.size > QUICK_EDIT_MAX_BYTES) return false;

  const lowerName = entry.name.toLowerCase();
  if (QUICK_EDIT_TEXT_FILENAMES.has(lowerName)) return true;
  if (lowerName.startsWith(".env")) return true;

  const lastDotIndex = lowerName.lastIndexOf(".");
  if (lastDotIndex === -1) return false;
  return QUICK_EDIT_TEXT_EXTENSIONS.has(lowerName.slice(lastDotIndex));
}

async function collectExistingRemoteUploadTargets(
  sessionId: string,
  uploadTasks: UploadTask[],
): Promise<string[]> {
  const namesByRemoteDir = new Map<string, Set<string>>();

  for (const task of uploadTasks) {
    const fileNames = namesByRemoteDir.get(task.remoteDir) ?? new Set<string>();
    for (const localPath of task.localPaths) {
      const fileName = getPathName(localPath);
      if (fileName) fileNames.add(fileName);
    }
    namesByRemoteDir.set(task.remoteDir, fileNames);
  }

  const duplicateLists = await Promise.all(
    Array.from(namesByRemoteDir.entries()).map(async ([remoteDir, fileNames]) => {
      try {
        const entries = await api.sftpListDir(sessionId, remoteDir);
        const existingNames = new Set(entries.map((entry) => entry.name));
        return Array.from(fileNames)
          .filter((fileName) => existingNames.has(fileName))
          .map((fileName) => joinRemotePath(remoteDir, fileName));
      } catch {
        // Missing remote directories are created during upload, so they cannot overwrite yet.
        return [];
      }
    }),
  );

  return Array.from(new Set(duplicateLists.flat())).sort((a, b) => a.localeCompare(b));
}

async function resolveDownloadBaseDir(): Promise<string> {
  const configuredPath = await api.settingGet("transfer.downloadPath");
  if (configuredPath?.trim()) return configuredPath.trim();

  try {
    return await downloadDir();
  } catch {
    const homeDir = await api.localHomeDir();
    return join(homeDir, "Downloads");
  }
}

async function resolveDownloadTargetPath(
  baseDir: string,
  remotePath: string,
  subPath?: string,
): Promise<string> {
  if (subPath?.trim()) return join(baseDir, subPath);
  return join(baseDir, getPathName(remotePath) || "download");
}

async function collectExistingLocalTargets(paths: string[]): Promise<string[]> {
  const uniquePaths = Array.from(new Set(paths));
  const targetInfo = await Promise.all(
    uniquePaths.map(async (targetPath) => ({
      targetPath,
      parentDir: await dirname(targetPath),
      fileName: await basename(targetPath),
    })),
  );

  const targetsByParent = new Map<string, Map<string, string>>();
  for (const target of targetInfo) {
    const filesInParent = targetsByParent.get(target.parentDir) ?? new Map<string, string>();
    filesInParent.set(target.fileName, target.targetPath);
    targetsByParent.set(target.parentDir, filesInParent);
  }

  const duplicateLists = await Promise.all(
    Array.from(targetsByParent.entries()).map(async ([parentDir, files]) => {
      try {
        const entries = await api.localListDir(parentDir);
        const existingNames = new Set(entries.map((entry) => entry.name));
        return Array.from(files.entries())
          .filter(([fileName]) => existingNames.has(fileName))
          .map(([, targetPath]) => targetPath);
      } catch {
        // Nested download directories are created during transfer if they do not exist yet.
        return [];
      }
    }),
  );

  return Array.from(new Set(duplicateLists.flat())).sort((a, b) => a.localeCompare(b));
}

async function confirmOverwritePaths(
  t: Translate,
  direction: "upload" | "download",
  loadPaths: () => Promise<string[]>,
): Promise<boolean> {
  const confirmResult = useConfirmStore.getState()._show({
    title: t("confirm.overwriteTitle"),
    description: t("confirm.overwriteChecking"),
    confirmLabel: t("confirm.overwriteAction"),
    cancelLabel: t("confirm.cancel"),
    scanning: true,
  });
  const confirmResolve = useConfirmStore.getState()._resolve;

  let paths: string[];
  try {
    paths = await loadPaths();
  } catch (error) {
    if (useConfirmStore.getState()._resolve === confirmResolve) {
      useConfirmStore.getState()._respond(true);
    }
    console.warn("overwrite pre-check failed, continuing transfer", error);
    return true;
  }

  if (paths.length === 0) {
    if (useConfirmStore.getState()._resolve === confirmResolve) {
      useConfirmStore.getState()._respond(true);
    }
    return true;
  }

  const preview = paths
    .slice(0, OVERWRITE_PREVIEW_LIMIT)
    .map((path) => `- ${path}`)
    .join("\n");
  const moreCount = paths.length - OVERWRITE_PREVIEW_LIMIT;
  const intro =
    direction === "upload"
      ? t("confirm.overwriteUploadDesc", { n: paths.length })
      : t("confirm.overwriteDownloadDesc", { n: paths.length });
  const moreLine = moreCount > 0 ? `\n${t("confirm.overwriteMore", { n: moreCount })}` : "";

  if (useConfirmStore.getState()._resolve !== confirmResolve) {
    return confirmResult;
  }

  useConfirmStore.getState().updateOptions({
    scanning: false,
    description: `${intro}\n\n${preview}${moreLine}`,
  });

  return confirmResult;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTime(mtime: number): string {
  if (mtime === 0) return "-";
  return new Date(mtime * 1000).toLocaleString();
}

function formatPermissions(mode: number, fileType: string): string {
  const typeChar = fileType === "dir" ? "d" : fileType === "symlink" ? "l" : "-";
  const owner = ((mode >> 6) & 7);
  const group = ((mode >> 3) & 7);
  const other = (mode & 7);
  const rwx = (bits: number) => `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${bits & 1 ? "x" : "-"}`;
  return `${typeChar}${rwx(owner)}${rwx(group)}${rwx(other)}`;
}

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.fileType === "dir")
    return <Folder size={16} className="text-[var(--color-accent)]" />;
  if (entry.fileType === "symlink")
    return <FileSymlink size={16} className="text-[var(--color-text-muted)]" />;
  return <File size={16} className="text-[var(--color-text-muted)]" />;
}

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  return (
    <div className="flex items-center gap-0.5 text-[var(--font-size-xs)] overflow-x-auto">
      <button
        onClick={() => onNavigate("/")}
        className="px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] shrink-0"
      >
        /
      </button>
      {parts.map((part, i) => {
        const target = "/" + parts.slice(0, i + 1).join("/");
        return (
          <div key={target} className="flex items-center shrink-0">
            <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
            <button
              onClick={() => onNavigate(target)}
              className={cn(
                "px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)]",
                i === parts.length - 1
                  ? "text-[var(--color-text-primary)] font-medium"
                  : "text-[var(--color-text-muted)]",
              )}
            >
              {part}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── FR-17: Path Tools Dropdown ──

// 本地路径收藏 / 最近访问的 sessionId scope。
// favorite_paths / recent_paths 表的 session_id 字段无外键约束，仅作 key 使用。
// 真实 session id 为 UUID，不会与这个保留串冲突；机器只有一台，所有 host 共享。
const LOCAL_PATH_SCOPE = "__local__";

function PathToolsDropdown({
  sessionId,
  currentPath,
  onNavigate,
}: {
  sessionId: string;
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoritePath[]>([]);
  const [recents, setRecents] = useState<RecentPath[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [loadingRecents, setLoadingRecents] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoadingFavorites(true);
    setLoadingRecents(true);
    try {
      const favs = await api.pathListFavorites(sessionId);
      setFavorites(favs);
    } catch {
      /* ignore */
    } finally {
      setLoadingFavorites(false);
    }
    try {
      const recs = await api.pathListRecent(sessionId, 20);
      setRecents(recs);
    } catch {
      /* ignore */
    } finally {
      setLoadingRecents(false);
    }
  }, [sessionId]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) loadData();
      return next;
    });
  }, [loadData]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleAddFavorite = useCallback(async () => {
    try {
      await api.pathAddFavorite(sessionId, currentPath);
      const favs = await api.pathListFavorites(sessionId);
      setFavorites(favs);
      toast.success("Path added to favorites");
    } catch (err) {
      toast.error(String(err));
    }
  }, [sessionId, currentPath]);

  const handleRemoveFavorite = useCallback(
    async (id: string) => {
      try {
        await api.pathRemoveFavorite(id);
        const favs = await api.pathListFavorites(sessionId);
        setFavorites(favs);
      } catch (err) {
        toast.error(String(err));
      }
    },
    [sessionId],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      onNavigate(path);
      setOpen(false);
    },
    [onNavigate],
  );

  const isCurrentFavorite = favorites.some((f) => f.path === currentPath);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleOpen}
        className={cn(
          "p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors",
          open && "bg-[var(--color-bg-hover)]",
        )}
        title="Path tools (favorites & recent)"
      >
        <Star
          size={14}
          className={cn(
            isCurrentFavorite
              ? "text-[var(--color-warning)] fill-[var(--color-warning)]"
              : "text-[var(--color-text-muted)]",
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-popover)] overflow-hidden">
          {/* Favorites section */}
          <div className="border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <Star size={12} className="text-[var(--color-warning)]" />
                {t("sftp.favorites")}
              </span>
              {!isCurrentFavorite && (
                <button
                  onClick={handleAddFavorite}
                  className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline"
                >
                  {t("sftp.addCurrentPath")}
                </button>
              )}
            </div>
            <div className="max-h-[120px] overflow-y-auto">
              {loadingFavorites && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />
                </div>
              )}
              {!loadingFavorites && favorites.length === 0 && (
                <div className="px-3 py-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                  {t("sftp.noFavorites")}
                </div>
              )}
              {!loadingFavorites &&
                favorites.map((fav) => (
                  <div
                    key={fav.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-bg-hover)] cursor-pointer group"
                  >
                    <Star size={12} className="text-[var(--color-warning)] fill-[var(--color-warning)] shrink-0" />
                    <button
                      className="flex-1 text-left text-[var(--font-size-xs)] truncate text-[var(--color-text-primary)]"
                      onClick={() => handleNavigate(fav.path)}
                      title={fav.path}
                    >
                      {fav.label || fav.path}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFavorite(fav.id);
                      }}
                      className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Remove from favorites"
                    >
                      <StarOff size={12} className="text-[var(--color-text-muted)]" />
                    </button>
                  </div>
                ))}
            </div>
          </div>

          {/* Recent section */}
          <div>
            <div className="flex items-center px-3 py-2">
              <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <Clock size={12} className="text-[var(--color-text-muted)]" />
                {t("sftp.recent")}
              </span>
            </div>
            <div className="max-h-[140px] overflow-y-auto">
              {loadingRecents && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />
                </div>
              )}
              {!loadingRecents && recents.length === 0 && (
                <div className="px-3 py-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                  {t("sftp.noRecent")}
                </div>
              )}
              {!loadingRecents &&
                recents.map((rec) => (
                  <button
                    key={rec.id}
                    className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-[var(--color-bg-hover)] cursor-pointer text-left"
                    onClick={() => handleNavigate(rec.path)}
                    title={rec.path}
                  >
                    <Clock size={12} className="text-[var(--color-text-muted)] shrink-0" />
                    <span className="flex-1 text-[var(--font-size-xs)] truncate text-[var(--color-text-primary)]">
                      {rec.path}
                    </span>
                    <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] shrink-0">
                      {new Date(rec.accessedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickEditRecentDropdown({
  hostId,
  onOpen,
}: {
  hostId?: string | null;
  onOpen: (remotePath: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuickEditRecentItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadItems = useCallback(() => {
    const recentItems = readQuickEditRecents().filter((item) => {
      if (!hostId) return true;
      return item.hostId === hostId;
    });
    setItems(recentItems);
  }, [hostId]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) loadItems();
      return next;
    });
  }, [loadItems]);

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback((remotePath: string) => {
    onOpen(remotePath);
    setOpen(false);
  }, [onOpen]);

  const handleClear = useCallback(() => {
    clearQuickEditRecents(hostId);
    setItems([]);
  }, [hostId]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleOpen}
        className={cn(
          "p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors",
          open && "bg-[var(--color-bg-hover)]",
        )}
        title={t("quickEdit.recent")}
      >
        <Clock size={14} className="text-[var(--color-text-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-popover)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
              <Clock size={12} className="text-[var(--color-text-muted)]" />
              {t("quickEdit.recent")}
            </span>
            {items.length > 0 && (
              <button
                onClick={handleClear}
                className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline"
              >
                {t("quickEdit.clearRecent")}
              </button>
            )}
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {items.length === 0 && (
              <div className="px-3 py-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("quickEdit.noRecent")}
              </div>
            )}

            {items.map((item) => (
              <button
                key={`${item.hostId ?? "global"}:${item.remotePath}`}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--color-bg-hover)]"
                onClick={() => handleOpen(item.remotePath)}
                title={item.remotePath}
              >
                <Clock size={12} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--font-size-xs)] font-medium text-[var(--color-text-primary)]">
                    {item.fileName}
                  </div>
                  <div className="truncate text-[11px] text-[var(--color-text-muted)]">
                    {item.remotePath}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LocalFileIcon({ entry }: { entry: LocalFileEntry }) {
  if (entry.fileType === "dir")
    return <Folder size={16} className="text-[var(--color-warning)]" />;
  if (entry.fileType === "symlink")
    return <FileSymlink size={16} className="text-[var(--color-text-muted)]" />;
  return <File size={16} className="text-[var(--color-text-muted)]" />;
}

// ── Upload fly animation ──

function UploadFlyAnimation({
  containerRef,
  onAnimationEnd,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAnimationEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const el = ref.current;
    if (!container || !el) {
      onAnimationEnd();
      return;
    }

    const rect = container.getBoundingClientRect();
    const pad = 12; // p-3
    const gap = 12; // gap-3
    const panelW = (rect.width - pad * 2 - gap) / 2;

    // Start: local panel center
    const sx = pad + panelW * 0.5;
    const sy = rect.height * 0.38;
    // Wall: remote panel RIGHT border (subtract icon width so icon's right edge aligns with border)
    const iconW = 28; // w-7 = 28px
    const wallX = pad + panelW + gap + panelW - iconW;
    // End: bounce back just a tiny bit from wall
    const ex = wallX - panelW * 0.04;

    // Pre-compute deltas from start point for GPU-accelerated transform animation.
    // Using translate() instead of left/top avoids layout thrashing — silky smooth.
    const midDx = (wallX - sx) / 2;
    const wallDx = wallX - sx;
    const bounceDx = ex - sx;

    // Set base position once — all movement is done via transform (compositor thread)
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;

    const anim = el.animate(
      [
        // 0% — appear
        { transform: "translate(0px, 0px) scale(0.5)", opacity: 0 },
        // 5% — pop up
        { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
        // 30% — mid-flight, rising arc
        { transform: `translate(${midDx}px, -40px) scale(1)`, opacity: 1 },
        // 55% — hit wall + squish (merged: no pause between reach and squish)
        { transform: `translate(${wallDx}px, 0px) scaleX(0.72) scaleY(1.2)`, opacity: 1 },
        // 68% — tiny bounce back, recovering shape
        { transform: `translate(${bounceDx}px, 0px) scaleX(1.05) scaleY(0.95)`, opacity: 0.9 },
        // 82% — settle
        { transform: `translate(${bounceDx}px, 0px) scale(1)`, opacity: 0.5 },
        // 100% — fade out
        { transform: `translate(${bounceDx}px, 0px) scale(0.9)`, opacity: 0 },
      ],
      {
        duration: 900,
        easing: "linear",
        fill: "forwards",
      },
    );
    anim.onfinish = onAnimationEnd;
  }, []);

  return (
    <div
      ref={ref}
      className="absolute z-50 pointer-events-none"
      style={{ willChange: "transform, opacity" }}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--color-accent)] shadow-lg shadow-[var(--color-accent)]/30">
        <Upload size={14} className="text-white" />
      </div>
    </div>
  );
}

// Recursively get all files in a local directory
async function scanLocalDir(
  dirPath: string,
  relativeBase: string,
): Promise<{ local: string; relative: string; isDir: boolean }[]> {
  const result: { local: string; relative: string; isDir: boolean }[] = [];
  try {
    const entries = await api.localListDir(dirPath);
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      if (entry.fileType === "dir") {
        result.push({ local: fullPath, relative: relativePath, isDir: true });
        const subFiles = await scanLocalDir(fullPath, relativePath);
        result.push(...subFiles);
      } else {
        result.push({ local: fullPath, relative: relativePath, isDir: false });
      }
    }
  } catch (e) {
    console.error("Error scanning directory:", dirPath, e);
  }
  return result;
}

function LocalFileList({
  sessionId,
  remotePath,
  onUploadStart,
  onUploadRef,
  onSelectedChange,
}: {
  sessionId: string;
  remotePath: string;
  onUploadStart?: () => void;
  onUploadRef?: React.MutableRefObject<(() => void) | null>;
  onSelectedChange?: (count: number) => void;
}) {
  const t = useT();
  const [localPath, setLocalPath] = useState<string>("");
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load home dir on mount
  useEffect(() => {
    api.localHomeDir().then((home) => {
      setLocalPath(home);
    });
  }, []);

  // Load entries when path changes
  useEffect(() => {
    if (!localPath) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api
      .localListDir(localPath)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [localPath]);

  // 包装 setLocalPath 同时记录 recent。初始 mount 加载 home 不走这里，
  // 避免每次开 SFTP 都把 home 写进最近访问列表。
  const navigateLocalWithRecent = useCallback((path: string) => {
    setLocalPath(path);
    api.pathAddRecent(LOCAL_PATH_SCOPE, path).catch(() => {
      /* ignore errors for recent tracking */
    });
  }, []);

  const goUp = useCallback(() => {
    const parts = localPath.replace(/\/$/, "").split("/");
    parts.pop();
    const parent = parts.join("/") || "/";
    navigateLocalWithRecent(parent);
  }, [localPath, navigateLocalWithRecent]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .localListDir(localPath)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [localPath]);

  const handleDoubleClick = useCallback(
    (entry: LocalFileEntry) => {
      if (entry.fileType === "dir") {
        const newPath =
          localPath === "/" ? `/${entry.name}` : `${localPath}/${entry.name}`;
        navigateLocalWithRecent(newPath);
      }
    },
    [localPath, navigateLocalWithRecent],
  );

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const refreshTransfers = useSftpStore((s) => s.refreshTransfers);
  const addUploadingEntry = useSftpStore((s) => s.addUploadingEntry);
  const registerBatch = useSftpStore((s) => s.registerBatch);

  const handleUploadSelected = useCallback(async () => {
    const selectedNames = Array.from(selected);

    if (selectedNames.length === 0) {
      toast.info(t("sftp.emptyDirectory") || "Select files to upload");
      return;
    }

    if (entries.length === 0) {
      toast.info("Local file list not loaded, please wait");
      return;
    }

    const selectedEntries = selectedNames
      .map((name) => entries.find((e) => e.name === name))
      .filter((e): e is LocalFileEntry => !!e);

    // Collect upload tasks: each is { localPath, remoteDir }
    const uploadTasks: UploadTask[] = [];

    for (const entry of selectedEntries) {
      const fullPath = localPath === "/" ? `/${entry.name}` : `${localPath}/${entry.name}`;
      if (entry.fileType === "file") {
        uploadTasks.push({ localPaths: [fullPath], remoteDir: remotePath });
      } else if (entry.fileType === "dir") {
        toast.info(`Scanning directory: ${entry.name}...`);
        const allFiles = await scanLocalDir(fullPath, "");
        const byDir = new Map<string, string[]>();
        for (const f of allFiles) {
          if (f.isDir) continue;
          const relativeDir = f.relative.includes("/")
            ? f.relative.substring(0, f.relative.lastIndexOf("/"))
            : "";
          const remoteSubDir = relativeDir
            ? `${remotePath}/${entry.name}/${relativeDir}`
            : `${remotePath}/${entry.name}`;
          if (!byDir.has(remoteSubDir)) byDir.set(remoteSubDir, []);
          byDir.get(remoteSubDir)!.push(f.local);
        }
        for (const [remoteDir, localPaths] of byDir) {
          uploadTasks.push({ localPaths, remoteDir });
        }
      }
    }

    const totalFiles = uploadTasks.reduce((n, t) => n + t.localPaths.length, 0);
    if (totalFiles === 0) {
      toast.info("No files to upload");
      return;
    }

    const shouldContinue = await confirmOverwritePaths(
      t,
      "upload",
      () => collectExistingRemoteUploadTargets(sessionId, uploadTasks),
    );
    if (!shouldContinue) return;

    try {
      // Upload files and register each with its taskId for reliable progress tracking
      const allTaskIds: string[] = [];
      for (const task of uploadTasks) {
        const taskIds = await api.sftpUploadFiles(sessionId, task.localPaths, task.remoteDir);
        // taskIds[i] corresponds to task.localPaths[i] — map by index
        for (let i = 0; i < taskIds.length; i++) {
          const lp = task.localPaths[i];
          const fileName = getPathName(lp || "");
          const localEntry = entries.find((e) => e.name === fileName);
          if (localEntry && taskIds[i]) {
            addUploadingEntry(fileName, localEntry.size, taskIds[i]);
          }
          if (taskIds[i]) allTaskIds.push(taskIds[i]);
        }
      }

      // Don't refreshRemote here — uploads run in background, virtual entries
      // would be wiped. The transfer:completed event triggers refresh instead.
      // Register batch BEFORE refreshTransfers to avoid race condition with fast transfers
      registerBatch(allTaskIds, "upload");
      await refreshTransfers();
    } catch (err) {
      toast.error(String(err));
    }
  }, [selected, entries, localPath, sessionId, remotePath, refreshTransfers, addUploadingEntry, registerBatch, onUploadStart, t]);

  useEffect(() => {
    if (onUploadRef) onUploadRef.current = handleUploadSelected;
  });

  const selectedCount = selected.size;
  useEffect(() => {
    onSelectedChange?.(selected.size);
  }, [selected.size]);
  const selectedSize = entries
    .filter((e) => selected.has(e.name))
    .reduce((sum, e) => sum + (e.fileType === "dir" ? 0 : e.size), 0);

  const totalSize = entries
    .filter((e) => e.fileType !== "dir")
    .reduce((sum, e) => sum + e.size, 0);

  return (
    <section className="file-pane">
      {/* Pane header */}
      <div className="file-pane-head">
        <span className="pane-tag-row">
          <span className="pane-icon"><Monitor size={13} /></span>
          <span className="pane-label">{t("sftp.local")}</span>
          <span className="pane-host">{localPath || "~"}</span>
        </span>
        <span className="pane-actions">
          <Button size="icon" variant="ghost" onClick={refresh} title="Refresh">
            <RefreshCw size={13} />
          </Button>
        </span>
      </div>

      {/* Toolbar: path up + breadcrumb */}
      <div className="file-toolbar">
        <button className="path-up btn btn-icon btn-ghost" onClick={goUp} title="Go up">
          <ArrowUp size={13} />
        </button>
        <div className="flex-1 overflow-hidden">
          <Breadcrumb path={localPath || "/"} onNavigate={navigateLocalWithRecent} />
        </div>
        {localPath && (
          <PathToolsDropdown
            sessionId={LOCAL_PATH_SCOPE}
            currentPath={localPath}
            onNavigate={navigateLocalWithRecent}
          />
        )}
      </div>

      {/* File list */}
      <div className="file-list">
        {/* Column header */}
        <div className="file-row-local file-head">
          <span className="col-name">{t("sftp.colName")}</span>
          <span className="col-size">{t("sftp.colSize")}</span>
          <span className="col-mtime">{t("sftp.colModified")}</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--fg-muted)] border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-[var(--fs-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="p-4 text-center text-[var(--fs-sm)] text-[var(--fg-muted)]">
            {t("sftp.emptyDirectory")}
          </div>
        )}

        {!loading &&
          entries.map((entry) => (
            <div
              key={entry.name}
              className={cn(
                "file-row-local",
                selected.has(entry.name) && "is-selected",
                entry.fileType === "dir" && "is-dir",
              )}
              onClick={() => toggleSelect(entry.name)}
              onDoubleClick={() => handleDoubleClick(entry)}
            >
              <span className="col-name">
                <LocalFileIcon entry={entry} />
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="col-size">{entry.fileType === "dir" ? "—" : formatBytes(entry.size)}</span>
              <span className="col-mtime">{formatTime(entry.mtime)}</span>
            </div>
          ))}
      </div>

      {/* Footer status */}
      <div className="file-foot">
        <span>{selectedCount > 0 ? `${selectedCount} ${t("sftp.selected")} · ${formatBytes(selectedSize)}` : "—"}</span>
        <span className="spacer" />
        <span>{entries.length} {t("sftp.itemsTotal")} · {formatBytes(totalSize)}</span>
      </div>
    </section>
  );
}

function RemoteFileList() {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const uploadingFiles = useSftpStore((s) => s.uploadingFiles);
  const taskIdToName = useSftpStore((s) => s.taskIdToName);
  const transfers = useSftpStore((s) => s.transfers);
  const uploadSpeeds = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transfers) {
      const name = taskIdToName.get(t.id);
      if (name && t.speedBytesPerSec) map.set(name, t.speedBytesPerSec);
    }
    return map;
  }, [transfers, taskIdToName]);
  const {
    sessionId,
    remotePath,
    remoteEntries,
    loading,
    error,
    selectedRemoteEntries,
    navigateRemote,
    refreshRemote,
    remove,
    removeEntry,
    toggleSelectRemote,
    clearSelectRemote,
  } = useSftpStore();
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [showRename, setShowRename] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [deletingEntries, setDeletingEntries] = useState<Set<string>>(new Set());
  const mkdir = useSftpStore((s) => s.mkdir);
  const rename = useSftpStore((s) => s.rename);
  const dropRef = useRef<HTMLDivElement>(null);
  const currentHostId = tabs.find((tab) => tab.sessionId === sessionId)?.hostId ?? null;

  const { menuState, onContextMenu, closeMenu } = useContextMenu<FileEntry>();

  // Wrap navigateRemote to also track recent paths
  const navigateRemoteWithRecent = useCallback(
    (path: string) => {
      navigateRemote(path);
      // Track recent path in background (non-blocking)
      if (sessionId) {
        api.pathAddRecent(sessionId, path).catch(() => {
          /* ignore errors for recent tracking */
        });
      }
    },
    [navigateRemote, sessionId],
  );

  // Helper to delete with animation
  const deleteWithAnimation = useCallback(async (name: string, isDir: boolean) => {
    setDeletingEntries((prev) => new Set(prev).add(name));
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await remove(name, isDir);
    } catch (err) {
      setDeletingEntries((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      throw err;
    }
  }, [remove]);

  // Helper to force delete with animation
  const forceDeleteWithAnimation = useCallback(async (name: string) => {
    setDeletingEntries((prev) => new Set(prev).add(name));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const fullPath = remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;
    await api.sftpRemove(sessionId!, fullPath, true);
    removeEntry(name);
  }, [sessionId, remotePath, removeEntry]);

  // Recursively count files in a remote directory
  const countDirFiles = useCallback(async (dirPath: string): Promise<number> => {
    let count = 0;
    const stack = [dirPath];
    while (stack.length > 0) {
      const currentDir = stack.pop()!;
      try {
        const entries = await api.sftpListDir(sessionId!, currentDir);
        for (const e of entries) {
          if (e.name === "." || e.name === "..") continue;
          count++;
          useConfirmStore.getState().updateOptions({ scanCount: count });
          if (e.fileType === "dir") {
            const subPath = currentDir === "/" ? `/${e.name}` : `${currentDir}/${e.name}`;
            stack.push(subPath);
          }
        }
      } catch {
        // If we can't list a subdirectory, still report what we have
      }
    }
    return count;
  }, [sessionId]);

  const openQuickEdit = useCallback((path: string) => {
    if (!sessionId) return;
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (!tab) return;
    void openQuickEditWindow({
      sessionId,
      hostId: tab.hostId,
      hostName: tab.title,
      remotePath: path,
    });
    recordQuickEditRecent({
      hostId: tab.hostId,
      sessionId,
      remotePath: path,
      fileName: getPathName(path),
      updatedAt: Date.now(),
    });
  }, [sessionId, tabs]);

  const reopenQuickEditFromRecent = useCallback((path: string) => {
    navigateRemoteWithRecent(getRemoteDirPath(path));
    openQuickEdit(path);
  }, [navigateRemoteWithRecent, openQuickEdit]);

  const buildContextMenuItems = useCallback((entry: FileEntry): MenuItem[] => {
    const items: MenuItem[] = [];

    if (entry.fileType === "dir") {
      items.push({
        icon: <FolderOpen size={14} className="text-[var(--color-accent)]" />,
        label: t("sftp.open") || "打开",
        onClick: () => {
          const newPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
          navigateRemoteWithRecent(newPath);
        },
      });
    }

    if (entry.fileType === "file") {
      items.push({
        icon: <Pencil size={14} />,
        label: t("sftp.quickEdit"),
        onClick: () => {
          openQuickEdit(joinRemotePath(remotePath, entry.name));
        },
      });
    }

    // Download (file or directory)
    items.push({
      icon: <Download size={14} />,
      label: t("sftp.download"),
      onClick: async () => {
        if (entry.fileType === "file") {
          const fullPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
          const shouldContinue = await confirmOverwritePaths(
            t,
            "download",
            async () => {
              const downloadBaseDir = await resolveDownloadBaseDir();
              const localTargetPath = await resolveDownloadTargetPath(downloadBaseDir, fullPath);
              return collectExistingLocalTargets([localTargetPath]);
            },
          );
          if (!shouldContinue) return;

          api.sftpTransferStart(sessionId!, "download", "", fullPath).then(() => {
            useSftpStore.getState().refreshTransfers();
            toast.success(t("sftp.downloadStarted"));
          });
        } else {
          // Directory download
          const fullPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
          toast.info(t("sftp.scanningDir"));
          try {
            const collectFiles = async (dir: string, base: string): Promise<{ remote: string; relative: string }[]> => {
              const files: { remote: string; relative: string }[] = [];
              const entries = await api.sftpListDir(sessionId!, dir);
              for (const e of entries) {
                if (e.name === "." || e.name === "..") continue;
                const fp = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
                const rp = base ? `${base}/${e.name}` : e.name;
                if (e.fileType === "file") files.push({ remote: fp, relative: rp });
                else if (e.fileType === "dir") {
                  const sub = await collectFiles(fp, rp);
                  files.push(...sub);
                }
              }
              return files;
            };
            const allFiles = await collectFiles(fullPath, "");
            if (allFiles.length === 0) {
              toast.info(t("sftp.emptyDir"));
            } else {
              const shouldContinue = await confirmOverwritePaths(
                t,
                "download",
                async () => {
                  const downloadBaseDir = await resolveDownloadBaseDir();
                  const localTargetPaths = await Promise.all(
                    allFiles.map((file) =>
                      resolveDownloadTargetPath(downloadBaseDir, file.remote, `${entry.name}/${file.relative}`),
                    ),
                  );
                  return collectExistingLocalTargets(localTargetPaths);
                },
              );
              if (!shouldContinue) return;

              const promises = allFiles.map((file) => {
                const subPath = `${entry.name}/${file.relative}`;
                return api.sftpTransferStart(sessionId!, "download", "", file.remote, subPath)
                  .catch((err) => ({ error: err, file: file.remote }));
              });
              const results = await Promise.all(promises);
              const failed = results.filter((r): r is { error: unknown; file: string } => "error" in r);
              if (failed.length > 0) {
                toast.error(`Failed to start ${failed.length} download(s)`);
              }
              useSftpStore.getState().refreshTransfers();
              const validIds = results.filter((r): r is { id: string } => "id" in r).map((r) => r.id);
              useSftpStore.getState().registerBatch(validIds, "download");
            }
          } catch {
            toast.error("Failed to scan directory");
          }
        }
      },
    });

    // Rename
    items.push({
      icon: <Pencil size={14} />,
      label: t("sftp.rename") || "重命名",
      onClick: () => {
        setShowRename(entry.name);
        setRenameValue(entry.name);
      },
    });

    // Separator
    items.push({ type: "separator" });

    // Delete
    items.push({
      icon: <Trash2 size={14} />,
      label: t("confirm.delete"),
      danger: true,
      onClick: async () => {
        const connectedTab = tabs.find((tab) => tab.sessionId === sessionId && tab.state === "connected");
        if (!connectedTab) {
          toast.error(t("term.disconnected"));
          return;
        }

        if (entry.fileType === "dir") {
          // Show confirm dialog immediately with scanning state
          const confirmResult = useConfirmStore.getState()._show({
            title: t("confirm.deleteNonEmptyDirTitle"),
            description: t("confirm.deleteFileDesc"),
            confirmLabel: t("confirm.delete"),
            scanning: true,
          });

          const fullPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
          let count = 0;
          try {
            count = await countDirFiles(fullPath);
          } catch {
            // ignore scan errors
          }

          // Update dialog with scan result
          useConfirmStore.getState().updateOptions({
            scanning: false,
            description: count > 0
              ? `${t("confirm.deleteNonEmptyDirDesc", { name: entry.name })}\n\n(${count} ${count === 1 ? (t("sftp.file") || "file") : (t("sftp.files") || "files")})`
              : t("confirm.deleteFileDesc"),
          });

          const ok = await confirmResult;
          if (!ok) return;

          await forceDeleteWithAnimation(entry.name);
          toast.success(t("sftp.deleted"));
          return;
        }

        const ok = await confirm({
          title: t("confirm.deleteFileTitle"),
          description: t("confirm.deleteFileDesc"),
          confirmLabel: t("confirm.delete"),
        });
        if (ok) {
          await deleteWithAnimation(entry.name, false);
          toast.success(t("sftp.deleted"));
        }
      },
    });

    return items;
  }, [t, remotePath, sessionId, navigateRemoteWithRecent, deleteWithAnimation, forceDeleteWithAnimation, countDirFiles, tabs, openQuickEdit]);

// ── SFTP keyboard shortcuts ──
  const handleDelete = useCallback(async () => {
    const connectedTab = tabs.find((tab) => tab.sessionId === sessionId && tab.state === "connected");
    if (!connectedTab) {
      toast.error(t("term.disconnected"));
      return;
    }

    const selected = Array.from(selectedRemoteEntries);
    if (selected.length === 0) return;

    const entries = remoteEntries.filter((e) => selectedRemoteEntries.has(e.name));
    const dirEntries = entries.filter((e) => e.fileType === "dir");

    if (dirEntries.length > 0) {
      // Show confirm dialog immediately with scanning state
      const confirmResult = useConfirmStore.getState()._show({
        title: t("confirm.deleteNonEmptyDirTitle"),
        description: t("confirm.deleteBatchDesc", { n: selected.length }),
        confirmLabel: t("confirm.delete"),
        scanning: true,
      });

      // Scan directories in background while dialog is showing
      let totalFileCount = 0;
      for (const dir of dirEntries) {
        const fullPath = remotePath === "/" ? `/${dir.name}` : `${remotePath}/${dir.name}`;
        try {
          const count = await countDirFiles(fullPath);
          totalFileCount += count;
          useConfirmStore.getState().updateOptions({
            description: totalFileCount > 0
              ? `${t("confirm.deleteNonEmptyDirDesc", { name: dirEntries.length === 1 ? dirEntries[0].name : dirEntries.map((d) => d.name).join(", ") })}\n\n(${totalFileCount} ${totalFileCount === 1 ? (t("sftp.file") || "file") : (t("sftp.files") || "files")})`
              : t("confirm.deleteBatchDesc", { n: selected.length }),
            scanCount: totalFileCount,
          });
        } catch {
          // ignore scan errors
        }
      }

      // Scanning complete — enable buttons
      useConfirmStore.getState().updateOptions({
        scanning: false,
        description: totalFileCount > 0
          ? `${t("confirm.deleteNonEmptyDirDesc", { name: dirEntries.length === 1 ? dirEntries[0].name : dirEntries.map((d) => d.name).join(", ") })}\n\n(${totalFileCount} ${totalFileCount === 1 ? (t("sftp.file") || "file") : (t("sftp.files") || "files")})`
          : t("confirm.deleteBatchDesc", { n: selected.length }),
      });

      const ok = await confirmResult;
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: t("confirm.deleteBatchTitle"),
        description: t("confirm.deleteBatchDesc", { n: selected.length }),
        confirmLabel: t("confirm.delete"),
      });
      if (!ok) return;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        if (entry.fileType === "dir") {
          await forceDeleteWithAnimation(entry.name);
        } else {
          await deleteWithAnimation(entry.name, false);
        }
        if (i < entries.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
    clearSelectRemote();
    setDeletingEntries(new Set());
    toast.success(t("sftp.deletedItems", { n: selected.length }));
  }, [tabs, selectedRemoteEntries, remoteEntries, deleteWithAnimation, forceDeleteWithAnimation, clearSelectRemote, sessionId, remotePath, countDirFiles, t]);

  useEffect(() => {
    const handleRefresh = () => {
      refreshRemote();
    };
    const handleRename = () => {
      // Trigger rename on the first selected item
      const selected = Array.from(selectedRemoteEntries);
      if (selected.length === 1) {
        setShowRename(selected[0]);
        setRenameValue(selected[0]);
      }
    };
    const handleMkdir = () => {
      setShowMkdir(true);
      setNewDirName("");
    };

    window.addEventListener("sftp:refresh", handleRefresh);
    window.addEventListener("sftp:rename", handleRename);
    window.addEventListener("sftp:delete", handleDelete);
    window.addEventListener("sftp:mkdir", handleMkdir);

    return () => {
      window.removeEventListener("sftp:refresh", handleRefresh);
      window.removeEventListener("sftp:rename", handleRename);
      window.removeEventListener("sftp:delete", handleDelete);
      window.removeEventListener("sftp:mkdir", handleMkdir);
    };
  }, [refreshRemote, selectedRemoteEntries, remoteEntries, remove, handleDelete]);

  // Handle native file drag-drop via Tauri drag events
  const addUploadingEntryDrop = useSftpStore((s) => s.addUploadingEntry);
  const registerBatchDrop = useSftpStore((s) => s.registerBatch);
  const refreshTransfersAfterDrop = useSftpStore((s) => s.refreshTransfers);

  useEffect(() => {
    if (!sessionId) return;

    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragOver(true);
      } else if (payload.type === "leave") {
        setIsDragOver(false);
      } else if (payload.type === "drop") {
        setIsDragOver(false);

        const paths = payload.paths;
        if (!paths || paths.length === 0) return;

        await (async () => {
          try {
            toast.info(t("sftp.uploadedFiles", {n: paths.length}));

            const uploadTasks: UploadTask[] = [];

            for (const localPath of paths) {
              const fileName = getPathName(localPath);
              try {
                await api.localListDir(localPath);
                const allFiles = await scanLocalDir(localPath, "");
                const byDir = new Map<string, string[]>();
                for (const f of allFiles) {
                  if (f.isDir) continue;
                  const relativeDir = f.relative.includes("/")
                      ? f.relative.substring(0, f.relative.lastIndexOf("/"))
                      : "";
                  const remoteSubDir = relativeDir
                      ? `${remotePath}/${fileName}/${relativeDir}`
                      : `${remotePath}/${fileName}`;
                  if (!byDir.has(remoteSubDir)) byDir.set(remoteSubDir, []);
                  byDir.get(remoteSubDir)!.push(f.local);
                }
                for (const [rdir, lpaths] of byDir) {
                  uploadTasks.push({localPaths: lpaths, remoteDir: rdir});
                }
              } catch {
                uploadTasks.push({localPaths: [localPath], remoteDir: remotePath});
              }
            }

            if (uploadTasks.length === 0) {
              toast.error(t("sftp.emptyDirectory") || "No files to upload");
              return;
            }

            const shouldContinue = await confirmOverwritePaths(
              t,
              "upload",
              () => collectExistingRemoteUploadTargets(sessionId, uploadTasks),
            );
            if (!shouldContinue) return;

            const allTaskIds: string[] = [];
            for (const task of uploadTasks) {
              const taskIds = await api.sftpUploadFiles(sessionId, task.localPaths, task.remoteDir);
              for (let i = 0; i < taskIds.length; i++) {
                const lp = task.localPaths[i];
                const taskFileName = getPathName(lp || "");
                if (taskFileName && taskIds[i]) {
                  addUploadingEntryDrop(taskFileName, 0, taskIds[i]);
                }
                if (taskIds[i]) allTaskIds.push(taskIds[i]);
              }
            }

            if (allTaskIds.length > 0) {
              registerBatchDrop(allTaskIds, "upload");
              await refreshTransfersAfterDrop();
            }
          } catch (err) {
            toast.error(String(err));
          }
        })();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId, remotePath, t, addUploadingEntryDrop, registerBatchDrop, refreshTransfersAfterDrop]);

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (entry.fileType === "dir") {
        navigateRemoteWithRecent(joinRemotePath(remotePath, entry.name));
        return;
      }

      if (isLikelyQuickEditFile(entry)) {
        openQuickEdit(joinRemotePath(remotePath, entry.name));
      }
    },
    [remotePath, navigateRemoteWithRecent, openQuickEdit],
  );

  const selectedQuickEditEntry = useMemo(() => {
    if (selectedRemoteEntries.size !== 1) return null;
    const selectedName = Array.from(selectedRemoteEntries)[0];
    const entry = remoteEntries.find((item) => item.name === selectedName);
    if (!entry || !isLikelyQuickEditFile(entry)) return null;
    return entry;
  }, [remoteEntries, selectedRemoteEntries]);

  const goUp = useCallback(() => {
    if (remotePath === "/") return;
    const parts = remotePath.split("/").filter(Boolean);
    parts.pop();
    navigateRemoteWithRecent("/" + parts.join("/") || "/");
  }, [remotePath, navigateRemoteWithRecent]);

  const connectedTab = tabs.find((tab) => tab.sessionId === sessionId && tab.state === "connected");
  const remoteSelectedCount = selectedRemoteEntries.size;
  const remoteSelectedSize = remoteEntries
    .filter((e) => selectedRemoteEntries.has(e.name))
    .reduce((sum, e) => sum + (e.fileType === "dir" ? 0 : e.size), 0);
  const remoteTotalSize = remoteEntries
    .filter((e) => e.fileType !== "dir")
    .reduce((sum, e) => sum + e.size, 0);

  return (
    <section
      ref={dropRef}
      className={cn("file-pane is-active-pane", isDragOver ? "is-drop-target" : "")}
      data-context-menu-container
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-base)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-[var(--accent)]" />
            <p className="text-[var(--fs-sm)] font-medium text-[var(--accent)]">
              {t("sftp.dropToUpload")}
            </p>
            <p className="text-[var(--fs-xs)] text-[var(--fg-muted)]">
              to {remotePath}
            </p>
          </div>
        </div>
      )}
      {/* Pane header */}
      <div className="file-pane-head">
        <span className="pane-tag-row">
          <span className="pane-icon"><HardDrive size={13} /></span>
          <span className="pane-label">{t("sftp.remote")}</span>
          <span className="pane-host">{connectedTab ? `${connectedTab.title}:${remotePath}` : remotePath}</span>
          {sessionId && (
            <span className="badge-success">
              <span className="dot" />
              Connected
            </span>
          )}
        </span>
        <span className="pane-actions">
          <button className="btn btn-icon btn-ghost" onClick={() => { setShowMkdir(true); setNewDirName(""); }} title="New folder">
            <FolderPlus size={13} />
          </button>
          {selectedQuickEditEntry && (
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => openQuickEdit(joinRemotePath(remotePath, selectedQuickEditEntry.name))}
              title={t("sftp.quickEdit")}
            >
              <Pencil size={13} className="text-[var(--accent)]" />
            </button>
          )}
        </span>
      </div>

      {/* Toolbar: path up + breadcrumb */}
      <div className="file-toolbar">
        <button className="path-up btn btn-icon btn-ghost" onClick={goUp} title="Go up">
          <ArrowUp size={13} />
        </button>
        <div className="flex-1 overflow-hidden">
          <Breadcrumb path={remotePath} onNavigate={navigateRemoteWithRecent} />
        </div>
        <QuickEditRecentDropdown hostId={currentHostId} onOpen={reopenQuickEditFromRecent} />
        {sessionId && (
          <PathToolsDropdown
            sessionId={sessionId}
            currentPath={remotePath}
            onNavigate={navigateRemoteWithRecent}
          />
        )}
      </div>

      {/* Mkdir inline input */}
      {showMkdir && (
        <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-1.5 bg-[var(--bg-elevated)]">
          <Input
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            placeholder={t("sftp.newFolderName")}
            className="flex-1"
            autoFocus
            onKeyDown={async (e) => {
              if (e.key === "Enter" && newDirName.trim()) {
                await mkdir(newDirName.trim());
                setShowMkdir(false);
              }
              if (e.key === "Escape") setShowMkdir(false);
            }}
          />
          <Button
            size="sm"
            onClick={async () => {
              if (newDirName.trim()) {
                await mkdir(newDirName.trim());
                setShowMkdir(false);
              }
            }}
          >
            {t("conn.create")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowMkdir(false)}>
            <X size={14} />
          </Button>
        </div>
      )}

      {/* File list */}
      <div className="file-list relative">
        {/* Column header */}
        <div className="file-row file-head">
          <span className="col-name">{t("sftp.colName")}</span>
          <span className="col-size">{t("sftp.colSize")}</span>
          <span className="col-mtime">{t("sftp.colModified")}</span>
          <span className="col-perm">{t("sftp.colPerm")}</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--fg-muted)] border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-[var(--fs-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {!loading && !error && remoteEntries.length === 0 && (
          <div className="p-4 text-center text-[var(--fs-sm)] text-[var(--fg-muted)]">
            {t("sftp.emptyDirectory")}
          </div>
        )}

        {!loading &&
          remoteEntries.map((entry) => {
            const totalSize = uploadingFiles.get(entry.name);
            const isUploading = totalSize !== undefined;
            const progress = isUploading && totalSize! > 0
              ? Math.round((entry.size / totalSize!) * 100)
              : 0;

            return (
              <div
                key={entry.name}
                data-file-entry
                data-file-name={entry.name}
                data-file-type={entry.fileType}
                className={cn(
                  "file-row",
                  selectedRemoteEntries.has(entry.name) && "is-selected",
                  isUploading && "is-uploading",
                  deletingEntries.has(entry.name) && "animate-fade-out pointer-events-none",
                )}
                onClick={() => toggleSelectRemote(entry.name)}
                onDoubleClick={() => handleDoubleClick(entry)}
                onContextMenu={(e) => {
                  if (!selectedRemoteEntries.has(entry.name)) {
                    toggleSelectRemote(entry.name);
                  }
                  onContextMenu(e, entry);
                }}
              >
                {/* Name column */}
                <span className="col-name">
                  {isUploading ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
                  ) : (
                    <FileIcon entry={entry} />
                  )}
                  {showRename === entry.name ? (
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 h-6 text-[var(--fs-sm)]"
                      autoFocus
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && renameValue.trim()) {
                          await rename(entry.name, renameValue.trim());
                          setShowRename(null);
                        }
                        if (e.key === "Escape") setShowRename(null);
                      }}
                      onBlur={() => setShowRename(null)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                  {isUploading && (
                    <span className="row-progress">
                      <span className="row-progress-fill" style={{ width: `${progress}%` }} />
                    </span>
                  )}
                </span>
                {/* Size column */}
                <span className="col-size">
                  {entry.fileType === "dir" ? "—" : formatBytes(entry.size)}
                </span>
                {/* Modified column */}
                <span className="col-mtime">
                  {isUploading ? t("sftp.uploading") : formatTime(entry.mtime)}
                </span>
                {/* Perm column */}
                <span className="col-perm">
                  {isUploading
                    ? `${progress}%${uploadSpeeds.has(entry.name) ? ` · ${formatBytes(uploadSpeeds.get(entry.name)!)}/s` : ""}`
                    : formatPermissions(entry.permissions, entry.fileType)}
                </span>
              </div>
            );
          })}
      </div>

      {/* Footer status */}
      <div className="file-foot">
        <span>{remoteSelectedCount > 0 ? `${remoteSelectedCount} ${t("sftp.selected")} · ${formatBytes(remoteSelectedSize)}` : "—"}</span>
        <span className="spacer" />
        <span>{remoteEntries.length} {t("sftp.itemsTotal")} · {formatBytes(remoteTotalSize)}</span>
      </div>

      {/* Context Menu */}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          containerRef={dropRef}
          items={buildContextMenuItems(menuState.data)}
        />
      )}
    </section>
  );
}

function TransferDrawer({ minimized, onMinimize }: { minimized: boolean; onMinimize: () => void }) {
  const t = useT();
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const clearFinishedTransfers = useSftpStore((s) => s.clearFinishedTransfers);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!minimized) setCollapsed(false);
  }, [minimized]);

  const activeTransfers = transfers.filter(
    (tr) => tr.state === "running" || tr.state === "queued",
  );

  const recentFinished = transfers.filter(
    (tr) => tr.state === "completed" || tr.state === "failed",
  );

  if (transfers.length === 0) return null;

  if (minimized) {
    return (
      <section className="transfer-drawer is-collapsed" />
    );
  }

  return (
    <section className={cn("transfer-drawer", collapsed && "is-collapsed")}>
      <div className="td-head">
        <span className="td-title">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          {t("sftp.transfers")}
        </span>
        {activeTransfers.length > 0 && (
          <span className="badge-accent">{activeTransfers.length} in progress</span>
        )}
        <span className="td-spacer" />
        {recentFinished.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFinishedTransfers}>
            {t("sftp.clearFinished")}
          </Button>
        )}
        <button
          onClick={() => {
            setCollapsed(true);
            setTimeout(onMinimize, 300);
          }}
          className="btn btn-icon btn-ghost"
          title={t("sftp.minimize")}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>

      <div className="td-list">
        {transfers.map((task) => (
          <TransferRow key={task.id} task={task} onCancel={cancelTransfer} />
        ))}
      </div>
    </section>
  );
}

function TransferMinPill({ onClick }: { onClick: () => void }) {
  const t = useT();
  const transfers = useSftpStore((s) => s.transfers);
  const activeTransfers = transfers.filter(
    (tr) => tr.state === "running" || tr.state === "queued",
  );

  return (
    <div className="td-minimized">
      <button onClick={onClick} className="td-min-pill">
        {activeTransfers.length > 0 && (
          <span className="td-min-dot" />
        )}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span className="td-min-label">
          {activeTransfers.length > 0
            ? `${activeTransfers.length} ${t("sftp.transferring")}`
            : `${transfers.length} ${t("sftp.transfers")}`}
        </span>
      </button>
    </div>
  );
}

function TransferRow({
  task,
  onCancel,
}: {
  task: TransferTask;
  onCancel: (id: string) => void;
}) {
  const progress =
    task.totalBytes > 0
      ? Math.round((task.transferredBytes / task.totalBytes) * 100)
      : 0;

  const fileName = task.direction === "upload"
    ? task.localPath.split("/").pop() || task.localPath
    : task.remotePath.split("/").pop() || task.remotePath;

  const route = task.direction === "upload"
    ? `${task.localPath.split("/").slice(0, -1).join("/") || "~"} → ${task.remotePath.split("/").slice(0, -1).join("/") || "/"}`
    : `${task.remotePath.split("/").slice(0, -1).join("/") || "/"} → ~/`;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return "0 B/s";
    return formatBytes(bytesPerSec) + "/s";
  };

  return (
    <div className={cn(
      "td-row",
      task.state === "running" && "is-active",
      task.state === "completed" && "is-done",
    )}>
      {/* Direction icon */}
      {task.direction === "upload" ? (
        <span className="td-dir up"><ArrowUp size={12} /></span>
      ) : (
        <span className="td-dir down"><ArrowDown size={12} /></span>
      )}
      {/* Name */}
      <span className="td-name">{fileName}</span>
      {/* Route */}
      <span className="td-route" title={route}>
        {route}
      </span>
      {/* Progress bar */}
      <span className="td-bar">
        <span className={cn("td-bar-fill", task.state === "completed" && "is-done")} style={{ width: `${progress}%` }} />
      </span>
      {/* Percentage */}
      <span className="td-pct">
        {task.state === "completed" ? (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ) : `${progress}%`}
      </span>
      {/* Speed */}
      <span className="td-speed">{task.state === "running" ? formatSpeed(task.speedBytesPerSec || 0) : "—"}</span>
      {/* ETA */}
      <span className="td-eta">
        {task.state === "completed" ? `Done · ${formatBytes(task.totalBytes)}` :
         task.state === "failed" ? "Failed" :
         task.state === "queued" ? "Waiting" :
         "~ "}
        {task.state === "running" && task.speedBytesPerSec ? `${Math.ceil((task.totalBytes - task.transferredBytes) / (task.speedBytesPerSec || 1))}s` : ""}
      </span>
      {/* Actions */}
      <span className="td-actions">
        {(task.state === "running" || task.state === "queued") && (
          <button onClick={() => onCancel(task.id)} className="btn btn-icon btn-ghost" title="Cancel">
            <X size={11} />
          </button>
        )}
      </span>
    </div>
  );
}

function SessionPicker({
  onSelect,
}: {
  onSelect: (sessionId: string) => void;
}) {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const hosts = useConnectionsStore((s) => s.hosts);
  const connectedTabs = tabs.filter((tab) => tab.state === "connected");

  if (connectedTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <span className="mon-session-pick-header-icon mx-auto mb-6">
            <HardDrive size={28} strokeWidth={1.8} />
          </span>
          <p className="text-[var(--fs-base)] text-[var(--fg-secondary)]">
            {t("sftp.noActiveSessions")}
          </p>
          <div className="mt-1">
            <p className="text-[var(--fs-sm)] text-[var(--fg-muted)]">
              {t("sftp.connectFirst")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <span className="mon-session-pick-header-icon mx-auto mb-6">
          <HardDrive size={28} strokeWidth={1.8} />
        </span>
        <p className="text-[var(--fs-base)] font-medium text-[var(--fg-primary)]">
          {t("sftp.selectSession")}
        </p>
        <div className="mon-session-pick-grid">
          {connectedTabs.map((tab) => {
            const host = hosts.find((h) => h.id === tab.hostId);
            const meta = host
              ? `${host.username}@${host.host}:${host.port}`
              : `session · ${tab.sessionId.slice(0, 8)}`;
            return (
              <button
                key={tab.sessionId}
                onClick={() => onSelect(tab.sessionId)}
                className="mon-session-pick-card"
              >
                <span className="mon-session-pick-glyph">
                  <HardDrive size={16} strokeWidth={1.8} />
                </span>
                <span className="mon-session-pick-info">
                  <span className="mon-session-pick-name">{tab.title}</span>
                  <span className="mon-session-pick-meta">{meta}</span>
                </span>
                <span className="mon-session-pick-status-dot" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SftpPage() {
  const t = useT();
  const sessionId = useSftpStore((s) => s.sessionId);
  const remotePath = useSftpStore((s) => s.remotePath);
  const setSessionId = useSftpStore((s) => s.setSessionId);
  const refreshTransfers = useSftpStore((s) => s.refreshTransfers);
  const transfers = useSftpStore((s) => s.transfers);

  const dualPaneRef = useRef<HTMLDivElement>(null);
  const uploadActionRef = useRef<(() => void) | null>(null);
  const [localSelectedCount, setLocalSelectedCount] = useState(0);
  const [showUploadAnim, setShowUploadAnim] = useState(false);
  const [transferMinimized, setTransferMinimized] = useState(false);

  // Use refs to get latest values in event listeners
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const setSessionIdRef = useRef(setSessionId);
  setSessionIdRef.current = setSessionId;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    initSftpListeners();
    // Load transfer list on mount
    refreshTransfers();

    // Listen for session state changes to handle disconnection
    const unlistenState = listen<{ sessionId: string; state: string }>(
      "session:state_changed",
      (event) => {
        if (event.payload.sessionId === sessionIdRef.current) {
          if (event.payload.state === "disconnected" || event.payload.state === "failed") {
            toast.error(tRef.current("term.disconnected"));
            setSessionIdRef.current(null);
          }
        }
      },
    );

    return () => {
      unlistenState.then((fn) => fn());
    };
  }, []);

  // Poll transfers periodically to show progress
  useEffect(() => {
    const hasActive = transfers.some((t) => t.state === "running" || t.state === "queued");
    if (!hasActive) return;

    const interval = setInterval(() => {
      refreshTransfers();
    }, 500);
    return () => clearInterval(interval);
  }, [transfers, refreshTransfers]);

  if (!sessionId) {
    return <SessionPicker onSelect={setSessionId} />;
  }

  return (
    <div className="sftp-main">
      {/* Page header */}
      <div className="sftp-header flex items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2">
        <span className="inline-flex items-center gap-2">
          <span className="text-[var(--fs-lg)] font-semibold text-[var(--fg-primary)]">SFTP</span>
          <span className="text-[var(--fs-xs)] text-[var(--fg-muted)]">
            {t("sftp.sftpSession")}
            {transfers.some((t) => t.state === "running" || t.state === "queued") && (
              <span className="badge-accent ml-1">
                {transfers.filter((t) => t.state === "running" || t.state === "queued").length} {t("sftp.transferring")}
              </span>
            )}
          </span>
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setSessionId(null)}>
          {t("sftp.changeSession")}
        </Button>
      </div>

      {/* Dual-pane file browser */}
      <div className="sftp-body relative overflow-hidden p-3" ref={dualPaneRef}>
        <LocalFileList sessionId={sessionId} remotePath={remotePath} onUploadStart={() => setShowUploadAnim(true)} onUploadRef={uploadActionRef} onSelectedChange={setLocalSelectedCount} />
        <div className="sftp-gutter">
          <button
            className={`gutter-arrow${localSelectedCount === 0 ? " is-disabled" : ""}`}
            onClick={() => uploadActionRef.current?.()}
            disabled={localSelectedCount === 0}
            title={localSelectedCount > 0 ? `Upload ${localSelectedCount} file(s)` : "Select files to upload"}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
        <RemoteFileList />
        {showUploadAnim && (
          <UploadFlyAnimation
            containerRef={dualPaneRef}
            onAnimationEnd={() => setShowUploadAnim(false)}
          />
        )}
      </div>

      {/* Transfer queue */}
      <TransferDrawer minimized={transferMinimized} onMinimize={() => setTransferMinimized(true)} />
      {transferMinimized && (
        <TransferMinPill onClick={() => setTransferMinimized(false)} />
      )}
    </div>
  );
}
