import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirmStore } from "@/stores/confirm";
import { useT } from "@/lib/i18n";

export function ConfirmDialog() {
  const visible = useConfirmStore((s) => s.visible);
  const options = useConfirmStore((s) => s.options);
  const respond = useConfirmStore((s) => s._respond);
  const t = useT();
  const [show, setShow] = useState(false);

  // Trigger enter animation after mount
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
    }
  }, [visible]);

  // Keyboard shortcuts: Escape to cancel, Enter to confirm
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        respond(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        respond(true);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [visible, respond]);

  if (!visible || !options) return null;

  const confirmLabel = options.confirmLabel || t("confirm.ok");
  const cancelLabel = options.cancelLabel || t("confirm.cancel");

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ease-[var(--ease-smooth)]",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
        onClick={() => respond(false)}
      />

      {/* Dialog card */}
      <div
        className={cn(
          "glass-card relative z-10 w-[360px] rounded-[var(--radius-popover)] border border-[var(--color-border)] p-6 shadow-[var(--shadow-modal)]",
          "transition-all duration-[280ms] ease-[var(--ease-spring)]",
          show ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        )}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle size={20} className="shrink-0 text-[var(--color-fair)]" />
          <h3 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">
            {options.title}
          </h3>
        </div>

        {/* Description */}
        <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)] ml-8 mb-6">
          {options.description}
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => respond(false)}
            className="btn-press rounded-[var(--radius-control)] px-4 py-1.5 text-[var(--font-size-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
          >
            {cancelLabel} <kbd className="ml-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">Esc</kbd>
          </button>
          <button
            onClick={() => respond(true)}
            className="btn-press rounded-[var(--radius-control)] px-4 py-1.5 text-[var(--font-size-sm)] bg-[var(--color-error)] text-white hover:opacity-90 shadow-[var(--shadow-card)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]"
          >
            {confirmLabel} <kbd className="ml-1 text-[var(--font-size-xs)] opacity-70">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
