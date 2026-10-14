import { expect, type Page, test } from "@playwright/test";
import { makeBook } from "./book.ts";
import { loadBook, openFinder, watchErrors } from "./helpers.ts";

// The search box stays put while its list scrolls (review 2026-10-13): at the
// top of a sheet, at the foot of the quick switcher, never sunk into the list.
const bigBook = makeBook(
  "big",
  "Big Book",
  Array.from({ length: 120 }, (_, i) => ({
    title: `Invented Hymn ${i + 1}`,
    lines: [`A lantern for number ${i + 1}`, "amen"],
  })),
);

const top = (page: Page, name: string) =>
  page.getByRole("combobox", { name }).evaluate((el) => el.getBoundingClientRect().top);

test("the sheet Finder's box stays at the top while the list scrolls", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bigBook);
  const box = await openFinder(page);
  const sheet = page.getByRole("dialog");
  await box.press("End");
  await page.getByRole("listbox").hover();
  await page.mouse.wheel(0, 600);
  await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
  await page.waitForTimeout(150);
  // Stuck under the sheet's header, not scrolled away with the rows.
  const at = await top(page, "Find a song or command");
  const sheetTop = await sheet.evaluate((el) => el.getBoundingClientRect().top);
  expect(at).toBeGreaterThan(sheetTop);
  expect(at).toBeLessThan(sheetTop + 140);
  expect(errors).toEqual([]);
});

// Seven books that share a word: the switcher shows three of each, more than its
// list has room for at any window height (Firefox's fullscreen presents in a tall one).
const manyBooks = Array.from({ length: 7 }, (_, n) =>
  makeBook(
    `shelf${n}`,
    `Shelf ${n}`,
    Array.from({ length: 5 }, (_, i) => ({
      title: `Shelf ${n} Hymn ${i + 1}`,
      lines: [`A lantern for number ${i + 1}`, "amen"],
    })),
  ),
);

test("the quick switcher's box stays at the foot while its list scrolls", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  for (const book of manyBooks) await loadBook(page, book);
  await (await openFinder(page)).fill("1");
  await page
    .getByRole("option", { name: /#1 Shelf \d Hymn 1/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Go Live" }).click();
  await expect(page.getByRole("region", { name: "Presenting on this screen" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Find a song" });
  await box.fill("lantern");
  await expect(page.getByRole("option").first()).toBeVisible();
  const finder = page.locator(".present-switcher .finder");
  await expect.poll(() => finder.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const height = page.viewportSize()?.height ?? 0;
  const before = await box.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(before).toBeLessThanOrEqual(height);
  // Scroll the list away from the field, towards the older rows.
  await finder.evaluate((el) => {
    el.scrollTop = -el.scrollHeight;
  });
  await page.waitForTimeout(150);
  const after = await box.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(Math.abs(after - before)).toBeLessThan(1);
  expect(errors).toEqual([]);
});
