import { create } from "zustand";
import type { Host, HostGroup, CreateHostRequest, UpdateHostRequest } from "@/types";
import * as api from "@/lib/tauri";

interface ConnectionsState {
  hosts: Host[];
  groups: HostGroup[];
  loading: boolean;
  selectedHostId: string | null;
  searchQuery: string;

  setSelectedHostId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  fetchHosts: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  createHost: (req: CreateHostRequest) => Promise<string>;
  updateHost: (req: UpdateHostRequest) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
  createGroup: (name: string, parentId?: string | null) => Promise<string>;
  updateGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  hosts: [],
  groups: [],
  loading: false,
  selectedHostId: null,
  searchQuery: "",

  setSelectedHostId: (id) => set({ selectedHostId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  fetchHosts: async () => {
    set({ loading: true });
    try {
      const hosts = await api.connectionList();
      set({ hosts });
    } finally {
      set({ loading: false });
    }
  },

  fetchGroups: async () => {
    const groups = await api.groupList();
    set({ groups });
  },

  createHost: async (req) => {
    const { id } = await api.connectionCreate(req);
    await get().fetchHosts();
    return id;
  },

  updateHost: async (req) => {
    await api.connectionUpdate(req);
    await get().fetchHosts();
  },

  deleteHost: async (id) => {
    await api.connectionDelete(id);
    const { selectedHostId } = get();
    if (selectedHostId === id) {
      set({ selectedHostId: null });
    }
    await get().fetchHosts();
  },

  createGroup: async (name, parentId) => {
    const { id } = await api.groupCreate(name, parentId);
    await get().fetchGroups();
    return id;
  },

  updateGroup: async (id, name) => {
    await api.groupUpdate(id, name);
    await get().fetchGroups();
  },

  deleteGroup: async (id) => {
    await api.groupDelete(id);
    await get().fetchGroups();
  },
}));
