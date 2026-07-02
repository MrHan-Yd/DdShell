import { create } from "zustand";
import type { TerminalTab, SessionState } from "@/types";
import * as api from "@/lib/tauri";
import { useSftpStore } from "@/stores/sftp";

export type SplitDirection = "horizontal" | "vertical" | null;
export type ConcreteSplitDirection = Exclude<SplitDirection, null>;

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  splitDirection: SplitDirection;
  splitTabId: string | null; // second pane tab ID
  latencyMap: Map<string, number>; // sessionId -> ms

  openSession: (hostId: string, hostName: string, password?: string) => Promise<string>;
  closeSession: (tabId: string) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  moveTab: (fromId: string, toIndex: number) => void;
  updateTabState: (sessionId: string, state: SessionState) => void;
  reconnectSession: (tabId: string) => Promise<void>;
  splitPane: (direction: ConcreteSplitDirection, targetTabId?: string) => boolean;
  closeSplit: () => void;
  pingSession: (sessionId: string) => Promise<void>;
  pingActiveSession: () => Promise<void>;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitDirection: null,
  splitTabId: null,
  latencyMap: new Map(),

  openSession: async (hostId, hostName, password) => {
    const { id: sessionId } = await api.sessionConnect(hostId, password);

    const tab: TerminalTab = {
      id: sessionId,
      sessionId,
      hostId,
      title: hostName,
      state: "connected",
    };

    set((s) => {
      // Dedupe by sessionId: if a tab for this session already exists (e.g.
      // user double-clicked Connect before the button's `disabled` flipped, or
      // any other duplicate-add path), don't push a second entry.
      const exists = s.tabs.some((t) => t.sessionId === sessionId);
      return {
        tabs: exists ? s.tabs : [...s.tabs, tab],
        activeTabId: sessionId,
      };
    });

    return sessionId;
  },

  closeSession: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab && tab.state === "connected") {
      try {
        await api.sessionDisconnect(tab.sessionId);
      } catch {
        // session may already be gone
      }
    }

    // Close associated SFTP session if connected to this terminal
    if (tab) {
      const sftpState = useSftpStore.getState();
      if (sftpState.sessionId === tab.sessionId) {
        sftpState.setSessionId(null);
      }
    }

    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      const closedSplit = s.splitTabId === tab?.id;
      const nextActiveTabId =
        s.activeTabId === tabId
          ? remaining[remaining.length - 1]?.id ?? null
          : s.activeTabId;
      const nextSplitTabId = closedSplit
        ? null
        : s.splitTabId === nextActiveTabId
          ? remaining.find((t) => t.id !== nextActiveTabId)?.id ?? null
          : s.splitTabId;
      return {
        tabs: remaining,
        activeTabId: nextActiveTabId,
        splitDirection: nextSplitTabId ? s.splitDirection : null,
        splitTabId: nextSplitTabId,
      };
    });
  },

  setActiveTab: (tabId) =>
    set((s) => {
      if (s.splitTabId === tabId && s.activeTabId && s.activeTabId !== tabId) {
        return {
          activeTabId: tabId,
          splitTabId: s.activeTabId,
        };
      }
      return { activeTabId: tabId };
    }),

  moveTab: (fromId, toIndex) =>
    set((s) => {
      const fromIndex = s.tabs.findIndex((t) => t.id === fromId);
      if (fromIndex < 0 || s.tabs.length <= 1) return s;
      const next = [...s.tabs];
      const [moved] = next.splice(fromIndex, 1);
      const insertIndex = Math.max(0, Math.min(toIndex, next.length));
      next.splice(insertIndex, 0, moved);
      return { tabs: next };
    }),

  updateTabState: (sessionId, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId ? { ...t, state } : t,
      ),
    })),

  reconnectSession: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    try {
      const { id: newSessionId } = await api.sessionConnect(tab.hostId);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, sessionId: newSessionId, state: "connected" as const }
            : t,
        ),
      }));
    } catch {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, state: "failed" as const } : t,
        ),
      }));
    }
  },

  splitPane: (direction, targetTabId) => {
    const state = get();
    if (state.splitDirection) {
      // Already split, just change direction
      set({ splitDirection: direction });
      return true;
    }
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!activeTab) return false;

    const targetTab = targetTabId
      ? state.tabs.find((t) => t.id === targetTabId)
      : state.tabs.find((t) => t.id !== activeTab.id);
    if (!targetTab || targetTab.id === activeTab.id) return false;

    set({
      splitDirection: direction,
      splitTabId: targetTab.id,
    });
    return true;
  },

  closeSplit: () => set({ splitDirection: null, splitTabId: null }),

  pingSession: async (sessionId) => {
    const tab = get().tabs.find((t) => t.sessionId === sessionId);
    if (!tab || tab.state !== "connected") return;
    try {
      const ms = await api.sshPing(sessionId);
      set((s) => {
        const next = new Map(s.latencyMap);
        next.set(sessionId, ms);
        return { latencyMap: next };
      });
    } catch {
      // session may be gone, ignore
    }
  },

  pingActiveSession: async () => {
    const { activeTabId, tabs, pingSession } = get();
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.state !== "connected") return;
    await pingSession(tab.sessionId);
  },
}));
