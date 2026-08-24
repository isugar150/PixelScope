export interface RgbColor { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }
export interface HslColor { readonly h: number; readonly s: number; readonly l: number }
export interface HsvColor { readonly h: number; readonly s: number; readonly v: number }
export interface CmykColor { readonly c: number; readonly m: number; readonly y: number; readonly k: number }

export function rgbToHex(color: RgbColor): string {
  return `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
}

export function rgbToHex8(color: RgbColor): string {
  return `${rgbToHex(color)}${channelHex((color.a ?? 1) * 255)}`;
}

export function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const [red, green, blue] = [r, g, b].map((channel) => clampChannel(channel) / 255) as [number, number, number];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: round(lightness * 100) };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0)
    : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue *= 60;
  return { h: Math.round(hue), s: round(saturation * 100), l: round(lightness * 100) };
}

export function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  const red = clampChannel(r) / 255, green = clampChannel(g) / 255, blue = clampChannel(b) / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: Math.round(hue), s: round(max === 0 ? 0 : (delta / max) * 100), v: round(max * 100) };
}

export function rgbToCmyk({ r, g, b }: RgbColor): CmykColor {
  const red = clampChannel(r) / 255, green = clampChannel(g) / 255, blue = clampChannel(b) / 255;
  const black = 1 - Math.max(red, green, blue);
  if (black === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: round(((1 - red - black) / (1 - black)) * 100),
    m: round(((1 - green - black) / (1 - black)) * 100),
    y: round(((1 - blue - black) / (1 - black)) * 100),
    k: round(black * 100),
  };
}

export function relativeLuminance({ r, g, b }: RgbColor): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = clampChannel(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function isLightColor(color: RgbColor): boolean { return relativeLuminance(color) > 0.179; }
export function contrastRatio(color: RgbColor, against: 'white' | 'black'): number {
  const a = relativeLuminance(color), b = against === 'white' ? 1 : 0;
  return round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), 2);
}

function channelHex(value: number): string { return Math.round(clampChannel(value)).toString(16).padStart(2, '0').toUpperCase(); }
function clampChannel(value: number): number { return Math.min(255, Math.max(0, value)); }
function round(value: number, digits = 1): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
