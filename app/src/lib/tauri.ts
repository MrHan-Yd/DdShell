import { invoke } from "@tauri-apps/api/core";
import type {
  Host,
  HostGroup,
  Snippet,
  CreateHostRequest,
  UpdateHostRequest,
  FileEntry,
  TransferTask,
  TransferDirection,
  MetricsSnapshot,
  CommandHistoryItem,
  SystemInfo,
  FavoritePath,
  RecentPath,
  SshConfigImportResult,
} from "@/types";

// ── Connection commands ──

export async function connectionCreate(req: CreateHostRequest): Promise<{ id: string }> {
  return invoke("connection_create", { req });
}

export async function connectionUpdate(req: UpdateHostRequest): Promise<{ success: boolean }> {
  return invoke("connection_update", { req });
}

export async function connectionDelete(id: string): Promise<{ success: boolean }> {
  return invoke("connection_delete", { id });
}

export async function connectionList(): Promise<Host[]> {
  return invoke("connection_list");
}

export async function connectionGet(id: string): Promise<Host> {
  return invoke("connection_get", { id });
}

// ── Group commands ──

export async function groupCreate(name: string, parentId?: string | null): Promise<{ id: string }> {
  return invoke("group_create", { name, parentId: parentId ?? null });
}

export async function groupUpdate(id: string, name: string): Promise<{ success: boolean }> {
  return invoke("group_update", { id, name });
}

export async function groupDelete(id: string): Promise<{ success: boolean }> {
  return invoke("group_delete", { id });
}

export async function groupList(): Promise<HostGroup[]> {
  return invoke("group_list");
}

// ── Snippet commands ──

export async function snippetCreate(
  title: string,
  command: string,
  description?: string | null,
  tags?: string[] | null,
): Promise<{ id: string }> {
  return invoke("snippet_create", { title, command, description: description ?? null, tags: tags ?? null });
}

export async function snippetUpdate(
  id: string,
  title?: string,
  command?: string,
  description?: string | null,
  tags?: string[] | null,
): Promise<{ success: boolean }> {
  return invoke("snippet_update", { id, title, command, description, tags });
}

export async function snippetDelete(id: string): Promise<{ success: boolean }> {
  return invoke("snippet_delete", { id });
}

export async function snippetList(): Promise<Snippet[]> {
  return invoke("snippet_list");
}

// ── Settings commands ──

export async function settingGet(key: string): Promise<string | null> {
  return invoke("setting_get", { key });
}

export async function settingSet(key: string, value: string): Promise<{ success: boolean }> {
  return invoke("setting_set", { key, value });
}

// ── Health check ──

export async function appHealth(): Promise<{ status: string; message: string }> {
  return invoke("app_health");
}

// ── Session commands ──

export async function sessionConnect(
  hostId: string,
  password?: string,
  cols?: number,
  rows?: number,
): Promise<{ id: string }> {
  return invoke("session_connect", {
    req: { hostId, password: password || null, cols: cols ?? 120, rows: rows ?? 40 },
  });
}

export async function sessionDisconnect(sessionId: string): Promise<{ success: boolean }> {
  return invoke("session_disconnect", { sessionId });
}

export async function sessionWrite(sessionId: string, data: number[]): Promise<{ success: boolean }> {
  return invoke("session_write", { sessionId, data });
}

export async function sessionResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<{ success: boolean }> {
  return invoke("session_resize", { sessionId, cols, rows });
}

// ── SFTP commands ──

export async function sftpListDir(sessionId: string, remotePath: string): Promise<FileEntry[]> {
  return invoke("sftp_list_dir", { sessionId, remotePath });
}

export async function sftpMkdir(sessionId: string, remotePath: string): Promise<{ success: boolean }> {
  return invoke("sftp_mkdir", { sessionId, remotePath });
}

export async function sftpRemove(
  sessionId: string,
  remotePath: string,
  isDir: boolean,
): Promise<{ success: boolean }> {
  return invoke("sftp_remove", { sessionId, remotePath, isDir });
}

export async function sftpRename(
  sessionId: string,
  oldPath: string,
  newPath: string,
): Promise<{ success: boolean }> {
  return invoke("sftp_rename", { sessionId, oldPath, newPath });
}

export async function sftpTransferStart(
  sessionId: string,
  direction: TransferDirection,
  localPath: string,
  remotePath: string,
): Promise<{ id: string }> {
  return invoke("sftp_transfer_start", {
    sessionId,
    direction,
    localPath,
    remotePath,
  });
}

export async function sftpTransferCancel(taskId: string): Promise<{ success: boolean }> {
  return invoke("sftp_transfer_cancel", { taskId });
}

export async function sftpTransferList(): Promise<TransferTask[]> {
  return invoke("sftp_transfer_list");
}

export async function sftpTransferClear(): Promise<{ success: boolean }> {
  return invoke("sftp_transfer_clear");
}

export async function sftpUploadFiles(
  sessionId: string,
  localPaths: string[],
  remoteDir: string,
): Promise<string[]> {
  return invoke("sftp_upload_files", { sessionId, localPaths, remoteDir });
}

// ── Connection test ──

export async function connectionTest(
  hostId: string,
): Promise<{ success: boolean; message: string; latencyMs: number | null }> {
  return invoke("connection_test", { hostId });
}

// ── Password commands ──

export async function passwordDecrypt(encrypted: string): Promise<string> {
  return invoke("password_decrypt", { encrypted });
}

// ── Metrics commands ──

export async function metricsStart(
  sessionId: string,
  intervalSecs?: number,
): Promise<{ id: string }> {
  return invoke("metrics_start", { sessionId, intervalSecs: intervalSecs ?? 2 });
}

export async function metricsStop(collectorId: string): Promise<{ success: boolean }> {
  return invoke("metrics_stop", { collectorId });
}

export async function metricsSnapshot(collectorId: string): Promise<MetricsSnapshot | null> {
  return invoke("metrics_snapshot", { collectorId });
}

export async function metricsHistory(collectorId: string): Promise<MetricsSnapshot[]> {
  return invoke("metrics_history", { collectorId });
}

// ── Command history commands ──

export async function commandHistoryInsert(
  sessionId: string,
  hostId: string,
  command: string,
): Promise<{ id: string }> {
  return invoke("command_history_insert", { sessionId, hostId, command });
}

export async function commandHistoryList(
  hostId?: string | null,
  query?: string | null,
  limit?: number,
): Promise<CommandHistoryItem[]> {
  return invoke("command_history_list", {
    hostId: hostId ?? null,
    query: query ?? null,
    limit: limit ?? 200,
  });
}

export async function commandHistoryClear(hostId?: string | null): Promise<{ success: boolean }> {
  return invoke("command_history_clear", { hostId: hostId ?? null });
}

// ── System detection ──

export async function systemDetect(sessionId: string): Promise<SystemInfo> {
  return invoke("system_detect", { sessionId });
}

// ── Local filesystem ──

export interface LocalFileEntry {
  name: string;
  fileType: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
}

export async function localListDir(path: string): Promise<LocalFileEntry[]> {
  return invoke("local_list_dir", { path });
}

export async function localHomeDir(): Promise<string> {
  return invoke("local_home_dir");
}

// ── FR-17: Path Tools ──

export async function pathAddFavorite(sessionId: string, path: string, label?: string): Promise<{ id: string }> {
  return invoke("path_add_favorite", { sessionId, path, label: label ?? null });
}

export async function pathRemoveFavorite(id: string): Promise<{ success: boolean }> {
  return invoke("path_remove_favorite", { id });
}

export async function pathListFavorites(sessionId: string): Promise<FavoritePath[]> {
  return invoke("path_list_favorites", { sessionId });
}

export async function pathListRecent(sessionId: string, limit?: number): Promise<RecentPath[]> {
  return invoke("path_list_recent", { sessionId, limit: limit ?? 20 });
}

export async function pathAddRecent(sessionId: string, path: string): Promise<{ id: string }> {
  return invoke("path_add_recent", { sessionId, path });
}

// ── SSH Config Import ──

export async function sshConfigImport(): Promise<SshConfigImportResult> {
  return invoke("ssh_config_import");
}

// ── System Fonts ──

export async function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts");
}

// ── Update check & download ──

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  assets: { name: string; browserDownloadUrl: string; size: number }[];
  error: string | null;
}

export async function checkUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  return invoke("check_update", { currentVersion });
}

export async function downloadUpdate(url: string, filename: string): Promise<string> {
  return invoke("download_update", { url, filename });
}

// ── Install type detection ──

export async function getInstallType(): Promise<string> {
  return invoke("get_install_type");
}

// ── Open browser ──

export async function openBrowser(url: string): Promise<void> {
  return invoke("open_browser", { url });
}
