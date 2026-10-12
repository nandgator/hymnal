import { expect, test } from "@playwright/test";
import { loadBook, openSettings } from "./helpers.ts";

// A notice drawn over a modal sheet must take its own taps (Safari/iOS phone
// report: tapping "Got It" on the storage note over Settings pressed the
// control under it). Real touch, phone width; the desktop projects repeat it.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("the storage notice over Settings takes the tap on Got It", async ({ page }) => {
  // The browser refuses the request to keep storage: the first load says so.
  await page.addInitScript(() => {
    const real = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persist: async () => false,
        persisted: async () => false,
        estimate: async () => ({}),
        getDirectory: real?.getDirectory?.bind(real),
      },
    });
  });
  await page.goto("/");
  await loadBook(page);
  const gotIt = page.getByRole("button", { name: "Got It" });
  await expect(gotIt).toBeVisible();

  await openSettings(page);
  await expect(gotIt).toBeVisible();

  // Nothing under the notice answers for it, and the sheet's modality does
  // not make it inert.
  const hit = await gotIt.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return button === at || button.contains(at);
  });
  expect(hit).toBe(true);

  const box = await gotIt.boundingBox();
  if (!box) throw new Error("Got It has no box");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(gotIt).toBeHidden();
  // The sheet is still open and nothing under the notice was pressed.
  await expect(page.getByRole("region", { name: "Backup" })).toBeVisible();
});
