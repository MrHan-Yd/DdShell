// Core data types aligned with API-CONTRACTS and GLOSSARY

/** Page navigation */
export type Page = "connections" | "terminal" | "sftp" | "snippets" | "settings";

/** Auth method for SSH connection */
export type AuthType = "password" | "publickey";

/** Session state — GLOSSARY §7 */
export type SessionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

/** Transfer task state — GLOSSARY §7 */
export type TransferState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

/** Transfer direction */
export type TransferDirection = "upload" | "download";

/** Host connection config — TECH-SPEC §2 */
export interface Host {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  secretRef?: string | null;
  groupId?: string | null;
  sortOrder: number;
  isFavorite: boolean;
  lastConnectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Host group — TECH-SPEC §2 */
export interface HostGroup {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Command snippet — TECH-SPEC §2 */
export interface Snippet {
  id: string;
  title: string;
  command: string;
  description?: string | null;
  tags?: string[] | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** API error — API-CONTRACTS §1 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Create host request */
export interface CreateHostRequest {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  groupId?: string | null;
}

/** Update host request — partial patch */
export interface UpdateHostRequest {
  id: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  groupId?: string | null;
  isFavorite?: boolean;
  sortOrder?: number;
}

/** Terminal tab info */
export interface TerminalTab {
  id: string;
  sessionId: string;
  hostId: string;
  title: string;
  state: SessionState;
}

/** SFTP file entry — API-CONTRACTS §4 */
export interface FileEntry {
  name: string;
  fileType: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  permissions: number;
}

/** Transfer task — SFTP */
export interface TransferTask {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  state: TransferState;
  totalBytes: number;
  transferredBytes: number;
  error?: string | null;
}
