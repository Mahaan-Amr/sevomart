export const visualViewports = [
  { name: "chromium-360x800", width: 360, height: 800 },
  { name: "chromium-390x844", width: 390, height: 844 },
  { name: "chromium-768x1024", width: 768, height: 1024 },
  { name: "chromium-1440x900", width: 1440, height: 900 },
] as const;

export const deterministicScreenshotOptions = {
  animations: "disabled",
  fullPage: true,
  maxDiffPixelRatio: 0.015,
} as const;

export const storefrontTestMobiles = Array.from({ length: 8 }, (_, index) =>
  testMobile(20 + index),
);

export const acceptanceTestMobiles = Array.from({ length: 4 }, (_, index) =>
  testMobile(30 + index),
);

export function visualProjectIndex(projectName: string) {
  const index = visualViewports.findIndex(({ name }) => name === projectName);
  if (index === -1) throw new Error(`Unknown visual project ${projectName}`);
  return index;
}

function testMobile(suffix: number) {
  return `09111111${String(suffix).padStart(3, "0")}`;
}
