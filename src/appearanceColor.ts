export interface HSV { h: number; s: number; v: number }
export const clampColor = (value: number, max = 100) => Math.max(0, Math.min(max, value));

export function hexToHsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  const sector = !delta ? 0 : max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  return { h: Math.round(60 * (sector < 0 ? sector + 6 : sector)), s: Math.round(max ? delta / max * 100 : 0), v: Math.round(max / 255 * 100) };
}

export function hsvToHex({ h, s, v }: HSV): string {
  // Keep the reference operation order: h / 60 changes rounding at half-channel boundaries.
  const sector = h / 360 * 6, index = Math.floor(sector) % 6, brightness = v / 100;
  const low = brightness * (1 - s / 100), down = brightness * (1 - (sector - Math.floor(sector)) * s / 100);
  const up = brightness * (1 - (1 - sector + Math.floor(sector)) * s / 100);
  return `#${[ [brightness, down, low, low, up, brightness][index], [up, brightness, brightness, down, low, low][index],
    [low, low, up, brightness, brightness, down][index] ].map(channel => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}
