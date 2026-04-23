import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  CreateWorkflowRecipeRequest,
  UpdateWorkflowRecipeRequest,
  WorkflowGroup,
  WorkflowRecipe,
  WorkflowRecipeParam,
  WorkflowRecipeStep,
  WorkflowRun,
} from "@/types";
import * as api from "@/lib/tauri";

export interface WorkflowRecipeDraft {
  title: string;
  description: string;
  groupId: string | null;
  params: WorkflowRecipeParam[];
  steps: WorkflowRecipeStep[];
}

export interface WorkflowDraftValidationResult {
  field: "title" | "params" | "steps";
  message: string;
}

interface WorkflowsState {
  recipes: WorkflowRecipe[];
  groups: WorkflowGroup[];
  loading: boolean;
  error: string | null;
  selectedRecipeId: string | null;
  selectedGroupId: string | null;
  activeRun: WorkflowRun | null;
  activeRunLoading: boolean;
  recentRuns: WorkflowRun[];
  recentRunsLoading: boolean;

  setSelectedRecipeId: (id: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  fetchRecipes: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  createRecipe: (req: CreateWorkflowRecipeRequest) => Promise<string>;
  updateRecipe: (req: UpdateWorkflowRecipeRequest) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  batchDeleteRecipes: (ids: string[]) => Promise<void>;
  createGroup: (name: string) => Promise<string>;
  updateGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  moveRecipeToGroup: (recipeId: string, groupId: string | null) => Promise<void>;
  startRun: (recipeId: string, hostId: string, params?: Record<string, string>) => Promise<string>;
  loadRun: (runId: string) => Promise<void>;
  loadRecentRuns: (recipeId: string, limit?: number) => Promise<void>;
  clearActiveRun: () => void;
}

function safeParseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeWorkflowParam(param: unknown): WorkflowRecipeParam {
  if (!isRecord(param)) {
    return { key: "", defaultValue: "" };
  }

  const defaultValue = typeof param.defaultValue === "string" || param.defaultValue === null
    ? param.defaultValue
    : typeof param.default_value === "string" || param.default_value === null
      ? param.default_value
      : "";

  return {
    ...param,
    key: typeof param.key === "string" ? param.key : "",
    defaultValue,
  };
}

function normalizeWorkflowStep(step: unknown): WorkflowRecipeStep {
  if (!isRecord(step)) {
    return { id: crypto.randomUUID(), title: "", command: "" };
  }

  return {
    ...step,
    id: typeof step.id === "string" && step.id.trim().length > 0 ? step.id : crypto.randomUUID(),
    title: typeof step.title === "string" ? step.title : "",
    command: typeof step.command === "string" ? step.command : "",
  };
}

export function createEmptyWorkflowDraft(): WorkflowRecipeDraft {
  return {
    title: "",
    description: "",
    groupId: null,
    params: [],
    steps: [{ id: crypto.randomUUID(), title: "", command: "" }],
  };
}

export function workflowRecipeToDraft(recipe: WorkflowRecipe): WorkflowRecipeDraft {
  return {
    title: recipe.title,
    description: recipe.description ?? "",
    groupId: recipe.groupId ?? null,
    params: safeParseJson<unknown[]>(recipe.paramsJson, []).map(normalizeWorkflowParam),
    steps: safeParseJson<unknown[]>(recipe.stepsJson, []).map(normalizeWorkflowStep),
  };
}

export function draftToCreateRecipeRequest(draft: WorkflowRecipeDraft): CreateWorkflowRecipeRequest {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    groupId: draft.groupId,
    paramsJson: JSON.stringify(draft.params),
    stepsJson: JSON.stringify(draft.steps),
  };
}

export function draftToUpdateRecipeRequest(id: string, draft: WorkflowRecipeDraft): UpdateWorkflowRecipeRequest {
  return {
    id,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    groupId: draft.groupId,
    paramsJson: JSON.stringify(draft.params),
    stepsJson: JSON.stringify(draft.steps),
  };
}

export function isDraftDirty(draft: WorkflowRecipeDraft, original: WorkflowRecipe | null): boolean {
  if (!original) return draft.title.trim().length > 0 || draft.steps.length > 0;
  const originalDraft = workflowRecipeToDraft(original);
  return JSON.stringify(draft) !== JSON.stringify(originalDraft);
}

export function validateWorkflowDraft(draft: WorkflowRecipeDraft): string | null {
  if (!draft.title.trim()) {
    return "title";
  }

  if (draft.steps.length === 0) {
    return "steps";
  }

  const hasInvalidStep = draft.steps.some((step) => !step.command.trim());
  if (hasInvalidStep) {
    return "steps";
  }

  const hasInvalidParam = draft.params.some((param) => !param.key.trim());
  if (hasInvalidParam) {
    return "params";
  }

  return null;
}

export function validateWorkflowDraftDetailed(
  draft: WorkflowRecipeDraft,
): WorkflowDraftValidationResult | null {
  if (!draft.title.trim()) {
    return { field: "title", message: "workflows.validationTitle" };
  }

  const invalidParam = draft.params.find((param) => {
    const key = param.key.trim();
    return !key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
  });
  if (invalidParam) {
    return { field: "params", message: "workflows.validationParams" };
  }

  const uniqueKeys = new Set<string>();
  for (const param of draft.params) {
    const key = param.key.trim();
    if (uniqueKeys.has(key)) {
      return { field: "params", message: "workflows.validationParamDuplicate" };
    }
    uniqueKeys.add(key);
  }

  if (draft.steps.length === 0) {
    return { field: "steps", message: "workflows.validationSteps" };
  }

  const hasInvalidStep = draft.steps.some((step) => !step.command.trim());
  if (hasInvalidStep) {
    return { field: "steps", message: "workflows.validationSteps" };
  }

  return null;
}

export function buildWorkflowPreviewValues(
  draft: WorkflowRecipeDraft,
): Record<string, string> {
  return Object.fromEntries(
    draft.params.map((param) => {
      const normalizedParam = normalizeWorkflowParam(param);
      return [normalizedParam.key.trim(), (normalizedParam.defaultValue ?? "").trim()];
    }),
  );
}

export function interpolateWorkflowCommand(
  command: string,
  values: Record<string, string>,
): string {
  return command.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    return values[key] ?? "";
  });
}

export function moveWorkflowStep(
  steps: WorkflowRecipeStep[],
  fromIndex: number,
  toIndex: number,
): WorkflowRecipeStep[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= steps.length || toIndex >= steps.length) {
    return steps;
  }

  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  recipes: [],
  groups: [],
  loading: false,
  error: null,
  selectedRecipeId: null,
  selectedGroupId: null,
  activeRun: null,
  activeRunLoading: false,
  recentRuns: [],
  recentRunsLoading: false,

  setSelectedRecipeId: (id) => set({ selectedRecipeId: id }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),

  fetchRecipes: async () => {
    set({ loading: true, error: null });
    try {
      const recipes = await api.workflowRecipeList();
      set({ recipes });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  fetchGroups: async () => {
    const groups = await api.workflowGroupList();
    set({ groups });
  },

  createRecipe: async (req) => {
    const { id } = await api.workflowRecipeCreate(req);
    await get().fetchRecipes();
    set({ selectedRecipeId: id });
    return id;
  },

  updateRecipe: async (req) => {
    await api.workflowRecipeUpdate(req);
    await get().fetchRecipes();
  },

  deleteRecipe: async (id) => {
    await api.workflowRecipeDelete(id);
    const { selectedRecipeId } = get();
    if (selectedRecipeId === id) {
      set({ selectedRecipeId: null, activeRun: null, activeRunLoading: false, recentRuns: [] });
    }
    await get().fetchRecipes();
  },

  batchDeleteRecipes: async (ids) => {
    if (ids.length === 0) return;

    for (const id of ids) {
      await api.workflowRecipeDelete(id);
    }

    const { selectedRecipeId } = get();
    if (selectedRecipeId && ids.includes(selectedRecipeId)) {
      set({ selectedRecipeId: null, activeRun: null, activeRunLoading: false, recentRuns: [] });
    }

    await get().fetchRecipes();
  },

  createGroup: async (name) => {
    const { id } = await api.workflowGroupCreate(name);
    await get().fetchGroups();
    return id;
  },

  updateGroup: async (id, name) => {
    await api.workflowGroupUpdate(id, name);
    await get().fetchGroups();
  },

  deleteGroup: async (id) => {
    const { selectedGroupId, selectedRecipeId, recipes } = get();
    const recipeInGroup = selectedRecipeId &&
      recipes.find((r) => r.id === selectedRecipeId)?.groupId === id;

    await api.workflowGroupDelete(id);

    set({
      selectedGroupId: selectedGroupId === id ? null : selectedGroupId,
      selectedRecipeId: recipeInGroup ? null : selectedRecipeId,
    });
    await get().fetchGroups();
    await get().fetchRecipes();
  },

  moveRecipeToGroup: async (recipeId, groupId) => {
    const recipe = get().recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    await api.workflowRecipeUpdate({
      id: recipeId,
      groupId: groupId,
    });
    await get().fetchRecipes();
  },

  startRun: async (recipeId, hostId, params) => {
    const { id } = await api.workflowRunStart(recipeId, hostId, params);
    set({ activeRunLoading: true });
    await get().loadRun(id);
    await get().loadRecentRuns(recipeId);
    return id;
  },

  loadRun: async (runId) => {
    try {
      const run = await api.workflowRunGet(runId);
      set({ activeRun: run });
    } finally {
      set({ activeRunLoading: false });
    }
  },

  loadRecentRuns: async (recipeId, limit = 10) => {
    set({ recentRunsLoading: true });
    try {
      const recentRuns = await api.workflowRunList(recipeId, limit);
      set({ recentRuns });
    } finally {
      set({ recentRunsLoading: false });
    }
  },

  clearActiveRun: () => set({ activeRun: null, activeRunLoading: false }),
}));

let workflowListenersInitialized = false;

export function initWorkflowListeners() {
  if (workflowListenersInitialized) return;
  workflowListenersInitialized = true;

  listen<{ run: WorkflowRun }>("workflow:run_updated", (event) => {
    useWorkflowsStore.setState((state) => {
      const updatedRecentRuns = [event.payload.run, ...state.recentRuns.filter((run) => run.id !== event.payload.run.id)]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 10);

      if (state.activeRun && state.activeRun.id !== event.payload.run.id) {
        return {
          ...state,
          recentRuns: updatedRecentRuns,
        };
      }

      return {
        ...state,
        activeRun: event.payload.run,
        activeRunLoading: false,
        recentRuns: updatedRecentRuns,
      };
    });
  });
}
