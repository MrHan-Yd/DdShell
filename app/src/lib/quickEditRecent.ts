import type { QuickEditRecentItem } from "@/types";

const QUICK_EDIT_RECENT_LIMIT = 20;
const QUICK_EDIT_RECENT_STORAGE_KEY = "shell.quickEditRecent.v1";

export function readQuickEditRecents(): QuickEditRecentItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(QUICK_EDIT_RECENT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is QuickEditRecentItem => {
        return Boolean(
          item &&
            typeof item === "object" &&
            typeof item.remotePath === "string" &&
            typeof item.fileName === "string" &&
            typeof item.updatedAt === "number",
        );
      })
      .slice(0, QUICK_EDIT_RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeQuickEditRecents(items: QuickEditRecentItem[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      QUICK_EDIT_RECENT_STORAGE_KEY,
      JSON.stringify(items.slice(0, QUICK_EDIT_RECENT_LIMIT)),
    );
  } catch {
    // ignore local storage failure
  }
}

export function recordQuickEditRecent(item: QuickEditRecentItem) {
  const nextItems = [
    item,
    ...readQuickEditRecents().filter(
      (existing) => !(existing.hostId === item.hostId && existing.remotePath === item.remotePath),
    ),
  ];
  writeQuickEditRecents(nextItems);
}

export function clearQuickEditRecents(hostId?: string | null) {
  if (!hostId) {
    writeQuickEditRecents([]);
    return;
  }

  writeQuickEditRecents(readQuickEditRecents().filter((item) => item.hostId !== hostId));
}
