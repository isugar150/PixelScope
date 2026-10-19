import { describe, expect, it } from 'vitest';
import { createCaptureTiles, createFrameLayout, intersectCaptureRect, shouldSuppressViewportFixed } from '../src/capture/tile-plan';

describe('capture tile planning', () => {
  it('covers a long page from top to bottom without gaps', () => {
    const tiles = createCaptureTiles({ left: 0, top: 0, width: 390, height: 2000 }, { width: 390, height: 844 });
    expect(tiles.map((tile) => tile.position)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 844 }, { x: 0, y: 1156 }]);
  });

  it('tiles both axes for an oversized element', () => {
    const tiles = createCaptureTiles({ left: 100, top: 200, width: 900, height: 700 }, { width: 500, height: 400 });
    expect(tiles.map((tile) => tile.position)).toEqual([
      { x: 100, y: 200 }, { x: 500, y: 200 },
      { x: 100, y: 500 }, { x: 500, y: 500 },
    ]);
  });

  it('calculates the crop shared by a target and captured viewport', () => {
    expect(intersectCaptureRect(
      { left: 100, top: 100, width: 500, height: 500 },
      { x: 400, y: 400 }, { width: 300, height: 300 },
    )).toEqual({ left: 400, top: 400, width: 200, height: 200 });
  });

  it('keeps the current scroll position when an element is fully visible', () => {
    const tiles = createCaptureTiles(
      { left: 120, top: 700, width: 300, height: 200 },
      { width: 500, height: 600 },
      { x: 40, y: 500 },
    );
    expect(tiles.map((tile) => tile.position)).toEqual([{ x: 40, y: 500 }]);
  });

  it('scrolls only enough to reveal an element outside the current viewport', () => {
    const tiles = createCaptureTiles(
      { left: 120, top: 1100, width: 300, height: 200 },
      { width: 500, height: 600 },
      { x: 40, y: 500 },
    );
    expect(tiles.map((tile) => tile.position)).toEqual([{ x: 40, y: 700 }]);
  });

  it('suppresses viewport-fixed elements on every object tile but keeps every tile in the first page row', () => {
    expect(shouldSuppressViewportFixed({ x: 0, y: 500 }, { x: 0, y: 500 }, 500)).toBe(true);
    expect(shouldSuppressViewportFixed({ x: 0, y: 500 }, { x: 500, y: 500 }, 500)).toBe(true);
    expect(shouldSuppressViewportFixed(undefined, { x: 0, y: 0 }, 0)).toBe(false);
    expect(shouldSuppressViewportFixed(undefined, { x: 500, y: 0 }, 0)).toBe(false);
    expect(shouldSuppressViewportFixed(undefined, { x: 0, y: 600 }, 0)).toBe(true);
  });

  it('starts an oversized object capture at the current viewport and then covers the remainder', () => {
    const tiles = createCaptureTiles(
      { left: 0, top: 0, width: 500, height: 2_000 },
      { width: 500, height: 600 },
      { x: 0, y: 500 },
    );
    expect(tiles.map((tile) => tile.position.y)).toEqual([500, 1_100, 1_400, 0]);
  });

  it('grows an app-shell scroller to its full content and stretches the sidebar column below it', () => {
    const layout = createFrameLayout(
      { width: 1500, height: 900 },
      { left: 300, top: 0, width: 1185, height: 900 },
      { width: 1185, height: 1400 },
    );
    expect(layout).toEqual({
      width: 1500,
      height: 1400,
      contentOffset: { x: 300, y: 0 },
      draws: [
        { source: { left: 0, top: 0, width: 300, height: 900 }, destination: { left: 0, top: 0, width: 300, height: 900 } },
        { source: { left: 0, top: 899, width: 300, height: 1 }, destination: { left: 0, top: 900, width: 300, height: 500 } },
        { source: { left: 1485, top: 0, width: 15, height: 900 }, destination: { left: 1485, top: 0, width: 15, height: 900 } },
        { source: { left: 1485, top: 899, width: 15, height: 1 }, destination: { left: 1485, top: 900, width: 15, height: 500 } },
      ],
    });
  });

  it('shifts regions after the scroller by the grown size and keeps corners unstretched', () => {
    const layout = createFrameLayout(
      { width: 400, height: 300 },
      { left: 100, top: 50, width: 200, height: 200 },
      { width: 260, height: 500 },
    );
    expect(layout.width).toBe(460);
    expect(layout.height).toBe(600);
    expect(layout.contentOffset).toEqual({ x: 100, y: 50 });
    expect(layout.draws).toContainEqual({ source: { left: 300, top: 250, width: 100, height: 50 }, destination: { left: 360, top: 550, width: 100, height: 50 } });
    expect(layout.draws).toContainEqual({ source: { left: 299, top: 0, width: 1, height: 50 }, destination: { left: 300, top: 0, width: 60, height: 50 } });
    expect(layout.draws).toContainEqual({ source: { left: 100, top: 250, width: 200, height: 50 }, destination: { left: 100, top: 550, width: 200, height: 50 } });
    const covered = layout.draws.reduce((sum, draw) => sum + draw.destination.width * draw.destination.height, 0);
    expect(covered + 260 * 500).toBe(layout.width * layout.height);
  });

  it('clamps a scroller that extends past the viewport', () => {
    const layout = createFrameLayout({ width: 400, height: 300 }, { left: -10, top: 0, width: 420, height: 300 }, { width: 400, height: 900 });
    expect(layout).toMatchObject({ width: 400, height: 900, contentOffset: { x: 0, y: 0 }, draws: [] });
  });
});
