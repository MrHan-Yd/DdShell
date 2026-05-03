import { create } from "zustand";
import * as api from "@/lib/tauri";
import { toast } from "@/stores/toast";
import type { RemoteTextFile } from "@/types";
import type { QuickEditTab } from "@/features/quick-edit/types";
import type { QuickEditOpenPayload } from "@/lib/quickEditWindow";
import type { useT } from "@/lib/i18n";
import {
  DEFAULT_EDITOR_STATUS,
  QUICK_EDIT_MAX_BYTES,
  getFileName,
  getQuickEditSuggestedActions,
  normalizeErrorCode,
  prepareContentForSave,
} from "@/features/quick-edit/utils";

type T = ReturnType<typeof useT>;

interface QuickEditState {
  tabs: QuickEditTab[];
  activeTabId: string | null;

  // tab lifecycle
  openOrFocusFile: (payload: QuickEditOpenPayload) => string;
  setActiveTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeBySessionId: (sessionId: string) => string[];
  closeAll: () => void;
  markDetached: (tabIds: string[]) => void;

  // load / save
  loadTab: (tabId: string) => Promise<void>;
  reloadTab: (tabId: string) => Promise<void>;
  saveTab: (tabId: string, t: T, latestDraft: string) => Promise<void>;
  privilegedSaveTab: (tabId: string, t: T, latestDraft: string) => Promise<void>;

  // per-tab field setters used by views.
  // 注意：草稿正文（draft content）不存在 store 里，由 QuickEditTabContent
  // 的 draftContentRef 维护，避免按键路径上每次输入都触发 store 重渲染。
  setEditorStatus: (tabId: string, status: QuickEditTab["editorStatus"]) => void;
  setStatusMessage: (tabId: string, message: string) => void;
  setShowPrivilegedSave: (tabId: string, show: boolean) => void;
  setSudoPassword: (tabId: string, value: string) => void;
  setCreateBackup: (tabId: string, value: boolean) => void;
  patchTab: (tabId: string, patch: Partial<QuickEditTab>) => void;
}

function newTabId(): string {
  return crypto.randomUUID();
}

function makeTab(payload: QuickEditOpenPayload): QuickEditTab {
  return {
    id: newTabId(),
    sessionId: payload.sessionId,
    hostId: payload.hostId,
    hostName: payload.hostName,
    remotePath: payload.remotePath,
    fileName: getFileName(payload.remotePath),
    viewState: "idle",
    remoteFile: null,
    baselineContent: "",
    dirty: false,
    errorCode: null,
    editorStatus: DEFAULT_EDITOR_STATUS,
    statusMessage: "",
    showPrivilegedSave: false,
    sudoPassword: "",
    createBackup: true,
    sudoPasswordError: false,
    suggestedActions: [],
    lastBackupPath: null,
    sessionDetached: false,
  };
}

export const useQuickEditStore = create<QuickEditState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openOrFocusFile: (payload) => {
    const existing = get().tabs.find(
      (t) => t.sessionId === payload.sessionId && t.remotePath === payload.remotePath,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const tab = makeTab(payload);
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
    void get().loadTab(tab.id);
    return tab.id;
  },

  setActiveTab: (tabId) => {
    if (!get().tabs.some((t) => t.id === tabId)) return;
    set({ activeTabId: tabId });
  },

  closeTab: (tabId) => {
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      const activeId =
        s.activeTabId === tabId
          ? remaining[remaining.length - 1]?.id ?? null
          : s.activeTabId;
      return { tabs: remaining, activeTabId: activeId };
    });
  },

  closeBySessionId: (sessionId) => {
    const removedIds: string[] = [];
    set((s) => {
      const remaining: QuickEditTab[] = [];
      for (const t of s.tabs) {
        if (t.sessionId === sessionId) removedIds.push(t.id);
        else remaining.push(t);
      }
      const activeStill = remaining.some((t) => t.id === s.activeTabId);
      return {
        tabs: remaining,
        activeTabId: activeStill ? s.activeTabId : (remaining[remaining.length - 1]?.id ?? null),
      };
    });
    return removedIds;
  },

  closeAll: () => set({ tabs: [], activeTabId: null }),

  markDetached: (tabIds) => {
    if (tabIds.length === 0) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (tabIds.includes(t.id) ? { ...t, sessionDetached: true } : t)),
    }));
  },

  loadTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    get().patchTab(tabId, { viewState: "loading", errorCode: null, statusMessage: "" });

    try {
      const file = await api.sftpReadText(tab.sessionId, tab.remotePath, QUICK_EDIT_MAX_BYTES);
      if (!file.isText) throw new Error("FILE_NOT_TEXT");

      get().patchTab(tabId, {
        viewState: "ready",
        remoteFile: file,
        baselineContent: file.content,
        dirty: false,
        errorCode: null,
        suggestedActions: [],
        lastBackupPath: null,
        editorStatus: DEFAULT_EDITOR_STATUS,
      });
    } catch (error) {
      const code = normalizeErrorCode(error);
      get().patchTab(tabId, {
        viewState: code === "FILE_CHANGED_CONFLICT" ? "conflict" : "error",
        errorCode: code,
        remoteFile: null,
      });
    }
  },

  reloadTab: async (tabId) => {
    await get().loadTab(tabId);
  },

  saveTab: async (tabId, t, latestDraft) => {
    const tab = get().tabs.find((x) => x.id === tabId);
    if (!tab || !tab.remoteFile) return;
    if (tab.sessionDetached) return;
    if (tab.remoteFile.readonly) {
      toast.error(t("quickEdit.permissionDenied"));
      return;
    }

    get().patchTab(tabId, {
      viewState: "saving",
      statusMessage: t("quickEdit.statusSaving"),
    });

    try {
      const contentToSave = prepareContentForSave(latestDraft, tab.remoteFile);
      const result = await api.sftpWriteText(
        tab.sessionId,
        tab.remotePath,
        contentToSave,
        tab.remoteFile.mtime,
        tab.remoteFile.hash,
      );

      const nextFile: RemoteTextFile = {
        ...tab.remoteFile,
        content: contentToSave,
        size: result.size,
        mtime: result.mtime,
        hash: result.hash,
      };

      get().patchTab(tabId, {
        remoteFile: nextFile,
        baselineContent: contentToSave,
        dirty: false,
        errorCode: null,
        viewState: "ready",
        statusMessage: t("quickEdit.statusSaved"),
        lastBackupPath: null,
        suggestedActions: getQuickEditSuggestedActions(tab.remotePath, t),
      });
      toast.success(t("quickEdit.saved"));
    } catch (error) {
      const code = normalizeErrorCode(error);
      get().patchTab(tabId, {
        errorCode: code,
        viewState: code === "FILE_CHANGED_CONFLICT" ? "conflict" : "ready",
        statusMessage:
          code === "FILE_CHANGED_CONFLICT" ? t("quickEdit.statusConflict") : t("quickEdit.statusError"),
      });
    }
  },

  privilegedSaveTab: async (tabId, t, latestDraft) => {
    const tab = get().tabs.find((x) => x.id === tabId);
    if (!tab || !tab.remoteFile) return;
    if (tab.sessionDetached) return;

    get().patchTab(tabId, {
      viewState: "saving",
      statusMessage: t("quickEdit.statusSaving"),
      sudoPasswordError: false,
    });

    try {
      const contentToSave = prepareContentForSave(latestDraft, tab.remoteFile);
      const result = await api.sftpWriteTextPrivileged(
        tab.sessionId,
        tab.remotePath,
        contentToSave,
        tab.remoteFile.mtime,
        tab.remoteFile.hash,
        tab.sudoPassword || null,
        tab.createBackup,
      );

      const nextFile: RemoteTextFile = {
        ...tab.remoteFile,
        content: contentToSave,
        size: result.size,
        mtime: result.mtime,
        hash: result.hash,
      };

      const successMsg = result.backupPath
        ? t("quickEdit.savedWithBackup")
        : t("quickEdit.savedPrivileged");

      get().patchTab(tabId, {
        remoteFile: nextFile,
        baselineContent: contentToSave,
        dirty: false,
        errorCode: null,
        viewState: "ready",
        showPrivilegedSave: false,
        sudoPassword: "",
        lastBackupPath: result.backupPath ?? null,
        suggestedActions: getQuickEditSuggestedActions(tab.remotePath, t),
        statusMessage: successMsg,
      });
      toast.success(successMsg);
    } catch (error) {
      const code = normalizeErrorCode(error);
      get().patchTab(tabId, {
        errorCode: code,
        viewState: code === "FILE_CHANGED_CONFLICT" ? "conflict" : "ready",
        statusMessage:
          code === "FILE_CHANGED_CONFLICT" ? t("quickEdit.statusConflict") : t("quickEdit.statusError"),
        sudoPasswordError: code === "SUDO_AUTH_FAILED",
        showPrivilegedSave: code === "SUDO_AUTH_FAILED",
      });
    }
  },

  setEditorStatus: (tabId, status) => get().patchTab(tabId, { editorStatus: status }),
  setStatusMessage: (tabId, message) => get().patchTab(tabId, { statusMessage: message }),
  setShowPrivilegedSave: (tabId, show) =>
    get().patchTab(tabId, show ? { showPrivilegedSave: true, sudoPasswordError: false } : { showPrivilegedSave: false }),
  setSudoPassword: (tabId, value) => get().patchTab(tabId, { sudoPassword: value }),
  setCreateBackup: (tabId, value) => get().patchTab(tabId, { createBackup: value }),

  patchTab: (tabId, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    }));
  },
}));
