import { useRef, useEffect, useState } from "react";
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

  const navRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ top: 0, height: 0 });

  const measurePill = () => {
    const nav = navRef.current;
    if (!nav) return;
    const idx = navItems.findIndex((n) => n.page === currentPage);
    const btn = nav.children[1 + idx] as HTMLElement; // +1 to skip pill div
    if (!btn) return;
    setPill({ top: btn.offsetTop, height: btn.offsetHeight });
  };

  // Re-measure on page change
  useEffect(measurePill, [currentPage]);

  // Re-measure after sidebar width transition ends
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const handler = (e: TransitionEvent) => {
      if (e.propertyName === "width") measurePill();
    };
    aside.addEventListener("transitionend", handler);
    return () => aside.removeEventListener("transitionend", handler);
  });

  return (
    <aside
      ref={asideRef}
      className={cn(
        "glass-surface flex flex-col border-r border-[var(--color-border)] transition-[width] duration-[var(--duration-panel)] ease-[var(--ease-smooth)]",
        collapsed
          ? "w-[var(--width-sidebar-collapsed)]"
          : "w-[var(--width-sidebar)]",
      )}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <nav ref={navRef} className="relative flex flex-col gap-1">
          {/* Sliding highlight pill */}
          <div
            className="absolute left-0 right-0 rounded-[var(--radius-control)] bg-[var(--color-accent-subtle)] shadow-[var(--border-hairline-inner)]"
            style={{
              top: pill.top,
              height: pill.height,
              transition: "top 400ms cubic-bezier(0.34, 1.56, 0.64, 1), height 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />

          {navItems.map(({ page, labelKey, icon: Icon }) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              data-active={currentPage === page}
              className={cn(
                "nav-item relative z-[1] flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[var(--font-size-sm)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
                currentPage === page
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <span className="nav-icon">
                <Icon size={18} />
              </span>
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
