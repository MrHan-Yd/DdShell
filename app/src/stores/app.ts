import { create } from "zustand";
import type { Page } from "@/types";

interface AppState {
  currentPage: Page;
  sidebarCollapsed: boolean;
  theme: "dark" | "light" | "system";

  setCurrentPage: (page: Page) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "connections",
  sidebarCollapsed: false,
  theme: "dark",

  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setTheme: (theme) => set({ theme }),
}));
