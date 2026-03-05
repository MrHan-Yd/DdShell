import { create } from "zustand";
import type { Snippet } from "@/types";
import * as api from "@/lib/tauri";

interface SnippetsState {
  snippets: Snippet[];
  loading: boolean;
  selectedSnippetId: string | null;
  searchQuery: string;

  setSelectedSnippetId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  fetchSnippets: () => Promise<void>;
  createSnippet: (
    title: string,
    command: string,
    description?: string | null,
    tags?: string[] | null,
  ) => Promise<string>;
  updateSnippet: (
    id: string,
    title?: string,
    command?: string,
    description?: string | null,
    tags?: string[] | null,
  ) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
}

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: [],
  loading: false,
  selectedSnippetId: null,
  searchQuery: "",

  setSelectedSnippetId: (id) => set({ selectedSnippetId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  fetchSnippets: async () => {
    set({ loading: true });
    try {
      const snippets = await api.snippetList();
      // Parse tags from JSON string
      const parsed = snippets.map((s) => ({
        ...s,
        tags: s.tags ? (typeof s.tags === "string" ? JSON.parse(s.tags as unknown as string) : s.tags) : null,
      }));
      set({ snippets: parsed });
    } finally {
      set({ loading: false });
    }
  },

  createSnippet: async (title, command, description, tags) => {
    const { id } = await api.snippetCreate(title, command, description, tags);
    await get().fetchSnippets();
    return id;
  },

  updateSnippet: async (id, title, command, description, tags) => {
    await api.snippetUpdate(id, title, command, description, tags);
    await get().fetchSnippets();
  },

  deleteSnippet: async (id) => {
    await api.snippetDelete(id);
    const { selectedSnippetId } = get();
    if (selectedSnippetId === id) {
      set({ selectedSnippetId: null });
    }
    await get().fetchSnippets();
  },
}));
