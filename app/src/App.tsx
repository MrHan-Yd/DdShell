import { Titlebar } from "@/components/Titlebar";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { useAppStore } from "@/stores/app";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { TerminalPage } from "@/features/terminal/TerminalPage";
import { SftpPage } from "@/features/sftp/SftpPage";
import { SnippetsPage } from "@/features/snippets/SnippetsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

function PageRenderer() {
  const currentPage = useAppStore((s) => s.currentPage);

  switch (currentPage) {
    case "connections":
      return <ConnectionsPage />;
    case "terminal":
      return <TerminalPage />;
    case "sftp":
      return <SftpPage />;
    case "snippets":
      return <SnippetsPage />;
    case "settings":
      return <SettingsPage />;
  }
}

export default function App() {
  return (
    <div className="flex h-screen flex-col">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg-base)]">
          <PageRenderer />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
