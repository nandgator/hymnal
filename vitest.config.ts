import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  define: { __APP_BUILD__: JSON.stringify("test") },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "virtual:pwa-register": new URL("./src/vitest-pwa-register.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/vitest-setup.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**", "e2e/**"],
  },
});
