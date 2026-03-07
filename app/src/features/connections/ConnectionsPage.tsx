import { useEffect, useRef, useState } from "react";
import { Plus, Search, Server, Folder, Trash2, Pencil, Star, StarOff, Loader2, Zap, Upload, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/stores/connections";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import { toast } from "@/stores/toast";
import { confirm } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
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
          <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} />
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
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as AuthType)}
          className="select-mac w-full"
        >
          <option value="password">{t("form.password")}</option>
          <option value="publickey">{t("form.publicKey")}</option>
        </select>
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
          <select
            value={groupId ?? ""}
            onChange={(e) => setGroupId(e.target.value || null)}
            className="select-mac w-full"
          >
            <option value="">{t("conn.noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
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
        <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
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
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
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
  } = useConnectionsStore();

  const [showForm, setShowForm] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [detailAnim, setDetailAnim] = useState("animate-fade-in-up");
  const prevHostIdRef = useRef<string | null>(null);

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

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Connection List */}
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
              placeholder={t("conn.search")}
              className="pl-8"
            />
          </div>
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
          {groupedHosts.map(
            ({ group, hosts: groupHosts }) =>
              groupHosts.length > 0 && (
                <div key={group.id} className="mb-2">
                  <div className="flex items-center gap-2 px-2 py-1">
                    <Folder size={14} className="text-[var(--color-text-muted)]" />
                    <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                      {group.name}
                    </span>
                  </div>
                  {groupHosts.map((h) => (
                    <HostItem
                      key={h.id}
                      host={h}
                      selected={h.id === selectedHostId}
                      onSelect={() => selectHost(h.id)}
                    />
                  ))}
                </div>
              ),
          )}

          {/* Ungrouped hosts */}
          {ungroupedHosts.map((h) => (
            <HostItem
              key={h.id}
              host={h}
              selected={h.id === selectedHostId}
              onSelect={() => selectHost(h.id)}
            />
          ))}
        </div>
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
    </div>
  );
}

function HostItem({
  host,
  selected,
  onSelect,
}: {
  host: Host;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left transition-all duration-[var(--duration-base)] ease-[var(--ease-smooth)] active:scale-[0.98]",
        selected
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <Server
        size={16}
        className={cn(
          "transition-colors duration-[var(--duration-base)]",
          selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[var(--font-size-sm)] font-medium">{host.name}</p>
        <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {host.username}@{host.host}:{host.port}
        </p>
      </div>
      {host.isFavorite && (
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
          <dd className="capitalize">{host.authType}</dd>
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
              <Loader2 size={16} className="animate-spin" />
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
              <Loader2 size={16} className="animate-spin" />
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
