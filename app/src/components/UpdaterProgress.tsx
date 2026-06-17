import { cn } from "@/lib/utils";

interface UpdaterProgressProps {
  percent: number | null;
  slowNetwork?: boolean;
  compact?: boolean;
  className?: string;
}

export function UpdaterProgress({ percent, slowNetwork = false, compact = false, className }: UpdaterProgressProps) {
  const isDeterminate = typeof percent === "number" && Number.isFinite(percent);
  const value = isDeterminate ? Math.min(100, Math.max(0, percent)) : 0;

  return (
    <span
      className={cn("updater-progress", compact && "updater-progress--compact", className)}
      data-indeterminate={!isDeterminate}
      data-slow={slowNetwork}
      role="progressbar"
      aria-label="Update progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isDeterminate ? value : undefined}
    >
      <span className="updater-progress__fill" style={isDeterminate ? { width: `${value}%` } : undefined} />
    </span>
  );
}
