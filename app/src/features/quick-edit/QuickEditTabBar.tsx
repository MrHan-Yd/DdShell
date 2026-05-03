import { useMemo } from "react";
import { Lock, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useQuickEditStore } from "@/stores/quickEdit";
import { confirm } from "@/stores/confirm";
import { cn } from "@/lib/utils";
import type { QuickEditTab } from "./types";

export function QuickEditTabBar() {
  const t = useT();
  const tabs = useQuickEditStore((s) => s.tabs);
  const activeTabId = useQuickEditStore((s) => s.activeTabId);

  // Disambiguate same fileName across hosts: append " · hostName".
  const labelOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      counts.set(tab.fileName, (counts.get(tab.fileName) ?? 0) + 1);
    }
    return (tab: QuickEditTab) => {
      const dup = (counts.get(tab.fileName) ?? 0) > 1;
      return dup ? `${tab.fileName} · ${tab.hostName}` : tab.fileName;
    };
  }, [tabs]);

  const setActiveTab = (id: string) => useQuickEditStore.getState().setActiveTab(id);

  const handleClose = async (id: string) => {
    const tab = useQuickEditStore.getState().tabs.find((x) => x.id === id);
    if (!tab) return;
    if (tab.dirty && !tab.sessionDetached) {
      const ok = await confirm({
        title: t("quickEdit.unsavedCloseTitle"),
        description: t("quickEdit.unsavedCloseDesc"),
        confirmLabel: t("quickEdit.close"),
        cancelLabel: t("confirm.cancel"),
      });
      if (!ok) return;
    }
    useQuickEditStore.getState().closeTab(id);
  };

  if (tabs.length === 0) return null;

  return (
    <div className="quick-edit-tabbar flex items-end gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]/40 px-2 pt-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            title={tab.remotePath}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveTab(tab.id);
              }
            }}
            className={cn(
              "group flex max-w-[220px] min-w-0 cursor-pointer items-center gap-1.5 rounded-t-[8px] border px-3 py-1.5 text-[12px] transition-colors",
              active
                ? "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
            )}
          >
            {tab.dirty && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                aria-hidden="true"
              />
            )}
            {tab.sessionDetached && (
              <Lock size={10} className="shrink-0 text-[var(--color-error)]" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{labelOf(tab)}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={t("quickEdit.tabClose")}
              onClick={(e) => {
                e.stopPropagation();
                void handleClose(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleClose(tab.id);
                }
              }}
              className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] opacity-60 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] hover:opacity-100"
            >
              <X size={11} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
