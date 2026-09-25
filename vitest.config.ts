import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Standalone test config. It deliberately does NOT reuse vite.config.ts: that
// config loads the TanStack Start + Nitro plugins, which build a full SSR app
// and are hostile to a plain node unit-test run. All we need here is the `@/`
// path alias and a node environment.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
