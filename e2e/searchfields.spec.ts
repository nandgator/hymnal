import { expect, test } from "@playwright/test";
import { openSettings } from "./helpers.ts";

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
