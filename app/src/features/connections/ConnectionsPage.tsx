import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Search, Server, Folder, FolderOpen, FolderInput, FolderX, Trash2, Pencil, Star, StarOff, Zap, Upload, Check, ChevronUp, ChevronDown, ChevronRight, FolderPlus, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/stores/connections";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import { toast } from "@/stores/toast";
import { confirm } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
import { useContextMenu, ContextMenu } from "@/components/ui/ContextMenu";
import type { MenuItem } from "@/components/ui/ContextMenu";
import * as api from "@/lib/tauri";
import type { Host, HostGroup, AuthType, SshConfigEntry } from "@/types";

function ConnectionForm({
  host,
  groups,
  onSave,
  onCancel,
}: {
  host?: Host | null;
  groups: HostGroup[];
  onSave: (data: {
    name: string;
    host: string;
    port: number;
    username: string;
    authType: AuthType;
    groupId: string | null;
    password?: string;
  }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(host?.name ?? "");
  const [hostAddr, setHostAddr] = useState(host?.host ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? "root");
  const [authType, setAuthType] = useState<AuthType>(host?.authType ?? "password");
  const [groupId, setGroupId] = useState<string | null>(host?.groupId ?? null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (host?.secretRef) {
      api.passwordDecrypt(host.secretRef).then(setPassword).catch(() => {});
    }
  }, [host?.secretRef]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, host: hostAddr, port, username, authType, groupId, password: password || undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {t("form.name")}
        </label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" required />
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {t("form.host")}
          </label>
          <Input value={hostAddr} onChange={(e) => setHostAddr(e.target.value)} placeholder="10.0.0.1" required />
        </div>
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {t("form.port")}
          </label>
          <div className="relative">
            <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} className="pr-6" />
            <div className="absolute right-0 top-0 flex h-full w-6 flex-col border-l border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setPort((p) => Math.min(65535, p + 1))}
                className="flex flex-1 items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors rounded-tr-[var(--radius-control)]"
              >
                <ChevronUp size={10} />
              </button>
              <div className="h-px bg-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => setPort((p) => Math.max(1, p - 1))}
                className="flex flex-1 items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors rounded-br-[var(--radius-control)]"
              >
                <ChevronDown size={10} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {t("form.username")}
        </label>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" required />
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {t("form.authType")}
        </label>
        <Select
          value={authType}
          onChange={(v) => setAuthType(v as AuthType)}
          options={[
            { value: "password", label: t("form.password") },
            { value: "publickey", label: t("form.publicKey") },
          ]}
          className="w-full"
        />
      </div>
      {authType === "password" && (
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {t("form.password")}
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("conn.enterPassword")}
          />
        </div>
      )}
      {groups.length > 0 && (
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {t("form.group")}
          </label>
          <Select
            value={groupId ?? ""}
            onChange={(v) => setGroupId(v || null)}
            options={[
              { value: "", label: t("conn.noGroup") },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
            className="w-full"
          />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("conn.cancel")}
        </Button>
        <Button type="submit">
          {host ? t("conn.update") : t("conn.create")}
        </Button>
      </div>
    </form>
  );
}

// ── FR-39: SSH Config Import Panel ──

function SshConfigImportPanel({
  onDone,
}: {
  onDone: () => void;
}) {
  const t = useT();
  const [entries, setEntries] = useState<SshConfigEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { createHost, fetchHosts } = useConnectionsStore();

  useEffect(() => {
    (async () => {
      try {
        const result = await api.sshConfigImport();
        setEntries(result.entries);
        setErrors(result.errors);
        // Select all by default
        setSelected(new Set(result.entries.map((_, i) => i)));
      } catch (e) {
        toast.error(`Failed to parse SSH config: ${e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleImport = async () => {
    setImporting(true);
    let imported = 0;
    for (const idx of selected) {
      const entry = entries[idx];
      try {
        await createHost({
          name: entry.host,
          host: entry.hostName || entry.host,
          port: entry.port || 22,
          username: entry.user || "root",
          authType: entry.identityFile ? "publickey" : "password",
          groupId: null,
        });
        imported++;
      } catch {
        // skip duplicates or failures
      }
    }
    await fetchHosts();
    toast.success(`Imported ${imported} connection(s)`);
    setImporting(false);
    onDone();
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-text-muted)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
        <h2 className="text-[var(--font-size-base)] font-medium">{t("conn.importSshConfig")}</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDone}>{t("conn.cancel")}</Button>
          <Button onClick={handleImport} disabled={selected.size === 0 || importing}>
            {importing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Upload size={14} />}
            Import ({selected.size})
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-fair)]/5 px-4 py-2">
          <p className="text-[var(--font-size-xs)] text-[var(--color-fair)]">
            {errors.length} warning(s): {errors[0]}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 && (
          <p className="p-8 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {t("conn.noEntries")}
          </p>
        )}

        {entries.map((entry, idx) => (
          <button
            key={idx}
            onClick={() => toggleSelect(idx)}
            className={cn(
              "flex w-full items-center gap-3 rounded-[var(--radius-control)] p-3 text-left transition-colors",
              selected.has(idx)
                ? "bg-[var(--color-accent-subtle)]"
                : "hover:bg-[var(--color-bg-hover)]",
            )}
          >
            <div
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                selected.has(idx)
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                  : "border-[var(--color-border)]",
              )}
            >
              {selected.has(idx) && <Check size={12} className="text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--font-size-sm)] font-medium truncate">
                {entry.host}
              </p>
              <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)] truncate">
                {entry.user || "root"}@{entry.hostName || entry.host}:{entry.port || 22}
              </p>
            </div>
          </button>
        ))}
      </div>
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

// ── Group Header ──

function GroupHeader({
  group,
  expanded,
  onToggle,
  onContextMenu,
  isDropTarget = false,
}: {
  group: HostGroup;
  expanded: boolean;
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
        onContextMenu={onContextMenu}
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 px-1 py-1.5 text-left min-w-0"
      >
        {expanded ? (
          <FolderOpen size={14} className={isDropTarget ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"} />
        ) : (
          <Folder size={14} className={isDropTarget ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"} />
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

// ── Move to group modal ──

function MoveToGroupModal({
  currentGroupId,
  groups,
  onSelect,
  onClose,
}: {
  currentGroupId: string | null;
  groups: HostGroup[];
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
              {t("conn.moveToGroupTitle")}
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
              <span className="text-[var(--font-size-sm)]">{t("conn.noGroup")}</span>
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

export function ConnectionsPage() {
  const t = useT();
  const {
    hosts,
    groups,
    loading,
    selectedHostId,
    searchQuery,
    setSelectedHostId,
    setSearchQuery,
    fetchHosts,
    fetchGroups,
    createHost,
    updateHost,
    deleteHost,
    createGroup,
    updateGroup,
    deleteGroup,
    batchDeleteHosts,
  } = useConnectionsStore();

  const [showForm, setShowForm] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [detailAnim, setDetailAnim] = useState("animate-fade-in-up");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [moveTargetHostId, setMoveTargetHostId] = useState<string | null>(null);
  const prevHostIdRef = useRef<string | null>(null);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // ── Mouse-based drag state ──
  const dragStartRef = useRef<{ hostId: string; startX: number; startY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const hoverGroupIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedGroupIdsRef = useRef<Set<string>>(expandedGroupIds);
  expandedGroupIdsRef.current = expandedGroupIds;
  const moveHostToGroupRef = useRef((hostId: string, groupId: string | null) => { updateHost({ id: hostId, groupId }); });
  moveHostToGroupRef.current = (hostId: string, groupId: string | null) => { updateHost({ id: hostId, groupId }); };

  const [dragHostId, setDragHostId] = useState<string | null>(null);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);

  const handleHostMouseDown = useCallback((e: React.MouseEvent, hostId: string) => {
    if (e.button !== 0 || selectionMode) return;
    dragStartRef.current = { hostId, startX: e.clientX, startY: e.clientY };
    isDraggingRef.current = false;
    hoverGroupIdRef.current = null;
  }, [selectionMode]);

  // ── Document-level drag handlers ──
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      if (!isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        if (dx * dx + dy * dy > 25) {
          isDraggingRef.current = true;
          setDragHostId(dragStartRef.current.hostId);
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
        moveHostToGroupRef.current(dragStartRef.current.hostId, targetGroupId);
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
      setDragHostId(null);
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

  // ── Right-click context menu (group) ──
  const {
    menuState: groupMenuState,
    onContextMenu: onGroupContextMenu,
    closeMenu: closeGroupMenu,
  } = useContextMenu<HostGroup>();

  // ── Right-click context menu (host) ──
  const {
    menuState: hostMenuState,
    onContextMenu: onHostContextMenu,
    closeMenu: closeHostMenu,
  } = useContextMenu<Host>();

  const hostContextMenuItems: MenuItem[] = hostMenuState
    ? [
        {
          label: t("conn.editConnection"),
          icon: <Pencil size={14} />,
          onClick: () => {
            setEditingHost(hostMenuState.data);
            setSelectedHostId(hostMenuState.data.id);
            setShowForm(true);
          },
        },
        {
          label: t("conn.testConnection"),
          icon: <Zap size={14} />,
          onClick: async () => {
            try {
              const result = await api.connectionTest(hostMenuState.data.id);
              if (result.success) toast.success(result.message);
              else toast.error(result.message);
            } catch (e) {
              toast.error(String(e));
            }
          },
        },
        { type: "separator" as const },
        {
          label: hostMenuState.data.isFavorite ? t("conn.unfavorite") : t("conn.favorite"),
          icon: hostMenuState.data.isFavorite ? <StarOff size={14} /> : <Star size={14} />,
          onClick: () => {
            updateHost({
              id: hostMenuState.data.id,
              isFavorite: !hostMenuState.data.isFavorite,
            });
          },
        },
        ...(groups.length > 0
          ? [
              {
                label: t("conn.moveToGroup"),
                icon: <FolderInput size={14} />,
                onClick: () => setMoveTargetHostId(hostMenuState.data.id),
              } as MenuItem,
            ]
          : []),
        { type: "separator" as const },
        {
          label: t("conn.deleteConnection"),
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: t("confirm.deleteConnectionTitle"),
              description: t("confirm.deleteConnectionDesc"),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) await deleteHost(hostMenuState.data.id);
          },
        },
      ]
    : [];

  const groupContextMenuItems: MenuItem[] = groupMenuState
    ? [
        {
          label: t("conn.renameGroup"),
          icon: <Pencil size={14} />,
          onClick: () => setRenamingGroupId(groupMenuState.data.id),
        },
        {
          label: t("conn.deleteGroup"),
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: t("conn.deleteGroup"),
              description: t("conn.deleteGroupDesc"),
              confirmLabel: t("confirm.delete"),
            });
            if (ok) await deleteGroup(groupMenuState.data.id);
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
      title: t("conn.batchDelete"),
      description: t("conn.batchDeleteDesc", { n: count }),
      confirmLabel: t("confirm.delete"),
    });
    if (!ok) return;
    const ids = Array.from(selectedIds);
    exitSelectionMode();
    await batchDeleteHosts(ids);
    toast.success(t("conn.batchDeleted", { n: count }));
  };

  useEffect(() => {
    fetchHosts();
    fetchGroups();
  }, [fetchHosts, fetchGroups]);

  const selectHost = (id: string) => {
    // Determine direction based on host list order
    const prevIdx = filteredHosts.findIndex((h) => h.id === prevHostIdRef.current);
    const nextIdx = filteredHosts.findIndex((h) => h.id === id);
    setDetailAnim(nextIdx >= prevIdx ? "animate-fade-in-up" : "animate-fade-in-down");
    prevHostIdRef.current = id;
    setSelectedHostId(id);
    setShowForm(false);
    setShowImport(false);
    setEditingHost(null);
  };

  const selectedHost = hosts.find((h) => h.id === selectedHostId) ?? null;

  const filteredHosts = searchQuery
    ? hosts.filter(
        (h) =>
          h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          h.host.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : hosts;

  const groupedHosts = groups.map((g) => ({
    group: g,
    hosts: filteredHosts.filter((h) => h.groupId === g.id),
  }));
  const ungroupedHosts = filteredHosts.filter((h) => !h.groupId);

  const handleCreateGroup = () => {
    setCreatingGroup(true);
    setTimeout(() => newGroupInputRef.current?.focus(), 0);
  };

  const handleCreateGroupConfirm = async (name: string) => {
    setCreatingGroup(false);
    if (name.trim()) {
      const id = await createGroup(name.trim());
      setExpandedGroupIds((prev) => new Set(prev).add(id));
    }
  };

  const handleRenameConfirm = async (groupId: string, newName: string) => {
    setRenamingGroupId(null);
    if (newName.trim()) {
      await updateGroup(groupId, newName);
    }
  };

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Connection List */}
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
              placeholder={t("conn.search")}
              className="pl-8"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleCreateGroup}
            title={t("conn.newGroup")}
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
            title={selectionMode ? t("conn.cancelSelect") : t("conn.batchSelect")}
          >
            {selectionMode ? <X size={16} /> : <ListChecks size={16} />}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
              setShowForm(false);
              setEditingHost(null);
              setShowImport(true);
            }}
            title="Import SSH Config"
          >
            <Upload size={16} />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
              setShowImport(false);
              setEditingHost(null);
              setShowForm(true);
            }}
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && (
            <p className="p-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              {t("conn.loading")}
            </p>
          )}

          {!loading && filteredHosts.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Server size={32} className="mb-3 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                {t("conn.noConnections")}
              </p>
              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {t("conn.addFirst")}
              </p>
            </div>
          )}

          {/* Grouped hosts */}
          {groupedHosts.map(({ group, hosts: groupHosts }) => {
            const expanded = expandedGroupIds.has(group.id);
            const isRenaming = renamingGroupId === group.id;
            return (
              <div key={group.id} className="mb-2" data-drop-group-id={group.id}>
                {isRenaming ? (
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
                    expanded={expanded}
                    onToggle={() => toggleGroupExpand(group.id)}
                    onContextMenu={(e) => onGroupContextMenu(e, group)}
                    isDropTarget={hoverGroupId === group.id}
                  />
                )}
                {groupHosts.length > 0 && (
                  <div className={cn("drawer-wrapper", expanded && "expanded")}>
                    <div className="drawer-inner">
                      <div className="border border-[var(--color-border)] rounded-2xl">
                        {groupHosts.map((h) => (
                          <HostItem
                            key={h.id}
                            host={h}
                            selected={h.id === selectedHostId}
                            onSelect={() => {
                              if (suppressClickRef.current) return;
                              selectHost(h.id);
                            }}
                            onContextMenu={(e) => onHostContextMenu(e, h)}
                            selectable={selectionMode}
                            checked={selectedIds.has(h.id)}
                            onToggleSelect={() => toggleSelect(h.id)}
                            onMouseDown={!selectionMode ? (e: React.MouseEvent) => handleHostMouseDown(e, h.id) : undefined}
                            isDragging={dragHostId === h.id}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* New group inline input */}
          {creatingGroup && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-1">
              <Folder size={14} className="flex-shrink-0 text-[var(--color-accent)]" />
              <input
                ref={newGroupInputRef}
                className="flex-1 bg-transparent text-[var(--font-size-sm)] text-[var(--color-text-primary)] outline-none"
                placeholder={t("conn.groupPlaceholder")}
                onBlur={(e) => handleCreateGroupConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroupConfirm((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setCreatingGroup(false);
                }}
              />
            </div>
          )}

          {/* Ungrouped hosts */}
          {groups.length > 0 ? (
            <div
              data-drop-group-id="ungrouped"
              className={cn(
                "rounded-2xl transition-colors duration-[var(--duration-fast)]",
                dragHostId && hoverGroupId === "ungrouped"
                  ? "border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                  : "",
              )}
            >
              {dragHostId && (
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-[var(--font-size-xs)] font-medium uppercase tracking-wide",
                  hoverGroupId === "ungrouped"
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)]",
                )}>
                  <FolderX size={14} />
                  {t("conn.noGroup")}
                </div>
              )}
              {ungroupedHosts.length > 0 && (
                <div className="mb-2">
                  {ungroupedHosts.map((h) => (
                    <HostItem
                      key={h.id}
                      host={h}
                      selected={h.id === selectedHostId}
                      onSelect={() => {
                        if (suppressClickRef.current) return;
                        selectHost(h.id);
                      }}
                      onContextMenu={(e) => onHostContextMenu(e, h)}
                      selectable={selectionMode}
                      checked={selectedIds.has(h.id)}
                      onToggleSelect={() => toggleSelect(h.id)}
                      onMouseDown={!selectionMode ? (e: React.MouseEvent) => handleHostMouseDown(e, h.id) : undefined}
                      isDragging={dragHostId === h.id}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            ungroupedHosts.length > 0 && (
              <div className="mb-2">
                {ungroupedHosts.map((h) => (
                  <HostItem
                    key={h.id}
                    host={h}
                    selected={h.id === selectedHostId}
                    onSelect={() => {
                      if (suppressClickRef.current) return;
                      selectHost(h.id);
                    }}
                    onContextMenu={(e) => onHostContextMenu(e, h)}
                    selectable={selectionMode}
                    checked={selectedIds.has(h.id)}
                    onToggleSelect={() => toggleSelect(h.id)}
                    onMouseDown={!selectionMode ? (e: React.MouseEvent) => handleHostMouseDown(e, h.id) : undefined}
                    isDragging={dragHostId === h.id}
                  />
                ))}
              </div>
            )
          )}

          {/* Group context menu */}
          {groupMenuState && (
            <ContextMenu
              x={groupMenuState.x}
              y={groupMenuState.y}
              onClose={closeGroupMenu}
              containerRef={listContainerRef}
              items={groupContextMenuItems}
            />
          )}

          {/* Host context menu */}
          {hostMenuState && (
            <ContextMenu
              x={hostMenuState.x}
              y={hostMenuState.y}
              onClose={closeHostMenu}
              containerRef={listContainerRef}
              items={hostContextMenuItems}
            />
          )}
        </div>

        {/* Move to group modal */}
        {moveTargetHostId && (() => {
          const targetHost = hosts.find((h) => h.id === moveTargetHostId);
          if (!targetHost) return null;
          return (
            <MoveToGroupModal
              currentGroupId={targetHost.groupId ?? null}
              groups={groups}
              onSelect={async (groupId) => {
                await updateHost({ id: moveTargetHostId, groupId });
                setMoveTargetHostId(null);
              }}
              onClose={() => setMoveTargetHostId(null)}
            />
          );
        })()}

        {/* Batch selection action bar */}
        {selectionMode && (
          <div className="border-t border-[var(--color-border)] px-3 py-2 flex items-center gap-2 flex-shrink-0">
            <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)] flex-1">
              {t("conn.selectedCount", { n: selectedIds.size })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (selectedIds.size === filteredHosts.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filteredHosts.map((h) => h.id)));
                }
              }}
            >
              {t("conn.selectAll")}
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
      </div>

      {/* Right: Detail / Form / Import */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {showImport ? (
          <div key="import" className="animate-fade-in-up flex flex-1 flex-col overflow-hidden">
            <SshConfigImportPanel onDone={() => setShowImport(false)} />
          </div>
        ) : showForm ? (
          <div key="form" className="animate-fade-in-up mx-auto w-full max-w-md">
            <h2 className="mb-4 text-[var(--font-size-lg)] font-medium">
              {editingHost ? t("conn.editConnection") : t("conn.newConnection")}
            </h2>
            <ConnectionForm
              host={editingHost}
              groups={groups}
              onSave={async (data) => {
                if (editingHost) {
                  await updateHost({ id: editingHost.id, ...data });
                } else {
                  await createHost(data);
                }
                setShowForm(false);
                setEditingHost(null);
              }}
              onCancel={() => {
                setShowForm(false);
                setEditingHost(null);
              }}
            />
          </div>
        ) : selectedHost ? (
          <HostDetail
            key={selectedHost.id}
            host={selectedHost}
            animClass={detailAnim}
            onEdit={() => {
              setEditingHost(selectedHost);
              setShowForm(true);
            }}
            onDelete={async () => {
              const ok = await confirm({
                title: t("confirm.deleteConnectionTitle"),
                description: t("confirm.deleteConnectionDesc"),
                confirmLabel: t("confirm.delete"),
              });
              if (!ok) return;
              await deleteHost(selectedHost.id);
            }}
            onToggleFavorite={async () => {
              await updateHost({
                id: selectedHost.id,
                isFavorite: !selectedHost.isFavorite,
              });
            }}
          />
        ) : (
          <div key="empty" className="animate-fade-in flex flex-1 items-center justify-center text-center">
            <div>
              <Server size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
                {t("conn.selectOrCreate")}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Drag ghost */}
      {dragHostId && (
        <div
          ref={dragGhostRef}
          className="fixed left-0 top-0 z-[100] pointer-events-none rounded-[var(--radius-control)] border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-3 py-2 shadow-[var(--shadow-floating)] max-w-[260px] opacity-90"
        >
          <div className="flex items-center gap-2">
            <Server size={14} className="text-[var(--color-accent)]" />
            <span className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
              {hosts.find((h) => h.id === dragHostId)?.name}
            </span>
          </div>
          <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {hosts.find((h) => h.id === dragHostId)?.host}
          </p>
        </div>
      )}
    </div>
  );
}

function HostItem({
  host,
  selected,
  onSelect,
  onContextMenu,
  selectable = false,
  checked = false,
  onToggleSelect,
  onMouseDown,
  isDragging = false,
}: {
  host: Host;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
}) {
  return (
    <button
      onMouseDown={onMouseDown}
      onClick={() => {
        if (selectable) {
          onToggleSelect?.();
        } else {
          onSelect();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)] active:scale-[0.98]",
        isDragging && "opacity-40 scale-[0.98]",
        selectable && checked
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
          : selected && !selectable
            ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
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
      <Server
        size={16}
        className={cn(
          "transition-colors duration-[var(--duration-base)]",
          (selectable ? checked : selected) ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[var(--font-size-sm)] font-medium">{host.name}</p>
        <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {host.username}@{host.host}:{host.port}
        </p>
      </div>
      {!selectable && host.isFavorite && (
        <span className="animate-star-pop">
          <Star size={14} className="text-[var(--color-warning)] fill-[var(--color-warning)]" />
        </span>
      )}
    </button>
  );
}

function HostDetail({
  host,
  animClass,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  host: Host;
  animClass: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const t = useT();
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openSession = useTerminalStore((s) => s.openSession);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  const hasSavedPassword = !!host.secretRef;

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await openSession(host.id, host.name);
      setCurrentPage("terminal");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await api.connectionTest(host.id);
      if (result.success) {
        toast.success(result.message);
      } else {
        setError(result.message);
        toast.error(result.message);
      }
    } catch (e) {
      setError(String(e));
      toast.error(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`${animClass} mx-auto w-full max-w-lg`}>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-[var(--font-size-xl)] font-medium">{host.name}</h2>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onToggleFavorite}>
            {host.isFavorite ? (
              <span className="animate-star-pop">
                <Star size={16} className="text-[var(--color-warning)] fill-[var(--color-warning)]" />
              </span>
            ) : (
              <StarOff size={16} />
            )}
          </Button>
          <Button size="icon" variant="ghost" onClick={onEdit}>
            <Pencil size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 size={16} className="text-[var(--color-error)]" />
          </Button>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
        <dl className="grid grid-cols-[120px_1fr] gap-3 text-[var(--font-size-sm)]">
          <dt className="text-[var(--color-text-muted)]">{t("form.host")}</dt>
          <dd>{host.host}</dd>
          <dt className="text-[var(--color-text-muted)]">{t("form.port")}</dt>
          <dd>{host.port}</dd>
          <dt className="text-[var(--color-text-muted)]">{t("form.username")}</dt>
          <dd>{host.username}</dd>
          <dt className="text-[var(--color-text-muted)]">{t("form.authType")}</dt>
          <dd>{host.authType === "password" ? t("form.password") : t("form.publicKey")}</dd>
          <dt className="text-[var(--color-text-muted)]">{t("form.created")}</dt>
          <dd>{new Date(host.createdAt).toLocaleString()}</dd>
          {host.lastConnectedAt && (
            <>
              <dt className="text-[var(--color-text-muted)]">{t("form.lastConnected")}</dt>
              <dd>{new Date(host.lastConnectedAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="mt-6 space-y-3">
        {host.authType === "password" && !hasSavedPassword && (
          <p className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("conn.noPasswordSaved")}
          </p>
        )}
        {hasSavedPassword && (
          <p className="text-[var(--font-size-xs)] text-[var(--color-success)]">
            {t("conn.passwordSaved")}
          </p>
        )}
        {error && (
          <p className="text-[var(--font-size-xs)] text-[var(--color-error)]">
            {error}
          </p>
        )}
        <Button
          className="w-full"
          size="lg"
          onClick={handleConnect}
          disabled={connecting || testing || !hasSavedPassword}
        >
          {connecting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("conn.connecting")}
            </>
          ) : (
            t("conn.connect")
          )}
        </Button>
        <Button
          className="w-full"
          size="lg"
          variant="secondary"
          onClick={handleTest}
          disabled={connecting || testing || !hasSavedPassword}
        >
          {testing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("conn.testing")}
            </>
          ) : (
            <>
              <Zap size={16} />
              {t("conn.testConnection")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
