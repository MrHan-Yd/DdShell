import { useEffect, useState, useRef } from "react";
import {
  Plus,
  Search,
  Code2,
  Trash2,
  Pencil,
  Copy,
  Tag,
  FolderPlus,
  Folder,
  FolderOpen,
  ClipboardCopy,
  FolderInput,
  FolderX,
  ChevronRight,
  X,
  Check,
  ListChecks,
} from "lucide-react";
import { ContextMenu, useContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useSnippetsStore } from "@/stores/snippets";
import { confirm } from "@/stores/confirm";
import { toast } from "@/stores/toast";
import type { Snippet, SnippetGroup } from "@/types";

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
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
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
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {t("snippets.formCommand")}
        </label>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t("snippets.placeholderCommand")}
          required
          rows={4}
          className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-primary)] font-mono focus:border-[var(--color-border-focus)] focus:outline-none resize-y"
        />
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {t("snippets.formDescription")}
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("snippets.placeholderDescription")}
        />
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
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
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
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
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("snippets.cancel")}
        </Button>
        <Button type="submit">{snippet ? t("snippets.update") : t("snippets.create")}</Button>
      </div>
    </form>
  );
}

function SnippetItem({
  snippet,
  selected,
  onSelect,
  onContextMenu,
  selectable = false,
  checked = false,
  onToggleSelect,
}: {
  snippet: Snippet;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (selectable) {
          onToggleSelect?.();
        } else {
          onSelect();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)]",
        selectable && checked
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
          : selected && !selectable
            ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <div className="flex items-center gap-2">
        {selectable && (
          <span
            className={cn(
              "flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-[3px] border transition-colors",
              checked
                ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
                : "border-[var(--color-border)]",
            )}
          >
            {checked && <Check size={10} className="text-white" />}
          </span>
        )}
        <Code2
          size={14}
          className={
            (selectable ? checked : selected)
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)]"
          }
        />
        <span className="truncate text-[var(--font-size-sm)] font-medium">
          {snippet.title}
        </span>
      </div>
      <p className={cn("truncate font-mono text-[var(--font-size-xs)] text-[var(--color-text-muted)]", selectable ? "pl-6" : "pl-[22px]")}>
        {snippet.command}
      </p>
      {snippet.tags && snippet.tags.length > 0 && (
        <div className={cn("flex gap-1 flex-wrap", selectable ? "pl-6" : "pl-[22px]")}>
          {snippet.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]"
            >
              <Tag size={8} />
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
}: {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-[var(--font-size-xl)] font-medium">{snippet.title}</h2>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onEdit}>
            <Pencil size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 size={16} className="text-[var(--color-error)]" />
          </Button>
        </div>
      </div>

      {/* Command block */}
      <div className="relative rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-base)] p-4">
        <pre className="whitespace-pre-wrap break-all font-mono text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
          {snippet.command}
        </pre>
        <Button
          size="sm"
          variant="ghost"
          className="absolute right-2 top-2"
          onClick={handleCopy}
        >
          <Copy size={14} />
          {copied ? t("snippets.copied") : t("snippets.copy")}
        </Button>
      </div>

      {/* Details */}
      {snippet.description && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {snippet.description}
          </p>
        </div>
      )}

      {/* Tags */}
      {snippet.tags && snippet.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {snippet.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-3 py-1 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]"
            >
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Metadata */}
      <div className="mt-4 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
        {t("snippets.createdAt")} {new Date(snippet.createdAt).toLocaleString()}
        {snippet.updatedAt !== snippet.createdAt && (
          <> · {t("snippets.updatedAt")} {new Date(snippet.updatedAt).toLocaleString()}</>
        )}
      </div>
    </div>
  );
}

// ── Group header (clickable + right-click) ──

function GroupHeader({
  group,
  selected,
  expanded,
  onSelect,
  onToggle,
  onContextMenu,
}: {
  group: SnippetGroup;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-1 rounded-[var(--radius-control)] transition-colors duration-[var(--duration-fast)]",
        selected
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
            className={selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
          />
        ) : (
          <Folder
            size={14}
            className={selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
          />
        )}
        <span className="flex-1 text-[var(--font-size-xs)] font-medium uppercase tracking-wide truncate">
          {group.name}
        </span>
      </button>
    </div>
  );
}

// ── Inline rename input ──

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

// ── Move to group modal ──

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
          {/* Header */}
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

          {/* Group list */}
          <div
            ref={listRef}
            tabIndex={-1}
            className="max-h-[300px] overflow-y-auto p-1.5"
          >
            {/* No group option */}
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

            {/* Group items */}
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

// ── Group detail (right panel) ──

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
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Folder size={24} className="text-[var(--color-accent)]" />
          <h2 className="text-[var(--font-size-xl)] font-medium">{group.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onRename}>
            <Pencil size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 size={16} className="text-[var(--color-error)]" />
          </Button>
        </div>
      </div>

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
    </div>
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
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // ── Right-click context menu (snippet) ──
  const { menuState, onContextMenu, closeMenu } = useContextMenu<Snippet>();

  // ── Right-click context menu (group) ──
  const {
    menuState: groupMenuState,
    onContextMenu: onGroupContextMenu,
    closeMenu: closeGroupMenu,
  } = useContextMenu<SnippetGroup>();

  const groupContextMenuItems: MenuItem[] = groupMenuState
    ? [
        {
          label: t("snippets.renameGroup"),
          icon: <Pencil size={14} />,
          onClick: () => setRenamingGroupId(groupMenuState.data.id),
        },
        {
          label: t("snippets.deleteGroup"),
          icon: <Trash2 size={14} />,
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
          icon: <Pencil size={14} />,
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
          icon: <Trash2 size={14} />,
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

  // ── Batch selection handlers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
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

  // Build grouped view
  const groupedSnippets = groups.map((g) => ({
    group: g,
    snippets: filteredSnippets.filter((s) => s.groupId === g.id),
  }));
  const ungroupedSnippets = filteredSnippets.filter((s) => !s.groupId);

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

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Snippet List */}
      <div className="flex w-[280px] flex-col border-r border-[var(--color-border)]" ref={listContainerRef} data-context-menu-container>
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("snippets.search")}
              className="pl-8"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCreateGroup}
            title={t("snippets.newGroup")}
          >
            <FolderPlus size={16} />
          </Button>
          <Button
            size="icon"
            variant={selectionMode ? "secondary" : "ghost"}
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
            title={selectionMode ? t("snippets.cancelSelect") : t("snippets.batchSelect")}
          >
            {selectionMode ? <X size={16} /> : <ListChecks size={16} />}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
              setEditingSnippet(null);
              setShowForm(true);
            }}
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <p className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              {t("snippets.loading")}
            </p>
          )}

          {!loading && filteredSnippets.length === 0 && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Code2 size={32} className="mb-3 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                {t("snippets.noSnippets")}
              </p>
              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("snippets.addFirst")}
              </p>
            </div>
          )}

          {/* New group inline input */}
          {creatingGroup && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-1">
              <Folder size={14} className="flex-shrink-0 text-[var(--color-accent)]" />
              <input
                ref={newGroupInputRef}
                className="flex-1 bg-transparent text-[var(--font-size-sm)] text-[var(--color-text-primary)] outline-none"
                placeholder={t("snippets.groupPlaceholder")}
                onBlur={(e) => handleCreateGroupConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroupConfirm((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setCreatingGroup(false);
                }}
              />
            </div>
          )}

          {/* Grouped snippets */}
          {groupedSnippets.map(({ group, snippets: groupSnippets }) => {
            const isExpanded = expandedGroupIds.has(group.id);
            return (
            <div key={group.id} className="mb-2">
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
                    setSelectedSnippetId(null);
                    setShowForm(false);
                    setEditingSnippet(null);
                    setExpandedGroupIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
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
                />
              )}
              {groupSnippets.length > 0 && (
                <div className={cn("drawer-wrapper", isExpanded && "expanded")}>
                  <div className="drawer-inner">
                    <div className="border border-[var(--color-border)] rounded-2xl">
                      {groupSnippets.map((s) => (
                        <SnippetItem
                          key={s.id}
                          snippet={s}
                          selected={s.id === selectedSnippetId}
                          selectable={selectionMode}
                          checked={selectedIds.has(s.id)}
                          onToggleSelect={() => toggleSelect(s.id)}
                          onSelect={() => {
                            setSelectedSnippetId(s.id);
                            setSelectedGroupId(null);
                            setShowForm(false);
                            setEditingSnippet(null);
                          }}
                          onContextMenu={(e) => onContextMenu(e, s)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })}

          {/* Ungrouped snippets */}
          {ungroupedSnippets.length > 0 && (
            <div className="mb-2">
              {ungroupedSnippets.map((s) => (
                <SnippetItem
                  key={s.id}
                  snippet={s}
                  selected={s.id === selectedSnippetId}
                  selectable={selectionMode}
                  checked={selectedIds.has(s.id)}
                  onToggleSelect={() => toggleSelect(s.id)}
                  onSelect={() => {
                    setSelectedSnippetId(s.id);
                    setSelectedGroupId(null);
                    setShowForm(false);
                    setEditingSnippet(null);
                  }}
                  onContextMenu={(e) => onContextMenu(e, s)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Batch selection action bar */}
        {selectionMode && (
          <div className="border-t border-[var(--color-border)] px-3 py-2 flex items-center gap-2 flex-shrink-0">
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)] flex-1">
              {t("snippets.selectedCount", { n: selectedIds.size })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (selectedIds.size === filteredSnippets.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filteredSnippets.map((s) => s.id)));
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
              <Trash2 size={14} />
              {t("confirm.delete")}
            </Button>
          </div>
        )}

        {/* Context menu (snippet) */}
        {menuState && (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            containerRef={listContainerRef}
            items={contextMenuItems}
          />
        )}

        {/* Context menu (group) */}
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

      {/* Right: Detail / Form */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {showForm ? (
          <div className="mx-auto w-full max-w-md">
            <h2 className="mb-4 text-[var(--font-size-lg)] font-medium">
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
          <SnippetDetail
            snippet={selectedSnippet}
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
        ) : selectedGroup ? (
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
        ) : (
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <Code2 size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
                {t("snippets.selectOrCreate")}
              </p>
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}
