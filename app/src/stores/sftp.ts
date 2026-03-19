import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { FileEntry, TransferTask, TransferDirection } from "@/types";
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
  addUploadingEntry: (name: string, totalSize: number) => void;
  updateUploadingEntry: (name: string, transferredSize: number) => void;
  clearUploadingEntry: (name: string) => void;
  updateTransferProgress: (taskId: string, transferred: number, total: number) => void;
  markTransferCompleted: (taskId: string) => void;
  markTransferFailed: (taskId: string, error: string) => void;
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

  setSessionId: (id) => {
    set({ sessionId: id, remotePath: "/", remoteEntries: [], error: null, uploadingFiles: new Map() });
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
      set({ remotePath: path, remoteEntries: entries });
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
    await get().refreshTransfers();
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
  addUploadingEntry: (name, totalSize) => {
    set((s) => {
      // Don't add if already exists
      if (s.remoteEntries.some((e) => e.name === name)) return s;
      const newEntry: FileEntry = {
        name,
        fileType: "file",
        size: 0, // Start at 0, will be updated with progress
        mtime: Date.now() / 1000,
        permissions: 0o644,
      };
      const newUploading = new Map(s.uploadingFiles);
      newUploading.set(name, totalSize);
      return { remoteEntries: [...s.remoteEntries, newEntry], uploadingFiles: newUploading };
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
      // Also remove the virtual entry from remoteEntries
      const newRemoteEntries = s.remoteEntries.filter((e) => e.name !== name);
      return { uploadingFiles: newUploading, remoteEntries: newRemoteEntries };
    });
  },

  updateTransferProgress: (taskId, transferred, total) => {
    set((s) => {
      // Find the task to get the remote filename
      const task = s.transfers.find((t) => t.id === taskId);
      let newUploading = s.uploadingFiles;

      // If this is an upload task, update the remote entry's size for progress bar
      if (task && task.direction === "upload") {
        // Extract filename from remotePath
        const remotePath = task.remotePath;
        const filename = remotePath.split("/").pop() || "";

        // Update the uploading files map with the latest transferred size
        newUploading = new Map(s.uploadingFiles);
        newUploading.set(filename, total);

        // Return updated state with both transfers and remoteEntries updated
        return {
          transfers: s.transfers.map((t) =>
            t.id === taskId
              ? { ...t, transferredBytes: transferred, totalBytes: total, state: "running" as const }
              : t,
          ),
          remoteEntries: s.remoteEntries.map((e) =>
            e.name === filename ? { ...e, size: transferred } : e,
          ),
          uploadingFiles: newUploading,
        };
      }

      // For download tasks or if task not found, just update transfers
      return {
        transfers: s.transfers.map((t) =>
          t.id === taskId
            ? { ...t, transferredBytes: transferred, totalBytes: total, state: "running" as const }
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
}));

// Set up event listeners for transfer events
let listenersInitialized = false;

export function initSftpListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen<{ taskId: string; transferredBytes: number; totalBytes: number }>(
    "transfer:progress",
    (event) => {
      useSftpStore
        .getState()
        .updateTransferProgress(
          event.payload.taskId,
          event.payload.transferredBytes,
          event.payload.totalBytes,
        );
    },
  );

  listen<{ taskId: string }>("transfer:completed", (event) => {
    const state = useSftpStore.getState();
    // Find the task to get the filename
    const task = state.transfers.find((t) => t.id === event.payload.taskId);

    // If this is an upload task, clear the uploading entry
    if (task && task.direction === "upload") {
      const remotePath = task.remotePath;
      const filename = remotePath.split("/").pop() || "";
      state.clearUploadingEntry(filename);
    }

    state.markTransferCompleted(event.payload.taskId);
    // Don't auto-refresh remote directory after upload - let user manually refresh
    // This prevents the "disappearing items" animation issue
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
  });
}
