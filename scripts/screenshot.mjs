// Drives the running app headless and screenshots it: Library, then a song in
// the Operator, then (with --blank) the same blanked. For checking layouts at
// a given size without a browser extension. Needs `bun run dev` running.
//
//   node scripts/screenshot.mjs [--url http://localhost:5173] [--size 390x844]
//     [--hymn 12] [--blank] [--dark] [--out <dir>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173/" },
    size: { type: "string", default: "390x844" },
    hymn: { type: "string", default: "12" },
    blank: { type: "boolean", default: false },
    dark: { type: "boolean", default: false },
    out: { type: "string", default: "screenshots" },
  },
});
const [width, height] = values.size.split("x").map(Number);
mkdirSync(values.out, { recursive: true });
const shot = (page, name) =>
  page.screenshot({ path: join(values.out, `${values.size}-${name}.png`) });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE || "/usr/bin/chromium",
});
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: values.dark ? "dark" : "light",
  });
  await page.goto(values.url);
  const find = page.getByRole("button", { name: "Find a Song" });
  await find.waitFor();
  await shot(page, "library");
  await find.click();
  await page.locator("input").first().fill(values.hymn);
  await page.keyboard.press("Enter");
  await page.locator(".operator").waitFor();
  await page.waitForTimeout(500); // fonts and the first glide settle
  await shot(page, "operator");
  if (values.blank) {
    await page.keyboard.press("b");
    await page.waitForTimeout(500);
    await shot(page, "blanked");
  }
  console.log(`screenshots in ${values.out}/`);
} finally {
  await browser.close();
}
