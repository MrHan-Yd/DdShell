import { useTerminalStore } from "@/stores/terminal";
import { useSftpStore } from "@/stores/sftp";
import { useMetricsStore } from "@/stores/metrics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

type HealthLevel = "GOOD" | "FAIR" | "POOR";

function HealthBadge({ level }: { level: HealthLevel }) {
  const colors: Record<HealthLevel, string> = {
    GOOD: "bg-[var(--color-good)]/15 text-[var(--color-good)]",
    FAIR: "bg-[var(--color-fair)]/15 text-[var(--color-fair)]",
    POOR: "bg-[var(--color-poor)]/15 text-[var(--color-poor)]",
  };
  const dotColors: Record<HealthLevel, string> = {
    GOOD: "bg-[var(--color-good)]",
    FAIR: "bg-[var(--color-fair)]",
    POOR: "bg-[var(--color-poor)]",
  };

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[var(--font-size-xs)] font-medium",
        colors[level],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColors[level])} />
      {level}
    </span>
  );
}

function computeHealthLevel(sessionHealth?: number): HealthLevel {
  if (sessionHealth === undefined || sessionHealth === null) return "GOOD";
  if (sessionHealth >= 80) return "GOOD";
  if (sessionHealth >= 50) return "FAIR";
  return "POOR";
}

export function StatusBar() {
  const tabs = useTerminalStore((s) => s.tabs);
  const transfers = useSftpStore((s) => s.transfers);
  const latest = useMetricsStore((s) => s.latest);
  const locale = useAppStore((s) => s.locale);
  const t = useT();

  const connectedCount = tabs.filter((t) => t.state === "connected").length;
  const activeTransfers = transfers.filter(
    (t) => t.state === "running" || t.state === "queued",
  ).length;

  const healthLevel = computeHealthLevel(latest?.sessionHealth);

  const sessionLabel = locale === "zh"
    ? `${connectedCount} ${t("status.sessions")}`
    : `${connectedCount} session${connectedCount !== 1 ? "s" : ""}`;

  const transferLabel = locale === "zh"
    ? `${activeTransfers} ${t("status.transfers")}`
    : `${activeTransfers} transfer${activeTransfers !== 1 ? "s" : ""}`;

  return (
    <footer className="glass-surface flex h-[var(--height-statusbar)] items-center border-t border-[var(--color-border)] px-4 gap-4">
      <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
        Shell v0.1.0
      </span>

      <div className="flex-1" />

      {connectedCount > 0 && (
        <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          {sessionLabel}
        </span>
      )}

      {activeTransfers > 0 && (
        <span className="text-[var(--font-size-xs)] text-[var(--color-accent)]">
          {transferLabel}
        </span>
      )}

      {connectedCount > 0 && latest && <HealthBadge level={healthLevel} />}

      {connectedCount === 0 && activeTransfers === 0 && (
        <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {t("status.ready")}
        </span>
      )}
    </footer>
  );
}
