import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend-Port im Dev — Standard 3000, überschreibbar via MC_SERVER_PORT
// (z. B. wenn auf 3000 bereits eine andere App läuft). API & WebSocket werden
// dorthin geproxyt, damit das Session-Cookie same-origin bleibt.
const apiPort = process.env.MC_SERVER_PORT ?? "3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
      "/ws": { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
