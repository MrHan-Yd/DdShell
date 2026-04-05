import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Code2,
  Trash2,
  Pencil,
  Copy,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useSnippetsStore } from "@/stores/snippets";
import { confirm } from "@/stores/confirm";
import type { Snippet } from "@/types";

function SnippetForm({
  snippet,
  onSave,
  onCancel,
}: {
  snippet?: Snippet | null;
  onSave: (data: {
    title: string;
    command: string;
    description: string;
    tags: string[];
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({ title, command, description, tags });
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
}: {
  snippet: Snippet;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)]",
        selected
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <div className="flex items-center gap-2">
        <Code2
          size={14}
          className={
            selected
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)]"
          }
        />
        <span className="truncate text-[var(--font-size-sm)] font-medium">
          {snippet.title}
        </span>
      </div>
      <p className="truncate pl-[22px] text-[var(--font-size-xs)] text-[var(--color-text-muted)] font-mono">
        {snippet.command}
      </p>
      {snippet.tags && snippet.tags.length > 0 && (
        <div className="flex gap-1 pl-[22px] flex-wrap">
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

export function SnippetsPage() {
  const t = useT();
  const {
    snippets,
    loading,
    selectedSnippetId,
    searchQuery,
    setSelectedSnippetId,
    setSearchQuery,
    fetchSnippets,
    createSnippet,
    updateSnippet,
    deleteSnippet,
  } = useSnippetsStore();

  const [showForm, setShowForm] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);

  useEffect(() => {
    fetchSnippets();
  }, [fetchSnippets]);

  const selectedSnippet = snippets.find((s) => s.id === selectedSnippetId) ?? null;

  const filteredSnippets = searchQuery
    ? snippets.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.tags && s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))),
      )
    : snippets;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Snippet List */}
      <div className="flex w-[280px] flex-col border-r border-[var(--color-border)]">
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

          {!loading && filteredSnippets.length === 0 && (
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

          {filteredSnippets.map((s) => (
            <SnippetItem
              key={s.id}
              snippet={s}
              selected={s.id === selectedSnippetId}
              onSelect={() => setSelectedSnippetId(s.id)}
            />
          ))}
        </div>
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
              onSave={async (data) => {
                if (editingSnippet) {
                  await updateSnippet(
                    editingSnippet.id,
                    data.title,
                    data.command,
                    data.description || null,
                    data.tags.length > 0 ? data.tags : null,
                  );
                } else {
                  await createSnippet(
                    data.title,
                    data.command,
                    data.description || null,
                    data.tags.length > 0 ? data.tags : null,
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
    </div>
  );
}
