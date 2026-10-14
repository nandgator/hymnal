import { expect, test } from "@playwright/test";
import { loadBook, openFinder } from "./helpers.ts";

// Touch Lock (Board #75, SDD-0001 §16.11): while live, a tap that would change
// the Output does nothing; a press held about half a second does it; keys act
// at once. A tap by touch where the project has touch, else a click; the held
// press is a mouse press, which every engine can make.
test("Touch Lock: a tap is swallowed with a hint, a held press acts, a key acts at once", async ({
  page,
  context,
  hasTouch,
}) => {
  await page.goto("/");
  await loadBook(page);
  await (await openFinder(page)).fill("1");
  await page.getByRole("option", { name: "#1 Lantern Morning" }).click();

  // Off out of the box; the command turns it on, and the toolbar's switch follows.
  await (await openFinder(page)).fill(">turn on touch");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Go Live" }).click();
  await expect(page.getByRole("region", { name: "Presenting on this screen" })).toBeVisible();
  const output = await context.newPage();
  await output.goto("/?output=1");
  const lit = output.locator(".output-line-current");
  await expect(lit).toContainText(["lantern burns", "shadows leave"]);

  await page.bringToFront();
  const next = page.getByRole("button", { name: "Next part" });
  await expect(page.getByRole("button", { name: "On Air" })).toBeVisible();

  // A plain tap changes nothing, and says what to do.
  if (hasTouch) await next.tap();
  else await next.click();
  await expect(page.locator(".touch-lock-hint")).toHaveText("Press and hold to show");
  await expect(lit).toContainText(["lantern burns", "shadows leave"]);

  // A held press does it, with the ring showing meanwhile.
  const box = await next.boundingBox();
  if (!box) throw new Error("no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator(".touch-lock-ring")).toBeVisible();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await output.bringToFront();
  await expect(lit).toContainText(["Sing it once", "sing it twice"]);

  // A key is never accidental: it acts at once.
  await page.bringToFront();
  await page.keyboard.press("ArrowLeft");
  await output.bringToFront();
  await expect(lit).toContainText(["lantern burns", "shadows leave"]);
});
