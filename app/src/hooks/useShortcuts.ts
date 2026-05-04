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
  allowInInput?: boolean;
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
        // Mac 保留 Cmd+W；Win 用 Ctrl+Shift+W，避免和终端 readline kill-word（Ctrl+W）冲突
        shift: !isMac,
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
      {
        key: "e",
        ctrl: true,
        shift: true,
        allowInInput: true,
        handler: () => {
          // Open Quick Edit from terminal — picks up selection / infers cwd / opens file picker
          window.dispatchEvent(new CustomEvent("terminal:open-quick-edit"));
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isPlainInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const isExclusiveEditor =
        target?.isContentEditable === true ||
        target?.closest("[data-quick-editor-root='true']") !== null;

      // QuickEditor 与 contenteditable 区域独占按键：全局与页面级快捷键都不拦截
      if (isExclusiveEditor) return;

      for (const def of shortcuts) {
        if (def.page !== null && def.page !== undefined && def.page !== currentPage) continue;

        // 普通输入区放行 page === null 的全局快捷键，仅阻止页面级快捷键
        if (isPlainInput && def.page !== null && !def.allowInInput) continue;

        if (matchesModifier(e, def)) {
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
