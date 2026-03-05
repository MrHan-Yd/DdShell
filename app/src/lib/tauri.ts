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
  password: string,
  cols?: number,
  rows?: number,
): Promise<{ id: string }> {
  return invoke("session_connect", {
    req: { hostId, password, cols: cols ?? 120, rows: rows ?? 40 },
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
    req: { sessionId, direction, localPath, remotePath },
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
