import { describe, expect, it } from 'vitest';
import { contrastRatio, isLightColor, rgbToCmyk, rgbToHex, rgbToHsl, rgbToHsv } from '../src/content/color-picker/color-converter';

describe('color conversion', () => {
  it('converts RGB to uppercase HEX', () => expect(rgbToHex({ r: 18, g: 171, b: 52 })).toBe('#12AB34'));
  it('converts RGB to HSL', () => expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 }));
  it('converts RGB to HSV', () => expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, v: 100 }));
  it('converts RGB to CMYK including black', () => {
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });
  it('classifies brightness and calculates WCAG contrast', () => {
    expect(isLightColor({ r: 255, g: 255, b: 255 })).toBe(true);
    expect(isLightColor({ r: 0, g: 0, b: 0 })).toBe(false);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, 'white')).toBe(21);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, 'black')).toBe(21);
  });
});
