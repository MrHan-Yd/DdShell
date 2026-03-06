import { create } from "zustand";
import type { TerminalTab, SessionState } from "@/types";
import * as api from "@/lib/tauri";

export type SplitDirection = "horizontal" | "vertical" | null;

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  splitDirection: SplitDirection;
  splitSessionId: string | null; // second pane session ID

  openSession: (hostId: string, hostName: string, password: string) => Promise<string>;
  closeSession: (tabId: string) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  updateTabState: (sessionId: string, state: SessionState) => void;
  splitPane: (direction: "horizontal" | "vertical") => void;
  closeSplit: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitDirection: null,
  splitSessionId: null,

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
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab && tab.state === "connected") {
      try {
        await api.sessionDisconnect(tab.sessionId);
      } catch {
        // session may already be gone
      }
    }

    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      const closedSplit =
        s.splitSessionId === tab?.sessionId ? true : false;
      return {
        tabs: remaining,
        activeTabId:
          s.activeTabId === tabId
            ? remaining[remaining.length - 1]?.id ?? null
            : s.activeTabId,
        splitDirection: closedSplit ? null : s.splitDirection,
        splitSessionId: closedSplit ? null : s.splitSessionId,
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

  splitPane: (direction) => {
    const state = get();
    if (state.splitDirection) {
      // Already split, just change direction
      set({ splitDirection: direction });
      return;
    }
    // Use current active session as the split pane
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (activeTab) {
      set({
        splitDirection: direction,
        splitSessionId: activeTab.sessionId,
      });
    }
  },

  closeSplit: () => set({ splitDirection: null, splitSessionId: null }),
}));
