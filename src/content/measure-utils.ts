import type { Point, Rect, Size } from './coordinate';
import type { MeasurementUnit } from '../shared/tool-state';

export const DRAG_THRESHOLD = 4;

export function isAreaDrag(start: Point, current: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

export function isInspectableElement(element: Element | null, overlayHost?: Element | null): boolean {
  if (element === null || element === overlayHost || overlayHost?.contains(element) === true) return false;
  if (element === document.documentElement || element === document.body) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
}

export function findInspectableElement(element: Element | null, overlayHost?: Element | null): Element | null {
  let candidate = element;
  while (candidate !== null) {
    if (isInspectableElement(candidate, overlayHost)) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

export function elementRect(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id.length > 0 ? `#${truncate(element.id, 24)}` : '';
  const classes = Array.from(element.classList).slice(0, 2).map((name) => `.${truncate(name, 20)}`).join('');
  return `${tag}${id}${classes}`;
}

export function formatCssPixels(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatMeasurement(width: number, height: number, unit: MeasurementUnit): string {
  if (unit === 'rem') {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return `${formatDecimal(width / rootSize)} × ${formatDecimal(height / rootSize)} rem`;
  }
  if (unit === 'viewport') {
    const viewportWidth = window.innerWidth || 1;
    const viewportHeight = window.innerHeight || 1;
    return `${formatDecimal(width / viewportWidth * 100)}vw × ${formatDecimal(height / viewportHeight * 100)}vh`;
  }
  return `${formatCssPixels(width)} × ${formatCssPixels(height)} px`;
}

export function formatMeasurementCoordinate(value: number, unit: MeasurementUnit, axis: 'x' | 'y'): string {
  if (unit === 'rem') {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return `${formatDecimal(value / rootSize)}rem`;
  }
  if (unit === 'viewport') {
    const viewportSize = (axis === 'x' ? window.innerWidth : window.innerHeight) || 1;
    return `${formatDecimal(value / viewportSize * 100)}v${axis === 'x' ? 'w' : 'h'}`;
  }
  return `${formatCssPixels(value)}px`;
}

export function calculateMagnifierPosition(pointer: Point, magnifier: Size, viewport: Size, gap = 16, margin = 8): Point {
  const preferredX = pointer.x + gap + magnifier.width <= viewport.width - margin
    ? pointer.x + gap : pointer.x - gap - magnifier.width;
  const preferredY = pointer.y + gap + magnifier.height <= viewport.height - margin
    ? pointer.y + gap : pointer.y - gap - magnifier.height;
  return {
    x: Math.min(Math.max(preferredX, margin), Math.max(margin, viewport.width - magnifier.width - margin)),
    y: Math.min(Math.max(preferredY, margin), Math.max(margin, viewport.height - magnifier.height - margin)),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatDecimal(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}
