import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock3, Search, Zap } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorkflowRecipe } from "@/types";

const MACRO_PANEL_TRANSITION_MS = 320;

interface ParsedMacroParam {
  key: string;
  defaultValue: string;
  required: boolean;
  secret: boolean;
}

function countJsonItems(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function formatLastRun(ts: number | undefined): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function parseRecipeParams(paramsJson: string): ParsedMacroParam[] {
  try {
    const parsed = JSON.parse(paramsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item !== "object" || item === null) return null;
        const record = item as Record<string, unknown>;
        const key = typeof record.key === "string" ? record.key.trim() : "";
        if (!key) return null;
        const rawDefault = record.defaultValue ?? record.default_value;
        const defaultValue = typeof rawDefault === "string" ? rawDefault : "";
        return {
          key,
          defaultValue,
          required: record.required === true,
          secret: record.secret === true,
        };
      })
      .filter((param): param is ParsedMacroParam => Boolean(param));
  } catch {
    return [];
  }
}

export function MacroQuickPanel({
  open,
  recipes,
  recentRecipes,
  lastRunAtMap,
  running,
  onRun,
  onClose,
}: {
  open: boolean;
  recipes: WorkflowRecipe[];
  recentRecipes: WorkflowRecipe[];
  lastRunAtMap: Record<string, number>;
  running: boolean;
  onRun: (recipe: WorkflowRecipe, runtimeParams?: Record<string, string>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [runtimeValuesByRecipe, setRuntimeValuesByRecipe] = useState<Record<string, Record<string, string>>>({});
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(open);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((recipe) => {
      const title = recipe.title.toLowerCase();
      const desc = (recipe.description ?? "").toLowerCase();
      return title.includes(q) || desc.includes(q);
    });
  }, [query, recipes]);

  const selectedRecipe = filtered[selectedIndex] ?? null;
  const selectedParams = useMemo(
    () => parseRecipeParams(selectedRecipe?.paramsJson ?? "[]"),
    [selectedRecipe],
  );
  const selectedOverrides = useMemo(
    () => (selectedRecipe ? runtimeValuesByRecipe[selectedRecipe.id] ?? {} : {}),
    [runtimeValuesByRecipe, selectedRecipe],
  );
  const selectedOverrideCount = useMemo(
    () => Object.keys(selectedOverrides).filter((key) => selectedOverrides[key] !== undefined).length,
    [selectedOverrides],
  );

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const frame = requestAnimationFrame(() => setIsActive(true));
      return () => cancelAnimationFrame(frame);
    }
    setIsActive(false);
    const timer = setTimeout(() => setShouldRender(false), MACRO_PANEL_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    setShowAdvancedParams(false);
    setConfirmRunId(null);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedIndex <= Math.max(filtered.length - 1, 0)) return;
    setSelectedIndex(0);
  }, [filtered.length, selectedIndex]);

  const handleRun = (recipe: WorkflowRecipe) => {
    onRun(recipe, runtimeValuesByRecipe[recipe.id] ?? {});
  };

  const requestRun = (recipe: WorkflowRecipe) => {
    if (running) return;
    if (confirmRunId === recipe.id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmRunId(null);
      handleRun(recipe);
      return;
    }

    setConfirmRunId(recipe.id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmRunId(null);
    }, 2000);
  };

  const selectRecipe = (index: number) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmRunId(null);
    setSelectedIndex(index);
  };

  const updateParamOverride = (recipeId: string, key: string, value: string) => {
    setRuntimeValuesByRecipe((prev) => {
      const existing = prev[recipeId] ?? {};
      return {
        ...prev,
        [recipeId]: {
          ...existing,
          [key]: value,
        },
      };
    });
  };

  const clearParamOverrides = (recipeId: string, defaults: ParsedMacroParam[]) => {
    setRuntimeValuesByRecipe((prev) => {
      const existing = prev[recipeId] ?? {};
      const nextValues = { ...existing };
      for (const param of defaults) {
        delete nextValues[param.key];
      }
      return {
        ...prev,
        [recipeId]: nextValues,
      };
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const recipe = filtered[selectedIndex];
        if (!recipe || running) return;
        requestRun(recipe);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmRunId, filtered, onClose, open, running, runtimeValuesByRecipe, selectedIndex]);

  if (!shouldRender) return null;

  return (
    <div
      ref={containerRef}
      className="terminal-macro-panel absolute right-0 top-9 z-30 w-[420px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-floating)]"
      data-state={open && isActive ? "open" : "closed"}
      aria-hidden={!open}
    >
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-base)] px-2.5 py-1.5">
          <Search size={14} className="text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("macro.search")}
            className="w-full bg-transparent text-[var(--font-size-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>

      <div className="max-h-[320px] space-y-2.5 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("macro.noResults")}
          </div>
        ) : (
          filtered.map((recipe, index) => {
            const stepCount = countJsonItems(recipe.stepsJson);
            const paramCount = countJsonItems(recipe.paramsJson);
            return (
              <button
                key={recipe.id}
                onClick={() => {
                  if (showAdvancedParams) {
                    if (index !== selectedIndex) selectRecipe(index);
                    if (running) return;
                    requestRun(recipe);
                    return;
                  }
                  if (running) return;
                  requestRun(recipe);
                }}
                onMouseEnter={() => {
                  if (!showAdvancedParams) setSelectedIndex(index);
                }}
                className={cn(
                  "terminal-macro-recipe relative w-full overflow-hidden rounded-[var(--radius-control)] text-left transition-colors",
                  index === selectedIndex && "is-selected",
                  running && "cursor-not-allowed opacity-60",
                )}
              >
                {confirmRunId === recipe.id && (
                  <div
                    className="absolute bottom-0 left-0 h-[2px] rounded-full bg-[var(--color-accent)]"
                    style={{ animation: "bookmark-confirm 2s linear forwards" }}
                  />
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">{recipe.title}</p>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{stepCount} {t("macro.steps")}</span>
                </div>
                <div className="mt-1.5 line-clamp-1 text-[11px] leading-snug text-[var(--color-text-muted)]">{recipe.description || "-"}</div>
                <div className="mt-2 flex min-w-0 items-center gap-3 text-[10px] leading-snug text-[var(--color-text-muted)]">
                  <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                    <span>{paramCount} {t("macro.params")}</span>
                    <span className="truncate">{t("macro.lastRun")}: {formatLastRun(lastRunAtMap[recipe.id])}</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-2">
        <button
          onClick={() => setShowAdvancedParams((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          <span>{t("macro.advancedParams")}</span>
          <ChevronDown
            size={12}
            className={cn("transition-transform", showAdvancedParams && "rotate-180")}
          />
        </button>
        {showAdvancedParams && selectedRecipe && (
          <div className="mt-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-base)] p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">{selectedRecipe.title}</p>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {t("macro.overrideCount", { n: selectedOverrideCount })}
              </span>
            </div>
            <div className="mb-2 px-1 text-[10px] text-[var(--color-text-muted)]">
              {t("macro.advancedParamsHint")}
            </div>
            {selectedParams.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-[var(--color-text-muted)]">{t("macro.noParams")}</p>
            ) : (
              <div className="max-h-[min(30vh,260px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {selectedParams.map((param) => {
                  const currentValue = selectedOverrides[param.key] ?? param.defaultValue;
                  return (
                    <label key={param.key} className="block">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                        <span className="min-w-0 break-all font-medium text-[var(--color-text-secondary)]">{param.key}</span>
                        {param.required && <span className="rounded-full border border-[var(--color-border)] px-1">{t("macro.required")}</span>}
                        {param.secret && <span className="rounded-full border border-[var(--color-border)] px-1">{t("macro.secret")}</span>}
                      </div>
                      <input
                        type={param.secret ? "password" : "text"}
                        value={currentValue}
                        onChange={(event) => {
                          updateParamOverride(selectedRecipe.id, param.key, event.target.value);
                        }}
                        className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                        placeholder={t("macro.paramPlaceholder")}
                      />
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex items-center justify-start gap-2">
              <button
                onClick={() => clearParamOverrides(selectedRecipe.id, selectedParams)}
                className="rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {t("macro.useDefaults")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-base)]/80 p-2">
        <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          <Clock3 size={10} />
          <span>{t("macro.recent")}</span>
        </div>
        <div className="flex gap-1 px-1">
          {recentRecipes.length === 0 ? (
            <span className="px-2 py-1 text-[11px] text-[var(--color-text-muted)]">{t("macro.noneRecent")}</span>
          ) : (
            recentRecipes.map((recipe) => (
              <button
                key={recipe.id}
                onClick={() => requestRun(recipe)}
                className="relative inline-flex items-center gap-1 overflow-hidden rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {confirmRunId === recipe.id && (
                  <div
                    className="absolute bottom-0 left-0 h-[2px] rounded-full bg-[var(--color-accent)]"
                    style={{ animation: "bookmark-confirm 2s linear forwards" }}
                  />
                )}
                <Zap size={10} />
                <span className="max-w-[120px] truncate">{recipe.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
