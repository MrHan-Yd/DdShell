import { create } from "zustand";
import * as api from "@/lib/tauri";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState {
  visible: boolean;
  options: ConfirmOptions | null;
  _resolve: ((value: boolean) => void) | null;
  _show: (options: ConfirmOptions) => Promise<boolean>;
  _respond: (value: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  visible: false,
  options: null,
  _resolve: null,

  _show: (options) => {
    // Cancel any previous unresolved dialog
    const prev = get()._resolve;
    if (prev) prev(false);

    return new Promise<boolean>((resolve) => {
      set({ visible: true, options, _resolve: resolve });
    });
  },

  _respond: (value) => {
    const resolve = get()._resolve;
    if (resolve) resolve(value);
    set({ visible: false, options: null, _resolve: null });
  },
}));

/**
 * Async confirm function.
 * Reads `confirmDangerousActions` setting:
 * - "false" → skip dialog, return true immediately
 * - otherwise → show modal, return user choice
 */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  try {
    const val = await api.settingGet("confirmDangerousActions");
    if (val === "false") return true;
  } catch {
    // If setting read fails, show dialog as a safe default
  }
  return useConfirmStore.getState()._show(options);
}
