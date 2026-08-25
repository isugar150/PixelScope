import { describe, expect, it } from 'vitest';
import { cropRectFromPoints, imagePointFromViewport, isCropRectWithinBounds } from '../src/viewer/crop';

describe('viewer crop coordinates', () => {
  it('normalizes reverse drag and clamps it to the image bounds', () => {
    expect(cropRectFromPoints({ x: 180.2, y: 110.8 }, { x: -20, y: 30.2 }, { width: 160, height: 120 }))
      .toEqual({ x: 0, y: 30, width: 160, height: 81 });
  });

  it('maps viewport coordinates to source pixels independently of zoom', () => {
    expect(imagePointFromViewport(
      { x: 250, y: 150 },
      { left: 50, top: 50, width: 400, height: 200 },
      { width: 1200, height: 800 },
    )).toEqual({ x: 600, y: 400 });
  });

  it('validates pixel-perfect manual crop values', () => {
    const bounds = { width: 1200, height: 800 };
    expect(isCropRectWithinBounds({ x: 100, y: 50, width: 600, height: 400 }, bounds)).toBe(true);
    expect(isCropRectWithinBounds({ x: 100, y: 50, width: 1101, height: 400 }, bounds)).toBe(false);
    expect(isCropRectWithinBounds({ x: 0.5, y: 0, width: 10, height: 10 }, bounds)).toBe(false);
  });
});
