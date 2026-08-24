export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ScrollDelta {
  readonly x: number;
  readonly y: number;
}

export function viewportToDocument(point: Point, scroll: Point): Point {
  return { x: point.x + scroll.x, y: point.y + scroll.y };
}

export function documentToViewport(point: Point, scroll: Point): Point {
  return { x: point.x - scroll.x, y: point.y - scroll.y };
}

export function rectangleFromPoints(start: Point, end: Point): Rect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function documentRectToViewport(rect: Rect, scroll: Point): Rect {
  return { ...rect, left: rect.left - scroll.x, top: rect.top - scroll.y };
}

export function clampLabelPosition(
  preferred: Point,
  label: Size,
  viewport: Size,
  margin = 8,
): Point {
  const maxX = Math.max(margin, viewport.width - label.width - margin);
  const maxY = Math.max(margin, viewport.height - label.height - margin);
  return {
    x: Math.min(Math.max(preferred.x, margin), maxX),
    y: Math.min(Math.max(preferred.y, margin), maxY),
  };
}

export function calculateAutoScroll(
  pointer: Point,
  viewport: Size,
  edgeSize = 48,
  maxSpeed = 24,
): ScrollDelta {
  return {
    x: edgeVelocity(pointer.x, viewport.width, edgeSize, maxSpeed),
    y: edgeVelocity(pointer.y, viewport.height, edgeSize, maxSpeed),
  };
}

function edgeVelocity(position: number, extent: number, edgeSize: number, maxSpeed: number): number {
  if (position < edgeSize) return -maxSpeed * Math.min(1, (edgeSize - position) / edgeSize);
  if (position > extent - edgeSize) return maxSpeed * Math.min(1, (position - (extent - edgeSize)) / edgeSize);
  return 0;
}
