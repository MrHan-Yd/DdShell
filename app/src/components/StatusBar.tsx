import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTerminalStore } from "@/stores/terminal";
import { useSftpStore } from "@/stores/sftp";
import { useMetricsStore } from "@/stores/metrics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { useConfirmStore } from "@/stores/confirm";
import { useUpdaterStore } from "@/stores/updater";
import { UpdaterProgress } from "@/components/UpdaterProgress";
import * as api from "@/lib/tauri";

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
  const monitorStatusBar = useMetricsStore((s) => s.StatusBarData);
  const locale = useAppStore((s) => s.locale);
  const updateStatus = useUpdaterStore((s) => s.status);
  const appVersion = useUpdaterStore((s) => s.currentVersion);
  const latestVersion = useUpdaterStore((s) => s.latestVersion);
  const progress = useUpdaterStore((s) => s.progress);
  const slowNetwork = useUpdaterStore((s) => s.slowNetwork);
  const loadCurrentVersion = useUpdaterStore((s) => s.loadCurrentVersion);
  const checkUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall);
  const restartApp = useUpdaterStore((s) => s.restartApp);
  const launchInstaller = useUpdaterStore((s) => s.launchInstaller);
  const openFallback = useUpdaterStore((s) => s.openFallback);
  const t = useT();
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    void loadCurrentVersion();
  }, [loadCurrentVersion]);

  useEffect(() => {
    const loadAiState = async () => {
      try {
        const config = await api.aiAgentConfigGet();
        setAiEnabled(config.enabled);
      } catch {
        setAiEnabled(false);
      }
    };
    void loadAiState();
    window.addEventListener("terminal:settings-changed", loadAiState);
    return () => window.removeEventListener("terminal:settings-changed", loadAiState);
  }, []);

  const connectedCount = tabs.filter((tab) => tab.state === "connected").length;
  const activeTransfers = transfers.filter(
    (transfer) => transfer.state === "running" || transfer.state === "queued",
  ).length;
  const healthLevel = computeHealthLevel(latest?.sessionHealth);

  const confirmRestart = useCallback(async () => {
    const hasActiveWork = connectedCount > 0 || activeTransfers > 0;
    const ok = await useConfirmStore.getState()._show({
      title: t("update.restartTitle"),
      description: hasActiveWork ? t("update.restartActiveDesc") : t("update.restartDesc"),
      confirmLabel: t("update.restartNow"),
      cancelLabel: t("update.later"),
      confirmVariant: "default",
    });
    if (ok) await restartApp();
  }, [activeTransfers, connectedCount, restartApp, t]);

  const sessionLabel = locale === "zh"
    ? `${connectedCount} ${t("status.sessions")}`
    : `${connectedCount} session${connectedCount !== 1 ? "s" : ""}`;

  const transferLabel = locale === "zh"
    ? `${activeTransfers} ${t("status.transfers")}`
    : `${activeTransfers} transfer${activeTransfers !== 1 ? "s" : ""}`;

  const renderVersion = () => {
    const versionTag = `${APP_NAME} v${appVersion || "..."}`;

    switch (updateStatus) {
      case "checking":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-text-muted)] border-t-transparent" />
            {t("update.checking")}
          </span>
        );
      case "available":
        return (
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[var(--font-size-xs)] text-[var(--color-success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              {t("update.available").replace("{v}", latestVersion)}
            </span>
            <button
              className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline cursor-pointer"
              onClick={downloadAndInstall}
            >
              {t("update.downloadInstall")}
            </button>
          </span>
        );
      case "downloading":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-text-muted)] border-t-transparent" />
            <UpdaterProgress compact percent={progress.percent} slowNetwork={slowNetwork} />
            {progress.percent === null
              ? t("update.downloading")
              : t("update.downloadingProgress", { n: progress.percent })}
            {slowNetwork && <span className="text-[var(--color-fair)]">{t("update.slowNetwork")}</span>}
          </span>
        );
      case "installing":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-text-muted)] border-t-transparent" />
            <UpdaterProgress compact percent={null} />
            {t("update.installing")}
          </span>
        );
      case "readyToRestart":
        return (
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--font-size-xs)] text-[var(--color-success)]">✓ {t("update.readyToRestart")}</span>
            <button
              className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline cursor-pointer"
              onClick={confirmRestart}
            >
              {t("update.restartNow")}
            </button>
          </span>
        );
      case "downloadedManualInstall":
        return (
          <span className="flex items-center gap-1.5">
            <span className="text-[var(--font-size-xs)] text-[var(--color-success)]">✓ {t("update.manualInstallReady")}</span>
            <button
              className="text-[var(--font-size-xs)] text-[var(--color-accent)] hover:underline cursor-pointer"
              onClick={launchInstaller}
            >
              {t("update.launchInstaller")}
            </button>
          </span>
        );
      case "restarting":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border border-[var(--color-text-muted)] border-t-transparent" />
            {t("update.restarting")}
          </span>
        );
      case "downloadFailed":
      case "installFailed":
        return (
          <button
            className="flex items-center gap-1.5 text-[var(--font-size-xs)] cursor-pointer"
            onClick={openFallback}
          >
            <span className="text-[var(--color-text-muted)]">{versionTag}</span>
            <span className="text-[var(--color-poor)]">
              {updateStatus === "installFailed" ? t("update.installFailed") : t("update.downloadFailed")}
            </span>
          </button>
        );
      case "upToDate":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span>{versionTag}</span>
            <span className="text-[var(--color-success)]">✓ {t("update.latest")}</span>
          </span>
        );
      case "unsupported":
        return (
          <button
            className="flex items-center gap-1.5 text-[var(--font-size-xs)] cursor-pointer"
            onClick={openFallback}
          >
            <span className="text-[var(--color-text-muted)]">{versionTag}</span>
            <span className="text-[var(--color-fair)]">{t("update.openReleases")}</span>
          </button>
        );
      case "checkFailed":
        return (
          <button
            className="flex items-center gap-1.5 text-[var(--font-size-xs)] cursor-pointer"
            onClick={checkUpdate}
          >
            <span className="text-[var(--color-text-muted)]">{versionTag}</span>
            <span className="text-[var(--color-poor)]">{t("update.failed")}</span>
          </button>
        );
      default:
        return (
          <button
            className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
            onClick={checkUpdate}
            title={locale === "zh" ? "检查更新" : "Check for updates"}
          >
            {versionTag}
          </button>
        );
    }
  };

  return (
    <footer className="glass-surface flex h-[var(--height-statusbar)] items-center border-t border-[var(--color-border)] px-4 gap-4">
      {monitorStatusBar ? (
        <>
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 80
                ? "bg-[var(--color-good)]"
                : monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 50
                  ? "bg-[var(--color-fair)]"
                  : monitorStatusBar.latest.sessionHealth != null
                    ? "bg-[var(--color-poor)]"
                    : "bg-[var(--color-success)]",
            )} />
            {monitorStatusBar.hostTitle ?? "--"} · {t("monitor.samplingBadge", { n: 2 })}
          </span>
          <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("monitor.cpu")} {monitorStatusBar.latest.cpu.usagePercent.toFixed(0)}% · {t("monitor.memoryUsage", { n: monitorStatusBar.latest.memory.usagePercent.toFixed(0) })} · LA {monitorStatusBar.latest.load.one.toFixed(2)}
          </span>
          <div className="flex-1" />
          <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("monitor.lastAt", { t: monitorStatusBar.latest.serverTime.match(/\d+:\d+$/)?.[1] ?? "--:--" })}
          </span>
          <span className={cn(
            "text-[var(--font-size-xs)] font-medium",
            monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 80 && "text-[var(--color-good)]",
            monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 50 && monitorStatusBar.latest.sessionHealth < 80 && "text-[var(--color-fair)]",
            monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth < 50 && "text-[var(--color-poor)]",
          )}>
            {monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 80 && t("monitor.healthy")}
            {monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth >= 50 && monitorStatusBar.latest.sessionHealth < 80 && t("monitor.warning")}
            {monitorStatusBar.latest.sessionHealth != null && monitorStatusBar.latest.sessionHealth < 50 && t("monitor.critical")}
            {monitorStatusBar.latest.sessionHealth != null && ` · ${Math.round(monitorStatusBar.latest.sessionHealth)}`}
          </span>
        </>
      ) : (
        <>
          {renderVersion()}

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

          <span className={cn(
            "flex items-center gap-1 text-[var(--font-size-xs)]",
            aiEnabled ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]",
          )}>
            <Sparkles size={11} />
            {aiEnabled ? t("aiAssist.on") : t("aiAssist.off")}
          </span>

          {connectedCount === 0 && activeTransfers === 0 && (
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {t("status.ready")}
            </span>
          )}
        </>
      )}
    </footer>
  );
}
