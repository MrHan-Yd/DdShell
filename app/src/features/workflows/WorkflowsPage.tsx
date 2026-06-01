import { useEffect, useMemo, useState } from "react";
import { Clock, ListChecks, Plus, Variable, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
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
import type { WorkflowRecipe } from "@/types";
import { WorkflowDetail } from "@/features/workflows/components/WorkflowDetail";
import { WorkflowEditor } from "@/features/workflows/components/WorkflowEditor";
import { WorkflowList } from "@/features/workflows/components/WorkflowList";

export function WorkflowsPage() {
  const t = useT();
  const {
    recipes,
    groups,
    loading,
    error,
    selectedRecipeId,
    setSelectedRecipeId,
    setSelectedGroupId,
    fetchRecipes,
    fetchGroups,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    batchDeleteRecipes,
  } = useWorkflowsStore();

  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [draft, setDraft] = useState<WorkflowRecipeDraft>(createEmptyWorkflowDraft());
  const [validation, setValidation] = useState<WorkflowDraftValidationResult | null>(null);
  const [selectionResetKey, setSelectionResetKey] = useState(0);

  useEffect(() => {
    initWorkflowListeners();
    fetchRecipes();
    fetchGroups();
  }, [fetchRecipes, fetchGroups]);

  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;

  const selectedRecipeMeta = useMemo(() => {
    if (!selectedRecipe || mode !== "view") return null;
    let stepCount = 0;
    let paramCount = 0;
    try {
      const s = JSON.parse(selectedRecipe.stepsJson) as unknown[];
      if (Array.isArray(s)) stepCount = s.length;
    } catch {}
    try {
      const p = JSON.parse(selectedRecipe.paramsJson) as unknown[];
      if (Array.isArray(p)) paramCount = p.length;
    } catch {}
    return { stepCount, paramCount, updatedAt: selectedRecipe.updatedAt };
  }, [selectedRecipe, mode]);

  const beginCreate = () => {
    setDraft(createEmptyWorkflowDraft());
    setValidation(null);
    setSelectedRecipeId(null);
    setSelectionResetKey((key) => key + 1);
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
      return false;
    }

    if (mode === "create") {
      const id = await createRecipe(draftToCreateRecipeRequest(draft));
      setSelectedRecipeId(id);
      setMode("view");
      toast.success(t("workflows.created"));
      return true;
    }

    if (mode === "edit" && selectedRecipe) {
      await updateRecipe(draftToUpdateRecipeRequest(selectedRecipe.id, draft));
      setMode("view");
      toast.success(t("workflows.updated"));
      return true;
    }

    return false;
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
    <div className="workflow-page wf-main flex flex-1 flex-col overflow-hidden">
      <header className="page-header workflow-page-header flex flex-shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-3">
        <div className="title-block min-w-0">
          <h1 className="title truncate text-[var(--font-size-xl)] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">
            {t("workflows.title")}
          </h1>
          {selectedRecipeMeta ? (
            <p className="subtitle workflow-page-subtitle mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-1">
                <ListChecks size={11} />
                {selectedRecipeMeta.stepCount} {t("workflows.stepsCount")}
              </span>
              {selectedRecipeMeta.paramCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Variable size={11} />
                  {selectedRecipeMeta.paramCount} {t("workflows.params")}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {new Date(selectedRecipeMeta.updatedAt).toLocaleString()}
              </span>
            </p>
          ) : (
            <p className="subtitle workflow-page-subtitle mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
              {recipes.length} {t("workflows.title")}
              {groups.length > 0 ? ` · ${groups.length} ${t("workflows.formGroup")}` : ""}
            </p>
          )}
        </div>
        <div className="actions workflow-page-actions flex flex-shrink-0 items-center gap-2">
          <Button size="sm" className="workflow-action-button workflow-page-primary-action" onClick={beginCreate}>
            <Plus size={13} />
            {t("workflows.newRecipe")}
          </Button>
        </div>
      </header>

      <div className="workflow-page-body wf-body grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] overflow-hidden">
        <WorkflowList
          loading={loading}
          error={error}
          selectedRecipeId={selectedRecipeId}
          onSelect={(id) => {
            setSelectedRecipeId(id);
            setSelectedGroupId(null);
            setMode("view");
          }}
          onEdit={beginEdit}
          onDelete={handleDelete}
          onBatchDelete={handleBatchDelete}
          onRetry={fetchRecipes}
          selectionResetKey={selectionResetKey}
        />

        <section className="workflow-detail-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              originalRecipe={mode === "edit" ? selectedRecipe ?? null : null}
            />
          ) : selectedRecipe ? (
            <div className="workflow-detail-scroll wf-detail flex-1 overflow-y-auto px-7 py-6">
              <WorkflowDetail
                recipe={selectedRecipe}
                onEdit={() => beginEdit(selectedRecipe)}
                onDelete={() => handleDelete(selectedRecipe)}
              />
            </div>
          ) : (
            <div className="animate-fade-in flex flex-1 items-center justify-center text-center p-6">
              <div>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-subtle)]">
                  <Workflow size={28} className="text-[var(--color-accent)]" />
                </div>
                <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">{error ? t("workflows.selectAfterLoad") : t("workflows.selectOrCreate")}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
