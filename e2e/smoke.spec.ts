import { BOOK_TITLE, bookFile } from "./book.ts";
import { expect, test } from "./fixtures.ts";
import {
  answerPersist,
  books,
  loadBook,
  noSavePicker,
  openFinder,
  openSettings,
  violations,
  watchCsp,
  watchErrors,
} from "./helpers.ts";

test("first load: the shell renders, with no console errors or CSP violations", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await watchCsp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Books" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go Live" })).toBeDisabled();
  expect(await violations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("load a book, find songs, open one", async ({ page }) => {
  await page.goto("/");
  await loadBook(page);
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(
    books(page).getByRole("button", { name: new RegExp(`^${BOOK_TITLE}`) }),
  ).toBeVisible();

  const box = await openFinder(page);
  await box.fill("2");
  const options = page.getByRole("listbox", { name: "Matching songs and actions" });
  await expect(options.getByRole("option")).toHaveCount(1);
  await expect(options.getByRole("option")).toContainText("River Of Stones");

  await box.fill("harbor");
  await expect(options.getByRole("option")).toHaveCount(1);
  await expect(options.getByRole("option")).toContainText("Harbor Light");

  await options.getByRole("option", { name: "#3 Harbor Light" }).click();
  await expect(page.getByRole("heading", { name: "Harbor Light #3" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Jump to part" })).toBeVisible();
});

test("present: Go Live, then the Output window follows Next part", async ({ page, context }) => {
  await page.goto("/");
  await loadBook(page);
  await (await openFinder(page)).fill("1");
  await page.getByRole("option", { name: "#1 Lantern Morning" }).click();

  await page.getByRole("button", { name: "Go Live" }).click();
  // No external screen is known, so Go Live presents on this one.
  await expect(page.getByRole("region", { name: "Presenting on this screen" })).toBeVisible();

  const output = await context.newPage();
  await output.goto("/?output=1");
  // The lit lines are the Output's reading band; only a class marks them.
  const lit = output.locator(".output-line-current");
  await expect(lit).toContainText(["lantern burns", "shadows leave"]);

  await page.bringToFront();
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(lit).toContainText(["Sing it once", "sing it twice"]);
});

test("backup round trip: Back Up, then Restore in a fresh profile", async ({
  page,
  browser,
  baseURL,
  viewport,
  userAgent,
}) => {
  await noSavePicker(page);
  await page.goto("/");
  await loadBook(page);
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Back Up" }).click(),
  ]);
  const backup = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.hymnal$/);

  const fresh = await browser.newContext({ baseURL, viewport, userAgent });
  try {
    await answerPersist(fresh);
    const other = await fresh.newPage();
    await other.goto("/");
    await expect(other.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
    await openSettings(other);
    await other.getByTestId("restore-file").setInputFiles(backup);
    const dialog = other.getByRole("dialog", { name: "Restore" });
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(dialog.getByText(/Restored/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).last().click();
    await expect(dialog).toBeHidden();
    await other.goto("/");
    await expect(
      books(other).getByRole("button", { name: new RegExp(`^${BOOK_TITLE}`) }),
    ).toBeVisible();

    // The same backup again: everything in it is already here.
    await other.getByTestId("book-file").setInputFiles(backup);
    await expect(dialog.getByText("Already here").first()).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test.describe("a private window (SDD-0004 §15)", () => {
  // The service worker would answer the worker script before a route sees it.
  test.use({ serviceWorkers: "block" });

  test("keeps books in memory, and a book still loads", async ({ page, context }) => {
    const denied = `Object.defineProperty(StorageManager.prototype, "getDirectory", { configurable: true, value: async () => { throw new DOMException("denied", "SecurityError"); } });`;
    await context.route(/\/assets\/content-store\.worker-[^/]*\.js$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${denied}\n${await response.text()}` });
    });
    await page.addInitScript(denied);

    await page.goto("/");
    await expect(page.getByText(/This window doesn’t keep books/).first()).toBeVisible();
    await loadBook(page, bookFile);
    await expect(
      books(page).getByRole("button", { name: new RegExp(`^${BOOK_TITLE}`) }),
    ).toBeVisible();
  });
});
