import {
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Play,
  X,
  AlertTriangle,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorkflowRun } from "@/types";

function StateIcon({ state }: { state: string }) {
  if (state === "completed") return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-success)] text-white shadow-sm animate-star-pop">
      <CheckCircle2 size={12} strokeWidth={3} />
    </div>
  );
  if (state === "failed") return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-error)] text-white shadow-sm">
      <XCircle size={12} strokeWidth={3} />
    </div>
  );
  if (state === "running") return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-sm">
      <Loader2 size={12} strokeWidth={3} className="animate-spin" />
    </div>
  );
  return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border)] shadow-sm">
      <Clock size={10} />
    </div>
  );
}

function RunStateBadge({ state }: { state: string }) {
  const t = useT();
  const label =
    state === "completed" ? t("workflows.stateCompleted") :
    state === "failed" ? t("workflows.stateFailed") :
    state === "running" ? t("workflows.runningState") :
    state;
  return (
    <div className={cn("wf-badge glass-surface shadow-sm transition-all", {
      "wf-badge--completed": state === "completed",
      "wf-badge--running": state === "running",
      "wf-badge--failed": state === "failed",
      "wf-badge--pending": state === "pending",
    })}>
      {state === "running" && <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </div>
  );
}

export function WorkflowRunPanel({
  run,
  loading,
  onClose,
}: {
  run: WorkflowRun | null;
  loading: boolean;
  onClose: () => void;
}) {
  const t = useT();

  if (loading && !run) {
    return (
      <div className="glass-card rounded-[var(--radius-card)] border border-[var(--color-border)] p-6 animate-fade-in">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-[var(--color-accent)] opacity-20 animate-ping" />
            <Loader2 size={32} className="text-[var(--color-accent)] animate-spin relative" />
          </div>
          <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)]">
            {t("workflows.runLoading")}
          </span>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="glass-card rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-8 flex flex-col items-center justify-center text-center group transition-all hover:border-[var(--color-accent)]/50">
        <div className="mb-4 h-16 w-16 rounded-2xl bg-[var(--color-bg-base)] flex items-center justify-center text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors">
          <Clock size={32} strokeWidth={1.5} className="opacity-40" />
        </div>
        <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)]">
          {t("workflows.noRunYet")}
        </p>
      </div>
    );
  }

  const startedAt = new Date(run.startedAt).toLocaleString();
  const finishedAt = run.finishedAt ? new Date(run.finishedAt).toLocaleString() : null;

  return (
    <div className="glass-card rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden shadow-[var(--shadow-floating)] animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)]">
            <Play size={16} className="text-[var(--color-accent)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[var(--font-size-base)] font-bold text-[var(--color-text-primary)]">
                {t("workflows.latestRun")}
              </span>
              <RunStateBadge state={run.state} />
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} className="flex-shrink-0 hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]">
          <X size={16} />
        </Button>
      </div>

      <div className="px-5 py-5 flex flex-col gap-6">
        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]/60 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
              {t("workflows.startedAt")}
            </p>
            <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">{startedAt}</p>
          </div>
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]/60 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-1">
              {t("workflows.finishedAt")}
            </p>
            <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {finishedAt ?? t("workflows.runningState")}
            </p>
          </div>
        </div>

        {/* Error */}
        {run.error && (
          <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-4 py-3 animate-shake">
            <div className="h-6 w-6 rounded-full bg-[var(--color-error)]/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={14} className="text-[var(--color-error)]" />
            </div>
            <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-error)] leading-relaxed">
              {run.error}
            </p>
          </div>
        )}

        {/* Steps Pipeline */}
        <div className="wf-pipeline">
          {run.steps.map((step, index) => {
            const isRunning = step.state === "running";
            const isCompleted = step.state === "completed";
            const isFailed = step.state === "failed";
            
            return (
              <div 
                key={step.stepId} 
                className={cn("wf-pipeline-step animate-list-item", isRunning && "wf-pipeline-step--active")}
                style={{ "--i": index } as React.CSSProperties}
              >
                <div className={cn("wf-pipeline-dot", {
                  "wf-pipeline-dot--completed": isCompleted,
                  "wf-pipeline-dot--running": isRunning,
                  "wf-pipeline-dot--failed": isFailed,
                })} />
                
                <div className={cn(
                  "wf-step-card glass-card rounded-[var(--radius-card)] border border-[var(--color-border)] p-4 transition-all duration-300",
                  {
                    "wf-step-card--completed": isCompleted,
                    "wf-step-card--running": isRunning,
                    "wf-step-card--failed": isFailed,
                    "opacity-50": step.state === "pending" && run.state !== "pending"
                  }
                )}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <StateIcon state={step.state} />
                      <span className={cn(
                        "text-[var(--font-size-sm)] font-bold truncate",
                        isFailed ? "text-[var(--color-error)]" : "text-[var(--color-text-primary)]"
                      )}>
                        {index + 1}. {step.title}
                      </span>
                    </div>
                    {isRunning && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-widest">
                        <span className="flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                        RUNNING
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="relative group">
                      <pre className="wf-output-block border-none bg-[var(--color-bg-base)]/80 text-[var(--color-text-secondary)] font-mono text-[11px]">
                        <span className="text-[var(--color-accent)]/50 mr-2">$</span>
                        {step.renderedCommand ?? step.command}
                      </pre>
                    </div>

                    {(step.stdout || isRunning) && (
                      <div className="animate-fade-in">
                        <div className="flex items-center gap-2 mb-1.5 ml-1">
                          <Terminal size={10} className="text-[var(--color-text-muted)]" />
                          <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--color-text-muted)]">Console Output</p>
                        </div>
                        <pre className={cn(
                          "wf-output-block wf-output-block--stdout max-h-[240px] overflow-auto scrollbar-thin border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[11px]",
                          isRunning && "border-[var(--color-accent)]/30 shadow-[inset_0_0_12px_rgba(59,130,246,0.05)]"
                        )}>
                          {step.stdout || (isRunning ? "Waiting for output..." : "")}
                        </pre>
                      </div>
                    )}

                    {step.stderr && (
                      <div className="animate-fade-in-up">
                        <div className="flex items-center gap-2 mb-1.5 ml-1">
                          <AlertTriangle size={10} className="text-[var(--color-error)]" />
                          <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--color-error)]">Error Log</p>
                        </div>
                        <pre className="wf-output-block wf-output-block--stderr max-h-[160px] overflow-auto scrollbar-thin bg-[var(--color-error)]/5 border-[var(--color-error)]/20 text-[11px]">
                          {step.stderr}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}