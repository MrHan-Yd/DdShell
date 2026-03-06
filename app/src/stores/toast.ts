import { create } from "zustand";

export interface Toast {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = String(++nextId);
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));

    // Auto-remove: 2.5s default, errors stay until dismissed
    if (toast.type !== "error") {
      const duration = toast.duration ?? 2500;
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Shorthand helpers */
export const toast = {
  success: (message: string) => useToastStore.getState().addToast({ type: "success", message }),
  error: (message: string) => useToastStore.getState().addToast({ type: "error", message }),
  info: (message: string) => useToastStore.getState().addToast({ type: "info", message }),
  warning: (message: string) => useToastStore.getState().addToast({ type: "warning", message }),
};
