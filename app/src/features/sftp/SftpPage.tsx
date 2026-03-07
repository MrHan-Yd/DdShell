import { useEffect, useState, useCallback, useRef } from "react";
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
  ChevronUp,
  ChevronDown,
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

  const handleUploadSelected = useCallback(async () => {
    const files = Array.from(selected)
      .map((name) => entries.find((e) => e.name === name))
      .filter((e): e is LocalFileEntry => !!e && e.fileType === "file");

    if (files.length === 0) {
      toast.error("No files selected to upload");
      return;
    }

    const paths = files.map((f) =>
      localPath === "/" ? `/${f.name}` : `${localPath}/${f.name}`,
    );

    try {
      await api.sftpUploadFiles(sessionId, paths, remotePath);
      toast.success(
        `Uploading ${paths.length} file${paths.length > 1 ? "s" : ""}...`,
      );
    } catch (err) {
      toast.error(String(err));
    }
  }, [selected, entries, localPath, sessionId, remotePath]);

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
              <span className="w-36 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
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
  } = useSftpStore();
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [showRename, setShowRename] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const mkdir = useSftpStore((s) => s.mkdir);
  const rename = useSftpStore((s) => s.rename);
  const dropRef = useRef<HTMLDivElement>(null);

  // Wrap navigateRemote to also track recent paths
  const navigateRemoteWithRecent = useCallback(
    async (path: string) => {
      navigateRemote(path);
      if (sessionId) {
        api.pathAddRecent(sessionId, path).catch(() => {
          /* ignore errors for recent tracking */
        });
      }
    },
    [navigateRemote, sessionId],
  );

  // ── SFTP keyboard shortcuts ──
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
    const handleDelete = async () => {
      const selected = Array.from(selectedRemoteEntries);
      if (selected.length > 0) {
        const ok = await confirm({
          title: t("confirm.deleteBatchTitle"),
          description: t("confirm.deleteBatchDesc", { n: selected.length }),
          confirmLabel: t("confirm.delete"),
        });
        if (!ok) return;
        const entries = remoteEntries.filter((e) => selectedRemoteEntries.has(e.name));
        for (const entry of entries) {
          remove(entry.name, entry.fileType === "dir");
        }
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
  }, [refreshRemote, selectedRemoteEntries, remoteEntries, remove]);

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
      for (let i = 0; i < files.length; i++) {
        // In Tauri, File objects have a path property
        const file = files[i] as File & { path?: string };
        if (file.path) {
          paths.push(file.path);
        }
      }

      if (paths.length === 0) return;

      try {
        await api.sftpUploadFiles(sessionId, paths, remotePath);
        toast.success(`Uploading ${paths.length} file${paths.length > 1 ? "s" : ""}...`);
      } catch (err) {
        toast.error(String(err));
      }
    },
    [sessionId, remotePath],
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
      <div className="flex-1 overflow-y-auto">
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
          remoteEntries.map((entry) => (
            <div
              key={entry.name}
              className={cn(
                "flex items-center gap-3 px-3 py-1.5 text-[var(--font-size-sm)] cursor-default hover:bg-[var(--color-bg-hover)] transition-colors",
                selectedRemoteEntries.has(entry.name) && "bg-[var(--color-accent-subtle)]",
              )}
              onClick={() => toggleSelectRemote(entry.name)}
              onDoubleClick={() => handleDoubleClick(entry)}
            >
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
              <span className="w-20 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {entry.fileType === "dir" ? "-" : formatBytes(entry.size)}
              </span>
              <span className="w-36 text-right text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {formatTime(entry.mtime)}
              </span>
              <div className="flex items-center gap-1 w-14">
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
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: t("confirm.deleteFileTitle"),
                      description: t("confirm.deleteFileDesc"),
                      confirmLabel: t("confirm.delete"),
                    });
                    if (!ok) return;
                    remove(entry.name, entry.fileType === "dir");
                  }}
                  className="p-0.5 rounded hover:bg-[var(--color-bg-hover)]"
                  title="Delete"
                >
                  <Trash2 size={12} className="text-[var(--color-error)]" />
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function TransferQueue() {
  const t = useT();
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const clearFinishedTransfers = useSftpStore((s) => s.clearFinishedTransfers);

  // Track whether user has manually toggled the panel
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);

  // Determine if there are active or failed transfers
  const hasActiveOrFailed = transfers.some(
    (t) => t.state === "running" || t.state === "queued" || t.state === "failed",
  );

  // Determine effective collapsed state:
  // - If user has manually toggled, respect that preference
  // - Otherwise, auto-expand when active/failed, collapse when idle
  const isExpanded =
    manualToggle !== null ? manualToggle : hasActiveOrFailed;

  // Reset manual toggle when active state changes so auto-behavior resumes
  useEffect(() => {
    // When transfers go from active to idle or vice versa, reset manual preference
    setManualToggle(null);
  }, [hasActiveOrFailed]);

  if (transfers.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <button
          onClick={() => setManualToggle(!isExpanded)}
          className="flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {t("sftp.transfers")} ({transfers.length})
          {hasActiveOrFailed && (
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
          )}
        </button>
        <Button size="sm" variant="ghost" onClick={clearFinishedTransfers}>
          {t("sftp.clearFinished")}
        </Button>
      </div>
      {isExpanded && (
        <div className="max-h-[140px] overflow-y-auto">
          {transfers.map((task) => (
            <TransferRow key={task.id} task={task} onCancel={cancelTransfer} />
          ))}
        </div>
      )}
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

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-[var(--font-size-xs)]">
      {task.direction === "upload" ? (
        <ArrowUp size={12} className="text-[var(--color-accent)]" />
      ) : (
        <ArrowDown size={12} className="text-[var(--color-success)]" />
      )}
      <span className="flex-1 truncate">{fileName}</span>
      {task.state === "running" && (
        <>
          <div className="w-24 h-1.5 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="w-10 text-right text-[var(--color-text-muted)]">{progress}%</span>
        </>
      )}
      <span
        className={cn(
          "w-16 text-right",
          task.state === "completed" && "text-[var(--color-success)]",
          task.state === "failed" && "text-[var(--color-error)]",
          task.state === "running" && "text-[var(--color-accent)]",
          task.state === "queued" && "text-[var(--color-text-muted)]",
          task.state === "canceled" && "text-[var(--color-text-muted)]",
        )}
      >
        {task.state}
      </span>
      {(task.state === "running" || task.state === "queued") && (
        <button onClick={() => onCancel(task.id)} className="p-0.5 rounded hover:bg-[var(--color-bg-hover)]">
          <X size={12} />
        </button>
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

  useEffect(() => {
    initSftpListeners();
  }, []);

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
