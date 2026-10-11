import { expect, type Locator, type Page, test } from "@playwright/test";
import { books, openFinder, watchErrors } from "./helpers.ts";

// Your books, end to end (SDD-0004 §17, Board #58): paste a song, add it,
// find it, present it, remove it. Both songs are invented.
const MALAYALAM_TITLE = "പ്രഭാത ദീപം";
const MALAYALAM_TEXT = `1. ${MALAYALAM_TITLE}

പ്രഭാതത്തിൽ ദീപം തെളിയുന്നു
മലമുകളിൽ നിഴൽ മായുന്നു`;
const ENGLISH_TITLE = "Harbor Lantern";
const ENGLISH_TEXT = `${ENGLISH_TITLE}

The lantern glows above the quay
and gulls go wheeling home`;

/** The Library: a section button from 840 wide, the Menu sheet below it. */
async function openLibrary(page: Page): Promise<void> {
  const wide = (page.viewportSize()?.width ?? 0) >= 840;
  if (!wide) await page.getByRole("button", { name: /^Menu/ }).first().click();
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("button", { name: "Library" })
    .click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
}

/** The first-add notice, if it is up: it can sit over the buttons. */
async function dismissStorageNotice(page: Page): Promise<void> {
  const notice = page.locator(".snackbar-message", {
    hasText: "Your browser may clear stored songs",
  });
  const shown = await notice
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await page.getByRole("button", { name: "Got It" }).click();
    await expect(notice).toBeHidden();
  }
}

/** From Text, one song, kept for Assorted Hymns, reviewed, Add Song. */
async function addSong(
  page: Page,
  text: string,
  title: string,
  language: { search: string } | { suggested: string },
  newBook?: string,
): Promise<void> {
  await page.getByRole("button", { name: "From Text" }).click();
  const dialog = page.getByRole("dialog", { name: "From Text" });
  if (newBook) {
    await dialog.getByRole("combobox", { name: "Add to" }).click();
    await dialog.getByRole("option", { name: "New book…" }).click();
    await dialog.getByLabel("Book name").fill(newBook);
  }
  await dialog.getByLabel("Song text").fill(text);
  if ("search" in language) {
    const box = dialog.getByRole("combobox", { name: "Song’s language" });
    await box.click();
    await box.fill(language.search);
    await page.getByRole("listbox", { name: "Languages" }).getByRole("option").first().click();
  } else {
    await expect(dialog.getByText(`Looks like ${language.suggested}`)).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Review Song" }).click();
  const review = page.getByRole("dialog", { name: "Add Song" });
  await expect(review.getByRole("heading", { name: newBook ?? title }).first()).toBeVisible();
  await review.getByRole("button", { name: "Add Song" }).click();
  await expect(review).toBeHidden();
}

const assortedRow = (page: Page): Locator =>
  books(page)
    .locator("li.book")
    .filter({ has: page.locator(".book-main", { hasText: "Assorted Hymns" }) });

test("Assorted Hymns: add two songs, find, present, open, rename, remove", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();

  // The first song makes the book; the Operator shows it.
  await addSong(page, MALAYALAM_TEXT, MALAYALAM_TITLE, { suggested: "Malayalam" });
  await expect(page.getByRole("heading", { name: `${MALAYALAM_TITLE} #1` })).toBeVisible();
  await dismissStorageNotice(page);

  // The second, in English, is number 2.
  await openLibrary(page);
  await addSong(page, ENGLISH_TEXT, ENGLISH_TITLE, { search: "English" });
  await expect(page.getByRole("heading", { name: `${ENGLISH_TITLE} #2` })).toBeVisible();
  await dismissStorageNotice(page);

  // The Library: Assorted Hymns first, with its count.
  await openLibrary(page);
  const first = books(page).locator("li.book").first();
  await expect(first).toContainText("Assorted Hymns");
  await expect(first.locator(".book-count")).toContainText("2");

  // Find by number and by a lyric word.
  const options = page.getByRole("listbox", { name: "Matching songs and actions" });
  const box = await openFinder(page);
  await box.fill("1");
  await expect(options.getByRole("option")).toHaveCount(1);
  await expect(options.getByRole("option")).toContainText(MALAYALAM_TITLE);
  await box.fill("gulls");
  await expect(options.getByRole("option")).toHaveCount(1);
  await expect(options.getByRole("option")).toContainText(ENGLISH_TITLE);

  // Present it.
  await options.getByRole("option", { name: new RegExp(ENGLISH_TITLE) }).click();
  await expect(page.getByRole("heading", { name: `${ENGLISH_TITLE} #2` })).toBeVisible();
  await page.getByRole("button", { name: "Go Live" }).click();
  const presenting = page.getByRole("region", { name: "Presenting on this screen" });
  await expect(presenting).toBeVisible();
  await expect(page.locator(".output-line-current").first()).toContainText("lantern glows");
  await page.keyboard.press("f");
  await expect(presenting).toBeHidden();

  // It opens like any book: its row makes it current and aims the Finder at it.
  await openLibrary(page);
  await assortedRow(page).locator(".book-main").click();
  await expect(page.getByRole("combobox", { name: "Find a song" })).toBeVisible();
  await page.keyboard.press("Escape");
  await openLibrary(page);
  await expect(assortedRow(page)).toContainText("Current");

  // Rename… is in its menu, and asks for the new title in a small sheet.
  await assortedRow(page).getByRole("button", { name: "More for Assorted Hymns" }).click();
  await page.getByRole("menuitem", { name: /Rename…/ }).click();
  const rename = page.getByRole("dialog", { name: "Rename Book" });
  await rename.getByLabel("Title").fill("Harbor Songs");
  await rename.getByRole("button", { name: "Rename Book" }).click();
  await expect(rename).toBeHidden();
  await expect(books(page).locator("li.book").first()).toContainText("Harbor Songs");

  // Remove… is the book's, as for any book; its songs go with it.
  await books(page).getByRole("button", { name: "More for Harbor Songs" }).click();
  await page.getByRole("menuitem", { name: /Remove…/ }).click();
  await page
    .getByRole("dialog", { name: "Remove Book" })
    .getByRole("button", { name: "Remove Book" })
    .click();
  await expect(books(page)).toHaveCount(0);
  // Nothing is left: the Library is as it was on first load.
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("a new book: named in the form, then offered the next time", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();

  await addSong(page, ENGLISH_TEXT, ENGLISH_TITLE, { search: "English" }, "Harbor Songs");
  await expect(page.getByRole("heading", { name: `${ENGLISH_TITLE} #1` })).toBeVisible();
  await dismissStorageNotice(page);

  // The book added to is the one the form offers next, and a song with no number takes the next.
  await openLibrary(page);
  await page.getByRole("button", { name: "From Text" }).click();
  const dialog = page.getByRole("dialog", { name: "From Text" });
  await expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveAttribute(
    "data-value",
    /.+/,
  );
  await expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveText("Harbor Songs");
  await dialog.getByLabel("Song text").fill(`${MALAYALAM_TITLE}\n\nപ്രഭാതത്തിൽ ദീപം തെളിയുന്നു`);
  await expect(dialog.getByText("Looks like Malayalam")).toBeVisible();
  await dialog.getByRole("button", { name: "Review Song" }).click();
  const review = page.getByRole("dialog", { name: "Add Song" });
  await expect(review.getByText(/Becomes song 2 in Harbor Songs/)).toBeVisible();
  await review.getByRole("button", { name: "Add Song" }).click();
  await expect(page.getByRole("heading", { name: `${MALAYALAM_TITLE} #2` })).toBeVisible();

  expect(errors).toEqual([]);
});
