// Drives the running app headless and screenshots it: Library, then a song in
// the Operator, then optionally repeated (its snackbar on a phone), blanked,
// and the song picker (its Recents). For checking layouts at a given size
// without a browser extension. Needs `bun run dev` running.
//
//   node scripts/screenshot.mjs [--url http://localhost:5173] [--size 390x844]
//     [--hymn 12] [--repeat] [--blank] [--picker] [--dark] [--out <dir>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173/" },
    size: { type: "string", default: "390x844" },
    hymn: { type: "string", default: "12" },
    repeat: { type: "boolean", default: false },
    blank: { type: "boolean", default: false },
    picker: { type: "boolean", default: false },
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
  const find = page.getByRole("button", { name: "Find a Song", exact: true });
  await find.waitFor();
  await shot(page, "library");
  await find.click();
  await page.locator("input").first().fill(values.hymn);
  await page.keyboard.press("Enter");
  await page.locator(".operator").waitFor();
  await page.waitForTimeout(500); // fonts and the first glide settle
  await shot(page, "operator");
  if (values.repeat) {
    await page.getByRole("button", { name: "Repeat", exact: true }).first().click();
    await page.getByRole("button", { name: "Repeat", exact: true }).first().click();
    await page.waitForTimeout(400);
    await shot(page, "repeated");
  }
  if (values.blank) {
    await page.keyboard.press("b");
    await page.waitForTimeout(500);
    await shot(page, "blanked");
  }
  if (values.picker) {
    await page.keyboard.press("b"); // restore, if blanked
    await page
      .getByRole("button", { name: new RegExp(`#${values.hymn}`) })
      .first()
      .click();
    await page.waitForTimeout(600);
    await shot(page, "picker");
  }
  console.log(`screenshots in ${values.out}/`);
} finally {
  await browser.close();
}
