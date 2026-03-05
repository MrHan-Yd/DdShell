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

  setSessionId: (id: string | null) => void;
  navigateRemote: (path: string) => Promise<void>;
  refreshRemote: () => Promise<void>;
  mkdir: (name: string) => Promise<void>;
  remove: (name: string, isDir: boolean) => Promise<void>;
  rename: (oldName: string, newName: string) => Promise<void>;
  startTransfer: (direction: TransferDirection, localPath: string, remotePath: string) => Promise<string>;
  cancelTransfer: (taskId: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  toggleSelectRemote: (name: string) => void;
  clearSelectRemote: () => void;
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

  setSessionId: (id) => {
    set({ sessionId: id, remotePath: "/", remoteEntries: [], error: null });
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

  remove: async (name, isDir) => {
    const { sessionId, remotePath } = get();
    if (!sessionId) return;
    const fullPath = remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;
    await api.sftpRemove(sessionId, fullPath, isDir);
    await get().refreshRemote();
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

  updateTransferProgress: (taskId, transferred, total) => {
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === taskId
          ? { ...t, transferredBytes: transferred, totalBytes: total, state: "running" as const }
          : t,
      ),
    }));
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
    useSftpStore.getState().markTransferCompleted(event.payload.taskId);
    useSftpStore.getState().refreshRemote();
  });

  listen<{ taskId: string; error: string }>("transfer:failed", (event) => {
    useSftpStore
      .getState()
      .markTransferFailed(event.payload.taskId, event.payload.error);
  });
}
