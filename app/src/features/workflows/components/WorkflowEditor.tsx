import React, { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Terminal, Trash2, Variable } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useWorkflowsStore } from "@/stores/workflows";
import {
  buildWorkflowPreviewValues,
  interpolateWorkflowCommand,
  type WorkflowDraftValidationResult,
  type WorkflowRecipeDraft,
} from "@/stores/workflows";
import type { WorkflowRecipeStep } from "@/types";

const DRAG_THRESHOLD = 5;
const LONG_PRESS_MS = 200;

export function WorkflowEditor({
  draft,
  validation,
  onChange,
  onSave,
  onCancel,
  savingLabel,
}: {
  draft: WorkflowRecipeDraft;
  validation: WorkflowDraftValidationResult | null;
  onChange: (draft: WorkflowRecipeDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  savingLabel: string;
}) {
  const t = useT();
  const groups = useWorkflowsStore((s) => s.groups);
  const previewValues = buildWorkflowPreviewValues(draft);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ index: number; startX: number; startY: number; longPressTimer: ReturnType<typeof setTimeout> | null } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const stepRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const flipSnapshotRef = useRef<Map<string, DOMRect>>(new Map());

  const recordFlipSnapshot = useCallback(() => {
    const snapshot = new Map<string, DOMRect>();
    stepRefsRef.current.forEach((el, idx) => {
      if (el && draft.steps[idx]) {
        snapshot.set(draft.steps[idx].id, el.getBoundingClientRect());
      }
    });
    flipSnapshotRef.current = snapshot;
  }, [draft.steps]);

  useEffect(() => {
    if (!isDragging && dragIndex === null && flipSnapshotRef.current.size > 0) {
      const firstRects = flipSnapshotRef.current;
      flipSnapshotRef.current = new Map();

      requestAnimationFrame(() => {
        draft.steps.forEach((step, idx) => {
          const el = stepRefsRef.current.get(idx);
          const first = firstRects.get(step.id);
          if (!el || !first) return;

          const last = el.getBoundingClientRect();
          const dx = first.left - last.left;
          const dy = first.top - last.top;
          if (dx === 0 && dy === 0) return;

          el.style.transform = `translate(${dx}px, ${dy}px)`;
          el.style.transition = "none";

          requestAnimationFrame(() => {
            el.style.transition = "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)";
            el.style.transform = "";
            el.addEventListener("transitionend", function cleanup() {
              el.style.transition = "";
              el.style.transform = "";
              el.removeEventListener("transitionend", cleanup);
            }, { once: true });
          });
        });
      });
    }
  });

  const handleStepDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    const timer = setTimeout(() => {
      dragStartRef.current = { index, startX: e.clientX, startY: e.clientY, longPressTimer: null };
      setIsDragging(true);
      setDragIndex(index);
      setDropIndex(null);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }, LONG_PRESS_MS);
    dragStartRef.current = { index, startX: e.clientX, startY: e.clientY, longPressTimer: timer };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !isDragging) {
        if (dragStartRef.current?.longPressTimer) {
          const dx = e.clientX - dragStartRef.current.startX;
          const dy = e.clientY - dragStartRef.current.startY;
          if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
            clearTimeout(dragStartRef.current.longPressTimer);
            dragStartRef.current = null;
          }
        }
        return;
      }

      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
      }

      const container = containerRef.current;
      if (!container) return;

      let newDropIndex: number | null = null;
      const entries = Array.from(stepRefsRef.current.entries()).sort(([a], [b]) => a - b);

      for (const [idx, el] of entries) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          newDropIndex = idx;
          break;
        }
      }
      if (newDropIndex === null) {
        newDropIndex = draft.steps.length;
      }
      setDropIndex(newDropIndex);
    };

    const handleMouseUp = () => {
      if (dragStartRef.current?.longPressTimer) {
        clearTimeout(dragStartRef.current.longPressTimer);
      }

      if (isDragging && dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
        recordFlipSnapshot();
        const steps = [...draft.steps];
        const [moved] = steps.splice(dragIndex, 1);
        const insertAt = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
        steps.splice(insertAt, 0, moved);
        onChange({ ...draft, steps });
      }

      setIsDragging(false);
      setDragIndex(null);
      setDropIndex(null);
      dragStartRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (dragStartRef.current?.longPressTimer) {
        clearTimeout(dragStartRef.current.longPressTimer);
      }
    };
  }, [isDragging, dragIndex, dropIndex, draft, onChange]);

  return (
    <div className="animate-fade-in-up mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="glass-card rounded-[var(--radius-card)] p-5">
        <div className="mb-4">
          <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            {t("workflows.formTitle")}
          </label>
          <Input
            value={draft.title}
            error={validation?.field === "title"}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder={t("workflows.placeholderTitle")}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            {t("workflows.formDescription")}
          </label>
          <textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            rows={2}
            placeholder={t("workflows.placeholderDescription")}
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none resize-y transition-colors duration-[var(--duration-fast)]"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {groups.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                {t("workflows.formGroup")}
              </label>
              <Select
                value={draft.groupId ?? ""}
                onChange={(v) => onChange({ ...draft, groupId: v || null })}
                options={[
                  { value: "", label: t("workflows.noGroup") },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>
          )}
<div>
             <label className="mb-1.5 block text-[var(--font-size-xs)] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
               {t("workflows.formTargetHost")}
             </label>
             <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] italic">
               {t("workflows.hostSelectAtRunTime")}
             </p>
           </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Variable size={15} className="text-[var(--color-accent)]" />
            <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
              {t("workflows.params")}
            </h3>
            {validation?.field === "params" && (
              <p className="text-[var(--font-size-xs)] text-[var(--color-error)]">{t(validation.message as never)}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...draft, params: [...draft.params, { key: "", label: "", defaultValue: "", required: false }] })}
          >
            <Plus size={14} />
            {t("workflows.addParam")}
          </Button>
        </div>

        {draft.params.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)]">
            <Variable size={24} className="mb-2 text-[var(--color-text-muted)] opacity-40" />
            <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">{t("workflows.noParams")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {draft.params.map((param, index) => (
              <div key={`${param.key}-${index}`} className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-base)] p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                  <Input
                    value={param.key}
                    onChange={(e) => {
                      const next = [...draft.params];
                      next[index] = { ...param, key: e.target.value };
                      onChange({ ...draft, params: next });
                    }}
                    placeholder={t("workflows.paramKey")}
                  />
                  <Input
                    value={param.label}
                    onChange={(e) => {
                      const next = [...draft.params];
                      next[index] = { ...param, label: e.target.value };
                      onChange({ ...draft, params: next });
                    }}
                    placeholder={t("workflows.paramLabel")}
                  />
                  <Input
                    value={param.defaultValue ?? ""}
                    onChange={(e) => {
                      const next = [...draft.params];
                      next[index] = { ...param, defaultValue: e.target.value };
                      onChange({ ...draft, params: next });
                    }}
                    placeholder={t("workflows.paramDefault")}
                  />
                  <label className="flex items-center gap-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)] px-1">
                    <input
                      type="checkbox"
                      checked={param.required}
                      onChange={(e) => {
                        const next = [...draft.params];
                        next[index] = { ...param, required: e.target.checked };
                        onChange({ ...draft, params: next });
                      }}
                    />
                    {t("workflows.required")}
                  </label>
                  <button
                    type="button"
                    className="flex items-center justify-center h-7 w-7 rounded-[var(--radius-control)] hover:bg-[var(--color-bg-hover)]"
                    onClick={() => onChange({ ...draft, params: draft.params.filter((_, i) => i !== index) })}
                  >
                    <Trash2 size={13} className="text-[var(--color-error)]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal size={15} className="text-[var(--color-accent)]" />
            <h3 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
              {t("workflows.steps")}
            </h3>
            {validation?.field === "steps" && (
              <p className="text-[var(--font-size-xs)] text-[var(--color-error)]">{t(validation.message as never)}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...draft, steps: [...draft.steps, { id: crypto.randomUUID(), title: "", command: "" }] })}
          >
            <Plus size={14} />
            {t("workflows.addStep")}
          </Button>
        </div>

        <div ref={containerRef} className="wf-pipeline flex flex-col">
          {draft.steps.map((step, index) => {
            const isItemDragging = isDragging && dragIndex === index;
            const showDropIndicator = isDragging && dropIndex === index && dragIndex !== index;
            const preview = step.command ? interpolateWorkflowCommand(step.command, previewValues) : null;
            const hasPreview = preview !== null && preview !== step.command;

            return (
              <div
                key={step.id}
                className="wf-pipeline-step animate-list-item"
                style={{ "--i": index } as React.CSSProperties}
              >
                <div className="wf-pipeline-dot" />
                {showDropIndicator && <div className="wf-step-drop-indicator mb-3" />}
                <StepCard
                  ref={(el) => {
                    if (el) stepRefsRef.current.set(index, el);
                    else stepRefsRef.current.delete(index);
                  }}
                  step={step}
                  index={index}
                  totalSteps={draft.steps.length}
                  isDragging={isItemDragging}
                  onDragStart={handleStepDragStart}
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
                    onChange({ ...draft, steps: draft.steps.filter((_, i) => i !== index) });
                  }}
                  preview={preview}
                  hasPreview={hasPreview}
                />
              </div>
            );
          })}

          {isDragging && dropIndex === draft.steps.length && dragIndex !== null && dragIndex !== draft.steps.length - 1 && (
            <div className="wf-pipeline-step">
              <div className="wf-step-drop-indicator" />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pb-2">
        <Button variant="secondary" onClick={onCancel}>{t("workflows.cancel")}</Button>
        <Button onClick={onSave}>{savingLabel}</Button>
      </div>

      {isDragging && dragIndex !== null && (
        <div
          ref={ghostRef}
          className="wf-step-ghost fixed left-0 top-0 z-[100] pointer-events-none max-w-[480px] rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-4 py-3 shadow-[var(--shadow-floating)] opacity-90"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[var(--font-size-xs)] font-bold text-[var(--color-accent)]">
              {dragIndex + 1}
            </div>
            <span className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {draft.steps[dragIndex]?.command || t("workflows.stepNumber", { n: dragIndex + 1 })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface StepCardProps {
  step: WorkflowRecipeStep;
  index: number;
  totalSteps: number;
  isDragging: boolean;
  onDragStart: (e: React.MouseEvent, index: number) => void;
  onTitleChange: (title: string) => void;
  onCommandChange: (command: string) => void;
  onRemove: () => void;
  preview: string | null;
  hasPreview: boolean;
}

const StepCard = React.forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  { step, index, totalSteps, isDragging, onDragStart, onTitleChange, onCommandChange, onRemove, preview, hasPreview },
  ref,
) {
  const t = useT();
  return (
    <div
      ref={ref}
      className={cn(
        "wf-step-card wf-step-card--pending glass-card rounded-[var(--radius-card)] border border-[var(--color-border)] p-4 transition-all duration-[var(--duration-base)]",
        isDragging && "wf-step-card--dragging",
        !isDragging && "hover:border-[var(--color-text-muted)]/30 hover:shadow-[var(--shadow-floating)]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="wf-step-drag-handle flex-shrink-0 flex items-center justify-center h-6 w-5 rounded-[3px] hover:bg-[var(--color-bg-hover)] transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              onDragStart(e, index);
            }}
          >
            <GripVertical size={14} className="text-[var(--color-text-muted)]" />
          </div>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[11px] font-bold text-[var(--color-accent)]">
            {index + 1}
          </div>
          <Input
            value={step.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t("workflows.stepNumber", { n: index + 1 })}
            className="h-7 border-none bg-transparent px-1 text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)] focus:bg-[var(--color-bg-elevated)]"
          />
        </div>
        <div className="flex items-center justify-center">
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

      <div className="relative group">
        <textarea
          value={step.command}
          onChange={(e) => onCommandChange(e.target.value)}
          rows={3}
          placeholder={t("workflows.stepCommand")}
          className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-primary)] font-mono focus:border-[var(--color-border-focus)] focus:outline-none resize-none transition-all duration-[var(--duration-fast)] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]"
        />
        <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-40 transition-opacity pointer-events-none">
          <Terminal size={12} className="text-[var(--color-text-muted)]" />
        </div>
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
});