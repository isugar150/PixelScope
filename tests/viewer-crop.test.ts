import { describe, expect, it } from 'vitest';
import { adjustCropRect, createInitialCropRect, cropRectFromPoints, imagePointFromViewport, isCropRectWithinBounds, visibleImageCenter } from '../src/viewer/crop';

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

  it('creates a centered 100 by 100 crop selection by default', () => {
    expect(createInitialCropRect({ width: 300, height: 200 })).toEqual({ x: 100, y: 50, width: 100, height: 100 });
    expect(createInitialCropRect({ width: 80, height: 60 })).toEqual({ x: 0, y: 0, width: 80, height: 60 });
  });

  it('centers the initial crop selection in the currently visible image area', () => {
    const imageSize = { width: 400, height: 2000 };
    const center = visibleImageCenter(
      { left: 100, top: -800, width: 400, height: 2000 },
      { left: 0, top: 100, right: 800, bottom: 600 },
      imageSize,
    );
    expect(center).toEqual({ x: 200, y: 1150 });
    expect(createInitialCropRect(imageSize, 100, center)).toEqual({ x: 150, y: 1100, width: 100, height: 100 });
  });

  it('moves and resizes the crop selection while clamping it to the image', () => {
    const bounds = { width: 300, height: 200 };
    const initial = { x: 100, y: 50, width: 100, height: 100 };
    expect(adjustCropRect(initial, 'move', { x: 180, y: -80 }, bounds)).toEqual({ x: 200, y: 0, width: 100, height: 100 });
    expect(adjustCropRect(initial, 'se', { x: 40, y: 30 }, bounds)).toEqual({ x: 100, y: 50, width: 140, height: 130 });
    expect(adjustCropRect(initial, 'nw', { x: -150, y: -80 }, bounds)).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });
});
