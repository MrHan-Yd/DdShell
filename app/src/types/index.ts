// Core data types aligned with API-CONTRACTS and GLOSSARY

/** Page navigation */
export type Page = "connections" | "terminal" | "sftp" | "snippets" | "macros" | "settings" | "monitor";

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

/** Snippet group (flat, one level) */
export interface SnippetGroup {
  id: string;
  name: string;
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
  groupId?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRecipeParam {
  key: string;
  label: string;
  defaultValue?: string | null;
  required: boolean;
}

export interface WorkflowRecipeStep {
  id: string;
  title: string;
  command: string;
}

export interface WorkflowGroup {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRecipe {
  id: string;
  title: string;
  description?: string | null;
  groupId?: string | null;
  paramsJson: string;
  stepsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRecipeRequest {
  title: string;
  description?: string | null;
  groupId?: string | null;
  paramsJson: string;
  stepsJson: string;
}

export interface UpdateWorkflowRecipeRequest {
  id: string;
  title?: string;
  description?: string | null;
  groupId?: string | null;
  paramsJson?: string;
  stepsJson?: string;
}

export interface WorkflowRunStepResult {
  stepId: string;
  title: string;
  command: string;
  renderedCommand: string;
  state: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface WorkflowRun {
  id: string;
  recipeId: string;
  recipeTitle: string;
  hostId: string;
  state: string;
  startedAt: string;
  finishedAt?: string | null;
  params: Record<string, string>;
  steps: WorkflowRunStepResult[];
  error?: string | null;
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
  password?: string;
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
  secretRef?: string | null;
  password?: string;
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
  speedBytesPerSec?: number | null;
  error?: string | null;
}

// ── Metrics types — TECH-SPEC §7 ──

export interface LoadInfo {
  one: number;
  five: number;
  fifteen: number;
}

export interface CpuInfo {
  usagePercent: number;
  coreCount: number;
}

export interface MemoryInfo {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  cacheMb: number;
  usagePercent: number;
}

export interface NetworkInfo {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  command: string;
}

export interface DiskInfo {
  filesystem: string;
  mount: string;
  total: string;
  used: string;
  available: string;
  usagePercent: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  uptime: string;
  serverTime: string;
  load: LoadInfo;
  cpu: CpuInfo;
  memory: MemoryInfo;
  network: NetworkInfo;
  processes: ProcessInfo[];
  disks: DiskInfo[];
  sessionHealth?: number;
}

export type CollectorState = "running" | "stopped" | "error";

/** Command history item */
export interface CommandHistoryItem {
  id: string;
  sessionId: string;
  hostId: string;
  command: string;
  createdAt: string;
}

/** Remote system info — FR-27 */
export interface SystemInfo {
  os: string;
  distro?: string | null;
  distroVersion?: string | null;
  shell?: string | null;
  kernel?: string | null;
}

// ── FR-17: Path Tools ──

export interface FavoritePath {
  id: string;
  sessionId: string;
  path: string;
  label?: string | null;
  createdAt: string;
}

export interface RecentPath {
  id: string;
  sessionId: string;
  path: string;
  accessedAt: string;
}

// ── Terminal Bookmarks ──

export interface TerminalBookmark {
  id: string;
  hostId: string;
  path: string;
  label?: string | null;
  createdAt: string;
}

// ── FR-30: Terminal Background ──

export type TerminalBgSource = "color" | "image";

export interface TerminalBgSettings {
  source: TerminalBgSource;
  color: string;
  imagePath?: string | null;
  opacity: number; // 0-100
  blur: number; // 0-20
}

// ── FR-37: Session Health ──

export type HealthLevel = "GOOD" | "FAIR" | "POOR";

// ── FR-39: SSH Config Import ──

export interface SshConfigEntry {
  host: string;
  hostName?: string | null;
  user?: string | null;
  port?: number | null;
  proxyJump?: string | null;
  identityFile?: string | null;
}

export interface SshConfigImportResult {
  entries: SshConfigEntry[];
  errors: string[];
}
