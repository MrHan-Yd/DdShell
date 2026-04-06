import { create } from "zustand";
import type { Snippet, SnippetGroup } from "@/types";
import * as api from "@/lib/tauri";
import { useCommandAssistStore } from "@/stores/commandAssist";

interface SnippetsState {
  snippets: Snippet[];
  groups: SnippetGroup[];
  loading: boolean;
  selectedSnippetId: string | null;
  selectedGroupId: string | null;
  searchQuery: string;

  setSelectedSnippetId: (id: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  fetchSnippets: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  createSnippet: (
    title: string,
    command: string,
    description?: string | null,
    tags?: string[] | null,
    groupId?: string | null,
  ) => Promise<string>;
  updateSnippet: (
    id: string,
    title?: string,
    command?: string,
    description?: string | null,
    tags?: string[] | null,
    groupId?: string | null,
  ) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  createGroup: (name: string) => Promise<string>;
  updateGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  batchDeleteSnippets: (ids: string[]) => Promise<void>;
  moveSnippetToGroup: (snippetId: string, groupId: string | null) => Promise<void>;
}

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: [],
  groups: [],
  loading: false,
  selectedSnippetId: null,
  selectedGroupId: null,
  searchQuery: "",

  setSelectedSnippetId: (id) => set({ selectedSnippetId: id }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  fetchSnippets: async () => {
    set({ loading: true });
    try {
      const snippets = await api.snippetList();
      const parsed = snippets.map((s) => ({
        ...s,
        tags: s.tags ? (typeof s.tags === "string" ? JSON.parse(s.tags as unknown as string) : s.tags) : null,
      }));
      set({ snippets: parsed });
    } finally {
      set({ loading: false });
    }
  },

  fetchGroups: async () => {
    const groups = await api.snippetGroupList();
    set({ groups });
  },

  createSnippet: async (title, command, description, tags, groupId) => {
    const { id } = await api.snippetCreate(title, command, description, tags, groupId);
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
    return id;
  },

  updateSnippet: async (id, title, command, description, tags, groupId) => {
    await api.snippetUpdate(id, title, command, description, tags, groupId);
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
  },

  deleteSnippet: async (id) => {
    await api.snippetDelete(id);
    const { selectedSnippetId } = get();
    if (selectedSnippetId === id) {
      set({ selectedSnippetId: null });
    }
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
  },

  deleteGroup: async (id) => {
    const { selectedGroupId, selectedSnippetId, snippets } = get();
    const snippetInGroup = selectedSnippetId &&
      snippets.find((s) => s.id === selectedSnippetId)?.groupId === id;

    await api.snippetGroupDelete(id);

    set({
      selectedGroupId: selectedGroupId === id ? null : selectedGroupId,
      selectedSnippetId: snippetInGroup ? null : selectedSnippetId,
    });
    await get().fetchGroups();
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
  },

  createGroup: async (name) => {
    const { id } = await api.snippetGroupCreate(name);
    await get().fetchGroups();
    return id;
  },

  updateGroup: async (id, name) => {
    await api.snippetGroupUpdate(id, name);
    await get().fetchGroups();
  },

  batchDeleteSnippets: async (ids) => {
    for (const id of ids) {
      await api.snippetDelete(id);
    }
    const { selectedSnippetId } = get();
    if (selectedSnippetId && ids.includes(selectedSnippetId)) {
      set({ selectedSnippetId: null });
    }
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
  },

  moveSnippetToGroup: async (snippetId, groupId) => {
    await api.snippetUpdate(snippetId, undefined, undefined, undefined, undefined, groupId);
    await get().fetchSnippets();
    useCommandAssistStore.getState().load();
  },
}));
