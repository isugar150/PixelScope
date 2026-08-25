import type { CaptureRect, CaptureScrollPosition, CaptureViewportSize } from '../shared/capture';

export interface CaptureTile {
  readonly position: CaptureScrollPosition;
}

export function createCaptureTiles(rect: CaptureRect, viewport: CaptureViewportSize, preferredPosition?: CaptureScrollPosition): CaptureTile[] {
  if (rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return [];
  const xs = axisPositions(rect.left, rect.left + rect.width, viewport.width, preferredPosition?.x);
  const ys = axisPositions(rect.top, rect.top + rect.height, viewport.height, preferredPosition?.y);
  return ys.flatMap((y) => xs.map((x) => ({ position: { x, y } })));
}

export function intersectCaptureRect(rect: CaptureRect, viewportPosition: CaptureScrollPosition, viewport: CaptureViewportSize): CaptureRect | null {
  const left = Math.max(rect.left, viewportPosition.x);
  const top = Math.max(rect.top, viewportPosition.y);
  const right = Math.min(rect.left + rect.width, viewportPosition.x + viewport.width);
  const bottom = Math.min(rect.top + rect.height, viewportPosition.y + viewport.height);
  return right <= left || bottom <= top ? null : { left, top, width: right - left, height: bottom - top };
}

function axisPositions(start: number, end: number, viewportLength: number, preferred?: number): number[] {
  if (preferred !== undefined && end - start <= viewportLength) {
    const minimum = Math.max(0, end - viewportLength);
    const maximum = Math.max(minimum, start);
    return [Math.min(maximum, Math.max(minimum, preferred))];
  }
  const positions: number[] = [];
  let position = Math.max(0, start);
  positions.push(position);
  while (position + viewportLength < end) {
    const next = Math.min(position + viewportLength, Math.max(position, end - viewportLength));
    if (next <= position) break;
    position = next;
    positions.push(position);
  }
  return positions;
}
