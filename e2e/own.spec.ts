import { expect, type Locator, type Page, test } from "@playwright/test";
import { books, openFinder, watchErrors } from "./helpers.ts";

// Assorted Hymns, end to end (SDD-0004 §17, Board #58): paste a song, add it,
// find it, present it, remove it. Both songs are invented.
const MALAYALAM_TITLE = "പ്രഭാത ദീപം";
const MALAYALAM_TEXT = `1. ${MALAYALAM_TITLE}

പ്രഭാതത്തിൽ ദീപം തെളിയുന്നു
മലമുകളിൽ നിഴൽ മായുന്നു`;
const ENGLISH_TITLE = "Harbor Lantern";
const ENGLISH_TEXT = `1. ${ENGLISH_TITLE}

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
): Promise<void> {
  await page.getByRole("button", { name: "From Text" }).click();
  const dialog = page.getByRole("dialog", { name: "From Text" });
  await dialog.getByLabel("Song text").fill(text);
  if ("search" in language) {
    const box = dialog.getByRole("combobox", { name: "Song’s language" });
    await box.click();
    await box.fill(language.search);
    await page.getByRole("option").first().click();
  } else {
    await expect(dialog.getByText(`Looks like ${language.suggested}`)).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Review the Song" }).click();
  const review = page.getByRole("dialog", { name: "Add Song" });
  await expect(review.getByRole("heading", { name: title })).toBeVisible();
  await review.getByRole("button", { name: "Add Song" }).click();
  await expect(review).toBeHidden();
}

const assortedRow = (page: Page): Locator =>
  books(page)
    .locator("li.book")
    .filter({ has: page.locator(".book-main", { hasText: "Assorted Hymns" }) });

test("Assorted Hymns: add two songs, find, present, remove", async ({ page }) => {
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

  // The sheet lists English before Malayalam (language, then title), though
  // the Malayalam song is number 1.
  await openLibrary(page);
  await assortedRow(page).locator(".book-main").click();
  const sheet = page.getByRole("dialog", { name: "Assorted Hymns" });
  const rows = sheet.getByRole("list", { name: "Songs" }).locator("li.book");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(ENGLISH_TITLE);
  await expect(rows.nth(1)).toContainText(MALAYALAM_TITLE);

  // Remove one, after its confirmation.
  await sheet.getByRole("button", { name: `Remove ${ENGLISH_TITLE}` }).click();
  const confirm = page.getByRole("dialog", { name: "Remove Song" });
  await expect(confirm.getByText(/Number 2 is retired/)).toBeVisible();
  await confirm.getByRole("button", { name: "Remove Song" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(MALAYALAM_TITLE);

  // The last song takes the book with it.
  await sheet.getByRole("button", { name: `Remove ${MALAYALAM_TITLE}` }).click();
  await expect(page.getByText(/Assorted Hymns goes with it/)).toBeVisible();
  await page.getByRole("button", { name: "Remove Song" }).click();
  await expect(sheet).toBeHidden();
  await expect(assortedRow(page)).toHaveCount(0);
  // Nothing is left: the Library is as it was on first load.
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();

  expect(errors).toEqual([]);
});
