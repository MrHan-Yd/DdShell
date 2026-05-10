import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Titlebar } from "@/components/Titlebar";
import { ToastContainer } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { useQuickEditStore } from "@/stores/quickEdit";
import * as api from "@/lib/tauri";
import type { QuickEditOpenPayload } from "@/lib/quickEditWindow";
import { QuickEditTabBar } from "./QuickEditTabBar";
import { QuickEditTabContent } from "./QuickEditTabContent";
import { SessionDetachedDialog } from "./SessionDetachedDialog";
import type { QuickEditTab } from "./types";

type DetachedPrompt = {
  sessionId: string;
  dirtyTabIds: string[];
};

function decodeInitialPayload(): QuickEditOpenPayload | null {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("open");
  if (!encoded) return null;
  try {
    // URL_SAFE_NO_PAD base64 → bytes → UTF-8 → JSON
    // atob 返回 Latin-1 binary string，必须经 TextDecoder 还原 UTF-8，否则
    // 中文路径会被拆成多字节单字符，后续 SFTP 读取时路径错误。
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as QuickEditOpenPayload;
  } catch {
    return null;
  }
}

export function QuickEditWindow() {
  const t = useT();
  const tabs = useQuickEditStore((s) => s.tabs);
  const activeTabId = useQuickEditStore((s) => s.activeTabId);
  const theme = useAppStore((s) => s.theme);
  const uiTheme = useAppStore((s) => s.uiTheme);

  const [detachedPrompt, setDetachedPrompt] = useState<DetachedPrompt | null>(null);
  // Tracks whether at least one tab has ever been opened in this window. We
  // only auto-close the window when tabs go from N → 0; on first mount tabs is
  // still [] (the URL payload hasn't been processed yet) so we must NOT close.
  const hasHadTabsRef = useRef(false);

  // 1. Initialise locale & theme from the same SettingStore as the main window,
  //    and keep following later settings saves so detached windows stay in sync.
  useEffect(() => {
    let cancelled = false;
    const loadUiSettings = () => {
      void (async () => {
        try {
          const [locale, savedTheme, savedUiTheme] = await Promise.all([
            api.settingGet("locale"),
            api.settingGet("theme"),
            api.settingGet("ui.theme"),
          ]);
          if (cancelled) return;
          if (locale) useAppStore.getState().setLocale(locale as Locale);
          if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system") {
            useAppStore.getState().setTheme(savedTheme);
          }
          if (savedUiTheme === "classic" || savedUiTheme === "aurora") {
            useAppStore.getState().setUiTheme(savedUiTheme);
          }
        } catch {
          // fall back to defaults
        }
      })();
    };

    loadUiSettings();
    window.addEventListener("terminal:settings-changed", loadUiSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("terminal:settings-changed", loadUiSettings);
    };
  }, []);

  // 2. Apply theme to <html data-theme>
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const applyTheme = (isDark: boolean) => {
      root.setAttribute("data-theme", isDark ? "dark" : "light");
      root.setAttribute("data-ui-theme", uiTheme);
      body.classList.toggle("theme-dark", isDark);
      body.classList.toggle("theme-light", !isDark);
    };
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme, uiTheme]);

  // 3. Initial file from URL (delivered alongside window creation).
  useEffect(() => {
    const initial = decodeInitialPayload();
    if (initial) useQuickEditStore.getState().openOrFocusFile(initial);
  }, []);

  // 4. Subsequent files arrive via global event.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen<QuickEditOpenPayload>("quick-edit:open-file", (e) => {
        useQuickEditStore.getState().openOrFocusFile(e.payload);
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // 5. Listen for SSH session disconnects → close clean tabs immediately,
  //    queue an aggregate confirmation for dirty tabs.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen<{ sessionId: string; state: string }>(
        "session:state_changed",
        (e) => {
          if (e.payload.state !== "disconnected") return;
          const sessionId = e.payload.sessionId;
          const all = useQuickEditStore
            .getState()
            .tabs.filter((tab) => tab.sessionId === sessionId && !tab.sessionDetached);
          if (all.length === 0) return;

          const cleanIds: string[] = [];
          const dirtyIds: string[] = [];
          for (const tab of all) {
            if (tab.dirty) dirtyIds.push(tab.id);
            else cleanIds.push(tab.id);
          }
          for (const id of cleanIds) {
            useQuickEditStore.getState().closeTab(id);
          }
          if (dirtyIds.length > 0) {
            setDetachedPrompt({ sessionId, dirtyTabIds: dirtyIds });
          }
        },
      );
    })();
    return () => { unlisten?.(); };
  }, []);

  // 6. Document title reflects the active file (Notepad++ style).
  useEffect(() => {
    const active = tabs.find((x) => x.id === activeTabId);
    document.title = active
      ? `${active.fileName} — ${t("quickEdit.window.title")}`
      : t("quickEdit.window.title");
  }, [tabs, activeTabId, t]);

  // 7. When all tabs are gone, close the window automatically — but only
  //    once at least one tab has been opened. Otherwise we'd close before the
  //    initial URL payload is processed.
  useEffect(() => {
    if (tabs.length > 0) hasHadTabsRef.current = true;
    if (hasHadTabsRef.current && tabs.length === 0 && !detachedPrompt) {
      void getCurrentWindow().close();
    }
  }, [tabs.length, detachedPrompt]);

  // Resolve dialog → either discard all or keep them as readonly tabs.
  const promptDirtyTabs: QuickEditTab[] = detachedPrompt
    ? tabs.filter((t) => detachedPrompt.dirtyTabIds.includes(t.id))
    : [];

  const handleDiscardAll = () => {
    if (!detachedPrompt) return;
    for (const id of detachedPrompt.dirtyTabIds) {
      useQuickEditStore.getState().closeTab(id);
    }
    setDetachedPrompt(null);
  };

  const handleKeepReadonly = () => {
    if (!detachedPrompt) return;
    useQuickEditStore.getState().markDetached(detachedPrompt.dirtyTabIds);
    setDetachedPrompt(null);
  };

  return (
    <div className="app-shell flex h-screen w-screen flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <div className="aurora-shell-orb aurora-shell-orb--violet" aria-hidden="true" />
      <div className="aurora-shell-orb aurora-shell-orb--cyan" aria-hidden="true" />
      <Titlebar />
      <QuickEditTabBar />
      <main className="relative flex min-h-0 flex-1 flex-col">
        {activeTabId ? (
          <QuickEditTabContent tabId={activeTabId} />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
            {t("quickEdit.window.empty")}
          </div>
        )}

        {detachedPrompt && promptDirtyTabs.length > 0 && (
          <SessionDetachedDialog
            tabs={promptDirtyTabs}
            onDiscardAll={handleDiscardAll}
            onKeepReadonly={handleKeepReadonly}
          />
        )}
      </main>
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
