import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const appWindow = getCurrentWindow();

export function Titlebar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--height-titlebar)] items-center border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4"
    >
      <span
        data-tauri-drag-region
        className="flex-1 text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)]"
      >
        Shell
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={() => appWindow.minimize()}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:bg-[var(--color-error)]/80 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
