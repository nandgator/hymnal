import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadBook, openFinder, openSettings } from "./helpers.ts";

const LONG = "ക്ഷമലയാളം lorem ".repeat(400);

/** A paste of `text`: an insert, which the field's maxlength limits as it does a real one. */
async function paste(page: Page, box: Locator, text: string) {
  await box.focus();
  await page.keyboard.insertText(text);
}

/** The card's heading stays on one line and inside the card. */
async function oneLine(heading: Locator) {
  await expect(heading).toBeVisible();
  const box = await heading.evaluate((el) => {
    const style = getComputedStyle(el);
    const h = el.getBoundingClientRect();
    const card = el.closest(".empty-card")?.getBoundingClientRect();
    return {
      height: h.height,
      line: Number.parseFloat(style.lineHeight),
      right: h.right,
      cardRight: card?.right ?? 0,
      scroll: el.scrollWidth <= el.clientWidth + 1 || style.textOverflow === "ellipsis",
    };
  });
  expect(box.height).toBeLessThanOrEqual(box.line * 1.5);
  expect(box.right).toBeLessThanOrEqual(box.cardRight + 1);
  expect(box.scroll).toBe(true);
}

test("Settings search: 5000 characters are held to 100, and the card stays one line", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
  await openSettings(page);
  const box = page.getByRole("searchbox", { name: "Search settings" });
  await paste(page, box, LONG);
  expect((await box.inputValue()).length).toBeLessThanOrEqual(100);
  const heading = page.getByRole("heading", { name: /^No settings match/ });
  await oneLine(heading);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
});

test("Search: 5000 characters are held to 100, and the card stays one line", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
  await loadBook(page);
  const box = await openFinder(page);
  await paste(page, box, LONG);
  expect((await box.inputValue()).length).toBeLessThanOrEqual(100);
  await oneLine(page.getByRole("heading", { name: /^No matches for/ }));
});
