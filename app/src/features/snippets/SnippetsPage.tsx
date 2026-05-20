import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Search,
  Code2,
  Trash,
  PenLine,
  Copy,
  FolderPlus,
  Folder,
  ClipboardCopy,
  FolderInput,
  FolderX,
  X,
  Check,
  ListChecks,
  Star,
  StarOff,
} from "lucide-react";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/themed/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useSnippetsStore } from "@/stores/snippets";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import type { Snippet, SnippetGroup } from "@/types";

const UNGROUPED_SENTINEL = "ungrouped";

function SnippetForm({
  snippet,
  groups,
  onSave,
  onCancel,
}: {
  snippet?: Snippet | null;
  groups: SnippetGroup[];
  onSave: (data: {
    title: string;
    command: string;
    description: string;
    tags: string[];
    groupId: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(snippet?.title ?? "");
  const [command, setCommand] = useState(snippet?.command ?? "");
  const [description, setDescription] = useState(snippet?.description ?? "");
  const [tagsInput, setTagsInput] = useState(
    snippet?.tags ? snippet.tags.join(", ") : "",
  );
  const [groupId, setGroupId] = useState<string | null>(
    snippet?.groupId ?? null,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({ title, command, description, tags, groupId });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="snip-form-label">
          {t("snippets.formTitle")}
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("snippets.placeholderTitle")}
          required
        />
      </div>
      <div>
        <label className="snip-form-label">
          {t("snippets.formCommand")}
        </label>
        <div className="snip-form-cmd-glow">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={t("snippets.placeholderCommand")}
            required
            rows={4}
            className="snip-form-cmd"
          />
        </div>
      </div>
      <div>
        <label className="snip-form-label">
          {t("snippets.formDescription")}
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("snippets.placeholderDescription")}
        />
      </div>
      <div>
        <label className="snip-form-label">
          {t("snippets.formTags")}
        </label>
        <Input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("snippets.placeholderTags")}
        />
      </div>
      {groups.length > 0 && (
        <div>
          <label className="snip-form-label">
            {t("snippets.formGroup")}
          </label>
          <Select
            value={groupId ?? ""}
            onChange={(v) => setGroupId(v || null)}
            options={[
              { value: "", label: t("snippets.noGroup") },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </div>
      )}
      <div className="snip-form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("snippets.cancel")}
        </Button>
        <Button type="submit">{snippet ? t("snippets.update") : t("snippets.create")}</Button>
      </div>
    </form>
  );
}

function SnippetCard({
  snippet,
  selected,
  onSelect,
  onContextMenu,
  selectable = false,
  checked = false,
  onToggleSelect,
  onMouseDown,
  isDragging = false,
  faved = false,
  onToggleFav,
}: {
  snippet: Snippet;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
  faved?: boolean;
  onToggleFav?: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onClick={() => {
        if (selectable) onToggleSelect?.();
        else onSelect();
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "snip-card",
        !selectable && selected && "is-active",
        selectable && checked && "is-checked",
        isDragging && "is-dragging",
      )}
    >
      <div className="snip-card-head">
        {selectable && (
          <span className={cn("snip-card-checkbox", checked && "is-checked")}>
            {checked && <Check size={10} />}
          </span>
        )}
        <span className="snip-card-title">{snippet.title}</span>
        <span className={cn("snip-card-fav", faved && "is-faved")} onClick={(e) => { e.stopPropagation(); onToggleFav?.(); }}>
          {faved ? <Star size={11} fill="currentColor" /> : <StarOff size={11} />}
        </span>
      </div>
      <pre className="snip-card-preview">{snippet.command}</pre>
      {snippet.tags && snippet.tags.length > 0 && (
        <div className="snip-card-meta">
          {snippet.tags.map((tag) => (
            <span key={tag} className="snip-card-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function SnippetDetail({
  snippet,
  onEdit,
  onDelete,
  faved = false,
  onToggleFav,
}: {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
  faved?: boolean;
  onToggleFav?: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <header className="snip-detail-head">
        <div className="min-w-0">
          <h2 className="snip-detail-title">{snippet.title}</h2>
          {snippet.description && (
            <p className="snip-detail-desc">{snippet.description}</p>
          )}
          {snippet.tags && snippet.tags.length > 0 && (
            <div className="snip-detail-tags">
              {snippet.tags.map((tag) => (
                <span key={tag} className="snip-detail-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="snip-detail-actions">
          <Button size="icon" variant="ghost" onClick={onToggleFav} title={faved ? t("snippets.unfavorite") : t("snippets.favorite")}>
            {faved ? (
              <Star size={14} strokeWidth={1.8} fill="currentColor" className="text-[var(--color-warning)]" />
            ) : (
              <StarOff size={14} strokeWidth={1.8} />
            )}
          </Button>
          <Button size="icon" variant="ghost" onClick={onEdit} title={t("snippets.editSnippet")}>
            <PenLine size={14} strokeWidth={1.8} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} title={t("snippets.deleteSnippet")}>
            <Trash size={14} strokeWidth={1.8} className="text-[var(--color-error)]" />
          </Button>
        </div>
      </header>

      <div className="snip-cmd-block">
        <div className="snip-cmd-block-head">
          <Button size="sm" variant="ghost" onClick={handleCopy}>
            <Copy size={12} strokeWidth={1.8} />
            {copied ? t("snippets.copied") : t("snippets.copy")}
          </Button>
        </div>
        <pre>{snippet.command}</pre>
      </div>

      <div className="snip-detail-meta">
        {t("snippets.createdAt")} {new Date(snippet.createdAt).toLocaleString()}
        {snippet.updatedAt !== snippet.createdAt && (
          <> · {t("snippets.updatedAt")} {new Date(snippet.updatedAt).toLocaleString()}</>
        )}
      </div>
    </>
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
      className="snip-nav-rename"
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
  groups: SnippetGroup[];
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
          className="pointer-events-auto w-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-lg animate-context-menu"
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {t("snippets.moveToGroupTitle")}
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
              <span className="text-[var(--font-size-sm)]">{t("snippets.noGroup")}</span>
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
                {currentGroupId === g.id && (
                  <Check size={14} className="text-[var(--color-accent)]" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function GroupDetail({
  group,
  snippetCount,
  onRename,
  onDelete,
}: {
  group: SnippetGroup;
  snippetCount: number;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <>
      <header className="snip-detail-head">
        <div className="flex items-center gap-3 min-w-0">
          <Folder size={24} className="text-[var(--color-accent)]" />
          <h2 className="snip-detail-title" style={{ margin: 0 }}>{group.name}</h2>
        </div>
        <div className="snip-detail-actions">
          <Button size="icon" variant="ghost" onClick={onRename} title={t("snippets.renameGroup")}>
            <PenLine size={14} strokeWidth={1.8} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} title={t("snippets.deleteGroup")}>
            <Trash size={14} strokeWidth={1.8} className="text-[var(--color-error)]" />
          </Button>
        </div>
      </header>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {t("snippets.formGroup")}
          </span>
          <span className="text-[var(--font-size-sm)] font-medium tabular-nums">
            {snippetCount}
          </span>
        </div>
        <div className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {t("snippets.createdAt")} {new Date(group.createdAt).toLocaleString()}
          {group.updatedAt !== group.createdAt && (
            <> · {t("snippets.updatedAt")} {new Date(group.updatedAt).toLocaleString()}</>
          )}
        </div>
      </div>
    </>
  );
}

export function SnippetsPage() {
  const t = useT();
  const {
    snippets,
    groups,
    loading,
    selectedSnippetId,
    selectedGroupId,
    searchQuery,
    setSelectedSnippetId,
    setSelectedGroupId,
    setSearchQuery,
    fetchSnippets,
    fetchGroups,
    createSnippet,
    updateSnippet,
    deleteSnippet,
    createGroup,
    updateGroup,
    deleteGroup,
    batchDeleteSnippets,
    moveSnippetToGroup,
  } = useSnippetsStore();

  const [showForm, setShowForm] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [moveTargetSnippetId, setMoveTargetSnippetId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [favSnippetIds, setFavSnippetIds] = useState<Set<string>>(() => new Set());
  const [showUngrouped, setShowUngrouped] = useState(false);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);

  // ── Mouse-based drag state ──
  const dragStartRef = useRef<{ snippetId: string; startX: number; startY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoverGroupIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const moveRef = useRef(moveSnippetToGroup);
  moveRef.current = moveSnippetToGroup;

  const [dragSnippetId, setDragSnippetId] = useState<string | null>(null);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      if (!isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        if (dx * dx + dy * dy > 25) {
          isDraggingRef.current = true;
          setDragSnippetId(dragStartRef.current.snippetId);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
      }

      if (isDraggingRef.current) {
        if (dragGhostRef.current) {
          dragGhostRef.current.style.left = `${e.clientX}px`;
          dragGhostRef.current.style.top = `${e.clientY + 12}px`;
        }
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const dropTarget = el?.closest("[data-drop-group-id]") as HTMLElement | null;
        const newHoverId = dropTarget?.getAttribute("data-drop-group-id") ?? null;
        if (newHoverId !== hoverGroupIdRef.current) {
          hoverGroupIdRef.current = newHoverId;
          setHoverGroupId(newHoverId);
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current && hoverGroupIdRef.current && dragStartRef.current) {
        const targetGroupId = hoverGroupIdRef.current === UNGROUPED_SENTINEL ? null : hoverGroupIdRef.current;
        moveRef.current(dragStartRef.current.snippetId, targetGroupId);
        suppressClickRef.current = true;
        requestAnimationFrame(() => { suppressClickRef.current = false; });
      }
      dragStartRef.current = null;
      isDraggingRef.current = false;
      hoverGroupIdRef.current = null;
      setDragSnippetId(null);
      setHoverGroupId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleSnippetMouseDown = useCallback((e: React.MouseEvent, snippetId: string) => {
    if (e.button !== 0 || selectionMode) return;
    dragStartRef.current = { snippetId, startX: e.clientX, startY: e.clientY };
    isDraggingRef.current = false;
    hoverGroupIdRef.current = null;
  }, [selectionMode]);

  const { menuState, onContextMenu, closeMenu } = useContextMenu<Snippet>();
  const {
    menuState: groupMenuState,
    onContextMenu: onGroupContextMenu,
    closeMenu: closeGroupMenu,
  } = useContextMenu<SnippetGroup>();

  const groupContextMenuItems: MenuItem[] = groupMenuState
    ? [
        {
          label: t("snippets.renameGroup"),
          icon: <PenLine size={14} strokeWidth={1.8} />,
          onClick: () => setRenamingGroupId(groupMenuState.data.id),
        },
        {
          label: t("snippets.deleteGroup"),
          icon: <Trash size={14} strokeWidth={1.8} />,
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: t("snippets.deleteGroup"),
              description: t("snippets.deleteGroupDesc"),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) await deleteGroup(groupMenuState.data.id);
          },
        },
      ]
    : [];

  const contextMenuItems: MenuItem[] = menuState
    ? [
        {
          label: t("snippets.editSnippet"),
          icon: <PenLine size={14} strokeWidth={1.8} />,
          onClick: () => {
            setEditingSnippet(menuState.data);
            setSelectedSnippetId(menuState.data.id);
            setShowForm(true);
          },
        },
        {
          label: t("snippets.copy"),
          icon: <ClipboardCopy size={14} />,
          onClick: () => {
            navigator.clipboard.writeText(menuState.data.command);
            toast.success(t("snippets.copied"));
          },
        },
        ...(groups.length > 0
          ? [
              { type: "separator" as const },
              {
                label: t("snippets.moveToGroup"),
                icon: <FolderInput size={14} />,
                onClick: () => setMoveTargetSnippetId(menuState.data.id),
              },
            ]
          : []),
        { type: "separator" as const },
        {
          label: t("snippets.deleteSnippet"),
          icon: <Trash size={14} strokeWidth={1.8} />,
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: t("confirm.deleteSnippetTitle"),
              description: t("confirm.deleteSnippetDesc"),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) await deleteSnippet(menuState.data.id);
          },
        },
      ]
    : [];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFav = (id: string) => {
    setFavSnippetIds((prev) => {
      const next = new Set(prev);
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
      title: t("snippets.batchDelete"),
      description: t("snippets.batchDeleteDesc", { n: count }),
      confirmLabel: t("confirm.delete"),
    });
    if (!ok) return;
    const ids = Array.from(selectedIds);
    exitSelectionMode();
    await batchDeleteSnippets(ids);
    toast.success(t("snippets.batchDeleted", { n: count }));
  };

  useEffect(() => {
    fetchSnippets();
    fetchGroups();
  }, [fetchSnippets, fetchGroups]);

  const selectedSnippet = snippets.find((s) => s.id === selectedSnippetId) ?? null;
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  const filteredSnippets = searchQuery
    ? snippets.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.tags && s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))),
      )
    : snippets;

  const ungroupedSnippets = filteredSnippets.filter((s) => !s.groupId);

  let displayedSnippets: Snippet[];
  let viewTitle: string;
  if (selectedGroupId !== null && selectedGroup) {
    displayedSnippets = filteredSnippets.filter((s) => s.groupId === selectedGroupId);
    viewTitle = `${selectedGroup.name} · ${displayedSnippets.length}`;
  } else if (showUngrouped) {
    displayedSnippets = ungroupedSnippets;
    viewTitle = `${t("snippets.ungrouped")} · ${displayedSnippets.length}`;
  } else {
    displayedSnippets = filteredSnippets;
    viewTitle = `${t("snippets.allSnippets")} · ${displayedSnippets.length}`;
  }

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

  const selectAllView = () => {
    setSelectedGroupId(null);
    setShowUngrouped(false);
    setSelectedSnippetId(null);
    setShowForm(false);
    setEditingSnippet(null);
  };

  const selectGroup = (gid: string) => {
    setSelectedGroupId(gid);
    setShowUngrouped(false);
    setSelectedSnippetId(null);
    setShowForm(false);
    setEditingSnippet(null);
  };

  const selectUngroupedView = () => {
    setSelectedGroupId(null);
    setShowUngrouped(true);
    setSelectedSnippetId(null);
    setShowForm(false);
    setEditingSnippet(null);
  };

  const snippetCardProps = (s: Snippet) => ({
    key: s.id,
    snippet: s,
    selected: s.id === selectedSnippetId,
    selectable: selectionMode,
    checked: selectedIds.has(s.id),
    onToggleSelect: () => toggleSelect(s.id),
    onSelect: () => {
      if (suppressClickRef.current) return;
      setSelectedSnippetId(s.id);
      setShowForm(false);
      setEditingSnippet(null);
    },
    onContextMenu: (e: React.MouseEvent) => onContextMenu(e, s),
    onMouseDown: !selectionMode ? (e: React.MouseEvent) => handleSnippetMouseDown(e, s.id) : undefined,
    isDragging: dragSnippetId === s.id,
    faved: favSnippetIds.has(s.id),
    onToggleFav: () => toggleFav(s.id),
  });

  const isAllActive = selectedGroupId === null && !showUngrouped;
  const isUngroupedActive = selectedGroupId === null && showUngrouped;

  return (
    <div ref={shellRef} className="snippets-shell" data-context-menu-container>
      {/* Left: groups aside */}
      <aside className="snip-aside">
        <div className="snip-aside-toolbar">
          <span className="input-with-icon">
            <span className="input-icon">
              <Search size={13} />
            </span>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("snippets.search")}
            />
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCreateGroup}
            title={t("snippets.newGroup")}
          >
            <FolderPlus size={16} />
          </Button>
        </div>

        <div className="snip-aside-scroll">
          <div className="snip-aside-section">{t("snippets.libraryHeading")}</div>
          <button type="button" className={cn("snip-nav-item", isAllActive && "is-active")} onClick={selectAllView}>
            <span className="nav-icon"><Code2 size={14} strokeWidth={1.8} /></span>
            <span className="nav-label">{t("snippets.allSnippets")}</span>
            <span className="nav-count">{filteredSnippets.length}</span>
          </button>

          {groups.length > 0 && (
            <div className="snip-aside-section">{t("snippets.groupsHeading")}</div>
          )}
          {(creatingGroup || groups.length > 0) && (
            <>
              {creatingGroup && (
                <div className="px-2 py-1">
                  <input
                    ref={newGroupInputRef}
                    className="snip-nav-rename"
                    placeholder={t("snippets.groupPlaceholder")}
                    onBlur={(e) => handleCreateGroupConfirm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateGroupConfirm((e.target as HTMLInputElement).value);
                      if (e.key === "Escape") setCreatingGroup(false);
                    }}
                  />
                </div>
              )}
              {groups.map((group) => {
                const isSelected = group.id === selectedGroupId;
                const isDropTarget = hoverGroupId === group.id;
                const groupCount = filteredSnippets.filter((s) => s.groupId === group.id).length;
                if (renamingGroupId === group.id) {
                  return (
                    <div key={group.id} className="px-2 py-1">
                      <InlineRename
                        initialValue={group.name}
                        onConfirm={(name) => handleRenameConfirm(group.id, name)}
                        onCancel={() => setRenamingGroupId(null)}
                      />
                    </div>
                  );
                }
                return (
                  <button
                    key={group.id}
                    type="button"
                    data-drop-group-id={group.id}
                    className={cn(
                      "snip-nav-item",
                      isSelected && "is-active",
                      isDropTarget && "is-drop-target",
                    )}
                    onClick={() => selectGroup(group.id)}
                    onContextMenu={(e) => onGroupContextMenu(e, group)}
                  >
                    <span className="nav-icon"><Folder size={14} strokeWidth={1.8} /></span>
                    <span className="nav-label">{group.name}</span>
                    <span className="nav-count">{groupCount}</span>
                  </button>
                );
              })}
              {!creatingGroup && (
                <button
                  type="button"
                  data-drop-group-id={UNGROUPED_SENTINEL}
                  className={cn(
                    "snip-nav-item",
                    isUngroupedActive && "is-active",
                    hoverGroupId === UNGROUPED_SENTINEL && "is-drop-target",
                  )}
                  onClick={selectUngroupedView}
                >
                  <span className="nav-icon"><FolderX size={14} /></span>
                  <span className="nav-label">{t("snippets.ungrouped")}</span>
                  <span className="nav-count">{ungroupedSnippets.length}</span>
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Middle: cards list */}
      <section className="snip-list">
        <header className="snip-list-head">
          <span className="snip-list-title">{viewTitle}</span>
          <div className="snip-list-actions">
            <Button
              size="icon"
              variant={selectionMode ? "secondary" : "ghost"}
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
              }}
              title={selectionMode ? t("snippets.cancelSelect") : t("snippets.batchSelect")}
            >
              {selectionMode ? <X size={14} /> : <ListChecks size={14} />}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              onClick={() => {
                setEditingSnippet(null);
                setShowForm(true);
              }}
              title={t("snippets.newSnippet")}
            >
              <Plus size={14} />
            </Button>
          </div>
        </header>

        <div className="snip-list-scroll">
          {loading && (
            <p className="snip-list-empty">{t("snippets.loading")}</p>
          )}

          {!loading && displayedSnippets.length === 0 && (
            <div className="snip-list-empty">
              <Code2 size={28} className="mx-auto mb-3 opacity-60" />
              <p>{t("snippets.noSnippets")}</p>
              <p className="mt-1 text-[10px] opacity-70">{t("snippets.addFirst")}</p>
            </div>
          )}

          {!loading && displayedSnippets.map((s) => (
            <SnippetCard {...snippetCardProps(s)} />
          ))}
        </div>

        {selectionMode && (
          <div className="snip-batch-bar">
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)] flex-1">
              {t("snippets.selectedCount", { n: selectedIds.size })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (selectedIds.size === displayedSnippets.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(displayedSnippets.map((s) => s.id)));
                }
              }}
            >
              {t("snippets.selectAll")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              onClick={handleBatchDelete}
              className="text-[var(--color-error)]"
            >
              <Trash size={14} strokeWidth={1.8} />
              {t("confirm.delete")}
            </Button>
          </div>
        )}
      </section>

      {/* Right: detail / form */}
      <section className="snip-detail-shell">
        <div className="snip-detail-scroll">
          {showForm ? (
            <div key="form" className="animate-fade-in-up snip-form">
              <h2 className="snip-form-title">
                {editingSnippet ? t("snippets.editSnippet") : t("snippets.newSnippet")}
              </h2>
              <SnippetForm
                snippet={editingSnippet}
                groups={groups}
                onSave={async (data) => {
                  const dup = snippets.some(
                    (s) => s.command === data.command && s.id !== editingSnippet?.id,
                  );
                  if (dup) {
                    toast.warning(t("snippets.duplicateCommand"));
                    return;
                  }
                  if (editingSnippet) {
                    await updateSnippet(
                      editingSnippet.id,
                      data.title,
                      data.command,
                      data.description || null,
                      data.tags.length > 0 ? data.tags : null,
                      data.groupId,
                    );
                  } else {
                    await createSnippet(
                      data.title,
                      data.command,
                      data.description || null,
                      data.tags.length > 0 ? data.tags : null,
                      data.groupId,
                    );
                  }
                  setShowForm(false);
                  setEditingSnippet(null);
                }}
                onCancel={() => {
                  setShowForm(false);
                  setEditingSnippet(null);
                }}
              />
            </div>
          ) : selectedSnippet ? (
            <div key="detail" className="animate-fade-in-up">
              <SnippetDetail
                snippet={selectedSnippet}
                faved={favSnippetIds.has(selectedSnippet.id)}
                onToggleFav={() => toggleFav(selectedSnippet.id)}
                onEdit={() => {
                  setEditingSnippet(selectedSnippet);
                  setShowForm(true);
                }}
                onDelete={async () => {
                  const ok = await confirm({
                    title: t("confirm.deleteSnippetTitle"),
                    description: t("confirm.deleteSnippetDesc"),
                    confirmLabel: t("confirm.delete"),
                  });
                  if (!ok) return;
                  await deleteSnippet(selectedSnippet.id);
                }}
              />
            </div>
          ) : selectedGroup ? (
            <div key="group-detail" className="animate-fade-in-up">
              <GroupDetail
                group={selectedGroup}
                snippetCount={snippets.filter((s) => s.groupId === selectedGroup.id).length}
                onRename={() => setRenamingGroupId(selectedGroup.id)}
                onDelete={async () => {
                  const ok = await confirm({
                    title: t("snippets.deleteGroup"),
                    description: t("snippets.deleteGroupDesc"),
                    confirmLabel: t("confirm.delete"),
                  });
                  if (!ok) return;
                  await deleteGroup(selectedGroup.id);
                }}
              />
            </div>
          ) : (
            <div key="empty" className="animate-fade-in flex h-full items-center justify-center text-center">
              <div>
                <Code2 size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
                <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
                  {t("snippets.selectOrCreate")}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Move to group modal */}
      {moveTargetSnippetId && (
        <MoveToGroupModal
          currentGroupId={snippets.find((s) => s.id === moveTargetSnippetId)?.groupId ?? null}
          groups={groups}
          onSelect={async (groupId) => {
            await moveSnippetToGroup(moveTargetSnippetId, groupId);
            setMoveTargetSnippetId(null);
          }}
          onClose={() => setMoveTargetSnippetId(null)}
        />
      )}

      {/* Drag ghost */}
      {dragSnippetId && createPortal(
        <div
          ref={dragGhostRef}
          className="fixed z-[100] pointer-events-none -translate-x-1/2 rounded-[var(--radius-control)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-3 py-2 shadow-[var(--shadow-floating)] max-w-[260px] opacity-90"
        >
          <div className="flex items-center gap-2">
            <Code2 size={14} strokeWidth={1.8} className="text-[var(--color-accent)]" />
            <span className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {snippets.find((s) => s.id === dragSnippetId)?.title}
            </span>
          </div>
          <p className="truncate font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {snippets.find((s) => s.id === dragSnippetId)?.command}
          </p>
        </div>,
        document.body
      )}

      {/* Context menus */}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          containerRef={shellRef}
          items={contextMenuItems}
        />
      )}

      {groupMenuState && (
        <ContextMenu
          x={groupMenuState.x}
          y={groupMenuState.y}
          onClose={closeGroupMenu}
          containerRef={shellRef}
          items={groupContextMenuItems}
        />
      )}
    </div>
  );
}
