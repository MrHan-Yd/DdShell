import { useMemo } from "react";
import {
  Clock,
  Pencil,
  Terminal,
  Trash2,
  Variable,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { buildWorkflowPreviewValues, interpolateWorkflowCommand } from "@/stores/workflows";
import type { WorkflowRecipe, WorkflowRecipeParam, WorkflowRecipeStep } from "@/types";

function parseJsonArray<T>(json: string): T[] {
  try {
    const value = JSON.parse(json) as T[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function StepPipeline({
  steps,
  previewValues,
}: {
  steps: WorkflowRecipeStep[];
  previewValues: Record<string, string>;
}) {
  const t = useT();
  return (
    <div className="wf-pipeline mt-4">
      {steps.map((step, index) => {
        const preview = interpolateWorkflowCommand(step.command, previewValues);
        return (
          <div
            key={step.id}
            className="wf-pipeline-step animate-list-item"
            style={{ "--i": index } as React.CSSProperties}
          >
            <div className="wf-pipeline-dot" />
            <div className="wf-step-card glass-card rounded-[var(--radius-card)] border border-[var(--color-border)] p-4 transition-all duration-[var(--duration-base)] hover:shadow-[var(--shadow-floating)]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[11px] font-bold text-[var(--color-accent)]">
                    {index + 1}
                  </div>
                  {step.title ? (
                    <span className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)] truncate">
                      {step.title}
                    </span>
                  ) : (
                    <span className="text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                      {t("workflows.stepNumber", { n: index + 1 })}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative group">
                <pre className="whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-[var(--color-bg-base)] px-3 py-2.5 font-mono text-[var(--font-size-xs)] text-[var(--color-text-secondary)] leading-relaxed border border-[var(--color-border-subtle)]">
                  {step.command}
                </pre>
              </div>
              {preview !== step.command && preview !== "" && (
                <div className="mt-3 rounded-[var(--radius-control)] border border-dashed border-[var(--color-accent)]/30 bg-[var(--color-accent-subtle)]/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Variable size={10} className="text-[var(--color-accent)]" />
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-accent)]">
                      {t("workflows.preview")}
                    </p>
                  </div>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[var(--font-size-xs)] text-[var(--color-accent)] leading-relaxed">
                    {preview}
                  </pre>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorkflowDetail({
  recipe,
  onEdit,
  onDelete,
}: {
  recipe: WorkflowRecipe;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const params = useMemo(() => parseJsonArray<WorkflowRecipeParam>(recipe.paramsJson), [recipe.paramsJson]);
  const steps = useMemo(() => parseJsonArray<WorkflowRecipeStep>(recipe.stepsJson), [recipe.stepsJson]);
  const previewValues = useMemo(
    () => buildWorkflowPreviewValues({ title: recipe.title, description: recipe.description ?? "", groupId: recipe.groupId ?? null, params, steps }),
    [recipe.description, recipe.title, params, steps],
  );
  const stepCount = steps.length;
  const paramCount = params.length;

  return (
    <div className="animate-fade-in-up mx-auto flex w-full max-w-3xl flex-col gap-5">
      {/* Hero Header */}
      <div className="glass-card rounded-[var(--radius-card)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-subtle)]">
                <Zap size={20} className="text-[var(--color-accent)]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[var(--font-size-xl)] font-semibold text-[var(--color-text-primary)] truncate">
                  {recipe.title}
                </h2>
                <p className="mt-0.5 text-[var(--font-size-sm)] text-[var(--color-text-secondary)] line-clamp-2">
                  {recipe.description || t("workflows.noDescription")}
                </p>
              </div>
            </div>
<div className="mt-3 flex flex-wrap items-center gap-4 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
               <div className="flex items-center gap-1.5">
                 <Terminal size={12} />
                 <span>{stepCount} {t("workflows.stepsCount")}</span>
               </div>
              {paramCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <Variable size={12} />
                  <span>{paramCount} {t("workflows.params")}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Clock size={12} />
                <span>{new Date(recipe.updatedAt).toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button size="icon" variant="ghost" onClick={onEdit} title={t("workflows.editRecipe")}>
              <Pencil size={16} />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} title={t("workflows.deleteTitle")}>
              <Trash2 size={16} className="text-[var(--color-error)]" />
            </Button>
          </div>
        </div>
      </div>

      {/* Parameters */}
      {params.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Variable size={15} className="text-[var(--color-accent)]" />
            <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
              {t("workflows.params")}
            </h3>
            <span className="ml-auto text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {paramCount}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {params.map((param) => (
              <div
                key={param.key}
                className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--color-bg-base)] px-3 py-2"
              >
                <code className="text-[var(--font-size-xs)] font-mono text-[var(--color-accent)]">
                  {param.key}
                </code>
                <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">—</span>
                <span className="text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
                  {param.label}
                </span>
                {param.defaultValue && (
                  <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                    = {param.defaultValue}
                  </span>
                )}
                {param.required && (
                  <span className="ml-auto rounded-full bg-[var(--color-accent-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                    {t("workflows.required")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps Pipeline */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Terminal size={15} className="text-[var(--color-accent)]" />
          <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
            {t("workflows.steps")}
          </h3>
          <span className="ml-auto text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {stepCount} {t("workflows.stepsCount")}
          </span>
        </div>
        <StepPipeline steps={steps} previewValues={previewValues} />
      </div>
    </div>
  );
}