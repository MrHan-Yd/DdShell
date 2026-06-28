import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

function getClipboardFallback(): Clipboard | null {
  return typeof navigator !== "undefined" && navigator.clipboard
    ? navigator.clipboard
    : null;
}

export async function readClipboardText(): Promise<string> {
  try {
    return await readText();
  } catch (pluginError) {
    const fallback = getClipboardFallback();
    if (!fallback?.readText) throw pluginError;
    return fallback.readText();
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch (pluginError) {
    const fallback = getClipboardFallback();
    if (!fallback?.writeText) throw pluginError;
    await fallback.writeText(text);
  }
}
