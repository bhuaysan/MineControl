import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend läuft im Dev auf :3000 — API & WebSocket werden dorthin geproxyt,
// damit das Session-Cookie same-origin bleibt.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
