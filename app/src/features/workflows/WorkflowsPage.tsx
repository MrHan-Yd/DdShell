import { useEffect, useState } from "react";
import {
  Clock,
  Globe,
  Play,
  RefreshCw,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useConnectionsStore } from "@/stores/connections";
import { toast } from "@/stores/toast";
import {
  createEmptyWorkflowDraft,
  draftToCreateRecipeRequest,
  draftToUpdateRecipeRequest,
  initWorkflowListeners,
  useWorkflowsStore,
  validateWorkflowDraftDetailed,
  workflowRecipeToDraft,
  type WorkflowDraftValidationResult,
  type WorkflowRecipeDraft,
} from "@/stores/workflows";
import type { WorkflowRecipe, WorkflowRecipeParam } from "@/types";
import { WorkflowDetail } from "@/features/workflows/components/WorkflowDetail";
import { WorkflowEditor } from "@/features/workflows/components/WorkflowEditor";
import { WorkflowList } from "@/features/workflows/components/WorkflowList";
import { WorkflowRunPanel } from "@/features/workflows/components/WorkflowRunPanel";

function parseRecipeParams(recipe: WorkflowRecipe | null): WorkflowRecipeParam[] {
  if (!recipe) return [];
  try {
    const value = JSON.parse(recipe.paramsJson) as WorkflowRecipeParam[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function buildInitialParamValues(params: WorkflowRecipeParam[]): Record<string, string> {
  return Object.fromEntries(params.map((param) => [param.key, param.defaultValue ?? ""]));
}

function getMissingRequiredParamKeys(
  params: WorkflowRecipeParam[],
  values: Record<string, string>,
): string[] {
  return params
    .filter((param) => param.required && !(values[param.key] ?? "").trim())
    .map((param) => param.key);
}

function formatRunDuration(run: { startedAt: string; finishedAt?: string | null }): string | null {
  const startedAt = Date.parse(run.startedAt);
  const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt) || finishedAt < startedAt) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function RunStateBadge({ state }: { state: string }) {
  const t = useT();
  const label =
    state === "completed" ? t("workflows.stateCompleted") :
    state === "failed" ? t("workflows.stateFailed") :
    state === "running" ? t("workflows.runningState") :
    state;
  return (
    <span className={cn("wf-badge", {
      "wf-badge--completed": state === "completed",
      "wf-badge--running": state === "running",
      "wf-badge--failed": state === "failed",
    })}>
      {label}
    </span>
  );
}

export function WorkflowsPage() {
  const t = useT();
  const {
    recipes,
    loading,
    error,
    selectedRecipeId,
    activeRun,
    activeRunLoading,
    recentRuns,
    recentRunsLoading,
    setSelectedRecipeId,
    setSelectedGroupId,
    fetchRecipes,
    fetchGroups,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    batchDeleteRecipes,
    startRun,
    loadRun,
    loadRecentRuns,
    clearActiveRun,
  } = useWorkflowsStore();
  const fetchHosts = useConnectionsStore((s) => s.fetchHosts);
  const hosts = useConnectionsStore((s) => s.hosts);

  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [draft, setDraft] = useState<WorkflowRecipeDraft>(createEmptyWorkflowDraft());
  const [validation, setValidation] = useState<WorkflowDraftValidationResult | null>(null);
  const [runParamValues, setRunParamValues] = useState<Record<string, string>>({});
  const [runParamErrors, setRunParamErrors] = useState<string[]>([]);
  const [runHostId, setRunHostId] = useState<string>("");

  useEffect(() => {
    initWorkflowListeners();
    fetchRecipes();
    fetchGroups();
    fetchHosts();
  }, [fetchRecipes, fetchGroups, fetchHosts]);

  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;
  const selectedRecipeParams = parseRecipeParams(selectedRecipe);

  useEffect(() => {
    if (!selectedRecipe) {
      setRunParamValues({});
      setRunParamErrors([]);
      setRunHostId("");
      return;
    }

    setRunParamValues(buildInitialParamValues(selectedRecipeParams));
    setRunParamErrors([]);
    setRunHostId("");
    loadRecentRuns(selectedRecipe.id);
  }, [loadRecentRuns, selectedRecipe, selectedRecipe?.id, selectedRecipe?.paramsJson]);

  const beginCreate = () => {
    setDraft(createEmptyWorkflowDraft());
    setValidation(null);
    setSelectedRecipeId(null);
    setMode("create");
  };

  const beginEdit = (recipe: WorkflowRecipe) => {
    setDraft(workflowRecipeToDraft(recipe));
    setValidation(null);
    setMode("edit");
  };

  const handleSave = async () => {
    const result = validateWorkflowDraftDetailed(draft);
    setValidation(result);
    if (result) {
      toast.warning(t(result.message as never));
      return;
    }

    if (mode === "create") {
      const id = await createRecipe(draftToCreateRecipeRequest(draft));
      setSelectedRecipeId(id);
      setMode("view");
      toast.success(t("workflows.created"));
      return;
    }

    if (mode === "edit" && selectedRecipe) {
      await updateRecipe(draftToUpdateRecipeRequest(selectedRecipe.id, draft));
      setMode("view");
      toast.success(t("workflows.updated"));
    }
  };

  const handleDelete = async (recipe: WorkflowRecipe) => {
    const ok = await confirm({
      title: t("workflows.deleteTitle"),
      description: t("workflows.deleteDesc"),
      confirmLabel: t("confirm.delete"),
    });
    if (!ok) return;

    await deleteRecipe(recipe.id);
    setMode("view");
    toast.success(t("workflows.deleted"));
  };

  const handleBatchDelete = async (ids: string[]) => {
    await batchDeleteRecipes(ids);
    if (selectedRecipeId && ids.includes(selectedRecipeId)) {
      setMode("view");
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <WorkflowList
        loading={loading}
        error={error}
        selectedRecipeId={selectedRecipeId}
        onSelect={(id) => {
          setSelectedRecipeId(id);
          setSelectedGroupId(null);
          setMode("view");
        }}
        onCreate={beginCreate}
        onEdit={beginEdit}
        onDelete={handleDelete}
        onBatchDelete={handleBatchDelete}
        onRetry={fetchRecipes}
      />

      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {mode === "create" || (mode === "edit" && selectedRecipe) ? (
          <WorkflowEditor
            draft={draft}
            validation={validation}
            onChange={(nextDraft) => {
              setDraft(nextDraft);
              if (validation) {
                setValidation(validateWorkflowDraftDetailed(nextDraft));
              }
            }}
            onSave={handleSave}
            onCancel={() => {
              setMode("view");
              setValidation(null);
              if (selectedRecipe) {
                setDraft(workflowRecipeToDraft(selectedRecipe));
              }
            }}
            savingLabel={mode === "create" ? t("workflows.create") : t("workflows.update")}
          />
        ) : selectedRecipe ? (
          <WorkflowDetail
            recipe={selectedRecipe}
            onEdit={() => beginEdit(selectedRecipe)}
            onDelete={() => handleDelete(selectedRecipe)}
          />
        ) : (
          <div className="animate-fade-in flex flex-1 items-center justify-center text-center">
            <div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-subtle)]">
                <Workflow size={28} className="text-[var(--color-accent)]" />
              </div>
              <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">{error ? t("workflows.selectAfterLoad") : t("workflows.selectOrCreate")}</p>
            </div>
          </div>
        )}

        {selectedRecipe && mode === "view" && (
          <div className="mx-auto mt-5 flex w-full max-w-3xl flex-col gap-4">
            {/* Run Configuration */}
            <div className="glass-card rounded-[var(--radius-card)] p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)]">
                    <Zap size={16} className="text-[var(--color-accent)]" />
                  </div>
                  <div>
                    <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
                      {t("workflows.runConfig")}
                    </h3>
                    <p className="mt-0.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {t("workflows.runConfigDesc")}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={async () => {
                    if (!runHostId.trim()) {
                      toast.warning(t("workflows.runValidationSelectHost"));
                      return;
                    }
                    const missingKeys = getMissingRequiredParamKeys(selectedRecipeParams, runParamValues);
                    if (missingKeys.length > 0) {
                      setRunParamErrors(missingKeys);
                      toast.warning(t("workflows.runValidationRequired"));
                      return;
                    }

                    try {
                      setRunParamErrors([]);
                      await startRun(selectedRecipe.id, runHostId, runParamValues);
                      toast.success(t("workflows.runStarted"));
                    } catch (err) {
                      toast.error(String(err));
                    }
                  }}
                >
                  <Play size={14} />
                  {t("workflows.run")}
                </Button>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  <Globe size={12} className="mr-1 inline-block" />
                  {t("workflows.formTargetHost")}
                </label>
                <Select
                  value={runHostId}
                  onChange={setRunHostId}
                  options={[
                    { value: "", label: t("workflows.selectHost") },
                    ...hosts.map((host) => ({ value: host.id, label: host.name })),
                  ]}
                />
              </div>

              {selectedRecipeParams.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-4 text-center rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)]">
                  <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("workflows.noParams")}</p>
                </div>
              ) : (
                <>
                  {runParamErrors.length > 0 && (
                    <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-3 py-2 text-[var(--font-size-xs)] text-[var(--color-error)]">
                      {t("workflows.runValidationRequired")}
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedRecipeParams.map((param) => (
                      <div key={param.key}>
                        <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
                          {param.label}
                          {param.required ? <span className="ml-1 text-[var(--color-error)]">*</span> : ""}
                        </label>
                        <Input
                          error={runParamErrors.includes(param.key)}
                          value={runParamValues[param.key] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRunParamValues((current) => ({
                              ...current,
                              [param.key]: value,
                            }));
                            setRunParamErrors((current) => current.filter((key) => key !== param.key));
                          }}
                          placeholder={param.defaultValue ?? param.key}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Recent Runs */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-bg-hover)]">
                    <Clock size={16} className="text-[var(--color-text-muted)]" />
                  </div>
                  <div>
                    <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
                      {t("workflows.recentRuns")}
                    </h3>
                    <p className="mt-0.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {t("workflows.recentRunsDesc")}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => loadRecentRuns(selectedRecipe.id)}>
                  <RefreshCw size={14} />
                  {t("workflows.retry")}
                </Button>
              </div>

              {recentRunsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
                </div>
              ) : recentRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)]">
                  <Clock size={24} className="mb-2 text-[var(--color-text-muted)] opacity-40" />
                  <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("workflows.noRunYet")}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentRuns.map((run) => {
                    const isActive = activeRun?.id === run.id;
                    const duration = formatRunDuration(run);
                    const failedStep = run.steps.find((step) => step.state === "failed")?.title;
                    return (
                      <button
                        key={run.id}
                        type="button"
                        className={cn(
                          "wf-card w-full rounded-[var(--radius-control)] border px-4 py-3 text-left transition-all",
                          isActive
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                            : "border-[var(--color-border)] bg-[var(--color-bg-base)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-bg-hover)]",
                        )}
                        onClick={() => loadRun(run.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] truncate">
                                {new Date(run.startedAt).toLocaleString()}
                              </span>
                              <RunStateBadge state={run.state} />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                              <span>{run.steps.length} {t("workflows.stepsCount")}</span>
                              {duration && <span>{duration}</span>}
                            </div>
                            {failedStep && (
                              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-error)]">
                                {t("workflows.failedStep")}: {failedStep}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <WorkflowRunPanel
              run={activeRun && activeRun.recipeId === selectedRecipe.id ? activeRun : null}
              loading={activeRunLoading}
              onClose={clearActiveRun}
            />
          </div>
        )}
      </div>
    </div>
  );
}