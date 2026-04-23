import { getVersion } from "@tauri-apps/api/app";

export const APP_NAME = "DdShell";

export const DEFAULT_DANGEROUS_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:",
  "shutdown",
  "poweroff",
  "reboot",
  "init 0",
  "init 6",
  "drop database",
  "truncate table",
];

export function isCommandDangerous(
  command: string,
  patterns: string[],
): boolean {
  const cmdLower = command.toLowerCase();
  return patterns.some((p) => cmdLower.includes(p.toLowerCase()));
}

let _cachedVersion = "";

export async function getAppVersion(): Promise<string> {
  if (_cachedVersion) return _cachedVersion;
  try {
    _cachedVersion = await getVersion();
  } catch {
    _cachedVersion = "0.0.0";
  }
  return _cachedVersion;
}
