import { useEffect } from "react";
import { useAppStore } from "@/stores/app";
import { useTerminalStore } from "@/stores/terminal";
import { confirm } from "@/stores/confirm";
import { t } from "@/lib/i18n";
import type { Page } from "@/types";

type ShortcutHandler = (e: KeyboardEvent) => void;

interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  handler: ShortcutHandler;
  /** Only active on this page (null = global) */
  page?: Page | null;
}

const isMac = navigator.platform.toUpperCase().includes("MAC");

function matchesModifier(e: KeyboardEvent, def: ShortcutDef): boolean {
  const wantCmd = def.meta || def.ctrl;
  const hasCmd = isMac ? e.metaKey : e.ctrlKey;
  if (wantCmd && !hasCmd) return false;
  if (!wantCmd && hasCmd) return false;

  if ((def.alt ?? false) !== e.altKey) return false;
  if ((def.shift ?? false) !== e.shiftKey) return false;

  return e.key.toLowerCase() === def.key.toLowerCase();
}

export function useShortcuts() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  useEffect(() => {
    const shortcuts: ShortcutDef[] = [
      // ── Global shortcuts ──
      {
        key: "t",
        ctrl: true,
        handler: () => {
          setCurrentPage("terminal");
        },
        page: null,
      },
      {
        key: "w",
        ctrl: true,
        handler: async () => {
          const store = useTerminalStore.getState();
          if (store.activeTabId) {
            const locale = useAppStore.getState().locale;
            const ok = await confirm({
              title: t("confirm.closeSessionTitle", locale),
              description: t("confirm.closeSessionDesc", locale),
              confirmLabel: t("confirm.close", locale),
            });
            if (!ok) return;
            store.closeSession(store.activeTabId);
          }
        },
        page: null,
      },
      {
        key: "n",
        ctrl: true,
        handler: () => {
          setCurrentPage("connections");
        },
        page: null,
      },
      {
        key: ",",
        ctrl: true,
        handler: () => {
          setCurrentPage("settings");
        },
        page: null,
      },
      // ── Terminal shortcuts ──
      {
        key: "l",
        ctrl: true,
        handler: () => {
          // Clear terminal — dispatch custom event picked up by TerminalPage
          window.dispatchEvent(new CustomEvent("terminal:clear"));
        },
        page: "terminal",
      },
      {
        key: "-",
        alt: true,
        shift: true,
        handler: () => {
          useTerminalStore.getState().splitPane("horizontal");
        },
        page: "terminal",
      },
      {
        key: "|",
        alt: true,
        shift: true,
        handler: () => {
          useTerminalStore.getState().splitPane("vertical");
        },
        page: "terminal",
      },
      {
        key: "Enter",
        alt: true,
        handler: () => {
          // Insert selected text — dispatch custom event
          window.dispatchEvent(new CustomEvent("terminal:insert-selection"));
        },
        page: "terminal",
      },
      // ── SFTP shortcuts ──
      {
        key: "F5",
        handler: () => {
          window.dispatchEvent(new CustomEvent("sftp:refresh"));
        },
        page: "sftp",
      },
      {
        key: "F2",
        handler: () => {
          window.dispatchEvent(new CustomEvent("sftp:rename"));
        },
        page: "sftp",
      },
      {
        key: "Delete",
        handler: () => {
          window.dispatchEvent(new CustomEvent("sftp:delete"));
        },
        page: "sftp",
      },
      {
        key: "n",
        ctrl: true,
        shift: true,
        handler: () => {
          window.dispatchEvent(new CustomEvent("sftp:mkdir"));
        },
        page: "sftp",
      },
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      for (const def of shortcuts) {
        if (def.page !== null && def.page !== undefined && def.page !== currentPage) continue;

        if (matchesModifier(e, def)) {
          // Allow typing in inputs unless it's a global shortcut
          if (isInput && def.page !== null) continue;

          e.preventDefault();
          e.stopPropagation();
          def.handler(e);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [currentPage, setCurrentPage]);
}
