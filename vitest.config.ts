import path from "path";
import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts: the app config carries dev-server, optimizeDeps
// and build/chunking settings that are irrelevant (and slow) for node unit tests.
// The compliance engine is pure and side-effect free, so no DOM environment is needed.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Edge-function tests cover the pure parsing modules only (e.g.
    // fetch-ojt-data/parse.ts); handlers that touch Deno globals stay untested here.
    include: ["src/**/*.test.ts", "supabase/functions/**/*.test.ts"],
  },
});
