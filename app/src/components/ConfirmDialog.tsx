import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirmStore } from "@/stores/confirm";
import { useT } from "@/lib/i18n";

export function ConfirmDialog() {
  const visible = useConfirmStore((s) => s.visible);
  const options = useConfirmStore((s) => s.options);
  const respond = useConfirmStore((s) => s._respond);
  const t = useT();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (options?.scanning) return;
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
  }, [visible, respond, options?.scanning]);

  if (!visible || !options) return null;

  const confirmLabel = options.confirmLabel || t("confirm.ok");
  const cancelLabel = options.cancelLabel || t("confirm.cancel");
  const scanning = options.scanning ?? false;

  return (
    <div
      data-confirm-dialog
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ease-[var(--ease-smooth)]",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
        onClick={() => { if (!scanning) respond(false); }}
      />

      <div
        className={cn(
          "glass-card relative z-10 w-[360px] rounded-[var(--radius-popover)] border border-[var(--color-border)] p-6 shadow-[var(--shadow-modal)]",
          "transition-all duration-[280ms] ease-[var(--ease-spring)]",
          show ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        )}
      >
        <div className="flex items-center gap-3 mb-2">
          {!scanning && <AlertTriangle size={20} className="shrink-0 text-[var(--color-fair)]" />}
          {scanning && <Loader2 size={20} className="shrink-0 animate-spin text-[var(--color-accent)]" />}
          <h3 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">
            {options.title}
          </h3>
        </div>

        <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)] ml-8 mb-2 whitespace-pre-line">
          {options.description}
        </p>

        {scanning && (
          <div className="ml-8 mb-4 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {options.scanLabel || t("sftp.scanningDir")}
            </span>
            {options.scanCount !== undefined && options.scanCount > 0 && (
              <span className="text-[var(--font-size-xs)] text-[var(--color-accent)]">
                {t("sftp.scanningDirCount", { n: options.scanCount })}
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => respond(false)}
            disabled={scanning}
            className={cn(
              "btn-press rounded-[var(--radius-control)] px-4 py-1.5 text-[var(--font-size-sm)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
              scanning
                ? "text-[var(--color-text-muted)] cursor-not-allowed"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
            )}
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => respond(true)}
            disabled={scanning}
            className={cn(
              "btn-press rounded-[var(--radius-control)] px-4 py-1.5 text-[var(--font-size-sm)] shadow-[var(--shadow-card)] transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)]",
              scanning
                ? "bg-[var(--color-text-muted)] text-white cursor-not-allowed opacity-50"
                : "bg-[var(--color-error)] text-white hover:opacity-90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
