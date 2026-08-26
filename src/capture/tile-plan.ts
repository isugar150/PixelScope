import type { CaptureRect, CaptureScrollPosition, CaptureViewportSize } from '../shared/capture';

export interface CaptureTile {
  readonly position: CaptureScrollPosition;
}

export function shouldSuppressViewportFixed(
  preferredPosition: CaptureScrollPosition | undefined,
  tilePosition: CaptureScrollPosition,
  firstPageRowY: number,
): boolean {
  return preferredPosition !== undefined || Math.abs(tilePosition.y - firstPageRowY) > 1;
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
  if (preferred !== undefined) {
    const first = Math.min(Math.max(0, end - viewportLength), Math.max(Math.max(0, start), preferred));
    const positions = [first];
    let position = first;
    while (position + viewportLength < end) {
      position = Math.min(position + viewportLength, end - viewportLength);
      if (positions.includes(position)) break;
      positions.push(position);
    }
    position = first;
    while (position > start) {
      position = Math.max(Math.max(0, start), position - viewportLength);
      if (positions.includes(position)) break;
      positions.push(position);
    }
    return positions;
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
