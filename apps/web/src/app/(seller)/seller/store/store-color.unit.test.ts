import { describe, expect, it } from "vitest";

import { readableStoreForeground } from "./store-color";

function toRgb(hex: string): string {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16));
  return `rgb(${channels.join(", ")})`;
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("readableStoreForeground", () => {
  it.each(["#ffffff", "#A41439", "#ffff00", "#000000"])(
    "keeps the store monogram readable on %s",
    (background) => {
      const foreground = readableStoreForeground(background);

      expect(toRgb(foreground)).toMatch(/^rgb/);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
