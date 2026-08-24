// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { calculateMagnifierPosition, describeElement, elementRect, findInspectableElement, isAreaDrag } from '../src/content/measure-utils';

describe('measure interaction helpers', () => {
  it('treats movement up to 4px as a click and larger movement as a drag', () => {
    expect(isAreaDrag({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(isAreaDrag({ x: 0, y: 0 }, { x: 4.1, y: 0 })).toBe(true);
    expect(isAreaDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });

  it('excludes the PixelScope overlay and selects its nearest valid parent', () => {
    const overlay = document.createElement('div'), child = document.createElement('span');
    overlay.append(child); document.body.append(overlay);
    expect(findInspectableElement(child, overlay)).toBeNull();
    overlay.remove();

    const parent = document.createElement('section'), zero = document.createElement('span');
    parent.append(zero); document.body.append(parent);
    vi.spyOn(zero, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 120, 60));
    expect(findInspectableElement(zero)).toBe(parent);
    parent.remove();
  });

  it('uses the rendered border box and produces a compact element descriptor', () => {
    const element = document.createElement('div'); element.id = 'header'; element.className = 'navigation primary extra';
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(12.5, 20.25, 320.5, 180.25));
    expect(elementRect(element)).toEqual({ left: 12.5, top: 20.25, width: 320.5, height: 180.25 });
    expect(describeElement(element)).toBe('div#header.navigation.primary');
  });

  it('flips the magnifier away from right and bottom viewport edges', () => {
    expect(calculateMagnifierPosition({ x: 390, y: 290 }, { width: 120, height: 120 }, { width: 400, height: 300 }))
      .toEqual({ x: 254, y: 154 });
    expect(calculateMagnifierPosition({ x: 20, y: 20 }, { width: 120, height: 120 }, { width: 400, height: 300 }))
      .toEqual({ x: 36, y: 36 });
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}
