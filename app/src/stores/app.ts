import { create } from "zustand";
import type { Page } from "@/types";
import type { Locale } from "@/lib/i18n";

export const UI_THEMES = ["classic", "aurora", "abyssal-vent", "obsidian-sand", "cloudrift", "draftgrid", "frostplain", "graphite-forge", "inkpaper", "lumenreef", "mossline", "nebula-dust", "orange-sea", "rainlake", "umbra", "celadon"] as const;
export type UiTheme = typeof UI_THEMES[number];

export function isUiTheme(value: string | null): value is UiTheme {
  return UI_THEMES.includes(value as UiTheme);
}

export function usesDesignSystemTheme(uiTheme: UiTheme): boolean {
  return uiTheme === "aurora" || uiTheme === "abyssal-vent" || uiTheme === "obsidian-sand" || uiTheme === "cloudrift" || uiTheme === "draftgrid" || uiTheme === "frostplain" || uiTheme === "graphite-forge" || uiTheme === "inkpaper" || uiTheme === "lumenreef" || uiTheme === "mossline" || uiTheme === "nebula-dust" || uiTheme === "orange-sea" || uiTheme === "rainlake" || uiTheme === "umbra" || uiTheme === "celadon";
}

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
