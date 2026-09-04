import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest-only config (vite build still uses vite.config.ts). setupFiles polyfills
// matchMedia for jsdom component tests; per-file `// @vitest-environment jsdom`
// opts individual suites into a DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/test-setup.ts"],
  },
});
