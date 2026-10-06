import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke suite (Board #52): the built app under `vite preview`, on
// three engines at a phone and a desktop size. Plain Playwright; no LLM.
const PORT = 4173;
const CI = Boolean(process.env.CI);

const SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};
const ENGINES = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"],
};

export default defineConfig({
  testDir: "./e2e",
  // One worker locally (the dev machine has little memory); CI has more room.
  workers: CI ? 2 : 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: Object.entries(ENGINES).flatMap(([engine, device]) =>
    Object.entries(SIZES).map(([size, viewport]) => ({
      name: `${engine}-${size}`,
      use: { ...device, viewport },
    })),
  ),
  webServer: {
    command: `bun run build && bun run preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
