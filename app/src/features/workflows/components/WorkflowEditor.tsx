import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FolderOpen, GripVertical, Plus, Save, Search, Settings2, Terminal, Trash2, Variable } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useWorkflowsStore, isDraftDirty } from "@/stores/workflows";
import {
  buildWorkflowPreviewValues,
  interpolateWorkflowCommand,
  type WorkflowDraftValidationResult,
  type WorkflowRecipeDraft,
} from "@/stores/workflows";
import type { WorkflowRecipe, WorkflowRecipeParam, WorkflowRecipeStep } from "@/types";

export function WorkflowEditor({
  draft,
  validation,
  onChange,
  onSave,
  onCancel,
  savingLabel,
  originalRecipe,
}: {
  draft: WorkflowRecipeDraft;
  validation: WorkflowDraftValidationResult | null;
  onChange: (draft: WorkflowRecipeDraft) => void;
  onSave: () => Promise<boolean> | boolean;
  onCancel: () => void;
  savingLabel: string;
  originalRecipe: WorkflowRecipe | null;
}) {
  const t = useT();
  const groups = useWorkflowsStore((s) => s.groups);
  const previewValues = buildWorkflowPreviewValues(draft);
  const dirty = isDraftDirty(draft, originalRecipe);

  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [fadeOut, setFadeOut] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [activeSideLayer, setActiveSideLayer] = useState<"none" | "steps" | "params">("none");
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const stepLayerRef = useRef<HTMLDivElement>(null);
  const paramLayerRef = useRef<HTMLDivElement>(null);
  const stepRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const stepOrderRef = useRef(draft.steps);
  const saveResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const stepIds = useMemo(() => draft.steps.map((step) => step.id), [draft.steps]);

  useEffect(() => {
    stepOrderRef.current = draft.steps;
  }, [draft.steps]);

  const addStep = useCallback(() => {
    const nextSteps = [...draft.steps, { id: crypto.randomUUID(), title: "", command: "" }];
    onChange({ ...draft, steps: nextSteps });
    setActiveStepIndex(nextSteps.length - 1);
  }, [draft, onChange]);

  const addParam = useCallback(() => {
    onChange({ ...draft, params: [...draft.params, { key: "", defaultValue: "" }] });
  }, [draft, onChange]);

  const openSideLayer = useCallback((layer: "steps" | "params") => {
    setActiveSideLayer(layer);
  }, []);

  const closeSideLayer = useCallback(() => {
    setActiveSideLayer("none");
  }, []);

  const toggleSideLayer = useCallback((layer: "steps" | "params") => {
    setActiveSideLayer((prev) => prev === layer ? "none" : layer);
  }, []);

  const scrollToStep = useCallback((index: number) => {
    setActiveStepIndex(index);
    stepRefsRef.current.get(index)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (window.innerWidth < 1200) {
      setActiveSideLayer("none");
    }
  }, []);

  const reorderStepsByIds = useCallback((activeId: string | number, overId: string | number | null | undefined) => {
    if (!overId || activeId === overId) return;

    const currentSteps = stepOrderRef.current;
    const activeStepId = String(activeId);
    const overStepId = String(overId);
    const fromIndex = currentSteps.findIndex((step) => step.id === activeStepId);
    const targetIndex = currentSteps.findIndex((step) => step.id === overStepId);

    if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
      return;
    }

    const activeStepIdAtIndex = currentSteps[activeStepIndex]?.id ?? null;
    const steps = arrayMove(currentSteps, fromIndex, targetIndex);
    stepOrderRef.current = steps;
    onChange({ ...draft, steps });

    if (!activeStepIdAtIndex) return;
    const nextActiveIndex = steps.findIndex((step) => step.id === activeStepIdAtIndex);
    if (nextActiveIndex >= 0) {
      setActiveStepIndex(nextActiveIndex);
    }
  }, [activeStepIndex, draft, onChange]);

  const moveStepToIndex = useCallback((fromIndex: number, targetIndex: number) => {
    if (fromIndex === targetIndex || fromIndex < 0 || targetIndex < 0 || fromIndex >= draft.steps.length || targetIndex >= draft.steps.length) {
      return;
    }

    reorderStepsByIds(draft.steps[fromIndex]?.id ?? "", draft.steps[targetIndex]?.id ?? null);
  }, [draft.steps, reorderStepsByIds]);

  const moveStepBy = useCallback((index: number, delta: number) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= draft.steps.length) return;
    moveStepToIndex(index, targetIndex);
  }, [draft.steps.length, moveStepToIndex]);

  const handleNavSortEnd = useCallback((event: DragEndEvent) => {
    reorderStepsByIds(event.active.id, event.over?.id);
  }, [reorderStepsByIds]);

  const handleEditorSortEnd = useCallback((event: DragEndEvent) => {
    reorderStepsByIds(event.active.id, event.over?.id);
  }, [reorderStepsByIds]);

  const editorCollisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    const pointerCollisions = pointerWithin(args).filter((collision) => String(collision.id) !== String(args.active.id));
    return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
  }, []);

  const spotlightActions = useMemo(() => {
    const actions: { id: string; label: string; section: string; icon: React.ReactNode; onSelect: () => void }[] = [
      { id: "edit-title", label: t("workflows.spotlightEditTitle"), section: t("workflows.spotlightSectionBasics"), icon: <AlignLeft size={14} />, onSelect: () => titleRef.current?.focus() },
      { id: "edit-desc", label: t("workflows.spotlightEditDesc"), section: t("workflows.spotlightSectionBasics"), icon: <AlignLeft size={14} />, onSelect: () => descRef.current?.focus() },
      { id: "add-step", label: t("workflows.addStep"), section: t("workflows.spotlightSectionActions"), icon: <Plus size={14} />, onSelect: addStep },
      { id: "add-param", label: t("workflows.addParam"), section: t("workflows.spotlightSectionActions"), icon: <Variable size={14} />, onSelect: addParam },
      { id: "save", label: t("workflows.spotlightSave"), section: t("workflows.spotlightSectionActions"), icon: <Plus size={14} />, onSelect: onSave },
    ];
    draft.steps.forEach((step, i) => {
      actions.push({
        id: `goto-step-${i}`,
        label: t("workflows.spotlightGotoStep", { n: i + 1, title: step.title || step.command?.slice(0, 20) }),
        section: t("workflows.spotlightSectionSteps"),
        icon: <Terminal size={14} />,
        onSelect: () => scrollToStep(i),
      });
    });
    return actions;
  }, [addParam, addStep, draft.steps, onSave, scrollToStep, t]);

  useEffect(() => {
    if (activeStepIndex <= draft.steps.length - 1) return;
    setActiveStepIndex(Math.max(0, draft.steps.length - 1));
  }, [activeStepIndex, draft.steps.length]);

  const renderStepNavigatorPanel = (className?: string) => (
    <section className={cn(
      "overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]",
      className,
    )}>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            {t("workflows.stepNavigator")}
          </p>
          <p className="mt-1 text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
            {draft.steps.length} {t("workflows.stepsCount")}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={addStep}>
          <Plus size={14} />
          {t("workflows.addStep")}
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleNavSortEnd}>
        <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
          <div className="flex max-h-[min(70vh,720px)] flex-col gap-2 overflow-y-auto p-3">
            {draft.steps.map((step, index) => (
              <SortableNavStep
                key={step.id}
                id={step.id}
                index={index}
                title={step.title.trim() || t("workflows.stepNumber", { n: index + 1 })}
                subtitle={step.command.trim() || t("workflows.stepCommand")}
                isActive={activeStepIndex === index}
                isFirst={index === 0}
                isLast={index === draft.steps.length - 1}
                onSelect={() => scrollToStep(index)}
                onMoveUp={() => moveStepBy(index, -1)}
                onMoveDown={() => moveStepBy(index, 1)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );

  useEffect(() => {
    if (saveStatus === "saved" && dirty) {
      setSaveStatus("idle");
    }
  }, [dirty, saveStatus]);

  useEffect(() => {
    return () => {
      if (saveResetTimerRef.current) {
        clearTimeout(saveResetTimerRef.current);
      }
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (saveResetTimerRef.current) {
      clearTimeout(saveResetTimerRef.current);
      saveResetTimerRef.current = null;
    }

    setSaveStatus("saving");

    try {
      const ok = await Promise.resolve(onSave());
      if (!ok) {
        setSaveStatus("error");
        saveResetTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1200);
        return;
      }

      setSaveStatus("saved");
      saveResetTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1600);
    } catch {
      setSaveStatus("error");
      saveResetTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1200);
    }
  }, [onSave]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSpotlightOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
        e.preventDefault();
        toggleSideLayer("steps");
      }
      if (e.key === "]" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
        e.preventDefault();
        toggleSideLayer("params");
      }
      if (e.key === "Escape" && !spotlightOpen) {
        if (activeSideLayer !== "none") {
          e.preventDefault();
          closeSideLayer();
        }
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [handleSave, toggleSideLayer, closeSideLayer, activeSideLayer, spotlightOpen]);

  useEffect(() => {
    if (activeSideLayer === "none") return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      if (activeSideLayer === "steps") {
        if (stepLayerRef.current?.contains(target)) return;
        closeSideLayer();
        return;
      }

      if (activeSideLayer === "params") {
        if (paramLayerRef.current?.contains(target)) return;
        closeSideLayer();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activeSideLayer, closeSideLayer]);

  return (
    <div className="animate-fade-in-up relative flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-4 pb-28">
          <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_34%),var(--color-bg-surface)] p-6 shadow-[var(--shadow-card)]">
            <div className="relative flex flex-col gap-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                <div className="min-w-0 space-y-2">
                  <input
                    ref={titleRef}
                    value={draft.title}
                    onChange={(e) => onChange({ ...draft, title: e.target.value })}
                    placeholder={t("workflows.placeholderTitle")}
                    className={cn(
                      "w-full border-0 bg-transparent text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]/40",
                      validation?.field === "title" && "text-[var(--color-error)]"
                    )}
                  />
                  <textarea
                    ref={descRef}
                    value={draft.description}
                    onChange={(e) => onChange({ ...draft, description: e.target.value })}
                    placeholder={t("workflows.placeholderDescription")}
                    rows={2}
                    className="w-full resize-none border-0 bg-transparent px-0 text-[var(--font-size-base)] leading-relaxed text-[var(--color-text-secondary)] outline-none placeholder:text-[var(--color-text-muted)]/40"
                  />
                </div>

                {groups.length > 0 && (
                  <div className="flex-shrink-0 xl:pt-1">
                    <GroupChipSelect
                      value={draft.groupId ?? ""}
                      onChange={(v) => onChange({ ...draft, groupId: v || null })}
                      options={[
                        { value: "", label: t("workflows.noGroup") },
                        ...groups.map((g) => ({ value: g.id, label: g.name })),
                      ]}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--color-border)]/70 pt-3 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                <div className="flex items-center gap-2">
                  <span>{draft.steps.length} {t("workflows.stepsCount")}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--color-border)]" />
                  <span>{draft.params.length} {t("workflows.params")}</span>
                  {dirty && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-[var(--color-border)]" />
                      <span className="inline-flex items-center gap-1 text-[var(--color-accent)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                        {t("workflows.dirtyHint")}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="group relative">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-base)]/70 text-[var(--color-text-muted)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
                      aria-label={t("workflows.keyboardSave")}
                    >
                      <Save size={12} />
                    </button>
                    <div className="pointer-events-none absolute bottom-[calc(100%+10px)] right-0 z-20 w-max rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01)),var(--color-bg-elevated)] px-2.5 py-2 text-[11px] leading-5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] backdrop-blur-sm opacity-0 translate-y-1 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100">
                      <span className="absolute -bottom-1 right-3 h-2 w-2 rotate-45 border-r border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]" />
                      <p className="whitespace-nowrap">{t("workflows.keyboardSave")}</p>
                    </div>
                  </div>

                  <div className="group relative">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-base)]/70 text-[var(--color-text-muted)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
                      aria-label={t("workflows.keyboardSpotlight")}
                    >
                      <Search size={12} />
                    </button>
                    <div className="pointer-events-none absolute bottom-[calc(100%+10px)] right-0 z-20 w-max rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01)),var(--color-bg-elevated)] px-2.5 py-2 text-[11px] leading-5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] backdrop-blur-sm opacity-0 translate-y-1 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100">
                      <span className="absolute -bottom-1 right-3 h-2 w-2 rotate-45 border-r border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]" />
                      <p className="whitespace-nowrap">{t("workflows.keyboardSpotlight")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => toggleSideLayer("steps")}
                className="flex w-full items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-left shadow-[var(--shadow-card)]"
              >
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                    {t("workflows.stepNavigator")}
                  </p>
                  <p className="mt-1 text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
                    {draft.steps.length} {t("workflows.stepsCount")}
                  </p>
                </div>
                <ChevronDown size={16} className={cn("text-[var(--color-text-muted)] transition-transform", activeSideLayer === "steps" && "rotate-180")} />
              </button>
              <div className={cn("drawer-wrapper", activeSideLayer === "steps" && "expanded")}>
                <div className="drawer-inner pt-3">
                  {renderStepNavigatorPanel()}
                </div>
              </div>
            </div>
            <section className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-card)]">
              <div className="mb-5 flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Terminal size={15} className="text-[var(--color-accent)]" />
                    <h3 className="text-[var(--font-size-base)] font-semibold text-[var(--color-text-primary)]">
                      {t("workflows.steps")}
                    </h3>
                  </div>
                  <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
                    {t("workflows.stepsHelper")}
                  </p>
                  {validation?.field === "steps" && (
                    <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-error)]">{t(validation.message as never)}</p>
                  )}
                </div>
                <Button size="sm" onClick={addStep}>
                  <Plus size={14} />
                  {t("workflows.addStep")}
                </Button>
              </div>

              <DndContext sensors={sensors} collisionDetection={editorCollisionDetection} onDragEnd={handleEditorSortEnd}>
                <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                  <div className="wf-pipeline flex flex-col">
                    {draft.steps.map((step, index) => {
                      const preview = step.command ? interpolateWorkflowCommand(step.command, previewValues) : null;
                      const hasPreview = preview !== null && preview !== step.command;

                      return (
                        <SortableWorkflowStep
                          key={step.id}
                          id={step.id}
                          index={index}
                          setStepRef={(el) => {
                            if (el) stepRefsRef.current.set(index, el);
                            else stepRefsRef.current.delete(index);
                          }}
                        >
                          <StepCard
                            step={step}
                            index={index}
                            totalSteps={draft.steps.length}
                            isActive={activeStepIndex === index}
                            onFocusStep={() => setActiveStepIndex(index)}
                            onMoveUp={() => moveStepBy(index, -1)}
                            onMoveDown={() => moveStepBy(index, 1)}
                            onTitleChange={(title) => {
                              const next = [...draft.steps];
                              next[index] = { ...step, title };
                              onChange({ ...draft, steps: next });
                            }}
                            onCommandChange={(command) => {
                              const next = [...draft.steps];
                              next[index] = { ...step, command };
                              onChange({ ...draft, steps: next });
                            }}
                            onRemove={() => {
                              const next = draft.steps.filter((_, i) => i !== index);
                              onChange({ ...draft, steps: next });
                              setActiveStepIndex((current) => Math.max(0, Math.min(current, next.length - 1)));
                            }}
                            onDuplicate={() => {
                              const currentStep = draft.steps[index];
                              const newStep: WorkflowRecipeStep = { id: crypto.randomUUID(), title: currentStep.title ? `${currentStep.title} (copy)` : "", command: currentStep.command };
                              const next = [...draft.steps];
                              next.splice(index + 1, 0, newStep);
                              onChange({ ...draft, steps: next });
                              setActiveStepIndex(index + 1);
                            }}
                            preview={preview}
                            hasPreview={hasPreview}
                            params={draft.params.filter((p) => p.key.trim())}
                          />
                        </SortableWorkflowStep>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute left-0 top-24 bottom-24 z-20 hidden lg:flex items-start">
        <div ref={stepLayerRef} className="pointer-events-auto flex items-start pt-4">
          {activeSideLayer !== "steps" && (
            <StepDrawerTab
              open={false}
              count={draft.steps.length}
              onClick={() => openSideLayer("steps")}
            />
          )}
          <div
            className="step-drawer-shell"
            data-state={activeSideLayer === "steps" ? "open" : "closed"}
          >
            <div className="step-drawer-panel flex items-start">
              <div className="w-[280px]">
                {renderStepNavigatorPanel("rounded-l-none rounded-tr-none rounded-br-[var(--radius-card)] shadow-none")}
              </div>
              <StepDrawerTab
                open
                count={draft.steps.length}
                onClick={closeSideLayer}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute right-0 top-24 bottom-24 z-20 hidden lg:flex items-start justify-end">
        <div ref={paramLayerRef} className="pointer-events-auto flex items-start pt-4">
          <div
            className="param-drawer-shell"
            data-state={activeSideLayer === "params" ? "open" : "closed"}
          >
            <div className="param-drawer-panel flex items-start">
              <ParamDrawerTab
                open
                count={draft.params.length}
                onClick={closeSideLayer}
              />
              <div className="min-w-0 flex-1">
                <ParamInspectorPanel
                  draft={draft}
                  validation={validation}
                  onChange={onChange}
                  addParam={addParam}
                />
              </div>
            </div>
          </div>
          {activeSideLayer !== "params" && (
            <ParamDrawerTab
              open={false}
              count={draft.params.length}
              onClick={() => openSideLayer("params")}
            />
          )}
        </div>
      </div>

{/* Floating bottom action bar */}
      <div className={cn(
        "absolute bottom-2 right-2 z-10 flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2 shadow-[var(--shadow-floating)] transition-all duration-300",
        fadeOut && "opacity-0 scale-95 translate-y-1"
      )}>
        <button
          type="button"
          onClick={() => {
            setFadeOut(true);
            setTimeout(onCancel, 200);
          }}
          className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {t("workflows.cancel")}
        </button>
        {dirty && saveStatus === "idle" && !fadeOut && (
          <span className="flex items-center gap-1.5 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            {t("workflows.dirtyHint")}
          </span>
        )}
        <Button onClick={() => void handleSave()}>
          {saveStatus === "saved" ? <Check size={14} /> : null}
          {saveStatus === "saved" ? t("workflows.saved") : savingLabel}
        </Button>
      </div>

      {spotlightOpen && (
        <SpotlightOverlay
          actions={spotlightActions}
          onClose={() => setSpotlightOpen(false)}
        />
      )}
    </div>
  );
}

function StepDrawerTab({
  open,
  count,
  onClick,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
}) {
  const t = useT();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex w-10 min-h-[136px] flex-col items-center justify-center gap-2 self-start rounded-r-[var(--radius-control)] border border-l-0 px-1.5 py-3 transition-all duration-150",
        open
          ? "border-[var(--color-accent)]/24 bg-[var(--color-bg-surface)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02)),var(--color-bg-surface)] text-[var(--color-text-muted)] hover:-translate-x-0.5 hover:border-[var(--color-accent)]/20 hover:bg-[linear-gradient(180deg,rgba(59,130,246,0.12),rgba(59,130,246,0.04)),var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
      )}
      title={open ? t("workflows.hideStepNavigator") : t("workflows.showStepNavigator")}
      aria-label={open ? t("workflows.hideStepNavigator") : t("workflows.showStepNavigator")}
      aria-expanded={open}
    >
      {open && <span className="absolute inset-y-2 left-0 w-[2px] rounded-r-full bg-[var(--color-accent)]" />}
      <div className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
        open
          ? "border-[var(--color-accent)]/25 bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-base)]/70 text-[var(--color-text-muted)]",
      )}>
        <Terminal size={14} />
      </div>
      <span
        className={cn(
          "text-[11px] font-semibold tracking-[0.12em] uppercase",
          open ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]",
        )}
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {t("workflows.stepNavigatorShort")}
      </span>
      <span className={cn(
        "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        open
          ? "border-[var(--color-accent)]/22 bg-[var(--color-bg-base)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]",
      )}>
        {count}
      </span>
      <div className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
        open
          ? "bg-[var(--color-bg-base)] text-[var(--color-accent)]"
          : "bg-[var(--color-bg-base)]/70 text-[var(--color-text-secondary)]",
      )}>
        {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </div>
    </button>
  );
}

function ParamDrawerTab({
  open,
  count,
  onClick,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
}) {
  const t = useT();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex w-10 min-h-[136px] flex-col items-center justify-center gap-2 self-start rounded-bl-[var(--radius-control)] rounded-tl-[var(--radius-control)] border border-r-0 px-1.5 py-3 transition-all duration-150",
        open
          ? "border-[var(--color-text-muted)]/24 bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]"
          : "border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02)),var(--color-bg-surface)] text-[var(--color-text-muted)] hover:translate-x-0.5 hover:border-[var(--color-accent)]/20 hover:bg-[linear-gradient(180deg,rgba(59,130,246,0.12),rgba(59,130,246,0.04)),var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]",
      )}
      title={open ? t("workflows.hideParamsInspector") : t("workflows.showParamsInspector")}
      aria-label={open ? t("workflows.hideParamsInspector") : t("workflows.showParamsInspector")}
      aria-expanded={open}
    >
      {open && <span className="absolute inset-y-2 right-0 w-[2px] rounded-l-full bg-[var(--color-text-muted)]" />}
      <div className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
        open
          ? "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-base)]/70 text-[var(--color-text-muted)]",
      )}>
        <Settings2 size={14} />
      </div>
      <span
        className={cn(
          "text-[11px] font-semibold tracking-[0.12em] uppercase",
          open ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-muted)]",
        )}
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {t("workflows.paramInspectorShort")}
      </span>
      <span className={cn(
        "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        open
          ? "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-muted)]",
      )}>
        {count}
      </span>
      <div className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
        open
          ? "bg-[var(--color-bg-base)] text-[var(--color-text-secondary)]"
          : "bg-[var(--color-bg-base)]/70 text-[var(--color-text-muted)]",
      )}>
        {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </div>
    </button>
  );
}

function SortableNavStep({
  id,
  index,
  title,
  subtitle,
  isActive,
  isFirst,
  isLast,
  onSelect,
  onMoveUp,
  onMoveDown,
}: {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-2 transition-all",
        isActive
          ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 shadow-[var(--shadow-floating)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-base)]/40",
        isDragging && "z-10 opacity-70 shadow-[var(--shadow-floating)]"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] opacity-60 transition-colors hover:bg-[var(--color-bg-hover)] hover:opacity-100"
          title="Drag to reorder"
        >
          <GripVertical size={13} />
        </button>
        <div className={cn(
          "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
          isActive
            ? "bg-[var(--color-accent)] text-white"
            : "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
        )}>
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {title}
          </p>
          <p className="truncate text-[11px] text-[var(--color-text-muted)]">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          <ChevronLeft size={14} className="rotate-90" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          <ChevronRight size={14} className="rotate-90" />
        </button>
      </div>
    </div>
  );
}

function SortableWorkflowStep({
  id,
  index,
  setStepRef,
  children,
}: {
  id: string;
  index: number;
  setStepRef: (element: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={(element) => {
        setNodeRef(element);
        setStepRef(element);
      }}
      className="wf-pipeline-step animate-list-item"
      style={{ "--i": index, transform: CSS.Transform.toString(transform), transition } as React.CSSProperties}
    >
      <div className="wf-pipeline-dot" />
      <StepDragHandleContext.Provider value={{
        setActivatorNodeRef,
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as Record<string, unknown> | undefined,
        isDragging,
      }}>
        {children}
      </StepDragHandleContext.Provider>
    </div>
  );
}

const StepDragHandleContext = React.createContext<StepCardProps["dragHandleProps"] & { isDragging?: boolean } | null>(null);

interface StepCardProps {
  step: WorkflowRecipeStep;
  index: number;
  totalSteps: number;
  isActive: boolean;
  onFocusStep: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragHandleProps?: {
    setActivatorNodeRef: (element: HTMLElement | null) => void;
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown> | undefined;
  };
  onTitleChange: (title: string) => void;
  onCommandChange: (command: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  preview: string | null;
  hasPreview: boolean;
  params: WorkflowRecipeParam[];
}

function StepCard(
  { step, index, totalSteps, isActive, onFocusStep, onMoveUp, onMoveDown, dragHandleProps, onTitleChange, onCommandChange, onRemove, onDuplicate, preview, hasPreview, params }: StepCardProps,
) {
  const t = useT();
  const sortableDragHandle = React.useContext(StepDragHandleContext);
  const resolvedDragHandle = dragHandleProps ?? sortableDragHandle ?? undefined;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [varHint, setVarHint] = useState<{ filter: string; rawFilter: string; insertPos: number } | null>(null);
  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 132)}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [step.command, syncTextareaHeight]);

  const handleCommandKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Backspace") return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const cursorPos = el.selectionStart;
    const before = el.value.slice(0, cursorPos);
    const after = el.value.slice(cursorPos);

    const openIndex = before.lastIndexOf("{{");
    if (openIndex === -1) return;

    const token = before.slice(openIndex);
    if (!token.startsWith("{{")) return;
    if (token.includes("\n")) return;

    // Keep the first Backspace natural for {{key}} -> {{key}
    if (token.endsWith("}}")) return;

    // After one } is deleted, collapse the remaining {{key} or {{key in one go.
    if (/^\{\{[^{}]+\}?$/.test(token)) {
      e.preventDefault();
      el.value = el.value.slice(0, openIndex) + after;
      onCommandChange(el.value);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = openIndex;
      });
    }
  }, [onCommandChange]);

  const handleCommandChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    onCommandChange(value);

    const textBefore = value.slice(0, cursorPos);
    const match = textBefore.match(/\{\{([^\n{}]*)$/);
    if (match) {
      setVarHint({ filter: match[1].trim(), rawFilter: match[1], insertPos: cursorPos });
    } else {
      setVarHint(null);
    }
  }, [onCommandChange]);

  const insertParam = useCallback((key: string) => {
    if (!varHint) return;
    const pos = varHint.insertPos;
    const before = step.command.slice(0, pos - varHint.rawFilter.length - 2);
    const after = step.command.slice(pos);
    const newCommand = before + `{{${key}}}` + after;
    onCommandChange(newCommand);
    setVarHint(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const cursorPos = before.length + key.length + 4;
      textareaRef.current.focus();
      textareaRef.current.selectionStart = cursorPos;
      textareaRef.current.selectionEnd = cursorPos;
      syncTextareaHeight();
    });
  }, [varHint, step.command, onCommandChange, syncTextareaHeight]);

  const insertParamAtCursor = useCallback((key: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? step.command.length;
    const end = el?.selectionEnd ?? step.command.length;
    const token = `{{${key}}}`;
    const newCommand = step.command.slice(0, start) + token + step.command.slice(end);

    onCommandChange(newCommand);
    setVarHint(null);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const cursorPos = start + token.length;
      textareaRef.current.focus();
      textareaRef.current.selectionStart = cursorPos;
      textareaRef.current.selectionEnd = cursorPos;
      syncTextareaHeight();
    });
  }, [onCommandChange, step.command, syncTextareaHeight]);

  const filteredParams = useMemo(() => {
    if (!varHint) return [];
    const keys = params.map((p) => p.key.trim()).filter(Boolean);
    if (!varHint.filter) return keys;
    return keys.filter((k) => k.toLowerCase().includes(varHint.filter.toLowerCase()));
  }, [varHint, params]);

  const showVarHint = varHint !== null && (filteredParams.length > 0 || params.length === 0);
  const [varHintIndex, setVarHintIndex] = useState(0);

  useEffect(() => { setVarHintIndex(0); }, [filteredParams]);

  useEffect(() => {
    if (!showVarHint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setVarHint(null); }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setVarHintIndex((i) => Math.min(i + 1, filteredParams.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setVarHintIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filteredParams.length > 0) {
        e.preventDefault();
        insertParam(filteredParams[varHintIndex]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showVarHint, filteredParams, insertParam, varHintIndex]);
  return (
    <div
      className={cn(
        "group wf-step-card wf-step-card--pending rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_28%),var(--color-bg-surface)] p-4 transition-all duration-[var(--duration-base)]",
        sortableDragHandle?.isDragging && "wf-step-card--dragging opacity-70",
        isActive && "border-[var(--color-accent)]/30 shadow-[0_18px_36px_rgba(0,0,0,0.16)]",
        "hover:border-[var(--color-text-muted)]/30 hover:shadow-[var(--shadow-floating)]",
      )}
      onClick={onFocusStep}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            ref={resolvedDragHandle?.setActivatorNodeRef}
            {...resolvedDragHandle?.attributes}
            {...resolvedDragHandle?.listeners}
            className="wf-step-drag-handle flex-shrink-0 flex items-center justify-center h-6 w-5 rounded-[3px] hover:bg-[var(--color-bg-hover)] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} className="text-[var(--color-text-muted)]" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[11px] font-bold text-[var(--color-accent)]">
            {index + 1}
          </div>
          <Input
            value={step.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onFocus={onFocusStep}
            placeholder={t("workflows.stepNumber", { n: index + 1 })}
            className="h-8 border-none bg-transparent px-1 text-[var(--font-size-base)] font-semibold text-[var(--color-text-primary)] focus:bg-[var(--color-bg-elevated)]"
          />
        </div>
        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              disabled={index === 0}
              onClick={onMoveUp}
              className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-control)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors disabled:opacity-30"
              title="Move up"
            >
              <ChevronLeft size={13} className="rotate-90" />
            </button>
            <button
              type="button"
              disabled={index === totalSteps - 1}
              onClick={onMoveDown}
              className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-control)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors disabled:opacity-30"
              title="Move down"
            >
              <ChevronRight size={13} className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-control)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors"
              title={t("workflows.duplicateStep")}
            >
              <Copy size={13} />
            </button>
            <button
              type="button"
              disabled={totalSteps === 1}
              onClick={onRemove}
              className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-control)] hover:bg-[var(--color-error)]/10 text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors disabled:opacity-30"
            >
              <Trash2 size={13} />
            </button>
          </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        <span>{t("workflows.stepCommand")}</span>
        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-0.5 normal-case tracking-normal text-[11px]">
          shell
        </span>
        {params.length > 0 && (
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2 py-0.5 normal-case tracking-normal text-[11px]">
            {params.length} {t("workflows.params")}
          </span>
        )}
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={step.command}
          onChange={handleCommandChange}
          onKeyDown={handleCommandKeyDown}
          onFocus={onFocusStep}
          rows={5}
          placeholder={t("workflows.stepCommand")}
          className="wf-command-editor w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 py-2.5 text-[var(--font-size-sm)] text-[var(--color-text-primary)] font-mono leading-relaxed focus:border-[var(--color-accent)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] resize-none transition-colors duration-[var(--duration-fast)]"
        />
        <div className="pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-40">
          <Terminal size={12} className="text-[var(--color-text-muted)]" />
        </div>

        {showVarHint && (
          <div className="relative z-10 mt-2 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-accent)]/35 bg-[var(--color-bg-base)] shadow-[0_16px_30px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
              <Variable size={12} className="text-[var(--color-accent)]" />
              <span>{t("workflows.varHintTitle")}</span>
              <kbd className="ml-auto rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">ESC</kbd>
            </div>
            {filteredParams.length > 0 ? (
              <div className="max-h-52 overflow-y-auto py-1">
                {filteredParams.map((key, i) => {
                  const param = params.find((p) => p.key === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                        i === varHintIndex
                          ? "bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                      )}
                      onClick={() => insertParam(key)}
                      onMouseEnter={() => setVarHintIndex(i)}
                    >
                      <span className="font-mono text-[var(--font-size-sm)] text-[var(--color-accent)]">{`{{${key}}}`}</span>
                      {param?.defaultValue && (
                        <span className="max-w-[45%] truncate font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                          {param.defaultValue}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-4 text-center">
                <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("workflows.varHintNoParams")}</p>
              </div>
            )}
          </div>
        )}

        <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {t("workflows.stepCommandHint")}
        </p>

        {params.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {params.map((param) => (
              <button
                key={param.key}
                type="button"
                onClick={() => insertParamAtCursor(param.key)}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/10"
              >
                {`{{${param.key}}}`}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {hasPreview && preview && (
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
  );
}

function ParamInspectorPanel({
  draft,
  validation,
  onChange,
  addParam,
}: {
  draft: WorkflowRecipeDraft;
  validation: WorkflowDraftValidationResult | null;
  onChange: (draft: WorkflowRecipeDraft) => void;
  addParam: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");

  const filteredParams = useMemo(() => {
    if (!search.trim()) return draft.params;
    const q = search.toLowerCase();
    return draft.params.filter((p) => p.key.toLowerCase().includes(q));
  }, [draft.params, search]);

  return (
    <section
      role="region"
      aria-label={t("workflows.paramInspector")}
      className="flex max-h-[calc(100vh-220px)] flex-col overflow-hidden rounded-bl-[var(--radius-card)] rounded-br-none rounded-tr-none border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-none"
    >
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              {t("workflows.paramInspector")}
            </p>
            <p className="mt-1 text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
              {draft.params.length} {t("workflows.params")}
            </p>
          </div>
        </div>
        {draft.params.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-base)]/60 px-3 py-1.5">
            <Search size={12} className="flex-shrink-0 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("workflows.searchParams")}
              className="min-w-0 flex-1 border-none bg-transparent text-[var(--font-size-xs)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]/50"
            />
          </div>
        )}
      </div>

      {validation?.field === "params" && (
        <div className="px-4 pt-3">
          <p className="text-[var(--font-size-xs)] text-[var(--color-error)]">{t(validation.message as never)}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {filteredParams.length === 0 && draft.params.length === 0 ? (
          <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-base)]/30 px-4 py-6 text-center">
            <Variable size={22} className="mx-auto mb-2 text-[var(--color-text-muted)] opacity-50" />
            <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("workflows.noParams")}</p>
            <Button size="sm" variant="ghost" className="mt-3" onClick={addParam}>
              <Plus size={14} />
              {t("workflows.addFirstParam")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredParams.map((param) => {
              const index = draft.params.indexOf(param);
              return (
                <div
                  key={index}
                  className="group rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-base)]/60 p-3 transition-colors hover:border-[var(--color-border-focus)]/40"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-1 font-mono text-[11px] text-[var(--color-accent)]">
                      {`{{`}
                    </span>
                    <input
                      value={param.key}
                      onChange={(e) => {
                        const next = [...draft.params];
                        next[index] = { ...param, key: e.target.value };
                        onChange({ ...draft, params: next });
                      }}
                      placeholder={t("workflows.paramKey")}
                      className="min-w-0 flex-1 border-none bg-transparent px-0 font-mono text-[var(--font-size-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]/40"
                    />
                    <span className="inline-flex items-center rounded-full bg-[var(--color-bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                      {`}}`}
                    </span>
                    <button
                      type="button"
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] opacity-0 transition-all hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] group-hover:opacity-100"
                      onClick={() => onChange({ ...draft, params: draft.params.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <input
                    value={param.defaultValue ?? ""}
                    onChange={(e) => {
                      const next = [...draft.params];
                      next[index] = { ...param, defaultValue: e.target.value };
                      onChange({ ...draft, params: next });
                    }}
                    placeholder={t("workflows.paramDefault")}
                    className="h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)]"
                  />
                </div>
              );
            })}
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] px-3 py-2.5 text-[var(--font-size-sm)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              onClick={addParam}
            >
              <Plus size={14} />
              {t("workflows.addParam")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function GroupChipSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-0.5 text-[var(--font-size-xs)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <FolderOpen size={11} />
        <span className="max-w-[80px] truncate">{selected?.label ?? ""}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-floating)] py-1 overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "w-full text-left px-3 py-1.5 text-[var(--font-size-xs)] transition-colors truncate",
                opt.value === value
                  ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              )}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SpotlightOverlay({
  actions,
  onClose,
}: {
  actions: { id: string; label: string; section: string; icon: React.ReactNode; onSelect: () => void }[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [query, actions]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof actions>();
    for (const a of filtered) {
      const group = map.get(a.section) ?? [];
      group.push(a);
      map.set(a.section, group);
    }
    return map;
  }, [filtered]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); const action = filtered[selectedIndex]; if (action) { action.onSelect(); onClose(); } }
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [filtered, selectedIndex, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[var(--radius-popover)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-modal)] overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-[var(--color-border)] px-4">
          <Search size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions..."
            className="flex-1 border-none bg-transparent px-3 py-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:outline-none placeholder:text-[var(--color-text-muted)]"
            autoFocus
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">ESC</kbd>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {[...grouped.entries()].map(([section, items]) => (
            <div key={section}>
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-medium">{section}</div>
              {items.map((action) => {
                const globalIndex = filtered.indexOf(action);
                const isActive = globalIndex === selectedIndex;
                return (
                  <div
                    key={action.id}
                    className={cn(
                      "flex items-center gap-3 rounded-[8px] px-3 py-2 cursor-pointer transition-colors",
                      isActive ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                    )}
                    onClick={() => { action.onSelect(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    {action.icon}
                    <span className="text-[var(--font-size-sm)]">{action.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
