import { expect, type Page, test } from "@playwright/test";
import { BOOK_TITLE } from "./book.ts";
import { books, loadBook, openFinder, openSettings, watchErrors } from "./helpers.ts";

/** The dialog's layout size: not its drawn box, which the sheet's own open animation scales. */
const dialogBox = (page: Page, name: string) =>
  page
    .getByRole("dialog", { name })
    .evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);

test("Settings search: rows that do not match are gone, not only marked hidden", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
  await openSettings(page);

  const box = page.getByRole("searchbox", { name: "Search settings" });
  await box.fill("theme");
  await expect(page.locator(".settings-label", { hasText: /^Theme$/ })).toBeVisible();
  // Another section's row has no business on screen: `hidden` must win over the row's display.
  await expect(page.locator(".settings-label", { hasText: /^Text size$/ })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Backup" })).toBeHidden();
});

test("Settings search: a clear button, a card with no button, and a dialog that holds its size", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bring a songbook" })).toBeVisible();
  await openSettings(page);
  // On a phone Settings is part of the Menu sheet.
  const name = (page.viewportSize()?.width ?? 0) < 840 ? "Menu" : "Settings";
  const box = page.getByRole("searchbox", { name: "Search settings" });
  const clear = page.getByRole("button", { name: "Clear search" });
  await expect(clear).toBeHidden();
  const rest = await dialogBox(page, name);

  await box.fill("theme");
  await expect(clear).toBeVisible();
  expect(await dialogBox(page, name)).toEqual(rest);

  await box.fill("asdf");
  await expect(page.getByRole("heading", { name: "No settings match “asdf”" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Clear Search$/ })).toHaveCount(0);
  expect(await dialogBox(page, name)).toEqual(rest);

  await clear.click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.getByRole("heading", { name: /^No settings match/ })).toBeHidden();
});

test("Search: the dialog holds its size while typing; the no-match card is centred and has no button", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page);
  const box = await openFinder(page);
  const rest = await dialogBox(page, "Search");

  await box.fill("lantern");
  await expect(page.getByRole("option", { name: /Lantern Morning/ })).toBeVisible();
  expect(await dialogBox(page, "Search")).toEqual(rest);
  await box.fill("1");
  await expect(page.getByRole("option", { name: /#1 Lantern Morning/ })).toBeVisible();
  expect(await dialogBox(page, "Search")).toEqual(rest);

  await box.fill("zzzzqq");
  const card = page.getByRole("dialog").locator(".empty-card");
  await expect(page.getByRole("heading", { name: "No matches for “zzzzqq”" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Clear Search$/ })).toHaveCount(0);
  expect(await dialogBox(page, "Search")).toEqual(rest);
  // Let the card settle in, then see it centred in what the field leaves: no gap to one side.
  await page.waitForTimeout(400);
  const where = await page.getByRole("dialog").evaluate((dialog) => {
    const card = dialog.querySelector(".empty-card")?.getBoundingClientRect();
    const field = dialog.querySelector(".finder-form")?.getBoundingClientRect();
    const content = dialog.querySelector(".sheet-content") as HTMLElement;
    // The content's own room: a notice over the sheet reserves clearance at its foot.
    const room =
      content.getBoundingClientRect().bottom -
      Number.parseFloat(getComputedStyle(content).paddingBottom);
    if (!card || !field) return undefined;
    return { above: card.top - field.bottom, below: room - card.bottom };
  });
  expect(where).toBeDefined();
  expect(Math.abs((where?.above ?? 0) - (where?.below ?? 0))).toBeLessThan(40);
  await expect(card).toBeVisible();

  // The field's own clear button.
  const clear = page.getByRole("button", { name: "Clear search" });
  await clear.click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(page.getByRole("heading", { name: /^No matches/ })).toBeHidden();
  expect(errors).toEqual([]);
});

test("Present with no song: a card and Find a Song, not an inline list; a digit starts a number", async ({
  page,
}) => {
  await page.goto("/");
  await loadBook(page);
  await books(page)
    .getByRole("button", { name: new RegExp(`^${BOOK_TITLE}`) })
    .click();
  await expect(page.getByRole("heading", { name: "No song selected" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await page.getByRole("button", { name: /^Find a Song/ }).click();
  const box = page.getByRole("combobox", { name: "Find a song or action" });
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();

  await page.keyboard.press("2");
  await expect(box).toHaveValue("2");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "River Of Stones #2" })).toBeVisible();
});

test("the Hymnbooks filter: a clear button, a card, a dialog that holds its size", async ({
  page,
}) => {
  await page.goto("/");
  await loadBook(page);
  await books(page)
    .getByRole("button", { name: new RegExp(`^${BOOK_TITLE}`) })
    .click();
  await page
    .getByRole("button", { name: new RegExp(BOOK_TITLE) })
    .first()
    .click();
  const box = page.getByRole("searchbox", { name: "Search hymnbooks" });
  await expect(box).toBeVisible();
  const rest = await dialogBox(page, "Hymnbooks");
  await box.fill("qqq");
  await expect(page.getByRole("heading", { name: "No hymnbooks match “qqq”" })).toBeVisible();
  expect(await dialogBox(page, "Hymnbooks")).toEqual(rest);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
});

type CardWatch = { frames: number; gone: number; removed: number; shortest: number };

test("the quick switcher's no-match card does not leave while typing on (the lyrics behind it flickered)", async ({
  page,
}) => {
  await page.goto("/");
  await loadBook(page);
  await (await openFinder(page)).fill("1");
  await page.getByRole("option", { name: /#1 Lantern Morning/ }).click();
  await page.getByRole("button", { name: "Go Live" }).click();
  await page.getByRole("region", { name: "Presenting on this screen" }).waitFor();
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Find a song" });
  await expect(box).toBeFocused();

  await box.pressSequentially("zz");
  await expect(page.getByRole("heading", { name: /^No matches/ })).toBeVisible();
  // From here the card is on screen every frame, through the pauses that start a search.
  await page.evaluate(() => {
    const seen = { frames: 0, gone: 0, removed: 0, shortest: Number.POSITIVE_INFINITY };
    (window as unknown as { __card: typeof seen }).__card = seen;
    const frame = () => {
      seen.frames++;
      if (!document.querySelector(".present-switcher .empty-card")) seen.gone++;
      const strip = document.querySelector<HTMLElement>(".present-switcher");
      if (strip) seen.shortest = Math.min(seen.shortest, strip.offsetHeight);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // Slow frames (a software renderer) can miss a card that left and came back; a mutation
    // observer cannot.
    const strip = document.querySelector(".present-switcher");
    if (strip)
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.removedNodes)
            if (node instanceof Element && node.matches(".empty-card, :has(.empty-card)"))
              seen.removed++;
      }).observe(strip, { childList: true, subtree: true });
  });
  const before = await page
    .locator(".present-switcher")
    .evaluate((el: HTMLElement) => el.offsetHeight);
  for (const key of ["q", "q", "x"]) {
    await box.pressSequentially(key);
    await page.waitForTimeout(450);
  }
  const seen = await page.evaluate(() => (window as unknown as { __card: CardWatch }).__card);
  expect(seen.frames).toBeGreaterThan(5);
  expect(seen.removed).toBe(0);
  expect(seen.gone).toBe(0);
  expect(seen.shortest).toBeGreaterThanOrEqual(before - 1);
});

test("Settings search: a closed section that holds a match shows open, and clearing shuts it again", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page);

  const box = page.getByRole("searchbox", { name: "Search settings" });
  // "Pin the chorus" lives in a disclosure that Whole song shuts.
  await page.getByRole("group", { name: "Layout" }).getByLabel("Whole song").check({ force: true });
  const fade = page.locator(".settings-disclosure").filter({ hasText: /Pin the chorus/ });
  const row = fade.locator(".settings-row").first();
  await expect(fade).toHaveAttribute("data-open", "false");
  await expect(row).toBeHidden();

  await box.fill("pin");
  await expect(fade).toHaveAttribute("data-search", "open");
  await expect(row).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(fade).not.toHaveAttribute("data-search", /.*/);
  await expect(fade).toHaveAttribute("data-open", "false");
  await expect(row).toBeHidden();
});
