import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the backend so the browser talks same-origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    // Pin the dev port so the OAuth redirect_uri (registered in Google) stays
    // stable — strictPort fails loudly instead of hopping to 5174.
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:8000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
