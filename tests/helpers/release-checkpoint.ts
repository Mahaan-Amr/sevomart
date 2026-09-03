import { createHash } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/** Capture a tested state for review; this never creates or approves a baseline. */
export async function captureReleaseCheckpoint(
  page: Page,
  testInfo: TestInfo,
  options: { cellId: string; name: string; sensitiveRegions: Locator[]; zoom?: 1 | 2 },
) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Release checkpoints require a measured viewport");
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureAtViewport(page, testInfo, options);
    if (options.zoom === undefined) {
      await page.setViewportSize({
        width: Math.floor(viewport.width / 2),
        height: Math.floor(viewport.height / 2),
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureAtViewport(page, testInfo, { ...options, zoom: 2 });
    }
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(({ x, y }) => window.scrollTo(x, y), scroll);
  }
}

async function captureAtViewport(
  page: Page,
  testInfo: TestInfo,
  options: { cellId: string; name: string; sensitiveRegions: Locator[]; zoom?: 1 | 2 },
) {
  if (
    !/^[a-z0-9-]+:[a-z0-9-]+$/.test(options.cellId) ||
    !/^[a-z0-9-]+$/.test(options.name)
  ) {
    throw new Error("Release checkpoints require stable scenario and capture names");
  }
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Release checkpoints require a measured viewport");
  const browser = page.context().browser()?.browserType().name();
  if (browser !== "chromium" && browser !== "webkit")
    throw new Error("Unsupported release browser engine");
  const measurement = {
    cellId: options.cellId,
    browser,
    ...viewport,
    zoom: options.zoom ?? 1,
  };
  const name = `${options.name}-${measurement.zoom}x`;
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const geometry = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  // Raw axe nodes contain HTML, text and selectors; keep only non-content diagnostics.
  const violations = scan.violations.map(({ id, impact, nodes }) => ({
    rule: id,
    impact,
    count: nodes.length,
  }));
  const incomplete = scan.incomplete.map(({ id, impact, nodes }) => ({
    rule: id,
    impact,
    count: nodes.length,
  }));
  const screenshot = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    mask: [
      page.locator("input:not([type=button]):not([type=submit]), textarea, address"),
      page.getByText(/(?:09[0-9]{9}|۰۹[۰-۹]{9}|خیابان|کوچه|پلاک|کد پستی)/),
      ...options.sensitiveRegions,
    ],
  });
  await testInfo.attach(`${name}-selected-screenshot`, {
    body: screenshot,
    contentType: "image/png",
  });
  await testInfo.attach(`${name}-accessibility-report`, {
    body: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        status: "PENDING_INDEPENDENT_REVIEW",
        sha: process.env.GITHUB_SHA ?? null,
        runId: process.env.SEVO_RELEASE_RUN_ID ?? null,
        measurement,
        geometry,
        screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
        engine: { name: scan.testEngine.name, version: scan.testEngine.version },
        browserVersion: page.context().browser()?.version() ?? null,
        violations,
        incomplete,
        manualReview: {
          keyboard: "PENDING",
          longText: "PENDING",
          motion: "PENDING",
          baseline: "PENDING",
        },
      }),
    ),
    contentType: "application/json",
  });
  expect(
    geometry.scrollWidth,
    "RTL content must fit the measured viewport",
  ).toBeLessThanOrEqual(geometry.width);
  expect(
    violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    "Release accessibility scan must have no serious or critical violations",
  ).toEqual([]);
  testInfo.annotations.push({
    type: "release-cell",
    description: JSON.stringify(measurement),
  });
}
