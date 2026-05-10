import { create } from "zustand";
import type { Page } from "@/types";
import type { Locale } from "@/lib/i18n";

export type UiTheme = "classic" | "aurora";

interface AppState {
  currentPage: Page;
  sidebarCollapsed: boolean;
  theme: "dark" | "light" | "system";
  uiTheme: UiTheme;
  locale: Locale;
  settingsDirty: boolean;

  setCurrentPage: (page: Page) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setUiTheme: (uiTheme: UiTheme) => void;
  setLocale: (locale: Locale) => void;
  setSettingsDirty: (dirty: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "connections",
  sidebarCollapsed: false,
  theme: "dark",
  uiTheme: "classic",
  locale: "zh",
  settingsDirty: false,

  setCurrentPage: (page) => set({ currentPage: page }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setTheme: (theme) => set({ theme }),
  setUiTheme: (uiTheme) => set({ uiTheme }),
  setLocale: (locale) => set({ locale }),
  setSettingsDirty: (dirty) => set({ settingsDirty: dirty }),
}));
