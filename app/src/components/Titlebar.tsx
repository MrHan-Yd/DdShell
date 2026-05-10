import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const appWindow = getCurrentWindow();
const isMac = navigator.platform.toUpperCase().includes("MAC");

function WinControls() {
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
        onClick={() => appWindow.close()}
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
