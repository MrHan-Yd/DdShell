import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  Clock,
  FolderPlus,
  Folder,
  FolderOpen,
  FolderInput,
  FolderX,
  ChevronRight,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import type { WorkflowGroup, WorkflowRecipe } from "@/types";
import { useWorkflowsStore } from "@/stores/workflows";

function GroupHeader({
  group,
  selected,
  expanded,
  onSelect,
  onToggle,
  onContextMenu,
  isDropTarget = false,
}: {
  group: WorkflowGroup;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isDropTarget?: boolean;
}) {
  return (
    <div
      data-drop-group-id={group.id}
      className={cn(
        "flex w-full items-center gap-1 rounded-[var(--radius-control)] transition-colors duration-[var(--duration-fast)]",
        isDropTarget
          ? "bg-[var(--color-accent-subtle)] border-2 border-dashed border-[var(--color-accent)] text-[var(--color-accent)]"
          : selected
            ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <button
        onClick={onToggle}
        className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
      >
        <ChevronRight
          size={12}
          className={cn(
            "transition-transform duration-[var(--duration-fast)]",
            expanded && "rotate-90",
          )}
        />
      </button>
      <button
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className="flex flex-1 items-center gap-2 px-1 py-1.5 text-left min-w-0"
      >
        {expanded ? (
          <FolderOpen
            size={14}
            className={isDropTarget ? "text-[var(--color-accent)]" : selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
          />
        ) : (
          <Folder
            size={14}
            className={isDropTarget ? "text-[var(--color-accent)]" : selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
          />
        )}
        <span className="flex-1 text-[var(--font-size-xs)] font-medium uppercase tracking-wide truncate">
          {group.name}
        </span>
        {isDropTarget && (
          <FolderInput size={14} className="text-[var(--color-accent)]" />
        )}
      </button>
    </div>
  );
}

function InlineRename({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value.trim()) {
      onConfirm(value.trim());
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (value.trim() && value.trim() !== initialValue) {
          onConfirm(value.trim());
        } else {
          onCancel();
        }
      }}
      className="w-full rounded border border-[var(--color-border-focus)] bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[var(--font-size-xs)] text-[var(--color-text-primary)] outline-none"
    />
  );
}

function MoveToGroupModal({
  currentGroupId,
  groups,
  onSelect,
  onClose,
}: {
  currentGroupId: string | null;
  groups: WorkflowGroup[];
  onSelect: (groupId: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-floating)] animate-context-menu"
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {t("workflows.moveToGroupTitle")}
            </h3>
            <button
              onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div
            ref={listRef}
            tabIndex={-1}
            className="max-h-[300px] overflow-y-auto p-1.5"
          >
            <button
              onClick={() => onSelect(null)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                currentGroupId === null
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
              )}
            >
              <FolderX size={16} className={currentGroupId === null ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"} />
              <span className="text-[var(--font-size-sm)]">{t("workflows.noGroup")}</span>
            </button>

            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelect(g.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                  currentGroupId === g.id
                    ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
                )}
              >
                <Folder size={16} className={currentGroupId === g.id ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"} />
                <span className="flex-1 truncate text-[var(--font-size-sm)]">{g.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function WorkflowList({
  loading,
  error,
  selectedRecipeId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onBatchDelete,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  selectedRecipeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (recipe: WorkflowRecipe) => void;
  onDelete: (recipe: WorkflowRecipe) => Promise<void>;
  onBatchDelete: (ids: string[]) => Promise<void>;
  onRetry: () => void;
}) {
  const t = useT();
  const recipes = useWorkflowsStore((s) => s.recipes);
  const groups = useWorkflowsStore((s) => s.groups);
  const selectedGroupId = useWorkflowsStore((s) => s.selectedGroupId);
  const setSelectedGroupId = useWorkflowsStore((s) => s.setSelectedGroupId);
  const setSelectedRecipeId = useWorkflowsStore((s) => s.setSelectedRecipeId);
  const createGroup = useWorkflowsStore((s) => s.createGroup);
  const updateGroup = useWorkflowsStore((s) => s.updateGroup);
  const deleteGroup = useWorkflowsStore((s) => s.deleteGroup);
  const moveRecipeToGroup = useWorkflowsStore((s) => s.moveRecipeToGroup);

  const listContainerRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const expandedGroupIdsRef = useRef<Set<string>>(expandedGroupIds);
  expandedGroupIdsRef.current = expandedGroupIds;
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const [moveTargetRecipeId, setMoveTargetRecipeId] = useState<string | null>(null);

  const dragStartRef = useRef<{ recipeId: string; startX: number; startY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoverGroupIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const moveRef = useRef(moveRecipeToGroup);
  moveRef.current = moveRecipeToGroup;

  const [dragRecipeId, setDragRecipeId] = useState<string | null>(null);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      if (!isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        if (dx * dx + dy * dy > 25) {
          isDraggingRef.current = true;
          setDragRecipeId(dragStartRef.current.recipeId);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
      }

      if (isDraggingRef.current) {
        if (dragGhostRef.current) {
          dragGhostRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
        }
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const dropTarget = el?.closest("[data-drop-group-id]") as HTMLElement | null;
        const newHoverId = dropTarget?.getAttribute("data-drop-group-id") ?? null;
        if (newHoverId !== hoverGroupIdRef.current) {
          hoverGroupIdRef.current = newHoverId;
          setHoverGroupId(newHoverId);

          if (autoExpandTimerRef.current) {
            clearTimeout(autoExpandTimerRef.current);
            autoExpandTimerRef.current = null;
          }
          if (newHoverId && newHoverId !== "ungrouped" && !expandedGroupIdsRef.current.has(newHoverId)) {
            const groupId = newHoverId;
            autoExpandTimerRef.current = setTimeout(() => {
              setExpandedGroupIds((prev) => {
                const next = new Set(prev);
                next.add(groupId);
                return next;
              });
            }, 500);
          }
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current && hoverGroupIdRef.current && dragStartRef.current) {
        const targetGroupId = hoverGroupIdRef.current === "ungrouped" ? null : hoverGroupIdRef.current;
        moveRef.current(dragStartRef.current.recipeId, targetGroupId);
        suppressClickRef.current = true;
        requestAnimationFrame(() => { suppressClickRef.current = false; });
      }
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }
      dragStartRef.current = null;
      isDraggingRef.current = false;
      hoverGroupIdRef.current = null;
      setDragRecipeId(null);
      setHoverGroupId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
      }
    };
  }, []);

  const handleRecipeMouseDown = useCallback((e: React.MouseEvent, recipeId: string) => {
    if (e.button !== 0 || selectionMode) return;
    dragStartRef.current = { recipeId, startX: e.clientX, startY: e.clientY };
    isDraggingRef.current = false;
    hoverGroupIdRef.current = null;
  }, [selectionMode]);

  const { menuState, onContextMenu, closeMenu } = useContextMenu<WorkflowRecipe>();
  const { menuState: groupMenuState, onContextMenu: onGroupContextMenu, closeMenu: closeGroupMenu } = useContextMenu<WorkflowGroup>();

  const filteredRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return recipes;
    return recipes.filter((recipe) => {
      const description = recipe.description ?? "";
      return recipe.title.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [recipes, searchQuery]);

  useEffect(() => {
    setSelectedIds((current) => new Set(Array.from(current).filter((id) => recipes.some((recipe) => recipe.id === id))));
  }, [recipes]);

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t("workflows.batchDelete"),
      description: t("workflows.batchDeleteDesc", { n: count }),
      confirmLabel: t("confirm.delete"),
    });
    if (!ok) return;
    await onBatchDelete(Array.from(selectedIds));
    exitSelectionMode();
    toast.success(t("workflows.batchDeleted", { n: count }));
  };

  const groupedRecipes = groups.map((g) => ({
    group: g,
    recipes: filteredRecipes.filter((r) => r.groupId === g.id),
  }));
  const ungroupedRecipes = filteredRecipes.filter((r) => !r.groupId);

  const handleCreateGroup = () => {
    setCreatingGroup(true);
    setTimeout(() => newGroupInputRef.current?.focus(), 0);
  };

  const handleCreateGroupConfirm = async (name: string) => {
    setCreatingGroup(false);
    if (name.trim()) {
      await createGroup(name.trim());
    }
  };

  const handleRenameConfirm = async (groupId: string, newName: string) => {
    setRenamingGroupId(null);
    await updateGroup(groupId, newName);
  };

  const menuItems: MenuItem[] = menuState
    ? [
        {
          label: t("workflows.editRecipe"),
          icon: <Pencil size={14} />,
          onClick: () => onEdit(menuState.data),
        },
        ...(groups.length > 0
          ? [
              { type: "separator" as const },
              {
                label: t("workflows.moveToGroup"),
                icon: <FolderInput size={14} />,
                onClick: () => setMoveTargetRecipeId(menuState.data.id),
              },
            ]
          : []),
        { type: "separator" as const },
        {
          label: t("workflows.deleteTitle"),
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            await onDelete(menuState.data);
          },
        },
      ]
    : [];

  const groupContextMenuItems: MenuItem[] = groupMenuState
    ? [
        {
          label: t("workflows.renameGroup"),
          icon: <Pencil size={14} />,
          onClick: () => setRenamingGroupId(groupMenuState.data.id),
        },
        {
          label: t("workflows.deleteGroup"),
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: t("workflows.deleteGroup"),
              description: t("workflows.deleteGroupDesc"),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) await deleteGroup(groupMenuState.data.id);
          },
        },
      ]
    : [];

  const recipeItemProps = (recipe: WorkflowRecipe) => ({
    recipe,
    selected: recipe.id === selectedRecipeId,
    selectable: selectionMode,
    checked: selectedIds.has(recipe.id),
    onToggleSelect: () => toggleSelect(recipe.id),
    onSelect: () => {
      if (suppressClickRef.current) return;
      onSelect(recipe.id);
    },
    onContextMenu: (e: React.MouseEvent) => onContextMenu(e, recipe),
    onMouseDown: !selectionMode ? (e: React.MouseEvent) => handleRecipeMouseDown(e, recipe.id) : undefined,
    isDragging: dragRecipeId === recipe.id,
  });

  return (
    <div className="flex w-[280px] flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("workflows.search")}
              className="pl-8"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCreateGroup}
            title={t("workflows.newGroup")}
          >
            <FolderPlus size={16} />
          </Button>
          <Button
            size="icon"
            variant={selectionMode ? "secondary" : "ghost"}
            onClick={() => {
              if (selectionMode) {
                exitSelectionMode();
              } else {
                setSelectionMode(true);
              }
            }}
            title={selectionMode ? t("workflows.cancelSelect") : t("workflows.batchSelect")}
          >
            {selectionMode ? <X size={16} /> : <ListChecks size={16} />}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
              exitSelectionMode();
              onCreate();
            }}
            title={t("workflows.newRecipe")}
          >
            <Plus size={16} />
          </Button>
        </div>
      </div>

      <div ref={listContainerRef} data-context-menu-container className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-3">
                  <div className="h-4 w-2/3 rounded bg-[var(--color-bg-hover)]" />
                  <div className="mt-2 h-3 w-full rounded bg-[var(--color-bg-hover)]" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="m-2 rounded-[var(--radius-card)] border border-[var(--color-fair)]/40 bg-[var(--color-bg-surface)] p-4 text-center">
              <AlertTriangle size={24} className="mx-auto mb-2 text-[var(--color-fair)]" />
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-primary)]">{t("workflows.loadFailed")}</p>
              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)] break-all">{error}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
                <RefreshCw size={14} />
                {t("workflows.retry")}
              </Button>
            </div>
          )}

          {!loading && !error && filteredRecipes.length === 0 && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Box size={32} className="mb-3 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">{t("workflows.noRecipes")}</p>
              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">{t("workflows.addFirst")}</p>
            </div>
          )}

          {creatingGroup && (
            <div className="mb-2 flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-1">
              <Folder size={14} className="flex-shrink-0 text-[var(--color-accent)]" />
              <input
                ref={newGroupInputRef}
                className="flex-1 bg-transparent text-[var(--font-size-sm)] text-[var(--color-text-primary)] outline-none"
                placeholder={t("workflows.groupPlaceholder")}
                onBlur={(e) => handleCreateGroupConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroupConfirm((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setCreatingGroup(false);
                }}
              />
            </div>
          )}

          {groupedRecipes.map(({ group, recipes: groupRecipes }) => {
            const isExpanded = expandedGroupIds.has(group.id);
            return (
              <div key={group.id} className="mb-2" data-drop-group-id={group.id}>
                {renamingGroupId === group.id ? (
                  <div className="px-2 py-1">
                    <InlineRename
                      initialValue={group.name}
                      onConfirm={(name) => handleRenameConfirm(group.id, name)}
                      onCancel={() => setRenamingGroupId(null)}
                    />
                  </div>
                ) : (
                  <GroupHeader
                    group={group}
                    selected={group.id === selectedGroupId}
                    expanded={isExpanded}
                    onSelect={() => {
                      setSelectedGroupId(group.id);
                      setSelectedRecipeId(null);
                    }}
                    onToggle={() => {
                      setExpandedGroupIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      });
                    }}
                    onContextMenu={(e) => onGroupContextMenu(e, group)}
                    isDropTarget={hoverGroupId === group.id}
                  />
                )}
                {groupRecipes.length > 0 && (
                  <div className={cn("drawer-wrapper", isExpanded && "expanded")}>
                    <div className="drawer-inner">
                      <div className="mt-1 flex flex-col gap-0.5">
                        {groupRecipes.map((recipe) => (
                          <RecipeItem key={recipe.id} {...recipeItemProps(recipe)} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {groups.length > 0 && (
            <div
              data-drop-group-id="ungrouped"
              className={cn(
                "rounded-[var(--radius-control)] transition-colors duration-[var(--duration-fast)]",
                dragRecipeId && hoverGroupId === "ungrouped"
                  ? "border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                  : "",
              )}
            >
              {dragRecipeId && (
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-[var(--font-size-xs)] font-medium uppercase tracking-wide",
                  hoverGroupId === "ungrouped"
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)]",
                )}>
                  <FolderX size={14} />
                  {t("workflows.ungrouped")}
                </div>
              )}
              {ungroupedRecipes.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {ungroupedRecipes.map((recipe) => (
                    <RecipeItem key={recipe.id} {...recipeItemProps(recipe)} />
                  ))}
                </div>
              )}
            </div>
          )}
          {groups.length === 0 && ungroupedRecipes.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {ungroupedRecipes.map((recipe) => (
                <RecipeItem key={recipe.id} {...recipeItemProps(recipe)} />
              ))}
            </div>
          )}
        </div>

        {selectionMode && (
          <div className="flex flex-shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
            <span className="flex-1 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
              {t("workflows.selectedCount", { n: selectedIds.size })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (selectedIds.size === filteredRecipes.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filteredRecipes.map((recipe) => recipe.id)));
                }
              }}
            >
              {t("workflows.selectAll")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              onClick={handleBatchDelete}
              className="text-[var(--color-error)]"
            >
              <Trash2 size={14} />
              {t("confirm.delete")}
            </Button>
          </div>
        )}

        {menuState && (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            containerRef={listContainerRef}
            items={menuItems}
          />
        )}
        {groupMenuState && (
          <ContextMenu
            x={groupMenuState.x}
            y={groupMenuState.y}
            onClose={closeGroupMenu}
            containerRef={listContainerRef}
            items={groupContextMenuItems}
          />
        )}
      </div>

      {moveTargetRecipeId && (
        <MoveToGroupModal
          currentGroupId={recipes.find((r) => r.id === moveTargetRecipeId)?.groupId ?? null}
          groups={groups}
          onSelect={async (groupId) => {
            await moveRecipeToGroup(moveTargetRecipeId, groupId);
            setMoveTargetRecipeId(null);
          }}
          onClose={() => setMoveTargetRecipeId(null)}
        />
      )}

      {dragRecipeId && (
        <div
          ref={dragGhostRef}
          className="fixed left-0 top-0 z-[100] pointer-events-none rounded-[var(--radius-control)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-3 py-2 shadow-[var(--shadow-floating)] max-w-[260px] opacity-90"
        >
          <div className="flex items-center gap-2">
            <Box size={14} className="text-[var(--color-accent)]" />
            <span className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {recipes.find((r) => r.id === dragRecipeId)?.title}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function getStepCount(recipe: WorkflowRecipe): number {
  try {
    const steps = JSON.parse(recipe.stepsJson) as unknown[];
    return Array.isArray(steps) ? steps.length : 0;
  } catch {
    return 0;
  }
}

function RecipeItem({
  recipe,
  selected,
  selectable,
  checked,
  onToggleSelect,
  onSelect,
  onContextMenu,
  onMouseDown,
  isDragging,
}: {
  recipe: WorkflowRecipe;
  selected: boolean;
  selectable: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
}) {
  const t = useT();
  const stepCount = getStepCount(recipe);
  return (
    <button
      onMouseDown={onMouseDown}
      onClick={() => {
        if (selectable) {
          onToggleSelect();
        } else {
          onSelect();
        }
      }}
      onContextMenu={onContextMenu}
      data-active={selected && !selectable}
      className={cn(
        "wf-recipe-item relative flex w-full items-start gap-2.5 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-all duration-[var(--duration-fast)]",
        isDragging && "opacity-40 scale-[0.98]",
        selectable && checked
          ? "bg-[var(--color-accent-subtle)]"
          : selected && !selectable
            ? "bg-[var(--color-accent-subtle)]"
            : "hover:bg-[var(--color-bg-hover)]",
      )}
    >
      {selectable && (
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] border transition-colors",
            checked
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
              : "border-[var(--color-border)]",
          )}
        >
          {checked && <Check size={10} className="text-white" />}
        </span>
      )}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)]">
        <Box size={14} className="text-[var(--color-accent)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {recipe.title}
          </span>
          {stepCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-[var(--color-bg-hover)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-text-muted)]">
              {stepCount}
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {recipe.description || t("workflows.noDescription")}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <Clock size={10} className="opacity-60" />
            <span>{new Date(recipe.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </button>
  );
}