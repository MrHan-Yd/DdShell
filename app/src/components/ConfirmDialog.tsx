import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirmStore } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/themed/Button";

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
  const confirmVariant = options.confirmVariant || "danger";
  const scanning = options.scanning ?? false;
  const toneColor = scanning
    ? "var(--color-accent)"
    : confirmVariant === "danger"
      ? "var(--color-error)"
      : "var(--color-fair)";

  return (
    <div
      data-confirm-dialog
      className={cn(
        "confirm-overlay fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ease-[var(--ease-smooth)]",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-[6px] transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
        onClick={() => { if (!scanning) respond(false); }}
      />

      <div
        className={cn(
          "relative z-10 w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-[calc(var(--radius-popover)+2px)] border border-[var(--color-border)] bg-[var(--surface-card)] shadow-[var(--shadow-modal)] backdrop-blur-[24px] saturate-[1.6]",
          "transition-all duration-[280ms] ease-[var(--ease-spring)]",
          show ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border"
              style={{
                color: toneColor,
                borderColor: `color-mix(in srgb, ${toneColor} 28%, transparent)`,
                background: `color-mix(in srgb, ${toneColor} 12%, transparent)`,
              }}
            >
              {!scanning && <AlertTriangle size={20} />}
              {scanning && (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="text-[var(--font-size-base)] font-semibold leading-6 text-[var(--color-text-primary)]">
                {options.title}
              </h3>
              <p className="mt-1 text-[var(--font-size-sm)] leading-5 text-[var(--color-text-secondary)] whitespace-pre-line">
                {options.description}
              </p>
            </div>
          </div>

          {scanning && (
            <div className="ml-[52px] mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-2">
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
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
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg-base)_42%,transparent)] px-5 py-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond(false)}
            disabled={scanning}
            className="min-w-[72px]"
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={confirmVariant}
            onClick={() => respond(true)}
            disabled={scanning}
            className="min-w-[72px]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
