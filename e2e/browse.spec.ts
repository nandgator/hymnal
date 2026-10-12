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

  // The list is the book and the actions, in a window: a few dozen options in the DOM.
  await expect(options.first()).toHaveAttribute("aria-setsize", /^\d+$/);
  const total = Number(await options.first().getAttribute("aria-setsize"));
  expect(total).toBeGreaterThan(COUNT);
  expect(await options.count()).toBeLessThan(80);

  // End reaches the last song, and only the last songs are in the DOM.
  await box.press("End");
  const last = listbox(page).getByRole("option", {
    name: `#${COUNT} Invented Hymn ${COUNT}`,
    exact: true,
  });
  await expect(last).toBeVisible();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(last).toHaveAttribute("aria-posinset", String(total));
  expect(await options.count()).toBeLessThan(80);
  await expect(listbox(page).getByRole("option", { name: /^#1 / })).toHaveCount(0);

  // Home goes back; a wheel scroll by hand brings later songs in and drops the earlier.
  await box.press("Home");
  await expect(options.first()).toHaveAttribute("aria-posinset", "1");
  await listbox(page).hover();
  await page.mouse.wheel(0, 9000);
  await expect
    .poll(async () =>
      Math.min(
        ...(await options.evaluateAll((all) =>
          all.map((o) => Number(o.getAttribute("aria-posinset"))),
        )),
      ),
    )
    .toBeGreaterThan(60);
  expect(await options.count()).toBeLessThan(80);

  // End again, then Enter opens the last song.
  await box.press("End");
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
  const end = listbox(page).getByText("End of results");
  await expect(async () => {
    await box.press("Control+End");
    await expect(end).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await box.press("Control+End");
  await expect(options.last()).toHaveAttribute("aria-setsize", String(SHARED));
  await expect(options.last()).toHaveAttribute("aria-posinset", String(SHARED));

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
