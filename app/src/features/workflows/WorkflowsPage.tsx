import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";
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

  useEffect(() => {
    initWorkflowListeners();
    fetchRecipes();
    fetchGroups();
  }, [fetchRecipes, fetchGroups]);

  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;

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

      <div className="flex flex-1 flex-col min-h-0">
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
          <div className="flex-1 overflow-y-auto p-6">
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
      </div>
    </div>
  );
}
