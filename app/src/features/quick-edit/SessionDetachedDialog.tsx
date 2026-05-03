import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import type { QuickEditTab } from "./types";

type Props = {
  tabs: QuickEditTab[];
  onDiscardAll: () => void;
  onKeepReadonly: () => void;
};

/**
 * Aggregated confirmation when the SSH session that hosts one or more dirty
 * tabs gets disconnected. The user picks once for the whole batch:
 *
 * - Discard all  → close every listed tab and lose changes.
 * - Keep readonly → mark them as `sessionDetached` so the user can still
 *   review / copy out the draft before manually closing them.
 */
export function SessionDetachedDialog({ tabs, onDiscardAll, onKeepReadonly }: Props) {
  const t = useT();
  if (tabs.length === 0) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[8px]">
      <div className="glass-card w-full max-w-[520px] rounded-[var(--radius-popover)] border border-[var(--color-border)] p-5 shadow-[var(--shadow-modal)]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">
              {t("quickEdit.sessionClosedTitle")}
            </h3>
            <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
              {t("quickEdit.sessionClosedDesc")}
            </p>
          </div>
        </div>

        <ul className="mt-4 max-h-[200px] space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/60 px-3 py-2 text-[var(--font-size-sm)]">
          {tabs.map((tab) => (
            <li
              key={tab.id}
              className="flex items-center gap-2 text-[var(--color-text-secondary)]"
            >
              <Lock size={11} className="shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
              <span className="truncate font-mono">{tab.fileName}</span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                {tab.hostName}
              </span>
              <span className="ml-auto truncate text-[11px] text-[var(--color-text-muted)]">
                {tab.remotePath}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onDiscardAll}>
            {t("quickEdit.discardAll")}
          </Button>
          <Button variant="secondary" onClick={onKeepReadonly}>
            {t("quickEdit.keepReadonly")}
          </Button>
        </div>
      </div>
    </div>
  );
}
