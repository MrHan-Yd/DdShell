import { useEffect, useId, useState } from "react";
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
  const titleId = useId();
  const descriptionId = useId();

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
  const dialogTone = scanning
    ? "confirm-dialog--scanning"
    : confirmVariant === "danger"
      ? "confirm-dialog--danger"
      : "confirm-dialog--default";

  return (
    <div
      data-confirm-dialog
      className={cn(
        "confirm-overlay",
        show && "is-open",
      )}
    >
      <div
        className="confirm-dialog__backdrop"
        onClick={() => { if (!scanning) respond(false); }}
      />

      <div
        className={cn("confirm-dialog", dialogTone)}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="confirm-dialog__body">
          <div className="confirm-dialog__header">
            <span className="confirm-dialog__icon" aria-hidden="true">
              {!scanning && <AlertTriangle size={20} />}
              {scanning && (
                <span className="confirm-dialog__spinner" />
              )}
            </span>
            <div className="confirm-dialog__content">
              <h3 id={titleId} className="confirm-dialog__title">
                {options.title}
              </h3>
              <p id={descriptionId} className="confirm-dialog__description">
                {options.description}
              </p>
            </div>
          </div>

          {scanning && (
            <div className="confirm-dialog__scan">
              <span className="confirm-dialog__scan-spinner" />
              <span className="confirm-dialog__scan-label">
                {options.scanLabel || t("sftp.scanningDir")}
              </span>
              {options.scanCount !== undefined && options.scanCount > 0 && (
                <span className="confirm-dialog__scan-count">
                  {t("sftp.scanningDirCount", { n: options.scanCount })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="confirm-dialog__footer">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond(false)}
            disabled={scanning}
            className="confirm-dialog__button"
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={confirmVariant}
            onClick={() => respond(true)}
            disabled={scanning}
            className="confirm-dialog__button"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
