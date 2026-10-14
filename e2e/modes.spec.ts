import { expect, type Page, test } from "@playwright/test";
import { bookFile } from "./book.ts";
import { loadBook, openFinder, watchErrors } from "./helpers.ts";

// The Finder's two modes (SDD-0001 §13.3, Board #69): songs by default, a `>` first for
// commands, never in one list.
const songs = (page: Page) => page.getByRole("listbox", { name: "Matching songs" });
const commands = (page: Page) => page.getByRole("listbox", { name: "Matching commands" });

test("songs by default; a > first lists commands only, Backspace returns to songs", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, bookFile);
  const box = await openFinder(page);

  // The empty list has its own headings: the mode heading waits for something typed.
  await expect(page.getByRole("heading", { name: "Songs" })).toHaveCount(0);
  await expect(box).toHaveAttribute("placeholder", "Number, title or words");
  await expect(songs(page).getByRole("option", { name: /Lantern Morning/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Blank the Output/ })).toHaveCount(0);

  // A > is the mode; the rest filters the commands, and no song is among them.
  await box.fill(">");
  await expect(page.getByRole("heading", { name: "Commands" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Songs" })).toHaveCount(0);
  await expect(commands(page).getByRole("option", { name: /Blank the Output/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Lantern Morning/ })).toHaveCount(0);
  await box.pressSequentially("blank");
  await expect(commands(page).getByRole("option")).toHaveCount(1);

  // No matching command is the results card, as for a song.
  await box.fill(">zzzzqq");
  await expect(page.getByRole("heading", { name: "No matches for “zzzzqq”" })).toBeVisible();

  // Backspace over the lone > is songs again.
  await box.fill(">");
  await box.press("Backspace");
  await expect(box).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Songs" })).toHaveCount(0);
  await expect(songs(page).getByRole("option", { name: /Lantern Morning/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ctrl+Shift+P opens the Finder in commands, Ctrl+K in songs", async ({
  page,
  browserName,
}) => {
  // Firefox keeps the chord for a private window (SDD-0001 §13.3): the page never gets it.
  test.skip(browserName !== "chromium", "Chrome and Edge give the page Ctrl+Shift+P");
  await page.goto("/");
  await loadBook(page, bookFile);
  await page.keyboard.press("Control+Shift+P");
  const box = page.getByRole("combobox", { name: "Find a song or command" });
  await expect(box).toHaveValue(">");
  await expect(page.getByRole("heading", { name: "Commands" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(box).toBeHidden();
  await openFinder(page);
  await expect(page.getByRole("heading", { name: "Songs" })).toHaveCount(0);
  await box.fill("lantern");
  await expect(page.getByRole("heading", { name: "Songs" })).toBeVisible();
});
