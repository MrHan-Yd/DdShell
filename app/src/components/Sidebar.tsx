import {
  Server,
  FolderOpen,
  Terminal,
  Code2,
  Workflow,
  Settings,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { confirm } from "@/stores/confirm";
import type { Page } from "@/types";
import type { DictKey } from "@/lib/i18n";

const navItems: { page: Page; labelKey: DictKey; icon: typeof Server; meta?: string; badge?: string }[] = [
  { page: "connections", labelKey: "nav.connections", icon: Server, meta: "12" },
  { page: "terminal", labelKey: "nav.terminal", icon: Terminal, badge: "3" },
  { page: "sftp", labelKey: "nav.sftp", icon: FolderOpen },
  { page: "monitor", labelKey: "nav.monitor", icon: Activity },
  { page: "snippets", labelKey: "nav.snippets", icon: Code2, meta: "24" },
  { page: "macros", labelKey: "nav.macros", icon: Workflow },
];

export function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const uiTheme = useAppStore((s) => s.uiTheme);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const t = useT();
  const logoSize = uiTheme === "aurora" ? 28 : 30;

  const navigateTo = async (page: Page) => {
    if (page === currentPage) return;
    const { settingsDirty, setSettingsDirty } = useAppStore.getState();
    if (currentPage === "settings" && settingsDirty) {
      const ok = await confirm({
        title: t("settings.unsavedTitle"),
        description: t("settings.unsavedDesc"),
        confirmLabel: t("settings.discardChanges"),
        cancelLabel: t("settings.continueEdit"),
      });
      if (!ok) return;
      setSettingsDirty(false);
    }
    setCurrentPage(page);
  };

  return (
    <aside className="sidebar flex w-[var(--width-sidebar)] flex-col border-r border-[var(--color-border)]">
      <div className="sidebar-brand flex items-center gap-2 px-3 py-2">
        <span className="logo">
          <Logo size={logoSize} />
        </span>
        <span className="name select-none">DdShell</span>
      </div>

      <nav className="sidebar-nav flex flex-col gap-1 px-2">
        {navItems.map(({ page, labelKey, icon: Icon, meta, badge }) => (
          <button
            key={page}
            type="button"
            onClick={() => navigateTo(page)}
            data-active={currentPage === page}
            className={cn(
              "nav-item flex w-full select-none items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-[var(--font-size-sm)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
              currentPage === page && "is-active",
              currentPage === page
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
            )}
          >
            <span className="icon nav-icon">
              <Icon size={16} strokeWidth={1.8} />
            </span>
            <span className="label select-none">{t(labelKey)}</span>
            {meta && <span className="meta">{meta}</span>}
            {badge && <span className="badge badge-accent">{badge}</span>}
          </button>
        ))}
      </nav>

      <span className="sidebar-spacer" />

      <div className="sidebar-footer flex flex-col border-t border-[var(--color-border)] p-2">
        <button
          type="button"
          onClick={() => navigateTo("settings")}
          data-active={currentPage === "settings"}
          className={cn(
            "nav-item flex w-full select-none items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-[var(--font-size-sm)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
            currentPage === "settings" && "is-active",
            currentPage === "settings"
              ? "text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
          )}
        >
          <span className="icon nav-icon">
            <Settings size={16} strokeWidth={1.8} />
          </span>
          <span className="label select-none">{t("nav.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
