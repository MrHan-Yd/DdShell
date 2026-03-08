import { getVersion } from "@tauri-apps/api/app";

export const APP_NAME = "DdShell";

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
