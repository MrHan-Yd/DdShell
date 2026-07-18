import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { getAppVersion } from "@/lib/constants";
import {
  appPlatformInfo,
  checkUpdate as checkGitHubReleaseUpdate,
  downloadUpdate,
  getInstallType,
  openBrowser,
  openInstaller,
} from "@/lib/tauri";

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
  | "downloadedManualInstall"
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
  installerPath: string;
  loadCurrentVersion: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  launchInstaller: () => Promise<void>;
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
let installTypeCache: string | null = null;

async function currentInstallType(): Promise<string> {
  if (installTypeCache === null) {
    try {
      // 安装类型是打包时烙入的静态值，成功后可永久缓存；
      // 失败（如 IPC 瞬时异常）不缓存，避免把 MSI 用户永久错导向静默更新路径。
      installTypeCache = await getInstallType();
    } catch {
      return "unknown";
    }
  }
  return installTypeCache;
}

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

type StoreSet = (partial: Partial<UpdaterState>) => void;
type StoreGet = () => UpdaterState;

let msiDownloadUnlistens: UnlistenFn[] = [];

function clearMsiDownloadListeners() {
  for (const unlisten of msiDownloadUnlistens) unlisten();
  msiDownloadUnlistens = [];
}

// MSI 分支：通过后端 download_update 下载到用户下载目录（可拿到文件路径），
// 完成后停在 downloadedManualInstall 终态，等待用户点击唤起安装向导。
async function downloadMsiForManualInstall(set: StoreSet, get: StoreGet) {
  set({ status: "downloading", progress: emptyProgress, error: null, slowNetwork: false, installerPath: "" });
  armSlowNetworkTimer(set);

  try {
    const currentVersion = get().currentVersion || (await getAppVersion());
    const result = await checkGitHubReleaseUpdate(currentVersion);
    if (!result.hasUpdate || !result.targetAsset) {
      clearSlowNetworkTimer();
      set({ status: result.hasUpdate ? "downloadFailed" : "upToDate", error: result.hasUpdate ? "no_msi_asset" : null });
      return;
    }

    clearMsiDownloadListeners();
    msiDownloadUnlistens.push(
      await listen<{ downloadedBytes: number; totalBytes: number }>("update:download_progress", (event) => {
        const { downloadedBytes, totalBytes } = event.payload;
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
        set({ status: "downloading", progress: { downloadedBytes, totalBytes, percent }, slowNetwork: false });
        armSlowNetworkTimer(set);
      }),
      await listen<{ path: string }>("update:download_completed", (event) => {
        clearSlowNetworkTimer();
        clearMsiDownloadListeners();
        set({ status: "downloadedManualInstall", installerPath: event.payload.path, slowNetwork: false, error: null });
      }),
      await listen<{ error: string }>("update:download_failed", (event) => {
        clearSlowNetworkTimer();
        clearMsiDownloadListeners();
        set({ status: "downloadFailed", error: event.payload.error, slowNetwork: false });
      }),
    );

    await downloadUpdate(result.targetAsset.browserDownloadUrl, result.targetAsset.name);
  } catch (error) {
    clearSlowNetworkTimer();
    clearMsiDownloadListeners();
    set({ status: "downloadFailed", error: describeError(error), slowNetwork: false });
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
  installerPath: "",

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

    // MSI 安装的应用无法免提权静默更新（msiexec /quiet 需要管理员权限，
    // 且交互式向导才允许用户自选目录），改为：下载完成 → 用户点击唤起安装向导自行安装。
    const installType = await currentInstallType();
    // 上面的 await 让出了事件循环，快速连点可能让两次调用都通过开头的守卫，重查一次。
    if (get().status === "downloading" || get().status === "installing") return;
    if (installType === "msi") {
      await downloadMsiForManualInstall(set, get);
      return;
    }

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

  launchInstaller: async () => {
    const path = get().installerPath;
    if (!path) return;
    try {
      await openInstaller(path);
    } catch (error) {
      set({ status: "installFailed", error: describeError(error) });
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
    clearMsiDownloadListeners();
    pendingUpdate = null;
    set({
      status: "idle",
      latestVersion: "",
      progress: emptyProgress,
      error: null,
      slowNetwork: false,
      installerPath: "",
    });
  },

  openFallback: async () => {
    await openBrowser(get().fallbackUrl);
  },
}));
