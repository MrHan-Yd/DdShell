import { useEffect, useState } from "react";
import { Plus, Search, Server, Folder, Trash2, Pencil, Star, StarOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/stores/connections";
import { useTerminalStore } from "@/stores/terminal";
import { useAppStore } from "@/stores/app";
import type { Host, HostGroup, AuthType } from "@/types";

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
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(host?.name ?? "");
  const [hostAddr, setHostAddr] = useState(host?.host ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? "root");
  const [authType, setAuthType] = useState<AuthType>(host?.authType ?? "password");
  const [groupId, setGroupId] = useState<string | null>(host?.groupId ?? null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, host: hostAddr, port, username, authType, groupId });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          Name
        </label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" required />
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            Host
          </label>
          <Input value={hostAddr} onChange={(e) => setHostAddr(e.target.value)} placeholder="10.0.0.1" required />
        </div>
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            Port
          </label>
          <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          Username
        </label>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" required />
      </div>
      <div>
        <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          Auth Type
        </label>
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as AuthType)}
          className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
        >
          <option value="password">Password</option>
          <option value="publickey">Public Key</option>
        </select>
      </div>
      {groups.length > 0 && (
        <div>
          <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            Group
          </label>
          <select
            value={groupId ?? ""}
            onChange={(e) => setGroupId(e.target.value || null)}
            className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
          >
            <option value="">No Group</option>
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
          Cancel
        </Button>
        <Button type="submit">
          {host ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}

export function ConnectionsPage() {
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

  useEffect(() => {
    fetchHosts();
    fetchGroups();
  }, [fetchHosts, fetchGroups]);

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
              placeholder="Search..."
              className="pl-8"
            />
          </div>
          <Button
            size="icon"
            variant="secondary"
            onClick={() => {
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
              Loading...
            </p>
          )}

          {!loading && filteredHosts.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Server size={32} className="mb-3 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                No connections yet
              </p>
              <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                Click + to add your first connection
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
                      onSelect={() => setSelectedHostId(h.id)}
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
              onSelect={() => setSelectedHostId(h.id)}
            />
          ))}
        </div>
      </div>

      {/* Right: Detail / Form */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {showForm ? (
          <div className="mx-auto w-full max-w-md">
            <h2 className="mb-4 text-[var(--font-size-lg)] font-medium">
              {editingHost ? "Edit Connection" : "New Connection"}
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
            host={selectedHost}
            onEdit={() => {
              setEditingHost(selectedHost);
              setShowForm(true);
            }}
            onDelete={async () => {
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
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <Server size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
              <p className="text-[var(--font-size-base)] text-[var(--color-text-secondary)]">
                Select a connection or create a new one
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
        "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors duration-[var(--duration-fast)]",
        selected
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <Server size={16} className={selected ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[var(--font-size-sm)] font-medium">{host.name}</p>
        <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
          {host.username}@{host.host}:{host.port}
        </p>
      </div>
      {host.isFavorite && <Star size={14} className="text-[var(--color-warning)] fill-[var(--color-warning)]" />}
    </button>
  );
}

function HostDetail({
  host,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  host: Host;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openSession = useTerminalStore((s) => s.openSession);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  const handleConnect = async () => {
    if (!password.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      await openSession(host.id, host.name, password);
      setPassword("");
      setCurrentPage("terminal");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-[var(--font-size-xl)] font-medium">{host.name}</h2>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onToggleFavorite}>
            {host.isFavorite ? (
              <Star size={16} className="text-[var(--color-warning)] fill-[var(--color-warning)]" />
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
          <dt className="text-[var(--color-text-muted)]">Host</dt>
          <dd>{host.host}</dd>
          <dt className="text-[var(--color-text-muted)]">Port</dt>
          <dd>{host.port}</dd>
          <dt className="text-[var(--color-text-muted)]">Username</dt>
          <dd>{host.username}</dd>
          <dt className="text-[var(--color-text-muted)]">Auth Type</dt>
          <dd className="capitalize">{host.authType}</dd>
          <dt className="text-[var(--color-text-muted)]">Created</dt>
          <dd>{new Date(host.createdAt).toLocaleString()}</dd>
          {host.lastConnectedAt && (
            <>
              <dt className="text-[var(--color-text-muted)]">Last Connected</dt>
              <dd>{new Date(host.lastConnectedAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="mt-6 space-y-3">
        {host.authType === "password" && (
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
          />
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
          disabled={connecting || (host.authType === "password" && !password.trim())}
        >
          {connecting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Connecting...
            </>
          ) : (
            "Connect"
          )}
        </Button>
      </div>
    </div>
  );
}
