import { useMemo } from "react";
import { Pencil, Terminal, Trash2, Variable } from "lucide-react";
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
    <ol className="wf-steps workflow-steps-timeline mt-4">
      {steps.map((step, index) => {
        const preview = interpolateWorkflowCommand(step.command, previewValues);
        return (
          <li
            key={step.id}
            className="wf-step workflow-detail-step animate-list-item"
            style={{ "--i": index } as React.CSSProperties}
          >
            <span className="wf-step-handle" aria-hidden="true" />
            <span className="wf-step-num">{index + 1}</span>
            <div className="wf-step-body min-w-0">
              <header className="wf-step-head flex items-center gap-2 mb-2">
                {step.title ? (
                  <span className="wf-step-name text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)] truncate">
                    {step.title}
                  </span>
                ) : (
                  <span className="wf-step-name text-[var(--font-size-sm)] font-medium text-[var(--color-text-muted)]">
                    {t("workflows.stepNumber", { n: index + 1 })}
                  </span>
                )}
              </header>
              <div className="relative group">
                <pre className="wf-step-cmd">
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
          </li>
        );
      })}
    </ol>
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
    <div className="workflow-detail-content animate-fade-in-up mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="workflow-detail-head wf-detail-head flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="wf-title truncate text-[24px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">
            {recipe.title}
          </h2>
          <p className="wf-desc mt-2 max-w-3xl text-[var(--font-size-sm)] leading-relaxed text-[var(--color-text-secondary)]">
            {recipe.description || t("workflows.noDescription")}
          </p>
        </div>
        <div className="wf-detail-actions flex flex-shrink-0 items-center gap-2">
          <Button size="sm" className="workflow-action-button workflow-detail-primary-action" onClick={onEdit} title={t("workflows.editRecipe")}>
            <Pencil size={13} />
            {t("workflows.editRecipe")}
          </Button>
          <Button size="sm" variant="ghost" className="workflow-action-button workflow-detail-quiet-action" onClick={onDelete} title={t("workflows.deleteTitle")}>
            <Trash2 size={13} />
            {t("workflows.deleteTitle")}
          </Button>
        </div>
      </header>

      {/* Parameters */}
      {params.length > 0 && (
        <section className="workflow-section wf-section">
          <div className="wf-section-head flex items-center justify-between mb-3">
            <h3 className="section-title text-[var(--font-size-xs)] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
              {t("workflows.params")}
            </h3>
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {paramCount} {t("workflows.params")}
            </span>
          </div>
          <div className="wf-input-grid">
            {params.map((param) => {
              const meta = [
                param.required ? t("workflows.required") : null,
                param.secret ? t("workflows.secretParam") : null,
              ].filter(Boolean);

              return (
                <div key={param.key} className="wf-input-row workflow-param-row">
                  <code className="var-key mono">
                    {`{{${param.key}}}`}
                  </code>
                  <span className={param.defaultValue ? "var-default" : "var-default var-default-empty"}>
                    {param.defaultValue || "—"}
                  </span>
                  <span className="var-desc">
                    {meta.join(" · ")}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Steps Pipeline */}
      <section className="workflow-section wf-section">
        <div className="wf-section-head flex items-center gap-2 mb-1">
          <Terminal size={15} className="text-[var(--color-accent)]" />
          <h3 className="section-title text-[var(--font-size-xs)] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium">
            {t("workflows.steps")}
          </h3>
          <span className="ml-auto text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {stepCount} {t("workflows.stepsCount")}
          </span>
        </div>
        <StepPipeline steps={steps} previewValues={previewValues} />
      </section>
    </div>
  );
}
