import {
  Server,
  FolderOpen,
  Terminal,
  Code2,
  Settings,
  Activity,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { useT } from "@/lib/i18n";
import type { Page } from "@/types";
import type { DictKey } from "@/lib/i18n";

const navItems: { page: Page; labelKey: DictKey; icon: typeof Server }[] = [
  { page: "connections", labelKey: "nav.connections", icon: Server },
  { page: "terminal", labelKey: "nav.terminal", icon: Terminal },
  { page: "sftp", labelKey: "nav.sftp", icon: FolderOpen },
  { page: "monitor", labelKey: "nav.monitor", icon: Activity },
  { page: "snippets", labelKey: "nav.snippets", icon: Code2 },
  { page: "settings", labelKey: "nav.settings", icon: Settings },
];

export function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const t = useT();

  return (
    <aside
      className={cn(
        "glass-surface flex flex-col border-r border-[var(--color-border)] transition-[width] duration-[var(--duration-panel)] ease-[var(--ease-smooth)]",
        collapsed
          ? "w-[var(--width-sidebar-collapsed)]"
          : "w-[var(--width-sidebar)]",
      )}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <nav className="flex flex-col gap-1">
          {navItems.map(({ page, labelKey, icon: Icon }) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[var(--font-size-sm)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
                currentPage === page
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-[var(--border-hairline-inner)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <Icon size={18} />
              {!collapsed && <span>{t(labelKey)}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="border-t border-[var(--color-border)] p-2">
        <button
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center rounded-[var(--radius-control)] py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </aside>
  );
}
