import { invoke } from "@tauri-apps/api/core";

export type QuickEditOpenPayload = {
  sessionId: string;
  hostId: string | null;
  hostName: string;
  remotePath: string;
};

/**
 * Open the Quick Edit window with a remote file. If the window already exists,
 * the file is added as a new tab (or the existing tab is focused). Otherwise
 * the window is created and the first file's payload is delivered via the
 * window URL to avoid a create→emit race.
 */
export async function openQuickEditWindow(payload: QuickEditOpenPayload): Promise<void> {
  return invoke("quick_edit_open", { payload });
}
