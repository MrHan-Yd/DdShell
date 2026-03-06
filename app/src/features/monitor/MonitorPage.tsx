import { useEffect, useRef, useCallback, useState } from "react";
import {
  Activity,
  Cpu,
  MemoryStick,
  ArrowDown,
  Clock,
  Gauge,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMetricsStore, initMetricsListeners } from "@/stores/metrics";
import { useTerminalStore } from "@/stores/terminal";
import * as api from "@/lib/tauri";
import { useT } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n";
import type { MetricsSnapshot, SystemInfo } from "@/types";

// ── Utility ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Collapsible Section ──

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-0">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
        ) : (
          <ChevronRight size={16} className="text-[var(--color-text-muted)]" />
        )}
        {title}
      </button>
      {isOpen && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ── Mini Chart (Canvas) ──

function MiniChart({
  data,
  color,
  maxValue,
  height = 80,
  label,
  valueFormatter,
}: {
  data: number[];
  color: string;
  maxValue?: number;
  height?: number;
  label: string;
  valueFormatter?: (v: number) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentValue = data[data.length - 1] ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = 2;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const max = maxValue ?? Math.max(...data, 1);
    const step = (w - padding * 2) / (data.length - 1);

    // Fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + "40");
    gradient.addColorStop(1, color + "05");

    ctx.beginPath();
    ctx.moveTo(padding, h);

    for (let i = 0; i < data.length; i++) {
      const x = padding + i * step;
      const y = h - padding - ((data[i] / max) * (h - padding * 2));
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.lineTo(padding + (data.length - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = padding + i * step;
      const y = h - padding - ((data[i] / max) * (h - padding * 2));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [data, color, maxValue, height]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {label}
        </span>
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-primary)]">
          {valueFormatter ? valueFormatter(currentValue) : `${currentValue.toFixed(1)}%`}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-[var(--radius-control)]"
        style={{ height }}
      />
    </div>
  );
}

// ── Overview Card ──

function OverviewCard({
  icon: Icon,
  label,
  value,
  subValue,
  colorClass,
  bgClass,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  subValue?: string;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
      <div
        className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bgClass)}
      >
        <Icon size={18} className={colorClass} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {label}
        </p>
        <p className="truncate text-[var(--font-size-base)] font-medium text-[var(--color-text-primary)]">
          {value}
        </p>
        {subValue && (
          <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {subValue}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Session Health helpers ──

function getHealthColor(score: number): string {
  if (score >= 80) return "var(--color-good)";
  if (score >= 50) return "var(--color-fair)";
  return "var(--color-poor)";
}

function getHealthBg(score: number): string {
  if (score >= 80) return "bg-green-500/10";
  if (score >= 50) return "bg-yellow-500/10";
  return "bg-red-500/10";
}

function getHealthTextClass(score: number): string {
  if (score >= 80) return "text-green-500";
  if (score >= 50) return "text-yellow-500";
  return "text-red-500";
}

// ── Session Picker ──

function SessionPicker({
  sessionId,
  onSelect,
}: {
  sessionId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const connected = tabs.filter((t) => t.state === "connected");

  if (connected.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Activity
            size={48}
            className="mx-auto mb-4 text-[var(--color-text-muted)]"
          />
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("monitor.noActiveSessions")}
          </p>
          <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("monitor.connectFirst")}
          </p>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Activity
            size={48}
            className="mx-auto mb-4 text-[var(--color-text-muted)]"
          />
          <p className="mb-4 text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("monitor.selectSession")}
          </p>
          <div className="flex flex-col gap-2">
            {connected.map((tab) => (
              <button
                key={tab.sessionId}
                onClick={() => onSelect(tab.sessionId)}
                className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2 text-left text-[var(--font-size-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" />
                {tab.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Process Table ──

function ProcessTable({
  processes,
}: {
  processes: MetricsSnapshot["processes"];
}) {
  const t = useT();

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
          {t("monitor.processesTop15")}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[var(--font-size-xs)]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-2 text-left font-medium">{t("monitor.pid")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("monitor.user")}</th>
              <th className="px-4 py-2 text-right font-medium">CPU%</th>
              <th className="px-4 py-2 text-right font-medium">MEM%</th>
              <th className="px-4 py-2 text-left font-medium">{t("monitor.command")}</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p) => (
              <tr
                key={p.pid}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-hover)]"
              >
                <td className="px-4 py-1.5 text-[var(--color-text-secondary)]">
                  {p.pid}
                </td>
                <td className="px-4 py-1.5 text-[var(--color-text-secondary)]">
                  {p.user}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <span
                    className={cn(
                      p.cpuPercent > 50
                        ? "text-[var(--color-error)]"
                        : p.cpuPercent > 20
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--color-text-secondary)]",
                    )}
                  >
                    {p.cpuPercent.toFixed(1)}
                  </span>
                </td>
                <td className="px-4 py-1.5 text-right text-[var(--color-text-secondary)]">
                  {p.memPercent.toFixed(1)}
                </td>
                <td className="max-w-[300px] truncate px-4 py-1.5 text-[var(--color-text-muted)]">
                  {p.command}
                </td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-4 text-center text-[var(--color-text-muted)]"
                >
                  {t("monitor.noProcessData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Disk Table ──

function DiskTable({ disks }: { disks: MetricsSnapshot["disks"] }) {
  const t = useT();

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
          {t("monitor.diskUsage")}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[var(--font-size-xs)]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-2 text-left font-medium">{t("monitor.filesystem")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("monitor.mount")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("monitor.total")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("monitor.used")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("monitor.available")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("monitor.usage")}</th>
            </tr>
          </thead>
          <tbody>
            {disks.map((d) => (
              <tr
                key={d.mount}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-hover)]"
              >
                <td className="px-4 py-1.5 text-[var(--color-text-secondary)]">
                  {d.filesystem}
                </td>
                <td className="px-4 py-1.5 text-[var(--color-text-secondary)]">
                  {d.mount}
                </td>
                <td className="px-4 py-1.5 text-right text-[var(--color-text-secondary)]">
                  {d.total}
                </td>
                <td className="px-4 py-1.5 text-right text-[var(--color-text-secondary)]">
                  {d.used}
                </td>
                <td className="px-4 py-1.5 text-right text-[var(--color-text-secondary)]">
                  {d.available}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          d.usagePercent > 90
                            ? "bg-[var(--color-error)]"
                            : d.usagePercent > 70
                              ? "bg-[var(--color-warning)]"
                              : "bg-[var(--color-accent)]",
                        )}
                        style={{ width: `${Math.min(d.usagePercent, 100)}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        "w-10 text-right",
                        d.usagePercent > 90
                          ? "text-[var(--color-error)]"
                          : "text-[var(--color-text-secondary)]",
                      )}
                    >
                      {d.usagePercent.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {disks.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-4 text-center text-[var(--color-text-muted)]"
                >
                  {t("monitor.noDiskData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Command Templates ──

interface CmdTemplate {
  titleKey: DictKey;
  command: string;
}

const commandTemplates: { categoryKey: DictKey; commands: CmdTemplate[] }[] = [
  {
    categoryKey: "monitor.catSystemInfo",
    commands: [
      { titleKey: "monitor.cmdOsInfo", command: "cat /etc/os-release" },
      { titleKey: "monitor.cmdKernel", command: "uname -a" },
      { titleKey: "monitor.cmdUptime", command: "uptime" },
      { titleKey: "monitor.cmdHostname", command: "hostname" },
      { titleKey: "monitor.cmdCurrentUser", command: "whoami" },
    ],
  },
  {
    categoryKey: "monitor.catNetwork",
    commands: [
      { titleKey: "monitor.cmdIpAddr", command: "ip addr show" },
      { titleKey: "monitor.cmdListenPorts", command: "ss -tlnp" },
      { titleKey: "monitor.cmdActiveConn", command: "ss -tunp" },
      { titleKey: "monitor.cmdDnsConfig", command: "cat /etc/resolv.conf" },
      { titleKey: "monitor.cmdRouteTable", command: "ip route" },
    ],
  },
  {
    categoryKey: "monitor.catDiskFiles",
    commands: [
      { titleKey: "monitor.cmdDiskUsage", command: "df -h" },
      { titleKey: "monitor.cmdDirSize", command: "du -sh *" },
      { titleKey: "monitor.cmdInodeUsage", command: "df -i" },
      { titleKey: "monitor.cmdMountPoints", command: "mount | column -t" },
      { titleKey: "monitor.cmdLargestFiles", command: "find / -type f -exec du -h {} + 2>/dev/null | sort -rh | head -20" },
    ],
  },
  {
    categoryKey: "monitor.catProcess",
    commands: [
      { titleKey: "monitor.cmdTopCpu", command: "ps aux --sort=-%cpu | head -15" },
      { titleKey: "monitor.cmdTopMemory", command: "ps aux --sort=-%mem | head -15" },
      { titleKey: "monitor.cmdProcessTree", command: "pstree -p" },
      { titleKey: "monitor.cmdOpenFiles", command: "lsof | head -50" },
    ],
  },
  {
    categoryKey: "monitor.catService",
    commands: [
      { titleKey: "monitor.cmdRunningServices", command: "systemctl list-units --type=service --state=running" },
      { titleKey: "monitor.cmdFailedServices", command: "systemctl list-units --type=service --state=failed" },
      { titleKey: "monitor.cmdRecentLogs", command: "journalctl -n 50 --no-pager" },
      { titleKey: "monitor.cmdCronJobs", command: "crontab -l 2>/dev/null; ls /etc/cron.d/" },
    ],
  },
];

function CommandTemplates() {
  const t = useT();
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleCopy = useCallback((command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      setCopiedCmd(command);
      setTimeout(() => setCopiedCmd(null), 1500);
    });
  }, []);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
          {t("monitor.commandTemplates")}
        </h3>
      </div>
      <div className="grid grid-cols-5 gap-px bg-[var(--color-border)]">
        {commandTemplates.map((group) => (
          <div key={group.categoryKey} className="bg-[var(--color-bg-surface)] p-3">
            <p className="mb-2 text-[var(--font-size-xs)] font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              {t(group.categoryKey)}
            </p>
            <div className="flex flex-col gap-1">
              {group.commands.map((cmd) => (
                <button
                  key={cmd.command}
                  onClick={() => handleCopy(cmd.command)}
                  className="group flex items-center justify-between rounded px-2 py-1 text-left text-[var(--font-size-xs)] hover:bg-[var(--color-bg-hover)] transition-colors"
                >
                  <span className="truncate text-[var(--color-text-secondary)]">
                    {t(cmd.titleKey)}
                  </span>
                  {copiedCmd === cmd.command ? (
                    <Check size={12} className="shrink-0 text-[var(--color-success)]" />
                  ) : (
                    <Copy
                      size={12}
                      className="shrink-0 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Monitor Page ──

export function MonitorPage() {
  const t = useT();
  const {
    collectorId,
    collectorState,
    snapshots,
    latest,
    timeWindow,
    startCollector,
    stopCollector,
    setTimeWindow,
  } = useMetricsStore();

  const tabs = useTerminalStore((s) => s.tabs);
  const connected = tabs.filter((t) => t.state === "connected");
  const sessionIdRef = useRef<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    initMetricsListeners();
  }, []);

  // Auto-stop collector on unmount
  useEffect(() => {
    return () => {
      stopCollector();
    };
  }, [stopCollector]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      sessionIdRef.current = sessionId;
      setSystemInfo(null);
      await startCollector(sessionId);
      // Detect remote system info
      try {
        const info = await api.systemDetect(sessionId);
        setSystemInfo(info);
      } catch {
        // Non-critical — silently ignore
      }
    },
    [startCollector],
  );

  // If no collector is running, show session picker
  if (!collectorId || collectorState === "stopped") {
    return (
      <SessionPicker
        sessionId={null}
        onSelect={handleSelectSession}
      />
    );
  }

  // Error state
  if (collectorState === "error") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <AlertCircle
            size={48}
            className="mx-auto mb-4 text-[var(--color-error)]"
          />
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("monitor.collectionFailed")}
          </p>
          <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("monitor.sessionDisconnected")}
          </p>
          <button
            onClick={() => {
              stopCollector();
            }}
            className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[var(--font-size-sm)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            {t("monitor.selectAnother")}
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!latest) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Activity
            size={32}
            className="mx-auto mb-3 animate-pulse text-[var(--color-accent)]"
          />
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("monitor.collecting")}
          </p>
        </div>
      </div>
    );
  }

  // Extract chart data arrays
  const cpuData = snapshots.map((s) => s.cpu.usagePercent);
  const memData = snapshots.map((s) => s.memory.usagePercent);
  const rxData = snapshots.map((s) => s.network.rxBytesPerSec);
  const txData = snapshots.map((s) => s.network.txBytesPerSec);

  const currentTab = connected.find(
    (t) => t.sessionId === sessionIdRef.current,
  );

  // Session health score
  const healthScore = latest.sessionHealth;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-[var(--color-accent)]" />
          <h1 className="text-[var(--font-size-lg)] font-medium text-[var(--color-text-primary)]">
            {t("monitor.title")}
          </h1>
          {currentTab && (
            <span className="rounded-full bg-[var(--color-accent-subtle)] px-2.5 py-0.5 text-[var(--font-size-xs)] text-[var(--color-accent)]">
              {currentTab.title}
            </span>
          )}
          {systemInfo && (
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {[
                systemInfo.distro
                  ? `${systemInfo.distro}${systemInfo.distroVersion ? ` ${systemInfo.distroVersion}` : ""}`
                  : systemInfo.os,
                systemInfo.kernel,
                systemInfo.shell,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {([5, 15, 60] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTimeWindow(m)}
              className={cn(
                "rounded-[var(--radius-control)] px-3 py-1 text-[var(--font-size-xs)] transition-colors",
                timeWindow === m
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]",
              )}
            >
              {m}m
            </button>
          ))}
          <button
            onClick={stopCollector}
            className="ml-2 rounded-[var(--radius-control)] bg-[var(--color-bg-elevated)] px-3 py-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {t("monitor.stop")}
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-6 gap-3">
        <OverviewCard
          icon={Clock}
          label={t("monitor.uptime")}
          value={latest.uptime}
          colorClass="text-blue-500"
          bgClass="bg-blue-500/10"
        />
        <OverviewCard
          icon={Gauge}
          label={t("monitor.load")}
          value={`${latest.load.one.toFixed(2)}`}
          subValue={`${latest.load.five.toFixed(2)} / ${latest.load.fifteen.toFixed(2)}`}
          colorClass="text-violet-500"
          bgClass="bg-violet-500/10"
        />
        <OverviewCard
          icon={Cpu}
          label={t("monitor.cpu")}
          value={`${latest.cpu.usagePercent.toFixed(1)}%`}
          colorClass="text-amber-500"
          bgClass="bg-amber-500/10"
        />
        <OverviewCard
          icon={MemoryStick}
          label={t("monitor.memory")}
          value={`${latest.memory.usedMb} / ${latest.memory.totalMb} MB`}
          subValue={`${latest.memory.usagePercent.toFixed(1)}%`}
          colorClass="text-green-500"
          bgClass="bg-green-500/10"
        />
        <OverviewCard
          icon={ArrowDown}
          label={t("monitor.network")}
          value={`${formatBytes(latest.network.rxBytesPerSec)}/s`}
          subValue={`TX ${formatBytes(latest.network.txBytesPerSec)}/s`}
          colorClass="text-cyan-500"
          bgClass="bg-cyan-500/10"
        />
        {/* Session Health Card */}
        <div
          className="glass-card flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3"
        >
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              healthScore != null ? getHealthBg(healthScore) : "bg-gray-500/10",
            )}
          >
            <Heart
              size={18}
              className={healthScore != null ? getHealthTextClass(healthScore) : "text-gray-500"}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {t("monitor.sessionHealth")}
            </p>
            <p
              className="truncate text-[var(--font-size-base)] font-medium"
              style={{
                color: healthScore != null ? getHealthColor(healthScore) : undefined,
              }}
            >
              {healthScore != null ? String(healthScore) : "--"}
            </p>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <MiniChart
            data={cpuData}
            color="#F59E0B"
            maxValue={100}
            height={100}
            label={t("monitor.cpuUsage")}
          />
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <MiniChart
            data={memData}
            color="#22C55E"
            maxValue={100}
            height={100}
            label={t("monitor.memoryUsage")}
          />
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <MiniChart
            data={rxData}
            color="#3B82F6"
            height={100}
            label={t("monitor.networkRx")}
            valueFormatter={(v) => `${formatBytes(v)}/s`}
          />
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <MiniChart
            data={txData}
            color="#06B6D4"
            height={100}
            label={t("monitor.networkTx")}
            valueFormatter={(v) => `${formatBytes(v)}/s`}
          />
        </div>
      </div>

      {/* Collapsible: Process Table */}
      <CollapsibleSection title={t("monitor.processes")} defaultOpen={true}>
        <ProcessTable processes={latest.processes} />
      </CollapsibleSection>

      {/* Collapsible: Disk Table */}
      <CollapsibleSection title={t("monitor.diskUsage")} defaultOpen={false}>
        <DiskTable disks={latest.disks} />
      </CollapsibleSection>

      {/* Collapsible: Command Templates */}
      <CollapsibleSection title={t("monitor.commandTemplates")} defaultOpen={false}>
        <CommandTemplates />
      </CollapsibleSection>
    </div>
  );
}
