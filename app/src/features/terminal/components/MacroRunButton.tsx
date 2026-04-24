import { Loader2, Square, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { MacroRunState } from "@/features/terminal/hooks/useMacroRunner";

export function MacroRunButton({
  open,
  state,
  progressText,
  disabled,
  onClick,
  onStop,
}: {
  open: boolean;
  state: MacroRunState;
  progressText: string | null;
  disabled?: boolean;
  onClick: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const isRunning = state === "running" || state === "cancelling";
  const progressWidth = progressText ? `${Math.max(progressText.length + 1, 4)}ch` : "0ch";

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 text-[var(--font-size-xs)] transition-colors duration-150",
          progressText ? "justify-start" : "justify-center",
          open
            ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
            : "bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
          disabled && "cursor-not-allowed opacity-50 hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-muted)]",
        )}
        title={t("macro.run")}
      >
        <span className="flex h-[13px] w-[13px] items-center justify-center">
          {state === "cancelling" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
        </span>
        <span
          className={cn(
            "overflow-hidden whitespace-nowrap transition-all duration-150 ease-[var(--ease-smooth)]",
            progressText
              ? "ml-1 opacity-100"
              : "ml-0 opacity-0",
          )}
          style={{ width: progressWidth }}
          aria-hidden={progressText ? undefined : true}
        >
          <span
            className={cn(
              "block whitespace-nowrap text-[10px] transition-all duration-150 ease-[var(--ease-smooth)]",
              progressText
                ? "translate-x-0 scale-100 blur-0"
                : "-translate-x-1 scale-95 blur-[2px]",
            )}
          >
            {progressText ?? ""}
          </span>
        </span>
      </button>
      {isRunning && (
        <button
          onClick={onStop}
          className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] px-1.5 text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
          title={t("macro.stop")}
        >
          <Square size={12} />
        </button>
      )}
    </div>
  );
}
