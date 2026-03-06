import { create } from "zustand";
import type { Page } from "@/types";
import type { Locale } from "@/lib/i18n";

interface AppState {
  currentPage: Page;
  sidebarCollapsed: boolean;
  theme: "dark" | "light" | "system";
  locale: Locale;

  setCurrentPage: (page: Page) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setLocale: (locale: Locale) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "connections",
  sidebarCollapsed: false,
  theme: "dark",
  locale: "zh",

  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setTheme: (theme) => set({ theme }),
  setLocale: (locale) => set({ locale }),
}));
