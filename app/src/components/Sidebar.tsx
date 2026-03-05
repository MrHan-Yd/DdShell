import {
  Monitor,
  FolderOpen,
  Terminal,
  Code2,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { Page } from "@/types";

const navItems: { page: Page; label: string; icon: typeof Monitor }[] = [
  { page: "connections", label: "Connections", icon: Monitor },
  { page: "terminal", label: "Terminal", icon: Terminal },
  { page: "sftp", label: "SFTP", icon: FolderOpen },
  { page: "snippets", label: "Snippets", icon: Code2 },
  { page: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-surface)] transition-[width] duration-[var(--duration-panel)] ease-[var(--ease-default)]",
        collapsed
          ? "w-[var(--width-sidebar-collapsed)]"
          : "w-[var(--width-sidebar)]",
      )}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <nav className="flex flex-col gap-1">
          {navItems.map(({ page, label, icon: Icon }) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[var(--font-size-sm)] transition-colors duration-[var(--duration-fast)]",
                currentPage === page
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <Icon size={18} />
              {!collapsed && <span>{label}</span>}
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
