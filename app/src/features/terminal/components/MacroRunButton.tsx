import { AlertCircle, Loader2, Square, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { MacroRunState } from "@/features/terminal/hooks/useMacroRunner";

export function MacroRunButton({
  open,
  state,
  progressText,
  hasFailedBadge,
  disabled,
  onClick,
  onStop,
}: {
  open: boolean;
  state: MacroRunState;
  progressText: string | null;
  hasFailedBadge: boolean;
  disabled?: boolean;
  onClick: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const isRunning = state === "running" || state === "cancelling";

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[var(--font-size-xs)] transition-colors",
          open
            ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
          disabled && "cursor-not-allowed opacity-50 hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-muted)]",
        )}
        title={t("macro.run")}
      >
        {state === "cancelling" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
        {progressText && <span>{progressText}</span>}
        {!isRunning && hasFailedBadge && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--color-error)]" />
        )}
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
      {!isRunning && state === "failed" && (
        <AlertCircle size={12} className="text-[var(--color-error)]" />
      )}
    </div>
  );
}
