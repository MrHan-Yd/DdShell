import { basename, dirname, downloadDir, join } from "@tauri-apps/api/path";
import type { DictKey } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import { useConfirmStore } from "@/stores/confirm";

export type UploadTask = {
  localPaths: string[];
  remoteDir: string;
};

export type SftpTranslate = (
  key: DictKey,
  params?: Record<string, string | number>,
) => string;

const OVERWRITE_PREVIEW_LIMIT = 5;

export function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

export function joinRemotePath(dir: string, name: string): string {
  if (dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function getRemoteDirPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}

export async function collectExistingRemoteUploadTargets(
  sessionId: string,
  uploadTasks: UploadTask[],
): Promise<string[]> {
  const namesByRemoteDir = new Map<string, Set<string>>();

  for (const task of uploadTasks) {
    const fileNames = namesByRemoteDir.get(task.remoteDir) ?? new Set<string>();
    for (const localPath of task.localPaths) {
      const fileName = getPathName(localPath);
      if (fileName) fileNames.add(fileName);
    }
    namesByRemoteDir.set(task.remoteDir, fileNames);
  }

  const duplicateLists = await Promise.all(
    Array.from(namesByRemoteDir.entries()).map(async ([remoteDir, fileNames]) => {
      try {
        const entries = await api.sftpListDir(sessionId, remoteDir);
        const existingNames = new Set(entries.map((entry) => entry.name));
        return Array.from(fileNames)
          .filter((fileName) => existingNames.has(fileName))
          .map((fileName) => joinRemotePath(remoteDir, fileName));
      } catch {
        return [];
      }
    }),
  );

  return Array.from(new Set(duplicateLists.flat())).sort((a, b) => a.localeCompare(b));
}

export async function resolveDownloadBaseDir(): Promise<string> {
  const configuredPath = await api.settingGet("transfer.downloadPath");
  if (configuredPath?.trim()) return configuredPath.trim();

  try {
    return await downloadDir();
  } catch {
    const homeDir = await api.localHomeDir();
    return join(homeDir, "Downloads");
  }
}

export async function resolveDownloadTargetPath(
  baseDir: string,
  remotePath: string,
  subPath?: string,
): Promise<string> {
  if (subPath?.trim()) return join(baseDir, subPath);
  return join(baseDir, getPathName(remotePath) || "download");
}

export async function collectExistingLocalTargets(paths: string[]): Promise<string[]> {
  const uniquePaths = Array.from(new Set(paths));
  const targetInfo = await Promise.all(
    uniquePaths.map(async (targetPath) => ({
      targetPath,
      parentDir: await dirname(targetPath),
      fileName: await basename(targetPath),
    })),
  );

  const targetsByParent = new Map<string, Map<string, string>>();
  for (const target of targetInfo) {
    const filesInParent = targetsByParent.get(target.parentDir) ?? new Map<string, string>();
    filesInParent.set(target.fileName, target.targetPath);
    targetsByParent.set(target.parentDir, filesInParent);
  }

  const duplicateLists = await Promise.all(
    Array.from(targetsByParent.entries()).map(async ([parentDir, files]) => {
      try {
        const entries = await api.localListDir(parentDir);
        const existingNames = new Set(entries.map((entry) => entry.name));
        return Array.from(files.entries())
          .filter(([fileName]) => existingNames.has(fileName))
          .map(([, targetPath]) => targetPath);
      } catch {
        return [];
      }
    }),
  );

  return Array.from(new Set(duplicateLists.flat())).sort((a, b) => a.localeCompare(b));
}

export async function confirmOverwritePaths(
  t: SftpTranslate,
  direction: "upload" | "download",
  loadPaths: () => Promise<string[]>,
): Promise<boolean> {
  const confirmResult = useConfirmStore.getState()._show({
    title: t("confirm.overwriteTitle"),
    description: t("confirm.overwriteChecking"),
    confirmLabel: t("confirm.overwriteAction"),
    cancelLabel: t("confirm.cancel"),
    scanning: true,
  });
  const confirmResolve = useConfirmStore.getState()._resolve;

  let paths: string[];
  try {
    paths = await loadPaths();
  } catch (error) {
    if (useConfirmStore.getState()._resolve === confirmResolve) {
      useConfirmStore.getState()._respond(true);
    }
    console.warn("overwrite pre-check failed, continuing transfer", error);
    return true;
  }

  if (paths.length === 0) {
    if (useConfirmStore.getState()._resolve === confirmResolve) {
      useConfirmStore.getState()._respond(true);
    }
    return true;
  }

  const preview = paths
    .slice(0, OVERWRITE_PREVIEW_LIMIT)
    .map((path) => `- ${path}`)
    .join("\n");
  const moreCount = paths.length - OVERWRITE_PREVIEW_LIMIT;
  const intro =
    direction === "upload"
      ? t("confirm.overwriteUploadDesc", { n: paths.length })
      : t("confirm.overwriteDownloadDesc", { n: paths.length });
  const moreLine = moreCount > 0 ? `\n${t("confirm.overwriteMore", { n: moreCount })}` : "";

  if (useConfirmStore.getState()._resolve !== confirmResolve) {
    return confirmResult;
  }

  useConfirmStore.getState().updateOptions({
    scanning: false,
    description: `${intro}\n\n${preview}${moreLine}`,
  });

  return confirmResult;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatTime(mtime: number): string {
  if (mtime === 0) return "-";
  return new Date(mtime * 1000).toLocaleString();
}

export function formatPermissions(mode: number, fileType: string): string {
  const typeChar = fileType === "dir" ? "d" : fileType === "symlink" ? "l" : "-";
  const owner = (mode >> 6) & 7;
  const group = (mode >> 3) & 7;
  const other = mode & 7;
  const rwx = (bits: number) => `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${bits & 1 ? "x" : "-"}`;
  return `${typeChar}${rwx(owner)}${rwx(group)}${rwx(other)}`;
}

export async function scanLocalDir(
  dirPath: string,
  relativeBase: string,
): Promise<{ local: string; relative: string; isDir: boolean }[]> {
  const result: { local: string; relative: string; isDir: boolean }[] = [];
  try {
    const entries = await api.localListDir(dirPath);
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      if (entry.fileType === "dir") {
        result.push({ local: fullPath, relative: relativePath, isDir: true });
        const subFiles = await scanLocalDir(fullPath, relativePath);
        result.push(...subFiles);
      } else {
        result.push({ local: fullPath, relative: relativePath, isDir: false });
      }
    }
  } catch (error) {
    console.error("Error scanning directory:", dirPath, error);
  }
  return result;
}
