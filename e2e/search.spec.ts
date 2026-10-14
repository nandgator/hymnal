import { expect, type Page, test } from "@playwright/test";
import { BOOK_TITLE, bookFile, makeBook } from "./book.ts";
import { loadBook, openFinder, watchErrors } from "./helpers.ts";

// One search across every book (SDD-0001 §13.1, Board #38): two invented books
// share the word "lantern"; no lyrics from the maintainer's books go in here.
const SECOND_TITLE = "Coast Hymns";
const secondBook = makeBook(
  "coast",
  SECOND_TITLE,
  [
    ["Lantern Morning", "The lantern burns at break of day"],
    ["Quay Song", "A lantern swings above the quay"],
    ["Net Mender", "By lantern light the nets are mended"],
    ["Tide Bell", "One lantern marks the tide bell"],
    ["Gull Rest", "Under a lantern the gulls sleep"],
    ["Cove Evening", "A lantern glows across the cove"],
    ["Pilot Light", "The pilot trims the lantern wick"],
  ].map(([title, line]) => ({
    title,
    lines: [line, "and the sea goes quiet"],
  })),
);

const listbox = (page: Page) => page.getByRole("listbox", { name: "Matching songs" });
const crumb = (page: Page) => page.getByRole("navigation", { name: "Hymnbook and song" });

test("search every book: grouped, found under each, a pick in the other book opens it", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bookFile);
  await loadBook(page, secondBook);

  // Book 1 current: open one of its songs.
  let box = await openFinder(page);
  await box.fill("1");
  await listbox(page)
    .getByRole("group", { name: BOOK_TITLE })
    .getByRole("option", { name: /#1 Lantern Morning/ })
    .click();
  await expect(page.getByRole("heading", { name: "Lantern Morning #1" })).toBeVisible();
  await expect(crumb(page)).toContainText(BOOK_TITLE);

  // The word, typed: all books, a group per book, the current book first.
  box = await openFinder(page);
  await box.fill("lantern");
  const results = listbox(page);
  const first = results.getByRole("group", { name: BOOK_TITLE });
  const second = results.getByRole("group", { name: SECOND_TITLE });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const groups = results.getByRole("group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText(BOOK_TITLE);
  await expect(groups.nth(1)).toContainText(SECOND_TITLE);

  // A song held in both books is found under each.
  await expect(first.getByRole("option", { name: /#1 Lantern Morning/ })).toHaveCount(1);
  await expect(second.getByRole("option", { name: /#1 Lantern Morning/ })).toHaveCount(1);

  // The other book shows five, then More in, which shows the rest in place.
  await expect(second.getByRole("option")).toHaveCount(6);
  const more = second.getByRole("option", { name: `More in ${SECOND_TITLE}` });
  await expect(more).toBeVisible();
  await more.click();
  await expect(second.getByRole("option")).toHaveCount(7);
  await expect(second.getByRole("option", { name: /More in/ })).toHaveCount(0);

  // Pick a song in the other book: it becomes current and the song opens.
  await second.getByRole("option", { name: /#7 Pilot Light/ }).click();
  await expect(page.getByRole("heading", { name: "Pilot Light #7" })).toBeVisible();
  await expect(crumb(page)).toContainText(SECOND_TITLE);
  await expect(crumb(page)).not.toContainText(BOOK_TITLE);

  // A number is searched in every book too (ADR-0032, amended 2026-10-12): the
  // current book's group first, the other book's joining when it has been read.
  box = await openFinder(page);
  await box.fill("2");
  const numbers = results.getByRole("group");
  await expect(numbers).toHaveCount(2);
  await expect(numbers.nth(0)).toContainText(SECOND_TITLE);
  await expect(numbers.nth(1)).toContainText(BOOK_TITLE);
  await expect(numbers.nth(0).getByRole("option")).toHaveCount(1);
  await expect(numbers.nth(0).getByRole("option")).toContainText("Quay Song");
  await expect(numbers.nth(1).getByRole("option")).toContainText("River Of Stones");

  // A pick in the other book hands its book.
  await numbers
    .nth(1)
    .getByRole("option", { name: /River Of Stones/ })
    .click();
  await expect(page.getByRole("heading", { name: "River Of Stones #2" })).toBeVisible();
  await expect(crumb(page)).toContainText(BOOK_TITLE);

  expect(errors).toEqual([]);
});
