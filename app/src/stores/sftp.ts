import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { FileEntry, TransferTask, TransferDirection } from "@/types";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { toast } from "@/stores/toast";
import * as api from "@/lib/tauri";

interface SftpState {
  sessionId: string | null;
  remotePath: string;
  remoteEntries: FileEntry[];
  loading: boolean;
  error: string | null;
  transfers: TransferTask[];
  selectedRemoteEntries: Set<string>;
  uploadingFiles: Map<string, number>; // name -> totalSize for files being uploaded
  taskIdToName: Map<string, string>; // taskId -> name
  completedUploads: Set<string>; // names of recently completed uploads (for fade-out)
  activeBatches: Map<string, { taskIds: Set<string>; completed: number; failed: number; total: number; direction: TransferDirection }>;

  setSessionId: (id: string | null) => void;
  navigateRemote: (path: string) => Promise<void>;
  refreshRemote: () => Promise<void>;
  mkdir: (name: string) => Promise<void>;
  remove: (name: string, isDir: boolean) => Promise<void>;
  removeEntry: (name: string) => void;  // Remove entry from local list without refresh
  rename: (oldName: string, newName: string) => Promise<void>;
  startTransfer: (direction: TransferDirection, localPath: string, remotePath: string) => Promise<string>;
  cancelTransfer: (taskId: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  toggleSelectRemote: (name: string) => void;
  clearSelectRemote: () => void;
  addUploadingEntry: (name: string, totalSize: number, taskId: string) => void;
  updateUploadingEntry: (name: string, transferredSize: number) => void;
  clearUploadingEntry: (name: string) => void;
  updateTransferProgress: (taskId: string, transferred: number, total: number, speed?: number) => void;
  markTransferCompleted: (taskId: string) => void;
  markTransferFailed: (taskId: string, error: string) => void;
  registerBatch: (taskIds: string[], direction: TransferDirection) => void;
}

export const useSftpStore = create<SftpState>((set, get) => ({
  sessionId: null,
  remotePath: "/",
  remoteEntries: [],
  loading: false,
  error: null,
  transfers: [],
  selectedRemoteEntries: new Set(),
  uploadingFiles: new Map(),
  taskIdToName: new Map(),
  completedUploads: new Set(),
  activeBatches: new Map(),

  setSessionId: (id) => {
    set({ sessionId: id, remotePath: "/", remoteEntries: [], error: null, uploadingFiles: new Map(), taskIdToName: new Map(), completedUploads: new Set() });
    if (id) {
      get().navigateRemote("/");
    }
  },

  navigateRemote: async (path) => {
    const { sessionId } = get();
    if (!sessionId) return;

    set({ loading: true, error: null, selectedRemoteEntries: new Set() });
    try {
      const entries = await api.sftpListDir(sessionId, path);
      const { uploadingFiles, remoteEntries: currentEntries } = get();
      // Build merged list: preserve uploaded size for files still being uploaded.
      const serverMap = new Map(entries.map((e) => [e.name, e]));

      for (const [name] of uploadingFiles) {
        // Find the current tracked entry (has our transferred bytes)
        const tracked = currentEntries.find((r) => r.name === name);
        if (serverMap.has(name)) {
          // File exists on server — override size with our tracked transferred bytes
          if (tracked) {
            serverMap.set(name, { ...serverMap.get(name)!, size: tracked.size });
          }
        } else if (tracked) {
          // File NOT on server yet (upload just started) — keep virtual entry
          serverMap.set(name, tracked);
        }
      }

      const mergedEntries = Array.from(serverMap.values());
      set({ remotePath: path, remoteEntries: mergedEntries });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  refreshRemote: async () => {
    const { remotePath } = get();
    await get().navigateRemote(remotePath);
  },

  mkdir: async (name) => {
    const { sessionId, remotePath } = get();
    if (!sessionId) return;
    const fullPath = remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;
    await api.sftpMkdir(sessionId, fullPath);
    await get().refreshRemote();
  },

  remove: async (name: string, isDir: boolean) => {
    const { sessionId, remotePath } = get();
    if (!sessionId) return;
    const fullPath = remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;

    // If it's a directory, check if it's empty first
    if (isDir) {
      const entries = await api.sftpListDir(sessionId, fullPath);
      // Filter out . and .. - if only those remain, directory is empty
      const nonHiddenEntries = entries.filter(e => e.name !== "." && e.name !== "..");
      if (nonHiddenEntries.length > 0) {
        // Directory is not empty - caller should handle confirmation
        throw new Error("NON_EMPTY_DIR");
      }
    }

    await api.sftpRemove(sessionId, fullPath, isDir);
    // Remove from local list without refreshing
    get().removeEntry(name);
  },

  removeEntry: (name: string) => {
    set((s) => ({
      remoteEntries: s.remoteEntries.filter((e) => e.name !== name),
    }));
  },

  rename: async (oldName, newName) => {
    const { sessionId, remotePath } = get();
    if (!sessionId) return;
    const oldPath = remotePath === "/" ? `/${oldName}` : `${remotePath}/${oldName}`;
    const newPath = remotePath === "/" ? `/${newName}` : `${remotePath}/${newName}`;
    await api.sftpRename(sessionId, oldPath, newPath);
    await get().refreshRemote();
  },

  startTransfer: async (direction, localPath, remotePath) => {
    const { sessionId } = get();
    if (!sessionId) throw new Error("No session");
    const { id } = await api.sftpTransferStart(sessionId, direction, localPath, remotePath);
    await get().refreshTransfers();
    return id;
  },

  cancelTransfer: async (taskId) => {
    await api.sftpTransferCancel(taskId);
    await api.sftpTransferRemove(taskId);
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== taskId) }));
  },

  refreshTransfers: async () => {
    const transfers = await api.sftpTransferList();
    set({ transfers });
  },

  clearFinishedTransfers: async () => {
    await api.sftpTransferClear();
    await get().refreshTransfers();
  },

  toggleSelectRemote: (name) => {
    set((s) => {
      const next = new Set(s.selectedRemoteEntries);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { selectedRemoteEntries: next };
    });
  },

  clearSelectRemote: () => set({ selectedRemoteEntries: new Set() }),

  // Add a virtual entry for uploading file (not yet on remote server)
  addUploadingEntry: (name, totalSize, taskId) => {
    set((s) => {
      const newUploading = new Map(s.uploadingFiles);
      newUploading.set(name, totalSize);

      // Track taskId -> name for reliable progress updates via taskId
      const newTaskIdToName = new Map(s.taskIdToName);
      newTaskIdToName.set(taskId, name);

      const existingIdx = s.remoteEntries.findIndex((e) => e.name === name);
      let newRemoteEntries = s.remoteEntries;
      if (existingIdx >= 0) {
        newRemoteEntries = s.remoteEntries.map((e, i) =>
          i === existingIdx ? { ...e, size: 0 } : e,
        );
      } else {
        const newEntry: FileEntry = {
          name,
          fileType: "file",
          size: 0,
          mtime: Date.now() / 1000,
          permissions: 0o644,
        };
        newRemoteEntries = [...s.remoteEntries, newEntry];
      }
      return { remoteEntries: newRemoteEntries, uploadingFiles: newUploading, taskIdToName: newTaskIdToName };
    });
  },

  // Update the transferred size for an uploading file
  updateUploadingEntry: (name, transferredSize) => {
    set((s) => ({
      remoteEntries: s.remoteEntries.map((e) =>
        e.name === name ? { ...e, size: transferredSize } : e,
      ),
    }));
  },

  // Clear uploading entry after transfer completes
  clearUploadingEntry: (name) => {
    set((s) => {
      const newUploading = new Map(s.uploadingFiles);
      newUploading.delete(name);
      // Also remove taskId -> name mapping
      const newTaskIdToName = new Map(s.taskIdToName);
      for (const [tid, n] of newTaskIdToName) {
        if (n === name) newTaskIdToName.delete(tid);
      }
      return { uploadingFiles: newUploading, taskIdToName: newTaskIdToName };
    });
  },

  updateTransferProgress: (taskId, transferred, total, speed) => {
    set((s) => {
      // Look up the filename directly from taskId — reliable, no path matching needed
      const filename = s.taskIdToName.get(taskId);
      let newUploading = s.uploadingFiles;

      if (filename) {
        // Update uploadingFiles with the latest total
        newUploading = new Map(s.uploadingFiles);
        newUploading.set(filename, total);

        return {
          transfers: s.transfers.map((t) =>
            t.id === taskId
              ? { ...t, transferredBytes: transferred, totalBytes: total, speedBytesPerSec: speed, state: "running" as const }
              : t,
          ),
          remoteEntries: s.remoteEntries.map((e) =>
            e.name === filename ? { ...e, size: transferred } : e,
          ),
          uploadingFiles: newUploading,
        };
      }

      // Task not found in taskIdToName — might be a download or task not yet registered
      return {
        transfers: s.transfers.map((t) =>
          t.id === taskId
            ? { ...t, transferredBytes: transferred, totalBytes: total, speedBytesPerSec: speed, state: "running" as const }
            : t,
        ),
      };
    });
  },

  markTransferCompleted: (taskId) => {
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === taskId ? { ...t, state: "completed" as const } : t,
      ),
    }));
  },

  markTransferFailed: (taskId, error) => {
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === taskId ? { ...t, state: "failed" as const, error } : t,
      ),
    }));
  },

  registerBatch: (taskIds, direction) => {
    if (taskIds.length <= 1) return; // Single file doesn't need batch tracking
    const batchId = `batch_${Date.now()}`;
    set((s) => {
      const newBatches = new Map(s.activeBatches);
      newBatches.set(batchId, {
        taskIds: new Set(taskIds),
        completed: 0,
        failed: 0,
        total: taskIds.length,
        direction,
      });
      return { activeBatches: newBatches };
    });
  },
}));

// Set up event listeners for transfer events
let listenersInitialized = false;

export function initSftpListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen<{ taskId: string; transferredBytes: number; totalBytes: number; speedBytesPerSec: number }>(
    "transfer:progress",
    (event) => {
      useSftpStore
        .getState()
        .updateTransferProgress(
          event.payload.taskId,
          event.payload.transferredBytes,
          event.payload.totalBytes,
          event.payload.speedBytesPerSec,
        );
    },
  );

  listen<{ taskId: string }>("transfer:completed", (event) => {
    const state = useSftpStore.getState();
    const task = state.transfers.find((t) => t.id === event.payload.taskId);

    // Check if this task belongs to a batch
    let batchKey: string | null = null;
    for (const [key, batch] of state.activeBatches) {
      if (batch.taskIds.has(event.payload.taskId)) {
        batchKey = key;
        break;
      }
    }

    if (task && task.direction === "upload") {
      const remotePath = task.remotePath;
      const filename = remotePath.split("/").pop() || "";
      // Move from uploading → completed (shows green fade-out)
      state.clearUploadingEntry(filename);
      useSftpStore.setState((s) => ({
        completedUploads: new Set(s.completedUploads).add(filename),
      }));
      // After fade-out animation, remove from completedUploads
      setTimeout(() => {
        useSftpStore.setState((s) => {
          const next = new Set(s.completedUploads);
          next.delete(filename);
          return { completedUploads: next };
        });
      }, 1500);

      // Single file (not in batch) → refresh and toast
      if (!batchKey) {
        const locale = useAppStore.getState().locale;
        toast.success(t("sftp.uploaded", locale));
        setTimeout(() => {
          useSftpStore.getState().refreshRemote();
        }, 1500);
      }
    }

    state.markTransferCompleted(event.payload.taskId);

    // Single file (not upload, not in batch) — e.g. download
    if (!batchKey && task && task.direction === "download") {
      const locale = useAppStore.getState().locale;
      toast.success(t("sftp.downloaded", locale));
    }

    // Update batch progress
    if (batchKey) {
      const batch = useSftpStore.getState().activeBatches.get(batchKey);
      if (!batch) return;
      const newCompleted = batch.completed + 1;
      const allDone = newCompleted + batch.failed >= batch.total;

      if (allDone) {
        // Remove batch
        useSftpStore.setState((s) => {
          const newBatches = new Map(s.activeBatches);
          newBatches.delete(batchKey!);
          return { activeBatches: newBatches };
        });
        // Show summary toast
        const locale = useAppStore.getState().locale;
        if (batch.failed === 0) {
          toast.success(t("sftp.batchAllSuccess", locale, { n: batch.total }));
        } else {
          toast.info(t("sftp.batchSummary", locale, { success: newCompleted, failed: batch.failed }));
        }
        // Refresh once for the whole batch (uploads only)
        if (batch.direction === "upload") {
          setTimeout(() => useSftpStore.getState().refreshRemote(), 500);
        }
      } else {
        useSftpStore.setState((s) => {
          const newBatches = new Map(s.activeBatches);
          newBatches.set(batchKey!, { ...batch, completed: newCompleted });
          return { activeBatches: newBatches };
        });
      }
    }
  });

  listen<{ taskId: string; error: string }>("transfer:failed", (event) => {
    const state = useSftpStore.getState();
    // Find the task to get the filename
    const task = state.transfers.find((t) => t.id === event.payload.taskId);

    // If this is an upload task, clear the uploading entry
    if (task && task.direction === "upload") {
      const remotePath = task.remotePath;
      const filename = remotePath.split("/").pop() || "";
      state.clearUploadingEntry(filename);
    }

    useSftpStore
      .getState()
      .markTransferFailed(event.payload.taskId, event.payload.error);

    // Update batch progress
    const currentState = useSftpStore.getState();
    let batchKey: string | null = null;
    for (const [key, batch] of currentState.activeBatches) {
      if (batch.taskIds.has(event.payload.taskId)) {
        batchKey = key;
        break;
      }
    }

    if (batchKey) {
      const batch = currentState.activeBatches.get(batchKey);
      if (!batch) return;
      const newFailed = batch.failed + 1;
      const allDone = batch.completed + newFailed >= batch.total;

      if (allDone) {
        useSftpStore.setState((s) => {
          const newBatches = new Map(s.activeBatches);
          newBatches.delete(batchKey!);
          return { activeBatches: newBatches };
        });
        const locale = useAppStore.getState().locale;
        if (batch.completed === 0) {
          toast.error(t("sftp.batchSummary", locale, { success: 0, failed: newFailed }));
        } else {
          toast.info(t("sftp.batchSummary", locale, { success: batch.completed, failed: newFailed }));
        }
        if (batch.direction === "upload") {
          setTimeout(() => useSftpStore.getState().refreshRemote(), 500);
        }
      } else {
        useSftpStore.setState((s) => {
          const newBatches = new Map(s.activeBatches);
          newBatches.set(batchKey!, { ...batch, failed: newFailed });
          return { activeBatches: newBatches };
        });
      }
    }
  });
}
