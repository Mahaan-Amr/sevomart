export function readableStoreForeground(background: string): "#111111" | "#FFFFFF" {
  const [red, green, blue] = background
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));
  const luminance =
    0.2126 * linear(red!) + 0.7152 * linear(green!) + 0.0722 * linear(blue!);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.055;
  return whiteContrast >= darkContrast ? "#FFFFFF" : "#111111";
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
