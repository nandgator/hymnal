import { expect, type Page, test } from "@playwright/test";
import { makeBook } from "./book.ts";
import { loadBook, openSettings } from "./helpers.ts";

// A notice drawn over a modal sheet must take its own taps (Safari/iOS phone
// report: tapping "Got It" on the storage note over Settings pressed the
// control under it). Real touch, phone width; the desktop projects repeat it.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** The browser refuses the request to keep storage: the first load says so. */
async function refuseStorage(page: Page): Promise<void> {
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
}

test("the storage notice over Settings takes the tap on Got It", async ({ page }) => {
  await refuseStorage(page);
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

test("a notice over the Load Books sheet leaves its buttons in reach", async ({ page }) => {
  await refuseStorage(page);
  await page.goto("/");
  await loadBook(page);
  const gotIt = page.getByRole("button", { name: "Got It" });
  await expect(gotIt).toBeVisible();

  // A second book: its review sheet opens with the notice still up.
  await page.getByTestId("book-file").setInputFiles(makeBook("coast", "Coast Hymns", []));
  const dialog = page.getByRole("dialog", { name: "Load Books" });
  const load = dialog.getByRole("button", { name: "Load Book", exact: true });
  await expect(load).toBeVisible();
  await expect(gotIt).toBeVisible();

  // The notice covers no button of the sheet: each one is what a tap reaches.
  const covered = () =>
    dialog.evaluate((sheet) =>
      [...sheet.querySelectorAll("button:not(:disabled)")]
        .filter((button) => {
          const box = button.getBoundingClientRect();
          if (box.width === 0 || box.bottom < 0 || box.top > innerHeight) return false;
          const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return !(button === at || button.contains(at));
        })
        .map((button) => button.textContent?.trim()),
    );
  // The sheet makes room as the notice settles, so poll.
  await expect.poll(covered).toEqual([]);

  await load.click();
  await expect(dialog).toBeHidden();
});
