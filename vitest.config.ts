import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Two projects, one split. The DOM-free files below read no DOM, Worker or
// BroadcastChannel through anything they import and keep no module state that
// could leak, so they run in node without isolation: no jsdom, workers reused.
// This is an allowlist on purpose: a new test file lands in the isolated jsdom
// project by default, and joins the list only when it is checked to be DOM-free
// (then run `bunx vitest run --project node --sequence.shuffle`).
const DOM_FREE = [
  "scripts/assorted-restore.test.ts",
  "scripts/backup.test.ts",
  "scripts/build-content.test.ts",
  "scripts/csp.test.ts",
  "scripts/import.test.ts",
  "scripts/pack.test.ts",
  "scripts/registry.test.ts",
  "scripts/sample-sources.test.ts",
  "scripts/text.test.ts",
  "src/domain/assorted.test.ts",
  "src/domain/container.test.ts",
  "src/domain/duplicates.test.ts",
  "src/domain/package-rows.test.ts",
  "src/domain/progress.test.ts",
  "src/domain/schema.test.ts",
  "src/domain/sequence-engine.test.ts",
  "src/domain/validate.test.ts",
  "src/import/draft.test.ts",
  "src/import/read/pdf.test.ts",
  "src/import/read/pptx.test.ts",
  "src/import/report.test.ts",
  "src/import/songtext.test.ts",
  "src/import/source.test.ts",
  "src/library/textbook.test.ts",
  "src/output/fullSong.test.ts",
  "src/output/screens.test.ts",
  "src/persistence/download.test.ts",
  "src/persistence/harden.test.ts",
  "src/persistence/memory-pool.test.ts",
  "src/persistence/search.test.ts",
  "src/shell/case.test.ts",
  "src/shell/glide-crossings.test.ts",
  "src/shell/menuPlacement.test.ts",
  "src/shell/workspace.test.ts",
];

export default defineConfig({
  plugins: [solid()],
  define: { __APP_BUILD__: JSON.stringify("test"), __SAMPLE_FILES__: "[]" },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "virtual:pwa-register": new URL("./src/vitest-pwa-register.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./src/vitest-setup.ts"],
          include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          exclude: ["**/node_modules/**", ".claude/worktrees/**", "e2e/**", ...DOM_FREE],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          isolate: false,
          include: DOM_FREE,
        },
      },
    ],
  },
});
