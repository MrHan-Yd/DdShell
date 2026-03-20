import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
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
  Minus,
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
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useSftpStore, initSftpListeners } from "@/stores/sftp";
import { useTerminalStore } from "@/stores/terminal";
import * as api from "@/lib/tauri";
import type { LocalFileEntry } from "@/lib/tauri";
import { toast } from "@/stores/toast";
import { confirm } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
import type { FileEntry, TransferTask, FavoritePath, RecentPath } from "@/types";

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
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-popover)] overflow-hidden">
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

function LocalFileIcon({ entry }: { entry: LocalFileEntry }) {
  if (entry.fileType === "dir")
    return <Folder size={16} className="text-[var(--color-warning)]" />;
  if (entry.fileType === "symlink")
    return <FileSymlink size={16} className="text-[var(--color-text-muted)]" />;
  return <File size={16} className="text-[var(--color-text-muted)]" />;
}

function LocalFileList({
  sessionId,
  remotePath,
}: {
  sessionId: string;
  remotePath: string;
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

  const goUp = useCallback(() => {
    const parts = localPath.replace(/\/$/, "").split("/");
    parts.pop();
    const parent = parts.join("/") || "/";
    setLocalPath(parent);
  }, [localPath]);

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
        setLocalPath(newPath);
      }
    },
    [localPath],
  );

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Recursively get all files in a directory, returning { localPath, relativePath }
  const getAllFiles = useCallback(async (dirPath: string, relativeBase: string): Promise<{ local: string; relative: string }[]> => {
    const files: { local: string; relative: string }[] = [];
    try {
      const dirEntries = await api.localListDir(dirPath);
      for (const entry of dirEntries) {
        const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;
        const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
        if (entry.fileType === "file") {
          files.push({ local: fullPath, relative: relativePath });
        } else if (entry.fileType === "dir") {
          const subFiles = await getAllFiles(fullPath, relativePath);
          files.push(...subFiles);
        }
      }
    } catch (e) {
      console.error("Error reading directory:", dirPath, e);
    }
    return files;
  }, []);

  const refreshTransfers = useSftpStore((s) => s.refreshTransfers);
  const addUploadingEntry = useSftpStore((s) => s.addUploadingEntry);

  const handleUploadSelected = useCallback(async () => {
    const selectedNames = Array.from(selected);

    if (selectedNames.length === 0) {
      toast.error("No files selected to upload");
      return;
    }

    if (entries.length === 0) {
      toast.error("Local file list not loaded, please wait");
      return;
    }

    const selectedEntries = selectedNames
      .map((name) => entries.find((e) => e.name === name))
      .filter((e): e is LocalFileEntry => !!e);

    // Collect upload tasks: each is { localPath, remoteDir }
    const uploadTasks: { localPaths: string[]; remoteDir: string }[] = [];

    for (const entry of selectedEntries) {
      const fullPath = localPath === "/" ? `/${entry.name}` : `${localPath}/${entry.name}`;
      if (entry.fileType === "file") {
        // Single file: upload to current remote dir
        uploadTasks.push({ localPaths: [fullPath], remoteDir: remotePath });
      } else if (entry.fileType === "dir") {
        // Directory: recursively get all files, group by their remote subdirectory
        toast.info(`Scanning directory: ${entry.name}...`);
        const allFiles = await getAllFiles(fullPath, "");
        // Group files by their parent directory relative to the selected dir
        const byDir = new Map<string, string[]>();
        for (const f of allFiles) {
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
      toast.error("No files to upload");
      return;
    }

    try {
      // Upload files and register each with its taskId for reliable progress tracking
      for (const task of uploadTasks) {
        const taskIds = await api.sftpUploadFiles(sessionId, task.localPaths, task.remoteDir);
        // taskIds[i] corresponds to task.localPaths[i] — map by index
        for (let i = 0; i < taskIds.length; i++) {
          const lp = task.localPaths[i];
          const fileName = lp?.split("/").pop() || "";
          const localEntry = entries.find((e) => e.name === fileName);
          if (localEntry && taskIds[i]) {
            addUploadingEntry(fileName, localEntry.size, taskIds[i]);
          }
        }
      }

      // Don't refreshRemote here — uploads run in background, virtual entries
      // would be wiped. The transfer:completed event triggers refresh instead.
      await refreshTransfers();
      if (totalFiles === 1) {
        toast.success(t("sftp.uploaded"));
      } else {
        toast.success(t("sftp.uploadedFiles", { n: totalFiles }));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [selected, entries, localPath, sessionId, remotePath, getAllFiles, refreshTransfers, addUploadingEntry]);

  return (
    <div className="flex flex-1 flex-col border rounded-[var(--radius-card)] border-[var(--color-border)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2">
        <Monitor size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
          {t("sftp.local")}
        </span>
        <div className="flex-1" />
        {selected.size > 0 && (
          <Button size="sm" onClick={handleUploadSelected} title="Upload selected files">
            <Upload size={12} className="mr-1" />
            Upload ({selected.size})
          </Button>
        )}
        <Button size="icon" variant="ghost" onClick={goUp} title="Go up">
          <ArrowUp size={14} />
        </Button>
        <Button size="icon" variant="ghost" onClick={refresh} title="Refresh">
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5">
        <Breadcrumb path={localPath || "/"} onNavigate={setLocalPath} />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2
              size={20}
              className="animate-spin text-[var(--color-text-muted)]"
            />
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-error)]">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("sftp.emptyDirectory")}
          </div>
        )}

        {!loading &&
          entries.map((entry) => (
            <div
              key={entry.name}
              className={cn(
                "flex items-center gap-3 px-3 py-1.5 text-[var(--font-size-sm)] cursor-default hover:bg-[var(--color-bg-hover)] transition-colors",
                selected.has(entry.name) && "bg-[var(--color-accent-subtle)]",
              )}
              onClick={() => toggleSelect(entry.name)}
              onDoubleClick={() => handleDoubleClick(entry)}
            >
              <LocalFileIcon entry={entry} />
              <span className="flex-1 truncate">{entry.name}</span>
              <span className="w-20 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {entry.fileType === "dir" ? "-" : formatBytes(entry.size)}
              </span>
              <span className="w-36 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)] whitespace-nowrap">
                {formatTime(entry.mtime)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function RemoteFileList() {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const uploadingFiles = useSftpStore((s) => s.uploadingFiles);
  const completedUploads = useSftpStore((s) => s.completedUploads);
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
    toggleSelectRemote,
    clearSelectRemote,
  } = useSftpStore();
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [showRename, setShowRename] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deletingEntries, setDeletingEntries] = useState<Set<string>>(new Set());
  const mkdir = useSftpStore((s) => s.mkdir);
  const rename = useSftpStore((s) => s.rename);
  const dropRef = useRef<HTMLDivElement>(null);

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
    // Start animation
    setDeletingEntries((prev) => new Set(prev).add(name));
    // Wait for animation to complete
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Actually delete
    try {
      await remove(name, isDir);
    } catch (err) {
      // Remove from animation set on error
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
    // Start animation
    setDeletingEntries((prev) => new Set(prev).add(name));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const fullPath = remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;
    await api.sftpRemove(sessionId!, fullPath, true);
  }, [sessionId, remotePath]);

  // ── SFTP keyboard shortcuts ──
  const handleDelete = useCallback(async () => {
    // Check if session is still connected
    const connectedTab = tabs.find((tab) => tab.sessionId === sessionId && tab.state === "connected");
    if (!connectedTab) {
      toast.error(t("term.disconnected"));
      return;
    }

    const selected = Array.from(selectedRemoteEntries);
    if (selected.length > 0) {
      // First check if any selected items are non-empty directories
      const entries = remoteEntries.filter((e) => selectedRemoteEntries.has(e.name));
      const nonEmptyDirs = entries.filter((e) => e.fileType === "dir");

      if (nonEmptyDirs.length > 0) {
        // Show warning for non-empty directories
        const ok = await confirm({
          title: t("confirm.deleteNonEmptyDirTitle"),
          description: t("confirm.deleteNonEmptyDirDesc", { name: nonEmptyDirs[0].name }),
          confirmLabel: t("confirm.delete"),
        });
        if (!ok) return;
      } else {
        // Empty directories or files - show normal confirmation
        const ok = await confirm({
          title: t("confirm.deleteBatchTitle"),
          description: t("confirm.deleteBatchDesc", { n: selected.length }),
          confirmLabel: t("confirm.delete"),
        });
        if (!ok) return;
      }

      // Delete each entry sequentially, with small delay between each to avoid channel overload
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        try {
          await deleteWithAnimation(entry.name, entry.fileType === "dir");
          // Small delay between deletes to prevent channel overload
          if (i < entries.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (err) {
          if (String(err) === "NON_EMPTY_DIR") {
            // If it's a non-empty directory that we couldn't detect earlier, try with force
            const ok = await confirm({
              title: t("confirm.deleteNonEmptyDirTitle"),
              description: t("confirm.deleteNonEmptyDirDesc", { name: entry.name }),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) {
              await forceDeleteWithAnimation(entry.name);
            }
          } else {
            console.error("Delete error:", err);
          }
        }
      }
      // Clear selection after batch delete
      clearSelectRemote();
      setDeletingEntries(new Set());
      toast.success(t("sftp.deletedItems", { n: selected.length }));
    }
  }, [tabs, selectedRemoteEntries, remoteEntries, deleteWithAnimation, forceDeleteWithAnimation, clearSelectRemote, sessionId, remotePath, t]);

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

  // Handle native context menu event
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const fileItem = target.closest("[data-file-entry]");
      if (fileItem) {
        const entryName = fileItem.getAttribute("data-file-name");
        const entryType = fileItem.getAttribute("data-file-type") as "file" | "dir" | "symlink" | null;
        if (entryName && entryType) {
          e.preventDefault();
          const entry: FileEntry = {
            name: entryName,
            fileType: entryType,
            size: 0,
            mtime: 0,
            permissions: 0,
          };
          if (!selectedRemoteEntries.has(entryName)) {
            toggleSelectRemote(entryName);
          }
          // Calculate position relative to the container
          const container = dropRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            let x = e.clientX - containerRect.left;
            let y = e.clientY - containerRect.top;

            // Menu dimensions
            const menuWidth = 180;
            const menuHeight = 120;

            // Adjust if menu would go outside right edge
            if (x + menuWidth > containerRect.width) {
              x = containerRect.width - menuWidth;
            }
            // Adjust if menu would go outside bottom edge
            if (y + menuHeight > containerRect.height) {
              y = containerRect.height - menuHeight;
            }

            setContextMenu({ x, y, entry });
          }
        }
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [selectedRemoteEntries, toggleSelectRemote]);

  // Handle native file drag-drop via HTML5 API
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're leaving the container
    const rect = dropRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsDragOver(false);
      }
    }
  }, []);

  const addUploadingEntryDrop = useSftpStore((s) => s.addUploadingEntry);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (!sessionId) return;

      // Get file paths from Tauri drag event
      // Tauri injects file paths into dataTransfer
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const paths: string[] = [];
      const fileSizes: number[] = [];
      for (let i = 0; i < files.length; i++) {
        // In Tauri, File objects have a path property
        const file = files[i] as File & { path?: string };
        if (file.path) {
          paths.push(file.path);
          fileSizes.push(file.size);
        }
      }

      if (paths.length === 0) return;

      try {
        const taskIds = await api.sftpUploadFiles(sessionId, paths, remotePath);
        // Register each file for progress tracking
        for (let i = 0; i < taskIds.length; i++) {
          const fileName = paths[i]?.split("/").pop() || "";
          const size = fileSizes[i] || 0;
          if (fileName && taskIds[i]) {
            addUploadingEntryDrop(fileName, size, taskIds[i]);
          }
        }
        if (paths.length === 1) {
          toast.success(t("sftp.uploaded"));
        } else {
          toast.success(t("sftp.uploadedFiles", { n: paths.length }));
        }
      } catch (err) {
        toast.error(String(err));
      }
    },
    [sessionId, remotePath, t, addUploadingEntryDrop],
  );

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (entry.fileType === "dir") {
        const newPath =
          remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
        navigateRemoteWithRecent(newPath);
      }
    },
    [remotePath, navigateRemoteWithRecent],
  );

  const goUp = useCallback(() => {
    if (remotePath === "/") return;
    const parts = remotePath.split("/").filter(Boolean);
    parts.pop();
    navigateRemoteWithRecent("/" + parts.join("/") || "/");
  }, [remotePath, navigateRemoteWithRecent]);

  return (
    <div
      ref={dropRef}
      className={cn(
        "flex flex-1 flex-col border rounded-[var(--radius-card)] overflow-hidden relative transition-colors",
        isDragOver
          ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
          : "border-[var(--color-border)]",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-bg-base)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-[var(--color-accent)]" />
            <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-accent)]">
              {t("sftp.dropToUpload")}
            </p>
            <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              to {remotePath}
            </p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2">
        <HardDrive size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
          {t("sftp.remote")}
        </span>
        <div className="flex-1" />
        <Button size="icon" variant="ghost" onClick={goUp} title="Go up">
          <ArrowUp size={14} />
        </Button>
        <Button size="icon" variant="ghost" onClick={refreshRemote} title="Refresh">
          <RefreshCw size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setShowMkdir(true);
            setNewDirName("");
          }}
          title="New folder"
        >
          <FolderPlus size={14} />
        </Button>
        {selectedRemoteEntries.size > 0 && (
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDelete}
            title={`Delete ${selectedRemoteEntries.size} item(s)`}
          >
            <Trash2 size={14} className="text-[var(--color-error)]" />
          </Button>
        )}
      </div>

      {/* Breadcrumb with Path Tools */}
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5">
        <div className="flex-1 overflow-hidden">
          <Breadcrumb path={remotePath} onNavigate={navigateRemoteWithRecent} />
        </div>
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
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-bg-elevated)]">
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
      <div className="flex-1 overflow-y-auto relative">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-error)]">
            {error}
          </div>
        )}

        {!loading && !error && remoteEntries.length === 0 && (
          <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("sftp.emptyDirectory")}
          </div>
        )}

        {!loading &&
          remoteEntries.map((entry) => {
            // Check if this file is being uploaded or just completed
            const totalSize = uploadingFiles.get(entry.name);
            const isUploading = totalSize !== undefined;
            const isCompleted = completedUploads.has(entry.name);
            const showProgress = isUploading || isCompleted;
            const progress = isUploading && totalSize! > 0
              ? Math.round((entry.size / totalSize!) * 100)
              : isCompleted ? 100 : 0;

            return (
              <div
                key={entry.name}
                data-file-entry
                data-file-name={entry.name}
                data-file-type={entry.fileType}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-1.5 text-[var(--font-size-sm)] cursor-default hover:bg-[var(--color-bg-hover)] transition-colors",
                  selectedRemoteEntries.has(entry.name) && "bg-[var(--color-accent-subtle)]",
                  deletingEntries.has(entry.name) && "animate-fade-out pointer-events-none",
                )}
                onClick={() => toggleSelectRemote(entry.name)}
                onDoubleClick={() => handleDoubleClick(entry)}
              >
                {/* Progress bar background - 从左到右增长，完成后绿色淡出 */}
                {showProgress && (
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 transition-all duration-300",
                      isCompleted
                        ? "bg-[var(--color-success)] opacity-0 duration-1000"
                        : "bg-[var(--color-accent)] opacity-15",
                    )}
                    style={{ width: `${progress}%` }}
                  />
                )}
                <FileIcon entry={entry} />
                {showRename === entry.name ? (
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1 h-6 text-[var(--font-size-sm)]"
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
                  <span className="flex-1 truncate">{entry.name}</span>
                )}
                {isUploading ? (
                  <span className="w-24 text-right text-[var(--font-size-xs)] text-[var(--color-accent)]">
                    {formatBytes(entry.size)} / {formatBytes(totalSize!)}
                  </span>
                ) : (
                  <span className="w-20 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                    {entry.fileType === "dir" ? "-" : formatBytes(entry.size)}
                  </span>
                )}
                <span className="w-36 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)] whitespace-nowrap">
                  {formatTime(entry.mtime)}
                </span>
                <div className="flex items-center gap-1 w-6">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRename(entry.name);
                      setRenameValue(entry.name);
                    }}
                    className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] opacity-0 group-hover:opacity-100"
                    title="Rename"
                  >
                    <Pencil size={12} className="text-[var(--color-text-muted)]" />
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="absolute z-50 min-w-[180px] py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg animate-context-menu"
          ref={(el) => {
            if (el && hoveredMenuItem !== null) {
              const buttons = el.querySelectorAll('.context-menu-item');
              const btn = buttons[hoveredMenuItem] as HTMLElement;
              if (btn) {
                const highlight = el.querySelector('.menu-highlight') as HTMLElement;
                if (highlight) {
                  highlight.style.top = (btn.offsetTop) + 'px';
                  highlight.style.height = btn.offsetHeight + 'px';
                }
              }
            }
          }}
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sliding highlight */}
          <div
            className="absolute left-0.5 right-0.5 bg-[var(--color-bg-hover)] rounded transition-all duration-150 ease-spring pointer-events-none menu-highlight"
          />

          {/* Open - for directories */}
          {contextMenu.entry.fileType === "dir" && (
            <button
              className="w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 context-menu-item relative z-10"
              onMouseEnter={(e) => {
                const buttons = e.currentTarget.parentElement?.querySelectorAll('.context-menu-item');
                if (buttons) {
                  setHoveredMenuItem(Array.from(buttons).indexOf(e.currentTarget));
                }
              }}
              onMouseLeave={() => setHoveredMenuItem(null)}
              onClick={() => {
                const newPath = remotePath === "/" ? `/${contextMenu.entry.name}` : `${remotePath}/${contextMenu.entry.name}`;
                navigateRemoteWithRecent(newPath);
                setContextMenu(null);
              }}
            >
              <FolderOpen size={14} className="text-[var(--color-accent)]" />
              {t("sftp.open") || "打开"}
            </button>
          )}

          {/* Download - for files */}
          {contextMenu.entry.fileType === "file" && (
            <button
              className="w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 context-menu-item relative z-10"
              onMouseEnter={(e) => {
                const buttons = e.currentTarget.parentElement?.querySelectorAll('.context-menu-item');
                if (buttons) {
                  setHoveredMenuItem(Array.from(buttons).indexOf(e.currentTarget));
                }
              }}
              onMouseLeave={() => setHoveredMenuItem(null)}
              onClick={() => {
                const entry = contextMenu.entry;
                if (!entry.name) return;
                const fullPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
                api.sftpTransferStart(sessionId!, "download", "", fullPath).then(() => {
                  useSftpStore.getState().refreshTransfers();
                  toast.success(t("sftp.downloadStarted"));
                });
                setContextMenu(null);
              }}
            >
              <Download size={14} className="text-[var(--color-text-muted)]" />
              {t("sftp.download")}
            </button>
          )}

          {/* Download - for directories */}
          {contextMenu.entry.fileType === "dir" && (
            <button
              className="w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 context-menu-item relative z-10"
              onMouseEnter={(e) => {
                const buttons = e.currentTarget.parentElement?.querySelectorAll('.context-menu-item');
                if (buttons) {
                  setHoveredMenuItem(Array.from(buttons).indexOf(e.currentTarget));
                }
              }}
              onMouseLeave={() => setHoveredMenuItem(null)}
              onClick={async () => {
                const entry = contextMenu.entry;
                if (!entry) return;
                const fullPath = remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
                toast.info(t("sftp.scanningDir"));
                try {
                  // Collect all files recursively
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
                    // Get download directory: settings > ~/Downloads
                    const downloadDir = await api.settingGet("transfer.downloadPath").catch(() => null)
                      ?? await api.localHomeDir() + "/Downloads";
                    // Start all downloads in parallel (they'll queue at semaphore)
                    const promises = allFiles.map((file) => {
                      const localPath = `${downloadDir.replace(/\/$/, "")}/${entry.name}/${file.relative}`;
                      return api.sftpTransferStart(sessionId!, "download", localPath, file.remote)
                        .catch((err) => ({ error: err, file: file.remote }));
                    });
                    const results = await Promise.all(promises);
                    const failed = results.filter((r): r is { error: unknown; file: string } => "error" in r);
                    if (failed.length > 0) {
                      toast.error(`Failed to start ${failed.length} download(s)`);
                    }
                    useSftpStore.getState().refreshTransfers();
                    toast.success(t("sftp.downloadStarted"));
                  }
                } catch {
                  toast.error("Failed to scan directory");
                }
                setContextMenu(null);
              }}
            >
              <Download size={14} className="text-[var(--color-text-muted)]" />
              {t("sftp.download")}
            </button>
          )}

          {/* Rename */}
          <button
            className="w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 context-menu-item relative z-10"
            onMouseEnter={(e) => {
              const buttons = e.currentTarget.parentElement?.querySelectorAll('.context-menu-item');
              if (buttons) {
                setHoveredMenuItem(Array.from(buttons).indexOf(e.currentTarget));
              }
            }}
            onMouseLeave={() => setHoveredMenuItem(null)}
            onClick={() => {
              setShowRename(contextMenu.entry.name);
              setRenameValue(contextMenu.entry.name);
              setContextMenu(null);
            }}
          >
            <Pencil size={14} className="text-[var(--color-text-muted)]" />
            {t("sftp.rename") || "重命名"}
          </button>

          <div className="my-1 border-t border-[var(--color-border)]" />

          {/* Delete */}
          <button
            className="w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] flex items-center gap-2 text-[var(--color-error)] context-menu-item relative z-10"
            onMouseEnter={(e) => {
              const buttons = e.currentTarget.parentElement?.querySelectorAll('.context-menu-item');
              if (buttons) {
                setHoveredMenuItem(Array.from(buttons).indexOf(e.currentTarget));
              }
            }}
            onMouseLeave={() => setHoveredMenuItem(null)}
            onClick={async () => {
              // Check if session is still connected
              const connectedTab = tabs.find((tab) => tab.sessionId === sessionId && tab.state === "connected");
              if (!connectedTab) {
                toast.error(t("term.disconnected"));
                setContextMenu(null);
                return;
              }

              // Check if directory and has content
              if (contextMenu.entry.fileType === "dir") {
                const fullPath = remotePath === "/" ? `/${contextMenu.entry.name}` : `${remotePath}/${contextMenu.entry.name}`;
                const entries = await api.sftpListDir(sessionId!, fullPath);
                const nonHiddenEntries = entries.filter((x) => x.name !== "." && x.name !== "..");
                if (nonHiddenEntries.length > 0) {
                  const ok = await confirm({
                    title: t("confirm.deleteNonEmptyDirTitle"),
                    description: t("confirm.deleteNonEmptyDirDesc", { name: contextMenu.entry.name }),
                    confirmLabel: t("confirm.delete"),
                  });
                  if (!ok) {
                    setContextMenu(null);
                    return;
                  }
                  // Start animation first
                  setDeletingEntries((prev) => new Set(prev).add(contextMenu.entry.name));
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  await api.sftpRemove(sessionId!, fullPath, true);
                  toast.success(t("sftp.deleted"));
                  setContextMenu(null);
                  return;
                }
              }
              const ok = await confirm({
                title: t("confirm.deleteFileTitle"),
                description: t("confirm.deleteFileDesc"),
                confirmLabel: t("confirm.delete"),
              });
              if (ok) {
                await deleteWithAnimation(contextMenu.entry.name, contextMenu.entry.fileType === "dir");
                toast.success(t("sftp.deleted"));
              }
              setContextMenu(null);
            }}
          >
            <Trash2 size={14} />
            {t("confirm.delete")}
          </button>
        </div>
      )}

      {/* Click outside to close context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function TransferQueue() {
  const t = useT();
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const clearFinishedTransfers = useSftpStore((s) => s.clearFinishedTransfers);
  const [minimized, setMinimized] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);

  // Only show active transfers (running or queued)
  const activeTransfers = transfers.filter(
    (t) => t.state === "running" || t.state === "queued",
  );

  // Only show finished transfers (for a while)
  const recentFinished = transfers.filter(
    (t) => t.state === "completed" || t.state === "failed",
  );

  const [panelKey, setPanelKey] = useState(0);

  const handleMinimize = useCallback(() => {
    setAnimatingOut(true);
    setTimeout(() => {
      setAnimatingOut(false);
      setMinimized(true);
    }, 250);
  }, []);

  const handleExpand = useCallback(() => {
    setMinimized(false);
    setPanelKey((k) => k + 1);
  }, []);

  // Only show drawer when there are transfers
  if (transfers.length === 0) return null;

  // Minimized: small pill in bottom-right corner
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-transfer-panel-in">
        <button
          onClick={handleExpand}
          className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          {activeTransfers.length > 0 && (
            <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse shrink-0" />
          )}
          <Upload size={14} className="text-[var(--color-accent)] shrink-0" />
          <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] whitespace-nowrap">
            {activeTransfers.length > 0
              ? `${activeTransfers.length} ${t("sftp.transferring")}`
              : `${transfers.length} ${t("sftp.transfers")}`}
          </span>
        </button>
      </div>
    );
  }

  // Floating drawer in bottom right corner
  return (
    <div key={panelKey} className={`fixed bottom-4 right-4 z-50 w-[480px] ${animatingOut ? "animate-transfer-panel-out" : "animate-transfer-panel-in"}`}>
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Upload size={14} className="text-[var(--color-accent)]" />
            <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {t("sftp.transfers")} ({activeTransfers.length > 0 ? activeTransfers.length : transfers.length})
            </span>
            {activeTransfers.length > 0 && (
              <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-1">
            {recentFinished.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearFinishedTransfers}>
                {t("sftp.clearFinished")}
              </Button>
            )}
            <button
              onClick={handleMinimize}
              className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors"
              title={t("sftp.minimize")}
            >
              <Minus size={14} />
            </button>
          </div>
        </div>

        {/* Transfer list */}
        <div className="max-h-[192px] overflow-y-auto">
          {transfers.map((task) => (
            <TransferRow key={task.id} task={task} onCancel={cancelTransfer} />
          ))}
        </div>
      </div>
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
    <div className="flex flex-col gap-1 px-3 py-2 text-[var(--font-size-xs)] border-b border-[var(--color-border-subtle)] last:border-0 overflow-hidden">
      <div className="flex items-center gap-2 min-w-0">
        {task.direction === "upload" ? (
          <ArrowUp size={12} className="text-[var(--color-accent)] shrink-0" />
        ) : (
          <ArrowDown size={12} className="text-[var(--color-success)] shrink-0" />
        )}
        <span className="flex-1 truncate font-medium min-w-0">{fileName}</span>
        {(task.state === "running" || task.state === "queued") && (
          <button
            onClick={() => onCancel(task.id)}
            className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] shrink-0"
            title="Cancel"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {task.state === "running" && (
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 h-1.5 bg-[var(--color-bg-base)] rounded-full overflow-hidden min-w-0">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)] whitespace-nowrap">
            {formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}
            <span className="ml-2 text-[var(--color-accent)]">{formatSpeed(task.speedBytesPerSec || 0)}</span>
          </span>
        </div>
      )}
      {task.state === "completed" && (
        <span className="text-[var(--color-success)]">Completed - {formatBytes(task.totalBytes)}</span>
      )}
      {task.state === "failed" && (
        <span className="text-[var(--color-error)] truncate" title={task.error || undefined}>Failed: {task.error}</span>
      )}
      {task.state === "queued" && (
        <span className="text-[var(--color-text-muted)]">Waiting...</span>
      )}
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
  const connectedTabs = tabs.filter((tab) => tab.state === "connected");

  if (connectedTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <HardDrive size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("sftp.noActiveSessions")}
          </p>
          <p className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("sftp.connectFirst")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm">
        <h2 className="mb-4 text-center text-[var(--font-size-lg)] font-medium">
          {t("sftp.selectSession")}
        </h2>
        <div className="space-y-2">
          {connectedTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.sessionId)}
              className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-[var(--font-size-sm)] font-medium">
                {tab.title}
              </span>
            </button>
          ))}
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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Session indicator */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
        <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
          {t("sftp.sftpSession")}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setSessionId(null)}>
          {t("sftp.changeSession")}
        </Button>
      </div>

      {/* Dual-pane file browser */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        <LocalFileList sessionId={sessionId} remotePath={remotePath} />
        <RemoteFileList />
      </div>

      {/* Transfer queue */}
      <TransferQueue />
    </div>
  );
}
