import { useEffect, useState } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore, type Toast } from "@/stores/toast";

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const iconColors = {
  success: "text-[var(--color-good)]",
  error: "text-[var(--color-poor)]",
  info: "text-[var(--color-accent)]",
  warning: "text-[var(--color-fair)]",
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);
  const Icon = icons[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={cn(
        "glass-card flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] px-4 py-3 transition-all duration-200 ease-[var(--ease-smooth)]",
        visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0",
      )}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", iconColors[toast.type])} />
      <p className="flex-1 text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
        {toast.message}
      </p>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded p-0.5 hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <X size={12} className="text-[var(--color-text-muted)]" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
