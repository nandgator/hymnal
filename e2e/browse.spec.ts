import { expect, type Page, test } from "@playwright/test";
import { makeBook } from "./book.ts";
import { loadBook, openFinder, watchErrors } from "./helpers.ts";

// Browse a whole book (SDD-0001 §13.2, Board #66): 300 invented songs, the
// first 80 of which share a word, so a search runs past its first page of 30.
const COUNT = 300;
const SHARED = 80;
const bigBook = makeBook(
  "big",
  "Big Book",
  Array.from({ length: COUNT }, (_, i) => ({
    title: `Invented Hymn ${i + 1}`,
    lines: [i < SHARED ? `A lantern for number ${i + 1}` : `A river for number ${i + 1}`, "amen"],
  })),
);

const listbox = (page: Page) => page.getByRole("listbox", { name: "Matching songs and actions" });

test("the Finder lists the whole book in a window: scroll to the end, open a late song", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bigBook);
  const box = await openFinder(page);
  const options = listbox(page).getByRole("option");

  // Songs, not just twenty: the list reaches number 40 on screen scroll, and the DOM stays small.
  await expect(
    listbox(page).getByRole("option", { name: "#1 Invented Hymn 1", exact: true }),
  ).toBeVisible();
  expect(await options.count()).toBeLessThan(80);
  await expect(options.first()).toHaveAttribute("aria-setsize", /\d+/);

  // Scrolling by hand brings later songs in and drops the earlier.
  await listbox(page).hover();
  await page.mouse.wheel(0, 6000);
  await expect(listbox(page).getByRole("option", { name: /^#1 / })).toHaveCount(0);
  expect(await options.count()).toBeLessThan(80);
  const posinsets = await options.evaluateAll((all) =>
    all.map((o) => Number(o.getAttribute("aria-posinset"))),
  );
  expect(Math.min(...posinsets)).toBeGreaterThan(20);

  // End reaches the last song; opening it opens song 300.
  await box.press("End");
  const last = listbox(page).getByRole("option", {
    name: `#${COUNT} Invented Hymn ${COUNT}`,
    exact: true,
  });
  await expect(last).toBeVisible();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: `Invented Hymn ${COUNT} #${COUNT}` }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a search that has more than a page scrolls on past 30", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bigBook);
  const box = await openFinder(page);
  const options = listbox(page).getByRole("option");

  await box.fill("lantern");
  await expect(options.first()).toBeVisible();
  await expect(options.first()).toHaveAttribute("aria-setsize", "30");

  // The next pages arrive as the end is reached: 30, 60, then the last 20.
  await box.press("Control+End");
  await expect(options.last()).toHaveAttribute("aria-setsize", /^(60|80)$/);
  await box.press("Control+End");
  await expect(listbox(page).getByText("End of results")).toBeVisible();
  await expect(options.last()).toHaveAttribute("aria-setsize", String(SHARED));

  // No song twice: every position in the window is distinct.
  const numbers = await options.evaluateAll((all) =>
    all.map((o) => o.getAttribute("aria-posinset")),
  );
  expect(new Set(numbers).size).toBe(numbers.length);

  // A new query starts over.
  await box.fill("river");
  await expect(options.first()).toHaveAttribute("aria-setsize", "30");
  expect(errors).toEqual([]);
});
