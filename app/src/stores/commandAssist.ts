import { create } from "zustand";
import type { CandidateItem } from "@/lib/tauri";
import * as api from "@/lib/tauri";
import { useAppStore } from "@/stores/app";

interface CommandAssistState {
  items: CandidateItem[];
  loaded: boolean;

  load: () => Promise<void>;
  search: (query: string, osType: string | null, page: number) => {
    items: CandidateItem[];
    total: number;
    page: number;
    hasMore: boolean;
  };
  updateLocalWeight: (id: string) => void;
}

const PAGE_SIZE = 10;

export const useCommandAssistStore = create<CommandAssistState>((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    const locale = useAppStore.getState().locale;
    const ALL_DEVTOOLS_SUB = ["python", "node", "java", "maven", "gradle", "go", "jq", "kotlin", "php", "rust"];
const allCats = ["git", "docker", "webServer", ...ALL_DEVTOOLS_SUB];
    const setting = await api.settingGet("commandAssist.enabledAppCategories");
    let enabledCategories: string[] = setting
      ? JSON.parse(setting)
      : allCats;
    // Migration: expand old "devTools" to individual sub-categories
    if (enabledCategories.includes("devTools")) {
      enabledCategories = enabledCategories
        .filter((c) => c !== "devTools")
        .concat(ALL_DEVTOOLS_SUB.filter((s) => !enabledCategories.includes(s)));
    }
    await api.commandAssistRebuildIndex(locale, enabledCategories);
    const items = await api.commandAssistGetAll();
    set({ items, loaded: true });
  },

  search: (query, osType, page) => {
    const { items } = get();
    const q = query.toLowerCase();
    const osLower = osType?.toLowerCase() ?? null;

    // Prefix match on command or title, deduplicate by command
    const seen = new Set<string>();
    const matched: CandidateItem[] = [];
    for (const item of items) {
      if (seen.has(item.command)) continue;
      if (
        item.command.toLowerCase().startsWith(q) ||
        item.title.toLowerCase().startsWith(q)
      ) {
        seen.add(item.command);
        matched.push(item);
      }
    }

    // Sort: OS match > weight desc > command length asc
    matched.sort((a, b) => {
      const aOsMatch =
        a.distro === null
          ? true
          : osLower
          ? a.distro?.toLowerCase().includes(osLower) || a.distro === "common"
          : a.distro === "common";
      const bOsMatch =
        b.distro === null
          ? true
          : osLower
          ? b.distro?.toLowerCase().includes(osLower) || b.distro === "common"
          : b.distro === "common";

      if (aOsMatch !== bOsMatch) return aOsMatch ? -1 : 1;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.command.length - b.command.length;
    });

    const total = matched.length;
    const offset = page * PAGE_SIZE;
    const pageItems = matched.slice(offset, offset + PAGE_SIZE);
    const hasMore = offset + pageItems.length < total;

    return { items: pageItems, total, page, hasMore };
  },

  updateLocalWeight: (id) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? { ...item, weight: item.weight * 0.9 + 1.0 }
          : item
      ),
    }));
  },
}));
