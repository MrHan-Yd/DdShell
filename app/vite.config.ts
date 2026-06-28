import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
          if (id.includes("/@xterm/")) return "vendor-xterm";
          if (
            id.includes("/@codemirror/state/") ||
            id.includes("/@codemirror/view/") ||
            id.includes("/@codemirror/language/")
          ) {
            return "vendor-codemirror-core";
          }
          if (id.includes("/@codemirror/") || id.includes("/codemirror/")) return "vendor-codemirror-addons";
          if (id.includes("/framer-motion/")) return "vendor-motion";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/@dnd-kit/")) return "vendor-dnd";
          return undefined;
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
