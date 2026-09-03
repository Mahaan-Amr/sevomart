import { expect, it } from "vitest";
import config from "../../playwright.release.config";

it("runs WebKit smoke with the WebKit engine instead of the inherited Chromium default", () => {
  const projects = config.projects!.filter((project) =>
    project.name?.startsWith("webkit-"),
  );
  expect(projects).toHaveLength(2);
  for (const project of projects) {
    expect(project.use?.browserName ?? config.use?.browserName).toBe("webkit");
    expect(project.use?.channel ?? config.use?.channel).toBeUndefined();
  }
});
