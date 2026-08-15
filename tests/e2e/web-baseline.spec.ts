import { expect, test } from "@playwright/test";

test("the mobile web baseline is Persian and right-to-left", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "خط پایه توسعه آماده است" }),
  ).toBeVisible();
});
