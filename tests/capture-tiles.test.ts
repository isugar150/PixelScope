import { describe, expect, it } from 'vitest';
import { createCaptureTiles, intersectCaptureRect } from '../src/capture/tile-plan';

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
});
