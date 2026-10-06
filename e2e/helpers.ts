import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { bookFile } from "./book.ts";

/** What the page itself reports as broken: console errors and thrown errors. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Records CSP violations; read them back with `violations`. Call before goto. */
export async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

export const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

/**
 * The first load asks the browser to keep storage (`navigator.storage.persist()`)
 * and waits for the answer before the Load Books sheet moves on. Firefox puts
 * that to the user as a prompt that nothing in a test answers, so the sheet
 * sits on "Indexing for search…" for good. A finding, reported on Board #52;
 * until it is fixed the suite answers "no" itself.
 */
export async function answerPersist(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    StorageManager.prototype.persist = async () => false;
  });
}

/** Chromium's save-file picker would open a real dialog; the app then falls
 * back to an ordinary download, as Firefox and Safari do. */
export async function noSavePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showSaveFilePicker");
  });
}

/** Load Books: pick the file, review it, Load Book. */
export async function loadBook(page: Page, file: typeof bookFile = bookFile): Promise<void> {
  await page.getByTestId("book-file").setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Load Books" });
  await dialog.getByRole("button", { name: "Load Book", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export const books = (page: Page) => page.getByRole("list", { name: "Books" });

/** The command menu (Ctrl+K), opened; its box is where songs are found. */
export async function openFinder(page: Page): Promise<Locator> {
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Find a song or action" });
  await expect(box).toBeVisible();
  return box;
}

/** Settings: the header's Menu on a phone, the Settings button from 840 up. */
export async function openSettings(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const opener =
    width < 840
      ? page.getByRole("button", { name: /^Menu/ })
      : page.getByRole("button", { name: /^Settings/ });
  await opener.first().click();
  await expect(page.getByRole("region", { name: "Backup" })).toBeVisible();
}
