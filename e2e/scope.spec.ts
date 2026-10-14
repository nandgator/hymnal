import { expect, type Page, test } from "@playwright/test";
import { BOOK_TITLE, bookFile, makeBook } from "./book.ts";
import { books, loadBook, openFinder, watchErrors } from "./helpers.ts";

// The scope chips under the Finder's field (SDD-0001 §13.4, Board #68): three invented
// books; "quay" is only in the second, "pebble" only in the third.
const SECOND_TITLE = "Coast Hymns";
const THIRD_TITLE = "Shingle Beach Songs";
const secondBook = makeBook("coast", SECOND_TITLE, [
  { title: "Lantern Morning", lines: ["The lantern burns at break of day", "and the sea is calm"] },
  { title: "Quay Song", lines: ["A lantern swings above the quay", "and the sea goes quiet"] },
]);
const thirdBook = makeBook("shingle", THIRD_TITLE, [
  { title: "Pebble Hymn", lines: ["A pebble in the shallows", "and the sea goes quiet"] },
]);

const songs = (page: Page) => page.getByRole("listbox", { name: "Matching songs" });
const chips = (page: Page) => page.getByRole("group", { name: "Search in" });
const chip = (page: Page, name: string) => chips(page).getByRole("button", { name, exact: true });

test("scope chips: This Book, the scoped no-match card, Books…, and the choice is remembered", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bookFile);
  await loadBook(page, secondBook);
  await loadBook(page, thirdBook);

  // Make the Demo Book current: open one of its songs.
  let box = await openFinder(page);
  await expect(chips(page)).toBeVisible();
  await expect(chip(page, "All Books")).toHaveAttribute("aria-pressed", "true");
  await box.fill("1");
  await songs(page)
    .getByRole("group", { name: BOOK_TITLE })
    .getByRole("option", { name: /#1 Lantern Morning/ })
    .click();
  await expect(page.getByRole("heading", { name: "Lantern Morning #1" })).toBeVisible();

  // All Books finds "lantern" in two books; This Book only in the current one.
  box = await openFinder(page);
  await box.fill("lantern");
  await expect(songs(page).getByRole("group")).toHaveCount(2);
  await chip(page, "This Book").click();
  await expect(chip(page, "This Book")).toHaveAttribute("aria-pressed", "true");
  await expect(songs(page).getByRole("option")).toHaveCount(1);
  await expect(songs(page).getByRole("group", { name: SECOND_TITLE })).toHaveCount(0);
  // The pointer left the focus in the field.
  await expect(box).toBeFocused();

  // A word only another book has: the card says where it looked, and offers All Books.
  await box.fill("quay");
  await expect(page.getByRole("heading", { name: "No matches in This Book" })).toBeVisible();
  await page.getByRole("button", { name: "Search All Books" }).click();
  await expect(chip(page, "All Books")).toHaveAttribute("aria-pressed", "true");
  await expect(
    songs(page)
      .getByRole("group", { name: SECOND_TITLE })
      .getByRole("option", { name: /Quay Song/ }),
  ).toBeVisible();

  // Books…: a checklist, none cannot be applied, Done applies the two chosen.
  await chip(page, "Books…").click();
  const dialog = page.getByRole("dialog", { name: "Search these books" });
  await expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: SECOND_TITLE }).check();
  await dialog.getByRole("checkbox", { name: THIRD_TITLE }).check();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(page, "2 Books")).toHaveAttribute("aria-pressed", "true");
  await box.fill("sea");
  await expect(songs(page).getByRole("group")).toHaveCount(2);
  await expect(songs(page).getByRole("group", { name: BOOK_TITLE })).toHaveCount(0);

  // Keyboard: Tab from the field reaches the pressed chip, arrows move along the row.
  // (Past the field's Clear button, there while it has text.)
  await box.fill("");
  await box.focus();
  await page.keyboard.press("Tab");
  await expect(chip(page, "2 Books")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(chip(page, "This Book")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(chip(page, "All Books")).toBeFocused();

  // Remembered across sessions.
  await page.reload();
  await expect(books(page).getByRole("listitem")).toHaveCount(3);
  box = await openFinder(page);
  await expect(chip(page, "2 Books")).toHaveAttribute("aria-pressed", "true");

  // No chips in commands.
  await box.fill(">");
  await expect(chips(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
