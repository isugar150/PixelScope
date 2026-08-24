import { describe, expect, it } from 'vitest';
import { calculateSampleRegion, viewportToImagePixel } from '../src/content/color-picker/pixel-sampler';

describe('capture pixel coordinates', () => {
  it('uses actual image dimensions and independent X/Y scales', () => {
    expect(viewportToImagePixel({ x: 250, y: 200 }, { width: 500, height: 400 }, { width: 1000, height: 1200 }))
      .toEqual({ x: 500, y: 600 });
  });
  it('clamps coordinates to image bounds', () => {
    expect(viewportToImagePixel({ x: -10, y: 999 }, { width: 500, height: 400 }, { width: 1000, height: 800 }))
      .toEqual({ x: 0, y: 799 });
  });
  it('subtracts a visual viewport offset before applying capture scales', () => {
    expect(viewportToImagePixel(
      { x: 150, y: 90 },
      { left: 50, top: 40, width: 400, height: 200 },
      { width: 800, height: 600 },
    )).toEqual({ x: 200, y: 150 });
  });
  it('clamps the magnifier source region at image edges', () => {
    expect(calculateSampleRegion({ x: 1, y: 99 }, { width: 100, height: 100 }, 15)).toEqual({ x: 0, y: 85, size: 15 });
  });
});
