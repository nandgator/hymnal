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

test("scope chips: This Book, the scoped no-match card, the books list, and the choice is remembered", async ({
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

  // The All Books chip opens a list of the titles, every book ticked; a tap applies at once.
  await chip(page, "All Books").click();
  const list = page.getByRole("listbox", { name: "Books to search" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(list.getByRole("option", { name: BOOK_TITLE })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await list.getByRole("option", { name: BOOK_TITLE }).click();
  await expect(chip(page, "2 Books")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  // Escape closed the list alone: Search is still open, and the chip has the focus.
  await expect(chip(page, "2 Books")).toBeFocused();
  await expect(box).toBeVisible();
  await box.fill("sea");
  await expect(songs(page).getByRole("group")).toHaveCount(2);
  await expect(songs(page).getByRole("group", { name: BOOK_TITLE })).toHaveCount(0);

  // The last ticked book cannot be unticked; every book ticked again is All Books.
  await chip(page, "2 Books").click();
  await list.getByRole("option", { name: SECOND_TITLE }).click();
  await expect(chip(page, "1 Book")).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("option", { name: THIRD_TITLE })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // (Forced: Playwright will not click what is aria-disabled, and the tap must do nothing.)
  await list.getByRole("option", { name: THIRD_TITLE }).click({ force: true });
  await expect(chip(page, "1 Book")).toBeVisible();
  await list.getByRole("option", { name: SECOND_TITLE }).click();
  await list.getByRole("option", { name: BOOK_TITLE }).click();
  await expect(chip(page, "All Books")).toHaveAttribute("aria-pressed", "true");
  await list.getByRole("option", { name: BOOK_TITLE }).click();
  await page.keyboard.press("Escape");
  await expect(chip(page, "2 Books")).toBeFocused();

  // Keyboard: Tab from the field reaches the pressed chip, arrows move along the row.
  // (Past the field's Clear button, there while it has text.)
  await box.fill("");
  await box.focus();
  await page.keyboard.press("Tab");
  await expect(chip(page, "2 Books")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(chip(page, "This Book")).toBeFocused();
  await page.keyboard.press("End");
  await expect(chip(page, "2 Books")).toBeFocused();

  // From This Book, one tap on the chip returns to the two books and opens the list.
  await chip(page, "This Book").click();
  await chip(page, "2 Books").click();
  await expect(list).toBeVisible();
  await expect(chip(page, "2 Books")).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("option", { name: BOOK_TITLE })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await page.keyboard.press("Escape");

  // Remembered across sessions (the last choice is written to storage a moment after the tap).
  await page.waitForTimeout(500);
  await page.reload();
  await expect(books(page).getByRole("listitem")).toHaveCount(3);
  box = await openFinder(page);
  await expect(chip(page, "2 Books")).toHaveAttribute("aria-pressed", "true");

  // No chips in commands.
  await box.fill(">");
  await expect(chips(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

// A tapped book opens Search over the Library on it (SDD-0001 §13.4): by mouse and, in the phone project, by touch.
test("a book tapped in the Library with no song up opens Search on it, for that opening only", async ({
  page,
  browserName,
  baseURL,
  viewport,
}) => {
  const touch = (viewport?.width ?? 1280) < 600;
  const context = touch
    ? await page
        .context()
        .browser()
        ?.newContext({
          baseURL,
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: browserName !== "firefox",
        })
    : undefined;
  const tab = context ? await context.newPage() : page;
  const errors = watchErrors(tab);
  await tab.goto("/");
  await loadBook(tab, bookFile);
  await loadBook(tab, secondBook);

  const tapBook = async (title: string) => {
    const row = books(tab).getByRole("button", { name: new RegExp(`^${title}`) });
    if (touch) await row.tap();
    else await row.click();
  };
  await tapBook(SECOND_TITLE);
  const search = tab.getByRole("dialog", { name: "Search" });
  await expect(search).toBeVisible();
  await expect(tab.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(chip(tab, "This Book")).toHaveAttribute("aria-pressed", "true");
  await expect(tab.getByRole("combobox", { name: "Find a song or command" })).toBeFocused();
  // Scoped: a word only the first book has finds nothing here.
  const field = tab.getByRole("combobox", { name: "Find a song or command" });
  await field.fill("shadows");
  await expect(tab.getByRole("heading", { name: "No matches in This Book" })).toBeVisible();
  await field.fill("");

  // Closing leaves the Library; the next opening is the remembered scope, All Books.
  await tab.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(tab.getByRole("heading", { name: "Library" })).toBeVisible();
  await openFinder(tab);
  await expect(chip(tab, "All Books")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
  await context?.close();
});
