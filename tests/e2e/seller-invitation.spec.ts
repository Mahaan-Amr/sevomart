import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";
import { expect, test } from "../helpers/release-playwright";
import { createSellerWorkspaceFixture } from "../helpers/seller-workspace-fixture";
import {
  invitationApplicantTestMobiles,
  invitationSellerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("empty discovery invites guests but not an approved seller", async ({
  page,
}, testInfo) => {
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({ json: discoveryV1Examples.DiscoveryFeedPageV1 }),
  );
  await page.goto("/discover");
  await expect(page.getByRole("link", { name: "فروشنده شوید" })).toBeVisible();
  const fixture = await createSellerWorkspaceFixture(page, {
    mobile: invitationSellerTestMobiles[visualProjectIndex(testInfo.project.name)]!,
    slug: `invitation-${visualProjectIndex(testInfo.project.name)}`,
    storeName: "فروشگاه نمونه",
  });
  try {
    await page.goto("/discover");
    await expect(page.getByText("فعلاً کالایی برای دیدن نیست.")).toBeVisible();
    await expect(page.getByRole("link", { name: "فروشنده شوید" })).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("a signed-in applicant can still find the invitation", async ({
  page,
}, testInfo) => {
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({ json: discoveryV1Examples.DiscoveryFeedPageV1 }),
  );
  await page.goto("/login?returnTo=%2Fdiscover");
  await page
    .getByLabel("شماره موبایل")
    .fill(invitationApplicantTestMobiles[visualProjectIndex(testInfo.project.name)]!);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("link", { name: "فروشنده شوید" })).toBeVisible();
});
