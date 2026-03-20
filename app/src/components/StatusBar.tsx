import { useState, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/stores/terminal";
import { useSftpStore } from "@/stores/sftp";
import { useMetricsStore } from "@/stores/metrics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
import { APP_NAME, getAppVersion } from "@/lib/constants";
import { openBrowser } from "@/lib/tauri";
import { checkUpdate as apiCheckUpdate } from "@/lib/tauri";

type HealthLevel = "GOOD" | "FAIR" | "POOR";
type UpdateStatus = "idle" | "checking" | "available" | "upToDate" | "rateLimited" | "networkError" | "error";
const GITHUB_REPO_URL = "https://github.com/MrHan-Yd/DdShell";

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
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const latencyMap = useTerminalStore((s) => s.latencyMap);
  const pingActiveSession = useTerminalStore((s) => s.pingActiveSession);
  const transfers = useSftpStore((s) => s.transfers);
  const latest = useMetricsStore((s) => s.latest);
  const locale = useAppStore((s) => s.locale);
  const t = useT();

  // Ping active session every 5 seconds
  useEffect(() => {
    pingActiveSession();
    const id = setInterval(pingActiveSession, 5000);
    return () => clearInterval(id);
  }, [activeTabId, pingActiveSession]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const latency = activeTab ? latencyMap.get(activeTab.sessionId) : undefined;

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [appVersion, setAppVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState("");

  useEffect(() => {
    getAppVersion().then(setAppVersion);
  }, []);

  const checkUpdate = useCallback(async () => {
    if (updateStatus === "checking" || !appVersion) return;
    setUpdateStatus("checking");
    try {
      const result = await apiCheckUpdate(appVersion);
      if (result.hasUpdate) {
        setLatestVersion(result.latestVersion);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("upToDate");
      }
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "";
      if (msg.includes("rate_limited")) {
        setUpdateStatus("rateLimited");
      } else if (msg.includes("network")) {
        setUpdateStatus("networkError");
      } else {
        setUpdateStatus("error");
      }
    }
  }, [updateStatus, appVersion]);

  const openDownloadPage = useCallback(async () => {
    try {
      await openBrowser(GITHUB_REPO_URL);
    } catch (err) {
      console.error("Failed to open browser:", err);
    }
  }, []);

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

  const renderVersion = () => {
    const versionTag = `${APP_NAME} v${appVersion}`;

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
              onClick={openDownloadPage}
            >
              {t("update.download")}
            </button>
          </span>
        );
      case "upToDate":
        return (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span>{versionTag}</span>
            <span className="text-[var(--color-success)]">✓ {t("update.latest")}</span>
          </span>
        );
      case "rateLimited":
        return (
          <button
            className="flex items-center gap-1.5 text-[var(--font-size-xs)] cursor-pointer"
            onClick={checkUpdate}
          >
            <span className="text-[var(--color-text-muted)]">{versionTag}</span>
            <span className="text-[var(--color-fair)]">{t("update.rateLimited")}</span>
          </button>
        );
      case "networkError":
        return (
          <button
            className="flex items-center gap-1.5 text-[var(--font-size-xs)] cursor-pointer"
            onClick={checkUpdate}
          >
            <span className="text-[var(--color-text-muted)]">{versionTag}</span>
            <span className="text-[var(--color-poor)]">{t("update.networkError")}</span>
          </button>
        );
      case "error":
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
    <>
      <footer className="glass-surface flex h-[var(--height-statusbar)] items-center border-t border-[var(--color-border)] px-4 gap-4">
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

        {latency !== undefined && activeTab?.state === "connected" && (
          <span className="flex items-center gap-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                latency < 100 ? "bg-[var(--color-good)]" : latency < 300 ? "bg-[var(--color-fair)]" : "bg-[var(--color-poor)]",
              )}
            />
            {latency}ms
          </span>
        )}

        {connectedCount === 0 && activeTransfers === 0 && (
          <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("status.ready")}
          </span>
        )}
      </footer>
    </>
  );
}
