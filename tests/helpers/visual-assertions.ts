import { expect, type Locator, type Page } from "@playwright/test";

import { contrastRatio } from "./color-contrast";

export async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

export async function assertInteractiveTargets(
  page: Page,
  selector = "a, button, input, select, summary, textarea",
) {
  const targets = await page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.checkVisibility()
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute("aria-label") ?? element.textContent?.trim(),
          height: rect.height,
          width: rect.width,
        };
      }),
  );
  for (const target of targets) {
    expect(
      target.height,
      `${target.name} must be at least 40px tall`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      target.width,
      `${target.name} must be at least 40px wide`,
    ).toBeGreaterThanOrEqual(40);
  }
}

export async function assertMinimumContrast(locator: Locator) {
  const samples = await locator.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      let background = style.backgroundColor;
      let ancestor = element.parentElement;
      while (background === "rgba(0, 0, 0, 0)" && ancestor) {
        background = getComputedStyle(ancestor).backgroundColor;
        ancestor = ancestor.parentElement;
      }
      return { foreground: style.color, background };
    }),
  );
  for (const sample of samples) {
    expect(contrastRatio(sample.foreground, sample.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
}
