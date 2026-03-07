import { useState, useCallback, useEffect, useRef } from "react";
import { useTerminalStore } from "@/stores/terminal";
import { useSftpStore } from "@/stores/sftp";
import { useMetricsStore } from "@/stores/metrics";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { downloadUpdate } from "@/lib/tauri";

type HealthLevel = "GOOD" | "FAIR" | "POOR";
type UpdateStatus = "idle" | "checking" | "available" | "upToDate" | "error";
type DownloadStatus = "idle" | "downloading" | "completed" | "failed";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

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

function compareVersions(current: string, latest: string): boolean {
  const normalize = (v: string) => v.replace(/^v/, "");
  const cur = normalize(current).split(".").map(Number);
  const lat = normalize(latest).split(".").map(Number);
  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPlatformAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac") || platform.includes("darwin")) {
    // Prefer .dmg, fallback to .app.tar.gz
    return (
      assets.find((a) => a.name.endsWith(".dmg")) ??
      assets.find((a) => a.name.includes("darwin") || a.name.includes("macos"))
    );
  }
  if (platform.includes("win")) {
    // Prefer .exe (NSIS), fallback to .msi
    return (
      assets.find((a) => a.name.endsWith(".exe")) ??
      assets.find((a) => a.name.endsWith(".msi"))
    );
  }
  // Linux: prefer .AppImage, fallback to .deb
  return (
    assets.find((a) => a.name.endsWith(".AppImage")) ??
    assets.find((a) => a.name.endsWith(".deb"))
  );
}

function DownloadModal({
  downloadStatus,
  downloadedBytes,
  totalBytes,
  downloadedPath,
  downloadError,
  onClose,
  t,
}: {
  downloadStatus: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  downloadedPath: string;
  downloadError: string;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-2xl">
        <h3 className="mb-4 text-sm font-semibold text-[var(--color-text)]">
          {downloadStatus === "completed"
            ? t("update.downloadComplete")
            : downloadStatus === "failed"
              ? t("update.downloadFailed")
              : t("update.downloading")}
        </h3>

        {downloadStatus === "downloading" && (
          <div>
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-secondary)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              <span>{pct}%</span>
              <span>
                {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
              </span>
            </div>
          </div>
        )}

        {downloadStatus === "completed" && (
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white hover:brightness-110"
              onClick={() => {
                openPath(downloadedPath);
                onClose();
              }}
            >
              {t("update.openFile")}
            </button>
            <button
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
              onClick={onClose}
            >
              {t("update.close")}
            </button>
          </div>
        )}

        {downloadStatus === "failed" && (
          <div>
            <p className="mb-3 text-[var(--font-size-xs)] text-[var(--color-poor)]">
              {downloadError}
            </p>
            <button
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
              onClick={onClose}
            >
              {t("update.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusBar() {
  const tabs = useTerminalStore((s) => s.tabs);
  const transfers = useSftpStore((s) => s.transfers);
  const latest = useMetricsStore((s) => s.latest);
  const locale = useAppStore((s) => s.locale);
  const t = useT();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [releaseAssets, setReleaseAssets] = useState<ReleaseAsset[]>([]);

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadedPath, setDownloadedPath] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const unlistenRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    const setup = async () => {
      const u1 = await listen<{ downloadedBytes: number; totalBytes: number }>(
        "update:download_progress",
        (e) => {
          setDownloadedBytes(e.payload.downloadedBytes);
          setTotalBytes(e.payload.totalBytes);
        },
      );
      const u2 = await listen<{ path: string }>(
        "update:download_completed",
        (e) => {
          setDownloadedPath(e.payload.path);
          setDownloadStatus("completed");
        },
      );
      const u3 = await listen<{ error: string }>(
        "update:download_failed",
        (e) => {
          setDownloadError(e.payload.error);
          setDownloadStatus("failed");
        },
      );
      unlistenRefs.current = [u1, u2, u3];
    };
    setup();
    return () => {
      unlistenRefs.current.forEach((u) => u());
    };
  }, []);

  const checkUpdate = useCallback(async () => {
    if (updateStatus === "checking") return;
    setUpdateStatus("checking");
    try {
      const res = await fetch(
        "https://api.github.com/repos/MrHan-Yd/DdShell/releases/latest",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tagName: string = data.tag_name ?? "";
      if (compareVersions(APP_VERSION, tagName)) {
        setLatestVersion(tagName);
        setReleaseAssets(data.assets ?? []);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("upToDate");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      }
    } catch {
      setUpdateStatus("error");
      setTimeout(() => setUpdateStatus("idle"), 3000);
    }
  }, [updateStatus]);

  const startDownload = useCallback(() => {
    const asset = getPlatformAsset(releaseAssets);
    if (!asset) return;
    setDownloadedBytes(0);
    setTotalBytes(asset.size);
    setDownloadError("");
    setDownloadedPath("");
    setDownloadStatus("downloading");
    downloadUpdate(asset.browser_download_url, asset.name);
  }, [releaseAssets]);

  const closeDownloadModal = useCallback(() => {
    setDownloadStatus("idle");
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
    switch (updateStatus) {
      case "checking":
        return (
          <button
            className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] cursor-default"
            disabled
          >
            {t("update.checking")}
          </button>
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
              onClick={startDownload}
            >
              {t("update.download")}
            </button>
          </span>
        );
      case "upToDate":
        return (
          <span className="text-[var(--font-size-xs)] text-[var(--color-success)]">
            ✓ {t("update.latest")}
          </span>
        );
      case "error":
        return (
          <span className="text-[var(--font-size-xs)] text-[var(--color-poor)]">
            {t("update.failed")}
          </span>
        );
      default:
        return (
          <button
            className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
            onClick={checkUpdate}
            title={locale === "zh" ? "检查更新" : "Check for updates"}
          >
            {APP_NAME} v{APP_VERSION}
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

        {connectedCount === 0 && activeTransfers === 0 && (
          <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("status.ready")}
          </span>
        )}
      </footer>

      {downloadStatus !== "idle" && (
        <DownloadModal
          downloadStatus={downloadStatus}
          downloadedBytes={downloadedBytes}
          totalBytes={totalBytes}
          downloadedPath={downloadedPath}
          downloadError={downloadError}
          onClose={closeDownloadModal}
          t={t as (key: string) => string}
        />
      )}
    </>
  );
}
