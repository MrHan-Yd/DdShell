import { useEffect, useRef, useCallback, useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  AlertCircle,
  MoreHorizontal,
  Search,
  RotateCw,
  ArrowDownUp,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMetricsStore, initMetricsListeners } from "@/stores/metrics";
import { useTerminalStore } from "@/stores/terminal";
import { useConnectionsStore } from "@/stores/connections";
import { toast } from "@/stores/toast";
import * as api from "@/lib/tauri";
import { useT } from "@/lib/i18n";
import type { MetricsSnapshot, SystemInfo } from "@/types";

// ── Utility ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatMemGb(mb: number): string {
  return (mb / 1024).toFixed(1);
}

function extractUptimeDays(uptime: string): string {
  const m = uptime.match(/(\d+)\s*days?/);
  if (m) return m[1];
  const h = uptime.match(/(\d+):(\d+)/);
  if (h && parseInt(h[1], 10) > 0) return h[1];
  return "0";
}

function pickBadge(kind: "info" | "warn" | "ok" | "err") {
  return `mon-kpi-badge is-${kind}`;
}

// ── Sparkline (lightweight, no animation cost) ──

const Sparkline = memo(function Sparkline({
  data,
  color,
  maxValue,
}: {
  data: number[];
  color: string;
  maxValue?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55");
    grad.addColorStop(1, color + "00");

    ctx.beginPath();
    ctx.moveTo(padding, h);
    for (let i = 0; i < data.length; i++) {
      const x = padding + i * step;
      const y = h - padding - (data[i] / max) * (h - padding * 2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(padding + (data.length - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = padding + i * step;
      const y = h - padding - (data[i] / max) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [data, color, maxValue]);

  return <canvas ref={canvasRef} className="mon-kpi-spark" />;
});

// ── Large area chart (single or dual series) ──

interface ChartSeries {
  data: number[];
  color: string;
  label: string;
}

const AreaChart = memo(function AreaChart({
  series,
  maxValue,
  height = 220,
}: {
  series: ChartSeries[];
  maxValue?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const padding = 6;

    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const validSeries = series.filter((s) => s.data.length >= 2);
    if (validSeries.length === 0) return;

    const computedMax =
      maxValue ??
      Math.max(
        1,
        ...validSeries.flatMap((s) => s.data),
      );

    for (const s of validSeries) {
      const step = (w - padding * 2) / (s.data.length - 1);

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, s.color + "55");
      grad.addColorStop(1, s.color + "00");

      ctx.beginPath();
      ctx.moveTo(padding, h);
      for (let i = 0; i < s.data.length; i++) {
        const x = padding + i * step;
        const y = h - padding - (s.data[i] / computedMax) * (h - padding * 2);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(padding + (s.data.length - 1) * step, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < s.data.length; i++) {
        const x = padding + i * step;
        const y = h - padding - (s.data[i] / computedMax) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }, [series, maxValue, height]);

  return (
    <div className="mon-chart-canvas" style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
});

// ── Rolling number ──

const RollingNumber = memo(function RollingNumber({
  value,
  className,
  direction = "up",
}: {
  value: string;
  className?: string;
  direction?: "up" | "down";
}) {
  return (
    <span className={cn("inline-block overflow-hidden", className)}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: direction === "down" ? -15 : 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: direction === "down" ? 15 : -15, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
});

// ── Time window picker (5-step) ──

// UI exposes 5 options (matches design mock). Store still only persists 5/15/60
// — 360/1440 currently map to 60 (extending backend collector history is out of scope).
type UiWindow = 5 | 15 | 60 | 360 | 1440;
const UI_WINDOW_OPTIONS: { value: UiWindow; label: string }[] = [
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 360, label: "6h" },
  { value: 1440, label: "24h" },
];

function uiToStoreWindow(v: UiWindow): 5 | 15 | 60 {
  if (v === 5 || v === 15 || v === 60) return v;
  return 60;
}

const TimeWindowPicker = memo(function TimeWindowPicker({
  value,
  onChange,
}: {
  value: UiWindow;
  onChange: (v: UiWindow) => void;
}) {
  const btnRefs = useRef<Map<UiWindow, HTMLButtonElement>>(new Map());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const btn = btnRefs.current.get(value);
    if (!btn) return;
    setPill({ left: btn.offsetLeft - 2, width: btn.offsetWidth });
  }, [value]);

  return (
    <div className="mon-seg" role="tablist">
      {pill && (
        <motion.div
          className="mon-seg-pill"
          initial={false}
          animate={{ left: pill.left + 2, width: pill.width }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      )}
      {UI_WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          ref={(el) => {
            if (el) btnRefs.current.set(opt.value, el);
          }}
          onClick={() => onChange(opt.value)}
          className={cn("mon-seg-btn", value === opt.value && "is-active")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
});

// ── Session health helpers ──

// ── Session Picker ──

function SessionPicker({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const hosts = useConnectionsStore((s) => s.hosts);
  const connected = tabs.filter((t) => t.state === "connected");

  if (connected.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <span className="mon-session-pick-header-icon mx-auto mb-6">
            <Activity size={28} strokeWidth={1.8} />
          </span>
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("monitor.noActiveSessions")}
          </p>
          <div className="mt-1">
            <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              {t("monitor.connectFirst")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <span className="mon-session-pick-header-icon mx-auto mb-6">
          <Activity size={28} strokeWidth={1.8} />
        </span>
        <p className="text-[var(--font-size-base)] font-medium text-[var(--color-text-primary)]">
          {t("monitor.selectSession")}
        </p>
        <div className="mon-session-pick-grid">
          {connected.map((tab) => {
            const host = hosts.find((h) => h.id === tab.hostId);
            const meta = host
              ? `${host.username}@${host.host}:${host.port}`
              : `session · ${tab.sessionId.slice(0, 8)}`;
            return (
              <button
                key={tab.sessionId}
                onClick={() => onSelect(tab.sessionId)}
                className="mon-session-pick-card"
              >
                <span className="mon-session-pick-glyph">
                  <Server size={16} strokeWidth={1.8} />
                </span>
                <span className="mon-session-pick-info">
                  <span className="mon-session-pick-name">{tab.title}</span>
                  <span className="mon-session-pick-meta">{meta}</span>
                </span>
                <span className="mon-session-pick-status-dot" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──

interface KpiCardProps {
  label: string;
  badge?: { text: string; kind: "info" | "warn" | "ok" | "err" };
  num: string;
  unit?: string;
  meta?: string;
  sparkData: number[];
  sparkColor: string;
  sparkMax?: number;
}

const KpiCard = memo(function KpiCard({
  label,
  badge,
  num,
  unit,
  meta,
  sparkData,
  sparkColor,
  sparkMax,
}: KpiCardProps) {
  return (
    <div className="mon-kpi-card">
      <header className="mon-kpi-head">
        <span className="mon-kpi-label">{label}</span>
        {badge && <span className={pickBadge(badge.kind)}>{badge.text}</span>}
      </header>
      <div className="mon-kpi-value">
        <span className="mon-kpi-num">
          <RollingNumber value={num} />
        </span>
        {unit && <span className="mon-kpi-unit">{unit}</span>}
      </div>
      {meta && <span className="mon-kpi-meta">{meta}</span>}
      <Sparkline data={sparkData} color={sparkColor} maxValue={sparkMax} />
    </div>
  );
});

// ── Chart Card with tabs ──

type ChartTab = "cpu" | "memory" | "network" | "disk";

const ChartCard = memo(function ChartCard({
  tab,
  onTabChange,
  snapshots,
  latest,
}: {
  tab: ChartTab;
  onTabChange: (t: ChartTab) => void;
  snapshots: MetricsSnapshot[];
  latest: MetricsSnapshot;
}) {
  const t = useT();

  const tabs: { value: ChartTab; label: string }[] = [
    { value: "cpu", label: t("monitor.cpuUsage") },
    { value: "memory", label: t("monitor.memory") },
    { value: "network", label: t("monitor.networkIo") },
    { value: "disk", label: t("monitor.diskIo") },
  ];

  // legend + series per tab
  let legend: { color: string; label: string }[] = [];
  let series: ChartSeries[] = [];
  let maxValue: number | undefined;
  let unit = "";

  if (tab === "cpu") {
    legend = [{ color: "#A78BFA", label: t("monitor.legendUser") }];
    series = [
      {
        data: snapshots.map((s) => s.cpu.usagePercent),
        color: "#A78BFA",
        label: "cpu",
      },
    ];
    maxValue = 100;
    unit = "%";
  } else if (tab === "memory") {
    legend = [{ color: "#22C55E", label: t("monitor.memory") }];
    series = [
      {
        data: snapshots.map((s) => s.memory.usagePercent),
        color: "#22C55E",
        label: "mem",
      },
    ];
    maxValue = 100;
    unit = "%";
  } else if (tab === "network") {
    legend = [
      { color: "#67E8F9", label: t("monitor.legendRx") },
      { color: "#A78BFA", label: t("monitor.legendTx") },
    ];
    series = [
      {
        data: snapshots.map((s) => s.network.rxBytesPerSec),
        color: "#67E8F9",
        label: "rx",
      },
      {
        data: snapshots.map((s) => s.network.txBytesPerSec),
        color: "#A78BFA",
        label: "tx",
      },
    ];
  }

  // axis labels — first / mid / last sample timestamps if available
  const axis = useMemo(() => {
    if (snapshots.length === 0) return [];
    const fmt = (n: number) => {
      const d = new Date(snapshots[n].timestamp * 1000);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const len = snapshots.length;
    const pts = [0, Math.floor(len * 0.25), Math.floor(len * 0.5), Math.floor(len * 0.75), len - 1];
    return pts.map(fmt);
  }, [snapshots]);

  return (
    <section className="mon-chart-card">
      <header className="mon-chart-head">
        <div className="mon-chart-tabs">
          {tabs.map((tb) => (
            <button
              key={tb.value}
              onClick={() => onTabChange(tb.value)}
              className={cn("mon-chart-tab", tab === tb.value && "is-active")}
            >
              {tb.label}
            </button>
          ))}
        </div>
        {tab !== "disk" && (
          <div className="mon-chart-legend">
            {legend.map((lg) => (
              <span key={lg.label} className="lg-item">
                <span className="lg-dot" style={{ background: lg.color }} />
                {lg.label}
              </span>
            ))}
            {tab !== "network" && (
              <span className="lg-item" style={{ color: "var(--color-text-muted)" }}>
                {tab === "cpu"
                  ? `${latest.cpu.usagePercent.toFixed(1)}${unit}`
                  : `${latest.memory.usagePercent.toFixed(1)}${unit}`}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="mon-chart-body" key={tab}>
      {tab === "disk" ? (
        <div className="mon-disk-list">
          {latest.disks.length === 0 ? (
            <div className="mon-proc-empty">{t("monitor.noDiskData")}</div>
          ) : (
            latest.disks.map((d) => (
              <div key={d.mount} className="mon-disk-row">
                <span className="mon-disk-name" title={d.filesystem}>
                  {d.filesystem}
                </span>
                <span className="mon-disk-mount" title={d.mount}>
                  {d.mount}
                </span>
                <div
                  className={cn(
                    "mon-disk-bar",
                    d.usagePercent > 90 && "is-err",
                    d.usagePercent > 70 && d.usagePercent <= 90 && "is-warn",
                  )}
                >
                  <span style={{ width: `${Math.min(d.usagePercent, 100)}%` }} />
                </div>
                <span className="mon-disk-usage">
                  {d.used} / {d.total}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <AreaChart series={series} maxValue={maxValue} />
          {axis.length > 0 && (
            <footer className="mon-chart-axis">
              {axis.map((a, i) => (
                <span key={i}>{a}</span>
              ))}
            </footer>
          )}
        </>
      )}
      </div>
    </section>
  );
});

// ── Process Table ──

const ProcessTable = memo(function ProcessTable({
  processes,
}: {
  processes: MetricsSnapshot["processes"];
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [sortByCpu, setSortByCpu] = useState(true);

  const rows = useMemo(() => {
    let r = processes;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      r = r.filter(
        (p) =>
          p.command.toLowerCase().includes(q) ||
          p.user.toLowerCase().includes(q) ||
          String(p.pid).includes(q),
      );
    }
    if (sortByCpu) {
      r = [...r].sort((a, b) => b.cpuPercent - a.cpuPercent);
    }
    return r;
  }, [processes, filter, sortByCpu]);

  return (
    <section className="mon-proc-card">
      <header className="mon-proc-head">
        <h3 className="mon-proc-title">{t("monitor.processes")}</h3>
        <div className="mon-proc-actions">
          <span className="mon-proc-search">
            <Search size={12} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("monitor.filterByCommand")}
            />
          </span>
          <button
            className="mon-proc-sort"
            onClick={() => setSortByCpu((v) => !v)}
            title={t("monitor.sortByCpu")}
          >
            <ArrowDownUp size={12} />
            {t("monitor.sortByCpu")}
          </button>
        </div>
      </header>

      <div className="mon-proc-table">
        <div className="mon-proc-row is-head">
          <span>{t("monitor.pid")}</span>
          <span>{t("monitor.user")}</span>
          <span>{t("monitor.cpuPercent")}</span>
          <span>{t("monitor.memPercent")}</span>
          <span>{t("monitor.timeHeader")}</span>
          <span>{t("monitor.command")}</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <div className="mon-proc-empty">{t("monitor.noProcessData")}</div>
        ) : (
          rows.map((p) => (
            <div className="mon-proc-row" key={p.pid}>
              <span className="mon-proc-cell-mono">{p.pid}</span>
              <span>{p.user}</span>
              <span className="mon-proc-bar-cell">
                <span className="mon-proc-bar">
                  <span
                    style={{
                      width: `${Math.min(p.cpuPercent, 100)}%`,
                      background:
                        p.cpuPercent > 50
                          ? "var(--color-error)"
                          : "#A78BFA",
                    }}
                  />
                </span>
                <span className="mon-proc-bar-num">{p.cpuPercent.toFixed(1)}</span>
              </span>
              <span className="mon-proc-bar-cell">
                <span className="mon-proc-bar">
                  <span
                    style={{
                      width: `${Math.min(p.memPercent, 100)}%`,
                      background: "#67E8F9",
                    }}
                  />
                </span>
                <span className="mon-proc-bar-num">{p.memPercent.toFixed(1)}</span>
              </span>
              <span className="mon-proc-cell-mono">--</span>
              <span className="mon-proc-cell-mono" title={p.command}>
                {p.command}
              </span>
              <span style={{ textAlign: "right" }}>
                <button className="mon-proc-act-btn" aria-label="more">
                  <MoreHorizontal size={12} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
});

// ── Main Page ──

export function MonitorPage() {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    collectorId,
    collectorState,
    snapshots,
    latest,
    timeWindow,
    startCollector,
    stopCollector,
    setTimeWindow,
    loadHistory,
  } = useMetricsStore();

  const setStatusBarData = useMetricsStore((s) => s.setStatusBarData);

  const tabs = useTerminalStore((s) => s.tabs);
  const connected = tabs.filter((t) => t.state === "connected");
  const sessionIdRef = useRef<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [uiWindow, setUiWindow] = useState<UiWindow>(timeWindow);
  const [chartTab, setChartTab] = useState<ChartTab>("cpu");
  const [now, setNow] = useState(() => Date.now());

  // Tick every second to keep "last sample Xs ago" current
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync UI window → store window
  useEffect(() => {
    const mapped = uiToStoreWindow(uiWindow);
    if (mapped !== timeWindow) setTimeWindow(mapped);
  }, [uiWindow, timeWindow, setTimeWindow]);

  useEffect(() => {
    initMetricsListeners();
  }, []);

  useEffect(() => {
    if (!collectorId) return;
    void loadHistory();
  }, [collectorId, timeWindow, loadHistory]);

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
      try {
        const info = await api.systemDetect(sessionId);
        setSystemInfo(info);
      } catch {
        /* non-critical */
      }
    },
    [startCollector],
  );

  const stopCollectorRef = useRef(stopCollector);
  stopCollectorRef.current = stopCollector;
  const collectorIdRef = useRef(collectorId);
  collectorIdRef.current = collectorId;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const unlistenState = listen<{ sessionId: string; state: string }>(
      "session:state_changed",
      (event) => {
        if (collectorIdRef.current && event.payload.sessionId === sessionIdRef.current) {
          if (event.payload.state === "disconnected" || event.payload.state === "failed") {
            toast.error(tRef.current("term.disconnected"));
            void stopCollectorRef.current();
          }
        }
      },
    );
    return () => {
      unlistenState.then((fn) => fn());
    };
  }, []);

  const currentTab = connected.find((c) => c.sessionId === sessionIdRef.current);
  const hostTitle = currentTab?.title ?? null;

  // Feed statusbar data to global StatusBar
  useEffect(() => {
    if (latest && collectorState === "running") {
      setStatusBarData({ hostTitle, latest });
    } else {
      setStatusBarData(null);
    }
    return () => setStatusBarData(null);
  }, [latest, collectorState, hostTitle, setStatusBarData]);

  if (!collectorId || collectorState === "stopped") {
    return <SessionPicker onSelect={handleSelectSession} />;
  }

  if (collectorState === "error") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-[var(--color-error)]" />
          <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
            {t("monitor.collectionFailed")}
          </p>
          <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("monitor.sessionDisconnected")}
          </p>
          <button
            onClick={() => stopCollector()}
            className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[var(--font-size-sm)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            {t("monitor.selectAnother")}
          </button>
        </div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Activity size={32} className="mx-auto mb-3 animate-pulse text-[var(--color-accent)]" />
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("monitor.collecting")}
          </p>
        </div>
      </div>
    );
  }

  // ── Derive sparkline data ──
  const cpuData = snapshots.map((s) => s.cpu.usagePercent);
  const memData = snapshots.map((s) => s.memory.usagePercent);
  const rxData = snapshots.map((s) => s.network.rxBytesPerSec);
  const loadData = snapshots.map((s) => s.load.one);

  // ── Derive subtitle ──
  const lastAgoSec = Math.max(0, Math.floor(now / 1000 - latest.timestamp));
  const distroLine = systemInfo
    ? [
        systemInfo.distro
          ? `${systemInfo.distro}${systemInfo.distroVersion ? ` ${systemInfo.distroVersion}` : ""}`
          : systemInfo.os,
        systemInfo.kernel,
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const uptimeDays = extractUptimeDays(latest.uptime);

  // ── KPI badges ──
  const cpuBadge = {
    text: t("monitor.coresShort", { n: latest.cpu.coreCount }),
    kind: "info" as const,
  };
  const memBadge =
    latest.memory.usagePercent > 85
      ? { text: t("monitor.warning"), kind: "warn" as const }
      : latest.memory.usagePercent > 60
        ? { text: t("monitor.healthy"), kind: "ok" as const }
        : { text: t("monitor.healthy"), kind: "ok" as const };
  const netBadge = { text: t("monitor.rxTx"), kind: "info" as const };
  const loadBadge =
    latest.cpu.coreCount > 0 && latest.load.one / latest.cpu.coreCount > 1
      ? { text: t("monitor.warning"), kind: "warn" as const }
      : { text: t("monitor.healthy"), kind: "ok" as const };

  // ── KPI primary number ──
  const cpuNum = latest.cpu.usagePercent.toFixed(0);
  const memNum = formatMemGb(latest.memory.usedMb);
  const memUnit = `/ ${formatMemGb(latest.memory.totalMb)} GB`;
  const netNum = formatBytes(latest.network.rxBytesPerSec + latest.network.txBytesPerSec);
  const netUnit = "/s";
  const loadNum = latest.load.one.toFixed(2);
  const loadUnit = `/ ${latest.load.five.toFixed(2)} / ${latest.load.fifteen.toFixed(2)}`;

  return (
    <div className="mon-page">
      <div ref={scrollRef} className="mon-scroll">
        <div className="mon-body">
          {/* ── Header ── */}
          <header className="mon-header">
            <div>
              <h1 className="mon-title">
                <Activity size={18} className="text-[var(--color-accent)]" />
                {t("monitor.title")}
                {hostTitle && (
                  <span className="rounded-full bg-[var(--color-accent-subtle)] px-2.5 py-0.5 text-[var(--font-size-xs)] text-[var(--color-accent)]">
                    {hostTitle}
                  </span>
                )}
              </h1>
              <div className="mon-subtitle">
                {distroLine && <span>{distroLine}</span>}
                {distroLine && <span>·</span>}
                <span>
                  {t("monitor.uptimeDays", { n: uptimeDays })}
                </span>
                <span>·</span>
                <span>{t("monitor.lastSampleAgo", { n: lastAgoSec })}</span>
              </div>
            </div>
            <div className="mon-actions">
              <TimeWindowPicker value={uiWindow} onChange={setUiWindow} />
              <button className="mon-btn-auto is-on" title="Auto refresh">
                <RotateCw size={12} />
                {t("monitor.autoBadge", { n: 2 })}
              </button>
              <button
                onClick={() => stopCollector()}
                className="rounded-[var(--radius-control)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)]"
              >
                {t("monitor.stop")}
              </button>
            </div>
          </header>

          {/* ── KPI grid ── */}
          <div className="mon-kpi-grid">
            <KpiCard
              label={t("monitor.cpu")}
              badge={cpuBadge}
              num={cpuNum}
              unit="%"
              meta={t("monitor.load1Cores", { load1: latest.load.one.toFixed(2), cores: latest.cpu.coreCount })}
              sparkData={cpuData}
              sparkColor="#A78BFA"
              sparkMax={100}
            />
            <KpiCard
              label={t("monitor.memory")}
              badge={memBadge}
              num={memNum}
              unit={memUnit}
              meta={t("monitor.memUsed", { n: latest.memory.usagePercent.toFixed(0), cache: formatMemGb(latest.memory.cacheMb) })}
              sparkData={memData}
              sparkColor="#FBBF24"
              sparkMax={100}
            />
            <KpiCard
              label={t("monitor.network")}
              badge={netBadge}
              num={netNum}
              unit={netUnit}
              meta={t("monitor.netRate", { rx: formatRate(latest.network.rxBytesPerSec), tx: formatRate(latest.network.txBytesPerSec) })}
              sparkData={rxData}
              sparkColor="#67E8F9"
            />
            <KpiCard
              label={t("monitor.loadAvg")}
              badge={loadBadge}
              num={loadNum}
              unit={loadUnit}
              meta={t("monitor.loadPeriods")}
              sparkData={loadData}
              sparkColor="#4ADE80"
            />
          </div>

          {/* ── Chart card ── */}
          <ChartCard
            tab={chartTab}
            onTabChange={setChartTab}
            snapshots={snapshots}
            latest={latest}
          />

          {/* ── Process table ── */}
          <ProcessTable processes={latest.processes} />
        </div>
      </div>
    </div>
  );
}
