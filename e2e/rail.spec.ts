import { expect, type Page, test } from "@playwright/test";
import { makeBook } from "./book.ts";
import { loadBook, openFinder } from "./helpers.ts";

// The stage rail keeps the Parts keypad its room (Board #75 review): on a short window Live's
// miniature shrinks, and the keypad's second row is whole above the transport, not clipped
// behind it.
const longBook = makeBook("long", "Long Book", [
  { title: "Nine Verses", lines: ["First line", "Second line"], stanzas: 9 },
]);

async function openNineVerses(page: Page) {
  await page.goto("/");
  await loadBook(page, longBook);
  const box = await openFinder(page);
  await box.fill("1");
  await page
    .getByRole("listbox", { name: "Matching songs" })
    .getByRole("option", { name: /Nine Verses/ })
    .click();
}

for (const height of [800, 740, 700, 650]) {
  test(`the Parts keypad's second row is whole at 1280x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height });
    await openNineVerses(page);
    const rail = page.getByRole("complementary", { name: "What they see" });
    const pad = rail.getByRole("region", { name: "Jump to part" });
    const keys = pad.getByRole("button");
    await expect(keys).toHaveCount(9);

    // Nine keys at six a row: the last three are the second row.
    const last = await keys.last().boundingBox();
    const transport = await rail.getByRole("navigation", { name: "Navigate" }).boundingBox();
    const visible = await pad.boundingBox();
    if (!last || !transport || !visible) throw new Error("no box");
    expect(last.y + last.height).toBeLessThanOrEqual(transport.y + 0.5);
    expect(last.y + last.height).toBeLessThanOrEqual(visible.y + visible.height + 0.5);
    expect(last.y).toBeGreaterThanOrEqual(visible.y - 0.5);
  });
}
