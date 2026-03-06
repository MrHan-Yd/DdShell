import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { MetricsSnapshot, CollectorState } from "@/types";
import * as api from "@/lib/tauri";

interface MetricsStore {
  collectorId: string | null;
  collectorState: CollectorState | null;
  snapshots: MetricsSnapshot[];
  latest: MetricsSnapshot | null;
  timeWindow: 5 | 15 | 60; // minutes

  startCollector: (sessionId: string) => Promise<void>;
  stopCollector: () => Promise<void>;
  setTimeWindow: (minutes: 5 | 15 | 60) => void;
  loadHistory: () => Promise<void>;
}

export const useMetricsStore = create<MetricsStore>((set, get) => ({
  collectorId: null,
  collectorState: null,
  snapshots: [],
  latest: null,
  timeWindow: 5,

  startCollector: async (sessionId) => {
    const { collectorId: existingId } = get();
    if (existingId) {
      // Already running
      return;
    }

    try {
      const result = await api.metricsStart(sessionId, 2);
      set({ collectorId: result.id, collectorState: "running", snapshots: [] });
    } catch (e) {
      console.error("Failed to start metrics collector:", e);
    }
  },

  stopCollector: async () => {
    const { collectorId } = get();
    if (!collectorId) return;

    try {
      await api.metricsStop(collectorId);
    } catch {
      // ignore
    }
    set({ collectorId: null, collectorState: "stopped" });
  },

  setTimeWindow: (minutes) => {
    set({ timeWindow: minutes });
  },

  loadHistory: async () => {
    const { collectorId } = get();
    if (!collectorId) return;

    try {
      const history = await api.metricsHistory(collectorId);
      set({ snapshots: history, latest: history[history.length - 1] ?? null });
    } catch {
      // ignore
    }
  },
}));

// ── Event listeners ──

let initialized = false;

export function initMetricsListeners() {
  if (initialized) return;
  initialized = true;

  listen<{ collectorId: string; snapshot: MetricsSnapshot }>(
    "metrics:updated",
    (event) => {
      const state = useMetricsStore.getState();
      if (event.payload.collectorId === state.collectorId) {
        const snapshot = event.payload.snapshot;
        const maxEntries = state.timeWindow * 30; // 2s interval
        const newSnapshots = [...state.snapshots, snapshot];
        if (newSnapshots.length > maxEntries) {
          newSnapshots.splice(0, newSnapshots.length - maxEntries);
        }
        useMetricsStore.setState({ snapshots: newSnapshots, latest: snapshot });
      }
    },
  );

  listen<{ collectorId: string; state: string }>(
    "metrics:collector_state_changed",
    (event) => {
      const currentState = useMetricsStore.getState();
      if (event.payload.collectorId === currentState.collectorId) {
        useMetricsStore.setState({
          collectorState: event.payload.state as CollectorState,
        });
      }
    },
  );
}
