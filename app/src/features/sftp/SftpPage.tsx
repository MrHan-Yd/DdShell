import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useSftpStore, initSftpListeners } from "@/stores/sftp";
import { useTerminalStore } from "@/stores/terminal";
import type { FileEntry, TransferTask } from "@/types";

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

function RemoteFileList() {
  const {
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
  const mkdir = useSftpStore((s) => s.mkdir);
  const rename = useSftpStore((s) => s.rename);

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (entry.fileType === "dir") {
        const newPath =
          remotePath === "/" ? `/${entry.name}` : `${remotePath}/${entry.name}`;
        navigateRemote(newPath);
      }
    },
    [remotePath, navigateRemote],
  );

  const goUp = useCallback(() => {
    if (remotePath === "/") return;
    const parts = remotePath.split("/").filter(Boolean);
    parts.pop();
    navigateRemote("/" + parts.join("/") || "/");
  }, [remotePath, navigateRemote]);

  return (
    <div className="flex flex-1 flex-col border border-[var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2">
        <HardDrive size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
          Remote
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

      {/* Breadcrumb */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5">
        <Breadcrumb path={remotePath} onNavigate={navigateRemote} />
      </div>

      {/* Mkdir inline input */}
      {showMkdir && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-bg-elevated)]">
          <Input
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            placeholder="New folder name"
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
            Create
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
            Empty directory
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
                  onClick={(e) => {
                    e.stopPropagation();
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
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const clearFinishedTransfers = useSftpStore((s) => s.clearFinishedTransfers);

  if (transfers.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
          Transfers ({transfers.length})
        </span>
        <Button size="sm" variant="ghost" onClick={clearFinishedTransfers}>
          Clear finished
        </Button>
      </div>
      <div className="max-h-[140px] overflow-y-auto">
        {transfers.map((task) => (
          <TransferRow key={task.id} task={task} onCancel={cancelTransfer} />
        ))}
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
  const tabs = useTerminalStore((s) => s.tabs);
  const connectedTabs = tabs.filter((t) => t.state === "connected");

  if (connectedTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <HardDrive size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            No active SSH sessions
          </p>
          <p className="mt-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            Connect to a host first to use SFTP.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm">
        <h2 className="mb-4 text-center text-[var(--font-size-lg)] font-medium">
          Select a session for SFTP
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
  const sessionId = useSftpStore((s) => s.sessionId);
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
          SFTP Session
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setSessionId(null)}>
          Change session
        </Button>
      </div>

      {/* File browser */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        <RemoteFileList />
      </div>

      {/* Transfer queue */}
      <TransferQueue />
    </div>
  );
}
