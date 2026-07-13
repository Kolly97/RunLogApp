import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend lebt in ./client, API-Server läuft auf :3000.
// Multi-Page-Build: App + eigenständige Doku-Seiten (Anleitung, Changelog).
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "client/index.html"),
        usage: resolve(__dirname, "client/usage.html"),
        changelog: resolve(__dirname, "client/changelog.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
