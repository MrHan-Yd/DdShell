import * as api from "@/lib/tauri";

export async function importTerminalBackgroundImagePath(sourcePath: string): Promise<string> {
  const trimmed = sourcePath.trim();
  if (!trimmed) return "";
  const imported = await api.terminalImportBackgroundImage(trimmed);
  return imported.path;
}

export async function migrateTerminalBackgroundImageSetting(sourcePath: string | null): Promise<string | null> {
  if (!sourcePath) return null;

  try {
    const importedPath = await importTerminalBackgroundImagePath(sourcePath);
    if (importedPath && importedPath !== sourcePath) {
      await api.settingSet("terminal.bgImagePath", importedPath);
    }
    return importedPath || sourcePath;
  } catch {
    return sourcePath;
  }
}
