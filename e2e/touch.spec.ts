import { expect, type Page, test } from "@playwright/test";
import { loadBook, openFinder } from "./helpers.ts";

// Present Here by touch (Board #72, SDD-0001 §16.7): an iPhone-like context,
// no keyboard but the one the switcher raises. Real taps; a real swipe on
// Chromium (CDP touch events), the same drag as pointer events elsewhere,
// since Playwright has no swipe and Firefox and WebKit have no touch CDP.
test.describe("Present Here by touch", () => {
  test("a tap shows the bar; Next, a swipe, Search and Leave work", async ({
    browser,
    browserName,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      // Firefox rejects isMobile.
      isMobile: browserName !== "firefox",
    });
    const page = await context.newPage();
    await page.goto("/");
    await loadBook(page);
    await (await openFinder(page)).fill("1");
    await page.getByRole("option", { name: "#1 Lantern Morning" }).click();
    await page.getByRole("button", { name: "Go Live" }).click();
    const here = page.getByRole("region", { name: "Presenting on this screen" });
    await expect(here).toBeVisible();
    const lit = here.locator(".output-line-current");
    await expect(lit).toContainText(["lantern burns", "shadows leave"]);

    const bar = page.getByRole("toolbar", { name: "Presenting controls" });
    await expect(bar).toBeHidden();

    // A tap shows the bar, with 48 px targets.
    await page.touchscreen.tap(187, 300);
    await expect(bar).toBeVisible();
    for (const name of ["Search", "Previous", "Next", "Leave"]) {
      const box = await bar.getByRole("button", { name }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }

    await bar.getByRole("button", { name: "Next" }).tap();
    await expect(lit).toContainText(["Sing it once", "sing it twice"]);

    // Swipe right is previous, left is next.
    await swipe(page, [60, 300], [300, 305]);
    await expect(lit).toContainText(["lantern burns", "shadows leave"]);
    await swipe(page, [300, 300], [60, 296]);
    await expect(lit).toContainText(["Sing it once", "sing it twice"]);

    // The bar goes by itself.
    await expect(bar).toBeHidden({ timeout: 8000 });

    // Search: the switcher opens, a song is chosen, the bar is out of the way.
    await page.touchscreen.tap(187, 300);
    await bar.getByRole("button", { name: "Search" }).tap();
    const field = page.getByRole("search", { name: "Switch song" }).getByRole("combobox");
    await expect(field).toBeVisible();
    await expect(bar).toBeHidden();
    await field.fill("3");
    await page.keyboard.press("Enter");
    await expect(lit).toContainText(["harbor waits", "window glowing"]);

    // Leave.
    await page.touchscreen.tap(187, 300);
    await bar.getByRole("button", { name: "Leave" }).tap();
    await expect(here).toBeHidden();
    await context.close();
  });
});

async function swipe(page: Page, from: [number, number], to: [number, number]) {
  if (page.context().browser()?.browserType().name() === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(...from) });
    for (let i = 1; i <= 6; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / 6;
      const y = from[1] + ((to[1] - from[1]) * i) / 6;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    return;
  }
  await page.evaluate(
    ([start, end]) => {
      const init = (x: number, y: number) => ({
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        clientX: x,
        clientY: y,
      });
      const target = document.elementFromPoint(start[0], start[1]) ?? document.body;
      target.dispatchEvent(new PointerEvent("pointerdown", init(start[0], start[1])));
      target.dispatchEvent(new PointerEvent("pointerup", init(end[0], end[1])));
    },
    [from, to],
  );
}
