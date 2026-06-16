import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { getAppVersion } from "@/lib/constants";
import { appPlatformInfo, checkUpdate as checkGitHubReleaseUpdate, openBrowser } from "@/lib/tauri";

const GITHUB_RELEASES_URL = "https://github.com/MrHan-Yd/DdShell/releases/latest";
const SLOW_NETWORK_MS = 15_000;

type TauriUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

export type OfficialUpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "readyToRestart"
  | "restarting"
  | "checkFailed"
  | "downloadFailed"
  | "installFailed"
  | "unsupported";

interface UpdateProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number | null;
}

interface UpdaterState {
  status: OfficialUpdateStatus;
  currentVersion: string;
  latestVersion: string;
  progress: UpdateProgress;
  error: string | null;
  slowNetwork: boolean;
  fallbackUrl: string;
  loadCurrentVersion: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restartApp: () => Promise<void>;
  reset: () => void;
  openFallback: () => Promise<void>;
}

const emptyProgress: UpdateProgress = {
  downloadedBytes: 0,
  totalBytes: 0,
  percent: null,
};

let pendingUpdate: TauriUpdate | null = null;
let slowNetworkTimer: ReturnType<typeof setTimeout> | null = null;

function clearSlowNetworkTimer() {
  if (slowNetworkTimer) {
    clearTimeout(slowNetworkTimer);
    slowNetworkTimer = null;
  }
}

function armSlowNetworkTimer(set: (partial: Partial<UpdaterState>) => void) {
  clearSlowNetworkTimer();
  slowNetworkTimer = setTimeout(() => {
    set({ slowNetwork: true });
  }, SLOW_NETWORK_MS);
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "unknown";
}

function isOfficialUpdaterSupported(os: string) {
  return os === "macOS" || os === "windows";
}

async function checkFallbackRelease(currentVersion: string) {
  try {
    const result = await checkGitHubReleaseUpdate(currentVersion);
    return result.hasUpdate ? result.latestVersion : "";
  } catch {
    return null;
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  currentVersion: "",
  latestVersion: "",
  progress: emptyProgress,
  error: null,
  slowNetwork: false,
  fallbackUrl: GITHUB_RELEASES_URL,

  loadCurrentVersion: async () => {
    if (get().currentVersion) return;
    const currentVersion = await getAppVersion();
    set({ currentVersion });
  },

  checkForUpdate: async () => {
    const current = get().status;
    if (current === "checking" || current === "downloading" || current === "installing" || current === "restarting") {
      return;
    }

    clearSlowNetworkTimer();
    pendingUpdate = null;
    set({ status: "checking", error: null, slowNetwork: false, progress: emptyProgress });

    try {
      const [currentVersion, platform] = await Promise.all([
        getAppVersion(),
        appPlatformInfo().catch(() => ({ os: "unknown", arch: "unknown", label: "Unknown" })),
      ]);
      set({ currentVersion });

      if (!isOfficialUpdaterSupported(platform.os)) {
        set({ status: "unsupported", latestVersion: "", error: null });
        return;
      }

      let update: TauriUpdate | null = null;
      try {
        update = await check();
      } catch (error) {
        const fallbackLatestVersion = await checkFallbackRelease(currentVersion);
        if (fallbackLatestVersion === "") {
          set({ status: "upToDate", latestVersion: "", error: null });
          return;
        }
        if (fallbackLatestVersion) {
          set({
            status: "unsupported",
            latestVersion: fallbackLatestVersion,
            error: describeError(error),
          });
          return;
        }
        throw error;
      }

      if (!update) {
        set({ status: "upToDate", latestVersion: "" });
        return;
      }

      pendingUpdate = update;
      set({
        status: "available",
        latestVersion: update.version,
        error: null,
      });
    } catch (error) {
      set({ status: "checkFailed", error: describeError(error) });
    }
  },

  downloadAndInstall: async () => {
    if (get().status === "downloading" || get().status === "installing") return;

    if (!pendingUpdate) {
      await get().checkForUpdate();
      if (!pendingUpdate) return;
    }

    let downloadedBytes = 0;
    let totalBytes = 0;
    set({ status: "downloading", progress: emptyProgress, error: null, slowNetwork: false });
    armSlowNetworkTimer(set);

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          set({
            status: "downloading",
            progress: { downloadedBytes, totalBytes, percent: null },
            slowNetwork: false,
          });
          armSlowNetworkTimer(set);
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
          set({
            status: "downloading",
            progress: { downloadedBytes, totalBytes, percent },
            slowNetwork: false,
          });
          armSlowNetworkTimer(set);
          return;
        }

        if (event.event === "Finished") {
          clearSlowNetworkTimer();
          set({ status: "installing", slowNetwork: false });
        }
      });

      clearSlowNetworkTimer();
      set({ status: "readyToRestart", slowNetwork: false, error: null });
    } catch (error) {
      clearSlowNetworkTimer();
      const status = get().status === "installing" ? "installFailed" : "downloadFailed";
      set({ status, error: describeError(error), slowNetwork: false });
    }
  },

  restartApp: async () => {
    if (get().status === "restarting") return;
    set({ status: "restarting", error: null });
    try {
      await relaunch();
    } catch (error) {
      set({ status: "installFailed", error: describeError(error) });
    }
  },

  reset: () => {
    clearSlowNetworkTimer();
    pendingUpdate = null;
    set({
      status: "idle",
      latestVersion: "",
      progress: emptyProgress,
      error: null,
      slowNetwork: false,
    });
  },

  openFallback: async () => {
    await openBrowser(get().fallbackUrl);
  },
}));
