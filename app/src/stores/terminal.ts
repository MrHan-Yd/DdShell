import { create } from "zustand";
import type { TerminalTab, SessionState } from "@/types";
import * as api from "@/lib/tauri";

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;

  openSession: (hostId: string, hostName: string, password: string) => Promise<string>;
  closeSession: (tabId: string) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  updateTabState: (sessionId: string, state: SessionState) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openSession: async (hostId, hostName, password) => {
    const { id: sessionId } = await api.sessionConnect(hostId, password);

    const tab: TerminalTab = {
      id: sessionId,
      sessionId,
      hostId,
      title: hostName,
      state: "connected",
    };

    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: sessionId,
    }));

    return sessionId;
  },

  closeSession: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab && tab.state === "connected") {
      try {
        await api.sessionDisconnect(tab.sessionId);
      } catch {
        // session may already be gone
      }
    }

    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      return {
        tabs: remaining,
        activeTabId:
          s.activeTabId === tabId
            ? remaining[remaining.length - 1]?.id ?? null
            : s.activeTabId,
      };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTabState: (sessionId, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId ? { ...t, state } : t,
      ),
    })),
}));
