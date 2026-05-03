import type { useT } from "@/lib/i18n";
import type { QuickEditRiskNotice, QuickEditSuggestedAction, RemoteTextFile } from "@/types";
import type {
  QuickEditorIndentStyle,
  QuickEditorLineEnding,
  QuickEditorStatus,
} from "../sftp/components/QuickEditor";

export const QUICK_EDIT_MAX_BYTES = 1024 * 1024;

export const DEFAULT_EDITOR_STATUS: QuickEditorStatus = {
  line: 1,
  column: 1,
  lineEnding: "LF",
  indentStyle: "unknown",
  language: "Plain Text",
};

export function getFileName(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? remotePath;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatTime(mtime: number): string {
  if (!mtime) return "-";
  return new Date(mtime * 1000).toLocaleString();
}

export function formatIndent(indentStyle: QuickEditorIndentStyle): string {
  switch (indentStyle) {
    case "tab":
      return "Tabs";
    case "spaces-2":
      return "Spaces:2";
    case "spaces-4":
      return "Spaces:4";
    default:
      return "Indent:-";
  }
}

export function formatLineEnding(lineEnding: QuickEditorLineEnding): string {
  return lineEnding === "unknown" ? "-" : lineEnding;
}

export function inferOriginalLineEnding(content: string): QuickEditorLineEnding {
  const hasCrLf = content.includes("\r\n");
  const hasLf = /(^|[^\r])\n/.test(content);
  if (hasCrLf && hasLf) return "mixed";
  if (hasCrLf) return "CRLF";
  if (hasLf) return "LF";
  return "unknown";
}

export function prepareContentForSave(draftContent: string, remoteFile: RemoteTextFile): string {
  if (inferOriginalLineEnding(remoteFile.content) !== "CRLF") return draftContent;
  return draftContent.replace(/\n/g, "\r\n");
}

const KNOWN_ERROR_CODES = [
  "FILE_NOT_TEXT",
  "FILE_TOO_LARGE",
  "FILE_READ_FAILED",
  "FILE_WRITE_FAILED",
  "FILE_ENCODING_UNSUPPORTED",
  "FILE_CHANGED_CONFLICT",
  "FILE_PERMISSION_DENIED",
  "SUDO_AUTH_FAILED",
  "SESSION_DISCONNECTED",
] as const;

export function normalizeErrorCode(error: unknown): string {
  const message = String(error ?? "");
  return KNOWN_ERROR_CODES.find((code) => message.includes(code)) ?? "UNKNOWN_ERROR";
}

type T = ReturnType<typeof useT>;

export function getErrorMessage(t: T, errorCode: string): string {
  switch (errorCode) {
    case "FILE_NOT_TEXT":
      return t("quickEdit.notText");
    case "FILE_TOO_LARGE":
      return t("quickEdit.fileTooLarge");
    case "FILE_ENCODING_UNSUPPORTED":
      return t("quickEdit.encodingUnsupported");
    case "FILE_PERMISSION_DENIED":
      return t("quickEdit.permissionDenied");
    case "SUDO_AUTH_FAILED":
      return t("quickEdit.sudoAuthFailed");
    case "FILE_CHANGED_CONFLICT":
      return t("quickEdit.conflict");
    case "SESSION_DISCONNECTED":
      return t("quickEdit.sessionDisconnected");
    case "FILE_WRITE_FAILED":
      return t("quickEdit.saveFailed");
    default:
      return t("quickEdit.loadFailed");
  }
}

export function getQuickEditSuggestedActions(remotePath: string, t: T): QuickEditSuggestedAction[] {
  const lowerPath = remotePath.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;
  const actions: QuickEditSuggestedAction[] = [];

  if (fileName === "nginx.conf" || lowerPath.includes("/nginx/")) {
    actions.push({
      id: "nginx-test",
      label: "nginx -t",
      command: "nginx -t",
      description: t("quickEdit.actionDescNginxTest"),
    });
  }

  if (fileName.endsWith(".service") || fileName.endsWith(".timer") || fileName.endsWith(".socket")) {
    actions.push({
      id: "systemd-daemon-reload",
      label: "systemctl daemon-reload",
      command: "systemctl daemon-reload",
      description: t("quickEdit.actionDescSystemdReload"),
    });
  }

  if (
    fileName === "docker-compose.yml" ||
    fileName === "docker-compose.yaml" ||
    fileName === "compose.yml" ||
    fileName === "compose.yaml"
  ) {
    actions.push({
      id: "docker-compose-config",
      label: "docker compose config",
      command: "docker compose config",
      description: t("quickEdit.actionDescDockerComposeConfig"),
    });
  }

  if (fileName === "sshd_config") {
    actions.push({
      id: "sshd-test",
      label: "sshd -t",
      command: "sshd -t",
      description: t("quickEdit.actionDescSshdTest"),
    });
  }

  return actions;
}

export function getQuickEditRiskNotice(remotePath: string, t: T): QuickEditRiskNotice | null {
  const lowerPath = remotePath.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;

  if (fileName === "sshd_config" || lowerPath.includes("/ssh/sshd_config")) {
    return {
      level: "high",
      title: t("quickEdit.riskHighTitle"),
      description: t("quickEdit.riskSshdDesc"),
    };
  }

  if (fileName === "sudoers" || lowerPath.includes("/sudoers.d/")) {
    return {
      level: "high",
      title: t("quickEdit.riskHighTitle"),
      description: t("quickEdit.riskSudoersDesc"),
    };
  }

  if (
    fileName === "nginx.conf" ||
    lowerPath.includes("/nginx/") ||
    fileName.endsWith(".service") ||
    fileName.endsWith(".timer") ||
    fileName.endsWith(".socket") ||
    fileName === "fstab"
  ) {
    return {
      level: "medium",
      title: t("quickEdit.riskMediumTitle"),
      description: t("quickEdit.riskConfigDesc"),
    };
  }

  return null;
}
