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

export interface CaptureDraw {
  readonly source: CaptureRect;
  readonly destination: CaptureRect;
}

export interface CaptureFrameLayout {
  readonly width: number;
  readonly height: number;
  /** Where the scroll container's content origin lands in the output image. */
  readonly contentOffset: CaptureScrollPosition;
  /** Static surroundings copied once from the first tile; the scroller's own box is left for the tiles. */
  readonly draws: readonly CaptureDraw[];
}

/**
 * App-shell pages lock the document and scroll an inner container instead, so a "full page" image
 * is the visible viewport with that container grown to its full content. Everything around the
 * container keeps its size; regions beside it are extended by stretching their trailing 1px edge so
 * the grown area never shows transparent gaps.
 */
export function createFrameLayout(viewport: CaptureViewportSize, scroller: CaptureRect, content: CaptureViewportSize): CaptureFrameLayout {
  const left = clamp(scroller.left, 0, viewport.width);
  const top = clamp(scroller.top, 0, viewport.height);
  const right = clamp(scroller.left + scroller.width, left, viewport.width);
  const bottom = clamp(scroller.top + scroller.height, top, viewport.height);
  const extraX = Math.max(0, content.width - (right - left));
  const extraY = Math.max(0, content.height - (bottom - top));
  const columns = [[0, left], [left, right], [right, viewport.width]] as const;
  const rows = [[0, top], [top, bottom], [bottom, viewport.height]] as const;
  const draws: CaptureDraw[] = [];
  for (const [rowIndex, [y0, y1]] of rows.entries()) {
    for (const [columnIndex, [x0, x1]] of columns.entries()) {
      const width = x1 - x0;
      const height = y1 - y0;
      if ((rowIndex === 1 && columnIndex === 1) || width <= 0 || height <= 0) continue;
      const x = x0 + (columnIndex === 2 ? extraX : 0);
      const y = y0 + (rowIndex === 2 ? extraY : 0);
      draws.push({ source: { left: x0, top: y0, width, height }, destination: { left: x, top: y, width, height } });
      if (columnIndex === 1 && extraX > 0) {
        draws.push({ source: { left: x1 - 1, top: y0, width: 1, height }, destination: { left: x + width, top: y, width: extraX, height } });
      }
      if (rowIndex === 1 && extraY > 0) {
        draws.push({ source: { left: x0, top: y1 - 1, width, height: 1 }, destination: { left: x, top: y + height, width, height: extraY } });
      }
    }
  }
  return { width: viewport.width + extraX, height: viewport.height + extraY, contentOffset: { x: left, y: top }, draws };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
