import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowDown,
  ArrowUp,
  Download,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  MoveRight,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/themed/Input";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import type { FileEntry, TransferTask } from "@/types";
import { useSftpStore, initSftpListeners } from "@/stores/sftp";
import { confirm, useConfirmStore } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import { openQuickEditWindow } from "@/lib/quickEditWindow";
import { recordQuickEditRecent } from "@/lib/quickEditRecent";
import {
  collectExistingLocalTargets,
  collectExistingRemoteUploadTargets,
  confirmOverwritePaths,
  formatBytes,
  formatPermissions,
  formatTime,
  getPathName,
  getRemoteDirPath,
  joinRemotePath,
  resolveDownloadBaseDir,
  resolveDownloadTargetPath,
  scanLocalDir,
  type UploadTask,
} from "@/features/sftp/shared";
import { RemoteDirectoryPicker } from "./RemoteDirectoryPicker";

type TerminalFileManagerDrawerProps = {
  open: boolean;
  sessionId: string;
  hostId: string;
  hostName: string;
  initialPath: string;
  onClose: () => void;
  onPathResolved?: (path: string) => void;
};

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
  ".h",
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

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.fileType === "dir") return <Folder size={16} className="text-[var(--color-accent)]" />;
  if (entry.fileType === "symlink") return <FileSymlink size={16} className="text-[var(--color-text-muted)]" />;
  return <File size={16} className="text-[var(--color-text-muted)]" />;
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

function fileNameFromTransfer(task: TransferTask): string {
  return task.direction === "upload"
    ? getPathName(task.localPath)
    : getPathName(task.remotePath);
}

function TransferRow({
  task,
  onCancel,
}: {
  task: TransferTask;
  onCancel: (id: string) => void;
}) {
  const progress = task.totalBytes > 0
    ? Math.round((task.transferredBytes / task.totalBytes) * 100)
    : 0;

  return (
    <div
      className={cn(
        "tfm-transfer-row",
        task.state === "running" && "is-active",
        task.state === "completed" && "is-done",
        task.state === "failed" && "is-failed",
      )}
    >
      <span className={cn("td-dir", task.direction === "upload" ? "up" : "down")}>
        {task.direction === "upload" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      </span>
      <span className="tfm-transfer-name" title={fileNameFromTransfer(task)}>
        {fileNameFromTransfer(task)}
      </span>
      <span className="tfm-transfer-bar">
        <span className="tfm-transfer-fill" style={{ width: `${progress}%` }} />
      </span>
      <span className="tfm-transfer-meta">
        {task.state === "running"
          ? `${progress}% · ${formatBytes(task.speedBytesPerSec || 0)}/s`
          : task.state === "completed"
            ? `${formatBytes(task.totalBytes)}`
            : task.state === "failed"
              ? task.error ?? "failed"
              : task.state}
      </span>
      {(task.state === "running" || task.state === "queued") && (
        <button
          type="button"
          onClick={() => onCancel(task.id)}
          className="btn btn-icon btn-ghost"
          title="Cancel"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

function CompactTransferStatus() {
  const t = useT();
  const transfers = useSftpStore((state) => state.transfers);
  const cancelTransfer = useSftpStore((state) => state.cancelTransfer);
  const clearFinishedTransfers = useSftpStore((state) => state.clearFinishedTransfers);
  const [expanded, setExpanded] = useState(false);

  const activeTransfers = transfers.filter((task) => task.state === "running" || task.state === "queued");
  const finishedTransfers = transfers.filter((task) => task.state === "completed" || task.state === "failed");
  const activeProgress = activeTransfers.length > 0
    ? Math.round(
        activeTransfers.reduce((sum, task) => {
          if (task.totalBytes <= 0) return sum;
          return sum + task.transferredBytes / task.totalBytes;
        }, 0) / activeTransfers.length * 100,
      )
    : 0;

  if (transfers.length === 0) return null;

  return (
    <div className={cn("tfm-transfer", expanded && "is-expanded")}>
      <button
        type="button"
        className="tfm-transfer-summary"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="td-title">
          <Upload size={13} />
          {t("sftp.transfers")}
        </span>
        <span className="tfm-transfer-summary-bar">
          <span style={{ width: `${activeProgress}%` }} />
        </span>
        <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {activeTransfers.length > 0
            ? t("terminalFileManager.transferActive", { n: activeTransfers.length })
            : t("terminalFileManager.transferTotal", { n: transfers.length })}
        </span>
      </button>
      {expanded && (
        <div className="tfm-transfer-list">
          <div className="flex items-center justify-between gap-2 pb-1">
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {finishedTransfers.length > 0
                ? t("terminalFileManager.finishedTransfers", { n: finishedTransfers.length })
                : t("terminalFileManager.noFinishedTransfers")}
            </span>
            {finishedTransfers.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearFinishedTransfers}>
                {t("sftp.clearFinished")}
              </Button>
            )}
          </div>
          {transfers.map((task) => (
            <TransferRow key={task.id} task={task} onCancel={cancelTransfer} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TerminalFileManagerDrawer({
  open,
  sessionId,
  hostId,
  hostName,
  initialPath,
  onClose,
  onPathResolved,
}: TerminalFileManagerDrawerProps) {
  const t = useT();
  const {
    remotePath,
    remoteEntries,
    loading,
    error,
    selectedRemoteEntries,
    uploadingFiles,
    transfers,
    taskIdToName,
    setSessionId,
    navigateRemote,
    refreshRemote,
    mkdir,
    rename,
    remove,
    removeEntry,
    toggleSelectRemote,
    clearSelectRemote,
    refreshTransfers,
    addUploadingEntry,
    registerBatch,
  } = useSftpStore();
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [movingEntries, setMovingEntries] = useState<FileEntry[] | null>(null);
  const [deletingEntries, setDeletingEntries] = useState<Set<string>>(new Set());
  const [focusInside, setFocusInside] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const mkdirSubmittingRef = useRef(false);
  const onPathResolvedRef = useRef(onPathResolved);
  const { menuState, onContextMenu, closeMenu } = useContextMenu<FileEntry>();

  onPathResolvedRef.current = onPathResolved;

  const openMkdirEditor = useCallback(() => {
    mkdirSubmittingRef.current = false;
    setNewDirName("");
    setShowMkdir(true);
  }, []);

  const cancelMkdirEditor = useCallback(() => {
    mkdirSubmittingRef.current = false;
    setShowMkdir(false);
    setNewDirName("");
  }, []);

  const commitMkdirEditor = useCallback(async () => {
    if (mkdirSubmittingRef.current) return;

    const name = newDirName.trim();
    if (!name) {
      cancelMkdirEditor();
      return;
    }

    mkdirSubmittingRef.current = true;
    try {
      await mkdir(name);
      cancelMkdirEditor();
    } finally {
      mkdirSubmittingRef.current = false;
    }
  }, [cancelMkdirEditor, mkdir, newDirName]);

  const uploadSpeeds = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of transfers) {
      const name = taskIdToName.get(task.id);
      if (name && task.speedBytesPerSec) map.set(name, task.speedBytesPerSec);
    }
    return map;
  }, [transfers, taskIdToName]);

  useEffect(() => {
    if (!open) return;
    initSftpListeners();
    setSessionId(sessionId, { navigate: false });
    void refreshTransfers();
  }, [open, refreshTransfers, sessionId, setSessionId]);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    const resolveInitialPath = async () => {
      const recents = await api.pathListRecent(sessionId, 1).catch(() => []);
      const candidates = Array.from(new Set([initialPath, recents[0]?.path, "/"].filter(Boolean)));
      for (const candidate of candidates) {
        try {
          await api.sftpListDir(sessionId, candidate);
          if (cancelled) return;
          await navigateRemote(candidate);
          onPathResolvedRef.current?.(candidate);
          return;
        } catch {
          // Try next fallback.
        }
      }
      if (!cancelled) await navigateRemote("/");
    };
    void resolveInitialPath();
    return () => {
      cancelled = true;
    };
    // Resolve only when the target session changes or the drawer opens; terminal cwd updates
    // after that should not steal the directory the user is browsing in this drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  const navigateRemoteWithRecent = useCallback(
    (path: string) => {
      void navigateRemote(path);
      onPathResolved?.(path);
      api.pathAddRecent(sessionId, path).catch(() => {});
    },
    [navigateRemote, onPathResolved, sessionId],
  );

  const countDirFiles = useCallback(
    async (dirPath: string): Promise<number> => {
      let count = 0;
      const stack = [dirPath];
      while (stack.length > 0) {
        const current = stack.pop()!;
        try {
          const entries = await api.sftpListDir(sessionId, current);
          for (const entry of entries) {
            count++;
            useConfirmStore.getState().updateOptions({ scanCount: count });
            if (entry.fileType === "dir") stack.push(joinRemotePath(current, entry.name));
          }
        } catch {
          // Keep partial count when a subdirectory cannot be listed.
        }
      }
      return count;
    },
    [sessionId],
  );

  const deleteWithAnimation = useCallback(
    async (name: string, isDir: boolean) => {
      setDeletingEntries((prev) => new Set(prev).add(name));
      await new Promise((resolve) => setTimeout(resolve, 180));
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
    },
    [remove],
  );

  const forceDeleteWithAnimation = useCallback(
    async (name: string) => {
      setDeletingEntries((prev) => new Set(prev).add(name));
      await new Promise((resolve) => setTimeout(resolve, 180));
      await api.sftpRemove(sessionId, joinRemotePath(remotePath, name), true);
      removeEntry(name);
    },
    [remotePath, removeEntry, sessionId],
  );

  const handleDeleteEntries = useCallback(
    async (entries: FileEntry[]) => {
      if (entries.length === 0) return;
      const dirEntries = entries.filter((entry) => entry.fileType === "dir");
      if (dirEntries.length > 0) {
        const confirmResult = useConfirmStore.getState()._show({
          title: t("confirm.deleteNonEmptyDirTitle"),
          description: entries.length === 1 ? t("confirm.deleteFileDesc") : t("confirm.deleteBatchDesc", { n: entries.length }),
          confirmLabel: t("confirm.delete"),
          scanning: true,
        });

        let totalFileCount = 0;
        for (const entry of dirEntries) {
          totalFileCount += await countDirFiles(joinRemotePath(remotePath, entry.name));
        }

        useConfirmStore.getState().updateOptions({
          scanning: false,
          description: totalFileCount > 0
            ? `${t("confirm.deleteNonEmptyDirDesc", { name: dirEntries.map((entry) => entry.name).join(", ") })}\n\n(${totalFileCount} ${totalFileCount === 1 ? t("sftp.file") : t("sftp.files")})`
            : entries.length === 1 ? t("confirm.deleteFileDesc") : t("confirm.deleteBatchDesc", { n: entries.length }),
        });
        const ok = await confirmResult;
        if (!ok) return;
      } else {
        const ok = await confirm({
          title: entries.length === 1 ? t("confirm.deleteFileTitle") : t("confirm.deleteBatchTitle"),
          description: entries.length === 1 ? t("confirm.deleteFileDesc") : t("confirm.deleteBatchDesc", { n: entries.length }),
          confirmLabel: t("confirm.delete"),
        });
        if (!ok) return;
      }

      for (const entry of entries) {
        if (entry.fileType === "dir") await forceDeleteWithAnimation(entry.name);
        else await deleteWithAnimation(entry.name, false);
      }
      clearSelectRemote();
      setDeletingEntries(new Set());
      toast.success(t("sftp.deletedItems", { n: entries.length }));
    },
    [clearSelectRemote, countDirFiles, deleteWithAnimation, forceDeleteWithAnimation, remotePath, t],
  );

  const selectedEntries = useMemo(
    () => remoteEntries.filter((entry) => selectedRemoteEntries.has(entry.name)),
    [remoteEntries, selectedRemoteEntries],
  );

  const selectedQuickEditEntry = useMemo(() => {
    if (selectedRemoteEntries.size !== 1) return null;
    const selectedName = Array.from(selectedRemoteEntries)[0];
    const entry = remoteEntries.find((item) => item.name === selectedName);
    if (!entry || !isLikelyQuickEditFile(entry)) return null;
    return entry;
  }, [remoteEntries, selectedRemoteEntries]);

  const openQuickEdit = useCallback(
    (path: string) => {
      void openQuickEditWindow({
        sessionId,
        hostId,
        hostName,
        remotePath: path,
      });
      recordQuickEditRecent({
        hostId,
        sessionId,
        remotePath: path,
        fileName: getPathName(path),
        updatedAt: Date.now(),
      });
    },
    [hostId, hostName, sessionId],
  );

  const handleDoubleClick = useCallback(
    (entry: FileEntry) => {
      const fullPath = joinRemotePath(remotePath, entry.name);
      if (entry.fileType === "dir") {
        navigateRemoteWithRecent(fullPath);
        return;
      }
      if (isLikelyQuickEditFile(entry)) openQuickEdit(fullPath);
    },
    [navigateRemoteWithRecent, openQuickEdit, remotePath],
  );

  const startDownload = useCallback(
    async (entry: FileEntry) => {
      const fullPath = joinRemotePath(remotePath, entry.name);
      if (entry.fileType === "file") {
        const shouldContinue = await confirmOverwritePaths(t, "download", async () => {
          const downloadBaseDir = await resolveDownloadBaseDir();
          const localTargetPath = await resolveDownloadTargetPath(downloadBaseDir, fullPath);
          return collectExistingLocalTargets([localTargetPath]);
        });
        if (!shouldContinue) return;
        await api.sftpTransferStart(sessionId, "download", "", fullPath);
        await refreshTransfers();
        toast.success(t("sftp.downloadStarted"));
        return;
      }

      toast.info(t("sftp.scanningDir"));
      const collectFiles = async (dir: string, base: string): Promise<{ remote: string; relative: string }[]> => {
        const files: { remote: string; relative: string }[] = [];
        const entries = await api.sftpListDir(sessionId, dir);
        for (const item of entries) {
          const remote = joinRemotePath(dir, item.name);
          const relative = base ? `${base}/${item.name}` : item.name;
          if (item.fileType === "file") files.push({ remote, relative });
          else if (item.fileType === "dir") files.push(...await collectFiles(remote, relative));
        }
        return files;
      };

      const files = await collectFiles(fullPath, "");
      if (files.length === 0) {
        toast.info(t("sftp.emptyDir"));
        return;
      }

      const shouldContinue = await confirmOverwritePaths(t, "download", async () => {
        const downloadBaseDir = await resolveDownloadBaseDir();
        const localTargets = await Promise.all(
          files.map((file) => resolveDownloadTargetPath(downloadBaseDir, file.remote, `${entry.name}/${file.relative}`)),
        );
        return collectExistingLocalTargets(localTargets);
      });
      if (!shouldContinue) return;

      const results = await Promise.all(
        files.map((file) =>
          api.sftpTransferStart(sessionId, "download", "", file.remote, `${entry.name}/${file.relative}`)
            .catch((error) => ({ error })),
        ),
      );
      const taskIds = results
        .filter((result): result is { id: string } => "id" in result)
        .map((result) => result.id);
      registerBatch(taskIds, "download");
      await refreshTransfers();
    },
    [refreshTransfers, registerBatch, remotePath, sessionId, t],
  );

  const uploadPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const uploadTasks: UploadTask[] = [];
      for (const localPath of paths) {
        const fileName = getPathName(localPath);
        try {
          await api.localListDir(localPath);
          const allFiles = await scanLocalDir(localPath, "");
          const byDir = new Map<string, string[]>();
          for (const file of allFiles) {
            if (file.isDir) continue;
            const relativeDir = file.relative.includes("/")
              ? file.relative.substring(0, file.relative.lastIndexOf("/"))
              : "";
            const baseRemoteDir = joinRemotePath(remotePath, fileName);
            const remoteSubDir = relativeDir ? joinRemotePath(baseRemoteDir, relativeDir) : baseRemoteDir;
            if (!byDir.has(remoteSubDir)) byDir.set(remoteSubDir, []);
            byDir.get(remoteSubDir)!.push(file.local);
          }
          for (const [remoteDir, localPaths] of byDir) {
            uploadTasks.push({ localPaths, remoteDir });
          }
        } catch {
          uploadTasks.push({ localPaths: [localPath], remoteDir: remotePath });
        }
      }

      if (uploadTasks.length === 0) {
        toast.error(t("sftp.emptyDirectory"));
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
          const localPath = task.localPaths[i];
          const taskId = taskIds[i];
          const fileName = getPathName(localPath || "");
          if (fileName && taskId) addUploadingEntry(fileName, 0, taskId);
          if (taskId) allTaskIds.push(taskId);
        }
      }
      if (allTaskIds.length > 0) {
        registerBatch(allTaskIds, "upload");
        await refreshTransfers();
      }
    },
    [addUploadingEntry, refreshTransfers, registerBatch, remotePath, sessionId, t],
  );

  const handleUploadClick = useCallback(async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      title: t("terminalFileManager.pickUploadFiles"),
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await uploadPaths(paths);
  }, [t, uploadPaths]);

  useEffect(() => {
    if (!open) return;
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragOver(true);
      } else if (payload.type === "leave") {
        setIsDragOver(false);
      } else if (payload.type === "drop") {
        setIsDragOver(false);
        await uploadPaths(payload.paths ?? []);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [open, uploadPaths]);

  const startMove = useCallback(
    (entries: FileEntry[]) => {
      if (entries.length === 0) return;
      setMovingEntries(entries);
    },
    [],
  );

  const finishMove = useCallback(
    async (targetDir: string) => {
      if (!movingEntries || movingEntries.length === 0) return;
      const sameDir = targetDir === remotePath;
      if (sameDir) {
        toast.info(t("terminalFileManager.moveSameDir"));
        setMovingEntries(null);
        return;
      }

      const targetEntries = await api.sftpListDir(sessionId, targetDir);
      const targetNames = new Set(targetEntries.map((entry) => entry.name));
      const conflicts = movingEntries.filter((entry) => targetNames.has(entry.name));
      if (conflicts.length > 0) {
        toast.error(`${t("terminalFileManager.moveConflictTitle")}: ${t("terminalFileManager.moveConflictDesc", { n: conflicts.length })}`);
        return;
      }

      for (const entry of movingEntries) {
        await api.sftpRename(sessionId, joinRemotePath(remotePath, entry.name), joinRemotePath(targetDir, entry.name));
      }
      clearSelectRemote();
      setMovingEntries(null);
      await refreshRemote();
      toast.success(t("terminalFileManager.movedItems", { n: movingEntries.length }));
    },
    [clearSelectRemote, movingEntries, refreshRemote, remotePath, sessionId, t],
  );

  const buildContextMenuItems = useCallback(
    (entry: FileEntry): MenuItem[] => {
      const activeSelection = selectedRemoteEntries.has(entry.name) ? selectedEntries : [entry];
      const items: MenuItem[] = [];

      if (entry.fileType === "dir") {
        items.push({
          icon: <FolderOpen size={14} />,
          label: t("sftp.open"),
          onClick: () => navigateRemoteWithRecent(joinRemotePath(remotePath, entry.name)),
        });
      }
      if (entry.fileType === "file") {
        items.push({
          icon: <Pencil size={14} />,
          label: t("sftp.quickEdit"),
          disabled: !isLikelyQuickEditFile(entry),
          onClick: () => openQuickEdit(joinRemotePath(remotePath, entry.name)),
        });
      }
      items.push(
        {
          icon: <Download size={14} />,
          label: t("sftp.download"),
          onClick: () => {
            void Promise.all(activeSelection.map((item) => startDownload(item)));
          },
        },
        {
          icon: <MoveRight size={14} />,
          label: t("terminalFileManager.moveTo"),
          onClick: () => startMove(activeSelection),
        },
        {
          icon: <Pencil size={14} />,
          label: t("sftp.rename"),
          disabled: activeSelection.length !== 1,
          onClick: () => {
            setRenamingName(entry.name);
            setRenameValue(entry.name);
          },
        },
        { type: "separator" },
        {
          icon: <Trash2 size={14} />,
          label: t("confirm.delete"),
          danger: true,
          onClick: () => {
            void handleDeleteEntries(activeSelection);
          },
        },
      );
      return items;
    },
    [handleDeleteEntries, navigateRemoteWithRecent, openQuickEdit, remotePath, selectedEntries, selectedRemoteEntries, startDownload, startMove, t],
  );

  useEffect(() => {
    if (!open || !focusInside) return;
    const handler = (event: KeyboardEvent) => {
      const targetNode = event.target instanceof Node ? event.target : null;
      if (!targetNode || !dropRef.current?.contains(targetNode)) return;
      const target = targetNode instanceof HTMLElement ? targetNode : null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (event.key === "F5") {
        event.preventDefault();
        void refreshRemote();
      } else if (event.key === "F2") {
        if (selectedEntries.length === 1) {
          event.preventDefault();
          setRenamingName(selectedEntries[0].name);
          setRenameValue(selectedEntries[0].name);
        }
      } else if (event.key === "Delete") {
        event.preventDefault();
        void handleDeleteEntries(selectedEntries);
      } else if (event.key.toLowerCase() === "n" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openMkdirEditor();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [focusInside, handleDeleteEntries, open, openMkdirEditor, refreshRemote, selectedEntries]);

  const goUp = useCallback(() => {
    if (remotePath === "/") return;
    navigateRemoteWithRecent(getRemoteDirPath(remotePath));
  }, [navigateRemoteWithRecent, remotePath]);

  const remoteSelectedCount = selectedRemoteEntries.size;
  const remoteSelectedSize = remoteEntries
    .filter((entry) => selectedRemoteEntries.has(entry.name))
    .reduce((sum, entry) => sum + (entry.fileType === "dir" ? 0 : entry.size), 0);
  const remoteTotalSize = remoteEntries
    .filter((entry) => entry.fileType !== "dir")
    .reduce((sum, entry) => sum + entry.size, 0);

  if (!open) return null;

  return (
    <section
      className="terminal-file-manager"
      onFocusCapture={() => setFocusInside(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusInside(false);
        }
      }}
    >
      <div className="tfm-head">
        <span className="tfm-title">
          <HardDrive size={14} />
          {t("terminalFileManager.title")}
        </span>
        <span className="tfm-host" title={`${hostName}:${remotePath}`}>{hostName}:{remotePath}</span>
        <span className="tfm-spacer" />
        <Button size="sm" variant="ghost" onClick={handleUploadClick}>
          <Upload size={13} />
          {t("sftp.upload")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => refreshRemote()}>
          <RefreshCw size={13} />
          {t("terminalPicker.refresh")}
        </Button>
        <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} title={t("terminalPicker.hintClose")}>
          <X size={14} />
        </button>
      </div>

      <div className="tfm-toolbar">
        <button className="path-up btn btn-icon btn-ghost" onClick={goUp} title={t("terminalPicker.parent")}>
          <ArrowUp size={13} />
        </button>
        <div className="tfm-path" title={remotePath}>{remotePath}</div>
        <button className="btn btn-icon btn-ghost" onClick={openMkdirEditor} title={t("sftp.newFolder")}>
          <FolderPlus size={13} />
        </button>
        {selectedQuickEditEntry && (
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => openQuickEdit(joinRemotePath(remotePath, selectedQuickEditEntry.name))}
            title={t("sftp.quickEdit")}
          >
            <Pencil size={13} />
          </button>
        )}
        {selectedEntries.length > 0 && (
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => startMove(selectedEntries)}
            title={t("terminalFileManager.moveTo")}
          >
            <MoveRight size={13} />
          </button>
        )}
      </div>

      {showMkdir && (
        <div
          className="tfm-inline-editor"
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget && event.currentTarget.contains(nextTarget)) return;
            void commitMkdirEditor();
          }}
        >
          <Input
            value={newDirName}
            onChange={(event) => setNewDirName(event.target.value)}
            placeholder={t("sftp.newFolderName")}
            className="flex-1"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitMkdirEditor();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelMkdirEditor();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("terminalPicker.hintClose")}
            onMouseDown={(event) => {
              event.preventDefault();
              cancelMkdirEditor();
            }}
            onClick={cancelMkdirEditor}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      <div
        ref={dropRef}
        className={cn("tfm-list", isDragOver && "is-drop-target")}
        tabIndex={0}
        data-context-menu-container
      >
        {isDragOver && (
          <div className="tfm-drop-overlay">
            <Upload size={30} />
            <span>{t("sftp.dropToUpload")}</span>
            <span className="font-mono text-[var(--font-size-xs)]">{remotePath}</span>
          </div>
        )}

        <div className="file-row file-head">
          <span className="col-name">{t("sftp.colName")}</span>
          <span className="col-size">{t("sftp.colSize")}</span>
          <span className="col-mtime">{t("sftp.colModified")}</span>
          <span className="col-perm">{t("sftp.colPerm")}</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        )}

        {error && <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-error)]">{error}</div>}

        {!loading && !error && remoteEntries.length === 0 && (
          <div className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("sftp.emptyDirectory")}
          </div>
        )}

        {!loading && remoteEntries.map((entry) => {
          const totalSize = uploadingFiles.get(entry.name);
          const isUploading = totalSize !== undefined;
          const progress = isUploading && totalSize > 0 ? Math.round((entry.size / totalSize) * 100) : 0;
          return (
            <div
              key={entry.name}
              className={cn(
                "file-row",
                entry.fileType === "dir" && "is-dir",
                selectedRemoteEntries.has(entry.name) && "is-selected",
                isUploading && "is-uploading",
                deletingEntries.has(entry.name) && "animate-fade-out pointer-events-none",
              )}
              onClick={() => toggleSelectRemote(entry.name)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(event) => {
                if (!selectedRemoteEntries.has(entry.name)) toggleSelectRemote(entry.name);
                onContextMenu(event, entry);
              }}
            >
              <span className="col-name">
                {isUploading ? <Upload size={14} className="text-[var(--color-accent)]" /> : <FileIcon entry={entry} />}
                {renamingName === entry.name ? (
                  <Input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="h-6 flex-1 text-[var(--font-size-sm)]"
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setRenamingName(null)}
                    onKeyDown={async (event) => {
                      if (event.key === "Enter" && renameValue.trim()) {
                        await rename(entry.name, renameValue.trim());
                        setRenamingName(null);
                      }
                      if (event.key === "Escape") setRenamingName(null);
                    }}
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
              <span className="col-size">{entry.fileType === "dir" ? "-" : formatBytes(entry.size)}</span>
              <span className="col-mtime">{isUploading ? t("sftp.uploading") : formatTime(entry.mtime)}</span>
              <span className="col-perm">
                {isUploading
                  ? `${progress}%${uploadSpeeds.has(entry.name) ? ` · ${formatBytes(uploadSpeeds.get(entry.name)!)} /s` : ""}`
                  : formatPermissions(entry.permissions, entry.fileType)}
              </span>
            </div>
          );
        })}

        {menuState && (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            containerRef={dropRef}
            items={buildContextMenuItems(menuState.data)}
          />
        )}
      </div>

      <div className="tfm-foot">
        <span>{remoteSelectedCount > 0 ? `${remoteSelectedCount} ${t("sftp.selected")} · ${formatBytes(remoteSelectedSize)}` : "-"}</span>
        <span className="spacer" />
        <span>{remoteEntries.length} {t("sftp.itemsTotal")} · {formatBytes(remoteTotalSize)}</span>
      </div>

      <CompactTransferStatus />

      {movingEntries && (
        <RemoteDirectoryPicker
          open
          sessionId={sessionId}
          hostName={hostName}
          initialPath={remotePath}
          title={t("terminalFileManager.movePickerTitle", { n: movingEntries.length })}
          confirmLabel={t("terminalFileManager.moveHere")}
          onPick={(path) => {
            void finishMove(path);
          }}
          onClose={() => setMovingEntries(null)}
        />
      )}
    </section>
  );
}
