// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { calculateMagnifierPosition, describeElement, elementRect, findInspectableElement, formatMeasurement, isAreaDrag } from '../src/content/measure-utils';
import { calculateSelectionGuidePosition, formatMeasurementInfo } from '../src/content/overlay';

describe('measure interaction helpers', () => {
  it('moves the selection guide away from the pointer at both viewport edges', () => {
    expect(calculateSelectionGuidePosition('top', 20, { top: 8, bottom: 44 }, 800)).toBe('bottom');
    expect(calculateSelectionGuidePosition('bottom', 400, { top: 756, bottom: 792 }, 800)).toBe('bottom');
    expect(calculateSelectionGuidePosition('bottom', 750, { top: 756, bottom: 792 }, 800)).toBe('top');
  });

  it('keeps area info compact and only shows coordinates when enabled', () => {
    const rect = { left: 12, top: 34, width: 100, height: 50 };
    expect(formatMeasurementInfo(rect, 'px', false)).toBe('100 × 50 px');
    expect(formatMeasurementInfo(rect, 'px', true)).toBe('100 × 50 px · X 12px · Y 34px');
    expect(formatMeasurementInfo(rect, 'px', false, 'Element', 'div.card')).toBe('Element · div.card · 100 × 50 px');
  });

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

  it('formats measurements using pixels, rems, and viewport units', () => {
    document.documentElement.style.fontSize = '16px';
    expect(formatMeasurement(160, 80, 'px')).toBe('160 × 80 px');
    expect(formatMeasurement(160, 80, 'rem')).toBe('10 × 5 rem');
    expect(formatMeasurement(window.innerWidth / 2, window.innerHeight / 4, 'viewport')).toBe('50vw × 25vh');
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}
