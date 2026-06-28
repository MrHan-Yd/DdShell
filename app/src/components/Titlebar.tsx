import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useAppStore } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/platform";
import { confirm } from "@/stores/confirm";

const appWindow = getCurrentWindow();
const isMac = isMacPlatform();

function WinControls() {
  const t = useT();

  const handleClose = async () => {
    const { currentPage, settingsDirty, setSettingsDirty } = useAppStore.getState();
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
    appWindow.close();
  };

  return (
    <div className="titlebar-right flex items-center gap-1">
      <button
        onClick={() => appWindow.minimize()}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
      >
        <Minus size={14} />
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
      >
        <Square size={12} />
      </button>
      <button
        onClick={handleClose}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-error)]/80 hover:text-white transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Titlebar() {
  return (
    <header
      data-tauri-drag-region
      className="titlebar app-titlebar glass-surface flex h-[var(--height-titlebar)] items-center border-b border-[var(--color-border)] px-4"
    >
      <div data-tauri-drag-region className="app-titlebar__center flex-1 select-none text-center">
        <span className="title app-titlebar__label">DdShell</span>
      </div>

      {!isMac && <WinControls />}
    </header>
  );
}
