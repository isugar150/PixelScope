import { describe, expect, it } from 'vitest';
import { addPoints, frameContentOrigin } from '../src/content/capture/frames';

describe('same-origin frame coordinates', () => {
  it('places a frame viewport at its content box inside the border and padding', () => {
    expect(frameContentOrigin({ left: 120, top: 64 }, { left: 2, top: 1 }, { left: 8, top: 4 })).toEqual({ x: 130, y: 69 });
  });

  it('accumulates offsets through nested frames', () => {
    const outer = frameContentOrigin({ left: 0, top: 60 }, { left: 0, top: 0 }, { left: 0, top: 0 });
    const inner = frameContentOrigin({ left: 20, top: 30 }, { left: 1, top: 1 }, { left: 0, top: 0 });
    expect(addPoints(outer, inner)).toEqual({ x: 21, y: 91 });
  });
});
