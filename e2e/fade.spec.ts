import { expect, type Locator, test } from "@playwright/test";
import { makeBook } from "./book.ts";
import { loadBook, openFinder, openSettings, watchErrors } from "./helpers.ts";

// Scroll edge fades (Board #71, DESIGN.md § Register): a scroll region fades each edge in
// proportion to how far it can still go that way. Where the browser has scroll-driven
// animations the CSS drives it, elsewhere scrollFade.ts does (Firefox); both end in the same
// two numbers on the region, which is what is read here.
const longBook = makeBook(
  "long",
  "Long Book",
  Array.from({ length: 120 }, (_, i) => ({
    title: `Hymn number ${i + 1}`,
    lines: Array.from({ length: 40 }, (_, line) => `Line ${line + 1} of hymn ${i + 1}`),
  })),
);

/** The strengths a region shows: `a` away from its start, `b` still ahead (to a tenth: Firefox
 * lands a scrollTop on a device pixel). */
const strengths = (region: Locator) =>
  region.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      a: Math.round(Number(style.getPropertyValue("--fade-a")) * 10) / 10,
      b: Math.round(Number(style.getPropertyValue("--fade-b")) * 10) / 10,
    };
  });

const scrollTo = (region: Locator, to: number | "end") =>
  region.evaluate((el, at) => {
    el.scrollTop = at === "end" ? el.scrollHeight : at;
  }, to);

/** What the mask leaves of the region's first and last pixel: 1 is solid, 0 is gone. */
const edges = (region: Locator) =>
  region.evaluate((el) => {
    const stops = getComputedStyle(el).maskImage.match(/rgba?\([^)]*\)/g) ?? [];
    const alpha = (stop: string | undefined) => {
      const parts = stop?.match(/[\d.]+/g) ?? [];
      return Math.round(Number(parts[3] ?? 1) * 10) / 10;
    };
    return { top: alpha(stops[0]), bottom: alpha(stops[stops.length - 1]) };
  });

/**
 * Top, 12px in (half a ramp), the middle and the end: the two numbers, and the mask they
 * make. `fixedTop` is a region whose top edge is a sticky bar, which is never faded.
 */
async function expectFadeAlong(region: Locator, { fixedTop = false } = {}) {
  const room = await region.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(room).toBeGreaterThan(200);
  const along = async (to: number | "end", a: number, b: number) => {
    await scrollTo(region, to);
    await expect.poll(() => strengths(region)).toEqual({ a, b });
    await expect.poll(() => edges(region)).toEqual({ top: fixedTop ? 1 : 1 - a, bottom: 1 - b });
  };
  await along(0, 0, 1);
  await along(12, 0.5, 1);
  await along(Math.floor(room / 2), 1, 1);
  await along("end", 1, 0);
}

test("Settings fades its edges by how far it can scroll", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await openSettings(page);
  await expectFadeAlong(page.locator("dialog[open] .sheet-content").first());
  expect(errors).toEqual([]);
});

test("the Search list fades the bottom only at the top, and its field stays plain", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, longBook);
  await openFinder(page);
  const region = page.locator("dialog[open] .sheet-content").first();
  // The field is stuck at the sheet's top: that edge is never faded (DESIGN.md § Register).
  await expectFadeAlong(region, { fixedTop: true });
  expect(errors).toEqual([]);
});

test("a long song's sequence fades its edges in the Operator", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, longBook);
  const box = await openFinder(page);
  await box.fill("3");
  await box.press("Enter");
  // A phone shows one tab of the Operator at a time; the sequence is "This Song".
  await expect(page.getByRole("heading", { name: /hymn number 3/i })).toBeVisible();
  const tab = page.getByRole("tab", { name: "This Song" });
  if ((await tab.count()) > 0) await tab.click();
  const sequence = page.locator(".sequence").first();
  await expect(sequence).toBeVisible();
  await expectFadeAlong(sequence);
  expect(errors).toEqual([]);
});

test("a floating list fades into its own surface: strips, not a mask", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await loadBook(page, longBook);
  await page.getByRole("button", { name: "From Text" }).click();
  await page
    .getByRole("combobox", { name: /language/i })
    .first()
    .click();
  const list = page.locator(".pick-list");
  await expect(list).toBeVisible();
  const strips = () =>
    list.evaluate((el) => ({
      top: Number(getComputedStyle(el, "::before").opacity),
      bottom: Number(getComputedStyle(el, "::after").opacity),
      mask: getComputedStyle(el).maskImage,
    }));
  expect((await strips()).mask).toBe("none");
  await scrollTo(list, 0);
  await expect.poll(strips).toMatchObject({ top: 0, bottom: 1 });
  await scrollTo(list, 300);
  await expect.poll(strips).toMatchObject({ top: 1, bottom: 1 });
  await scrollTo(list, "end");
  await expect.poll(strips).toMatchObject({ top: 1, bottom: 0 });
  expect(errors).toEqual([]);
});
