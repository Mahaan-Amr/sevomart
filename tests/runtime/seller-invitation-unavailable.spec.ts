import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";
import { expect, test } from "@playwright/test";

test("empty discovery does not assert seller status when the identity service fails", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "test-session", value: "fixture", url: "http://127.0.0.1:3529" },
  ]);
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({ json: discoveryV1Examples.DiscoveryFeedPageV1 }),
  );
  await page.goto("/");
  await expect(page.getByText("فعلاً کالایی برای دیدن نیست.")).toBeVisible();
  await expect(page.getByRole("link", { name: "فروشنده شوید" })).toHaveCount(0);
});
