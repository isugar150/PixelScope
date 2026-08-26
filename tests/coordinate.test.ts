import { describe, expect, it } from 'vitest';
import {
  calculateAutoScroll,
  clampLabelPosition,
  documentToViewport,
  isPointInsideRect,
  rectangleFromPoints,
  viewportToDocument,
} from '../src/content/coordinate';

describe('coordinate conversion', () => {
  it('converts viewport coordinates to document coordinates with scroll offsets', () => {
    expect(viewportToDocument({ x: 20, y: 30 }, { x: 100, y: 250 })).toEqual({ x: 120, y: 280 });
  });

  it('converts document coordinates back to viewport coordinates', () => {
    expect(documentToViewport({ x: 120, y: 280 }, { x: 100, y: 250 })).toEqual({ x: 20, y: 30 });
  });
});

describe('rectangle measurement', () => {
  it('detects points inside a rectangle including its edges', () => {
    const rect = { left: 10, top: 20, width: 30, height: 40 };
    expect(isPointInsideRect({ x: 10, y: 20 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 40, y: 60 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 41, y: 60 }, rect)).toBe(false);
  });

  it('calculates a forward drag rectangle and dimensions', () => {
    expect(rectangleFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      left: 10, top: 20, width: 100, height: 50,
    });
  });

  it('calculates a reverse drag rectangle and dimensions', () => {
    expect(rectangleFromPoints({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({
      left: 10, top: 20, width: 100, height: 50,
    });
  });
});

describe('label clamping', () => {
  it('keeps the label inside every viewport edge', () => {
    expect(clampLabelPosition({ x: -20, y: 490 }, { width: 100, height: 30 }, { width: 800, height: 500 }, 8))
      .toEqual({ x: 8, y: 462 });
    expect(clampLabelPosition({ x: 790, y: -10 }, { width: 100, height: 30 }, { width: 800, height: 500 }, 8))
      .toEqual({ x: 692, y: 8 });
  });
});

describe('automatic scrolling', () => {
  it('returns direction and proportional speed near viewport edges', () => {
    expect(calculateAutoScroll({ x: 0, y: 500 }, { width: 1000, height: 1000 }, 50, 20)).toEqual({ x: -20, y: 0 });
    expect(calculateAutoScroll({ x: 975, y: 990 }, { width: 1000, height: 1000 }, 50, 20)).toEqual({ x: 10, y: 16 });
  });

  it('does not scroll in the safe center area', () => {
    expect(calculateAutoScroll({ x: 500, y: 500 }, { width: 1000, height: 1000 })).toEqual({ x: 0, y: 0 });
  });
});
