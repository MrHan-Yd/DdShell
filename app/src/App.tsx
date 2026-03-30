import { useEffect, useRef, useState } from "react";
import { Titlebar } from "@/components/Titlebar";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { ToastContainer } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAppStore } from "@/stores/app";
import { useShortcuts } from "@/hooks/useShortcuts";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { TerminalPage } from "@/features/terminal/TerminalPage";
import { SftpPage } from "@/features/sftp/SftpPage";
import { SnippetsPage } from "@/features/snippets/SnippetsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { MonitorPage } from "@/features/monitor/MonitorPage";
import { useCommandAssistStore } from "@/stores/commandAssist";
import * as api from "@/lib/tauri";
import type { Locale } from "@/lib/i18n";
import type { Page } from "@/types";

const PAGE_ORDER: Page[] = ["connections", "terminal", "sftp", "monitor", "snippets", "settings"];

function PageRenderer() {
  const currentPage = useAppStore((s) => s.currentPage);
  const prevPageRef = useRef<Page>(currentPage);
  const [animClass, setAnimClass] = useState("animate-fade-in-up");

  useEffect(() => {
    const prevIdx = PAGE_ORDER.indexOf(prevPageRef.current);
    const currIdx = PAGE_ORDER.indexOf(currentPage);
    setAnimClass(currIdx >= prevIdx ? "animate-fade-in-up" : "animate-fade-in-down");
    prevPageRef.current = currentPage;
  }, [currentPage]);

  return (
    <>
      <div className={currentPage === "terminal" ? "flex flex-1 overflow-hidden" : "hidden"}>
        <TerminalPage />
      </div>
      {currentPage !== "terminal" && (
        <div key={currentPage} className={`flex flex-1 overflow-hidden ${animClass}`}>
          {currentPage === "connections" && <ConnectionsPage />}
          {currentPage === "sftp" && <SftpPage />}
          {currentPage === "monitor" && <MonitorPage />}
          {currentPage === "snippets" && <SnippetsPage />}
          {currentPage === "settings" && <SettingsPage />}
        </div>
      )}
    </>
  );
}

export default function App() {
  const theme = useAppStore((s) => s.theme);
  const setLocale = useAppStore((s) => s.setLocale);
  const [uiFontFamily, setUiFontFamily] = useState("");
  const [uiFontSize, setUiFontSize] = useState(14);

  // Register global + page shortcuts
  useShortcuts();

  // Load command assist data into memory on mount
  useEffect(() => {
    useCommandAssistStore.getState().load();
  }, []);

  // Load locale and UI font settings from backend on mount + when settings change
  useEffect(() => {
    const loadUiSettings = () => {
      api.settingGet("locale").then((saved) => {
        if (saved === "en" || saved === "zh") {
          setLocale(saved as Locale);
        }
      }).catch(() => {});

      api.settingGet("ui.fontFamily").then((saved) => {
        setUiFontFamily(saved || "");
      }).catch(() => {});

      api.settingGet("ui.fontSize").then((saved) => {
        if (saved) setUiFontSize(parseInt(saved));
      }).catch(() => {});
    };

    loadUiSettings();

    window.addEventListener("terminal:settings-changed", loadUiSettings);
    return () => {
      window.removeEventListener("terminal:settings-changed", loadUiSettings);
    };
  }, [setLocale]);

  // Apply UI font to document
  useEffect(() => {
    const root = document.documentElement;
    if (uiFontFamily) {
      root.style.fontFamily = `"${uiFontFamily}", "SF Pro Text", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    } else {
      root.style.removeProperty("font-family");
    }
    root.style.fontSize = `${uiFontSize}px`;
  }, [uiFontFamily, uiFontSize]);

  // Apply theme to document + update favicon
  useEffect(() => {
    const root = document.documentElement;
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    const applyTheme = (isDark: boolean) => {
      root.setAttribute("data-theme", isDark ? "dark" : "light");
      if (favicon) favicon.href = isDark ? "/logo-dark.svg" : "/logo.svg";
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
  }, [theme]);

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg-base)]">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden [scrollbar-gutter:stable]">
          <PageRenderer />
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
