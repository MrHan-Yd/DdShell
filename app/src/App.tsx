import { useEffect } from "react";
import { Titlebar } from "@/components/Titlebar";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { ToastContainer } from "@/components/Toast";
import { useAppStore } from "@/stores/app";
import { useShortcuts } from "@/hooks/useShortcuts";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { TerminalPage } from "@/features/terminal/TerminalPage";
import { SftpPage } from "@/features/sftp/SftpPage";
import { SnippetsPage } from "@/features/snippets/SnippetsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { MonitorPage } from "@/features/monitor/MonitorPage";
import * as api from "@/lib/tauri";
import type { Locale } from "@/lib/i18n";

function PageRenderer() {
  const currentPage = useAppStore((s) => s.currentPage);

  switch (currentPage) {
    case "connections":
      return <ConnectionsPage />;
    case "terminal":
      return <TerminalPage />;
    case "sftp":
      return <SftpPage />;
    case "monitor":
      return <MonitorPage />;
    case "snippets":
      return <SnippetsPage />;
    case "settings":
      return <SettingsPage />;
  }
}

export default function App() {
  const theme = useAppStore((s) => s.theme);
  const setLocale = useAppStore((s) => s.setLocale);

  // Register global + page shortcuts
  useShortcuts();

  // Load locale from backend on mount
  useEffect(() => {
    api.settingGet("locale").then((saved) => {
      if (saved === "en" || saved === "zh") {
        setLocale(saved as Locale);
      }
    }).catch(() => {});
  }, [setLocale]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", isDark ? "dark" : "light");

      const handler = (e: MediaQueryListEvent) => {
        root.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg-base)]">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <PageRenderer />
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
    </div>
  );
}
