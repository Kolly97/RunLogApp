import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend lebt in ./client, API-Server läuft auf :3000.
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
