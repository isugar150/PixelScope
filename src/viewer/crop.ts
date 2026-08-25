export interface CropPoint {
  readonly x: number;
  readonly y: number;
}

export interface CropSize {
  readonly width: number;
  readonly height: number;
}

export interface CropRect extends CropPoint, CropSize {}

export function cropRectFromPoints(start: CropPoint, end: CropPoint, bounds: CropSize): CropRect {
  const startX = clamp(start.x, 0, bounds.width);
  const startY = clamp(start.y, 0, bounds.height);
  const endX = clamp(end.x, 0, bounds.width);
  const endY = clamp(end.y, 0, bounds.height);
  const left = Math.floor(Math.min(startX, endX));
  const top = Math.floor(Math.min(startY, endY));
  const right = Math.ceil(Math.max(startX, endX));
  const bottom = Math.ceil(Math.max(startY, endY));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function isCropRectWithinBounds(rect: CropRect, bounds: CropSize): boolean {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) && Number.isInteger(rect.height) &&
    rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1 &&
    rect.x + rect.width <= bounds.width && rect.y + rect.height <= bounds.height;
}

export function imagePointFromViewport(
  point: CropPoint,
  imageRect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  imageSize: CropSize,
): CropPoint {
  if (imageRect.width <= 0 || imageRect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((point.x - imageRect.left) * imageSize.width / imageRect.width, 0, imageSize.width),
    y: clamp((point.y - imageRect.top) * imageSize.height / imageRect.height, 0, imageSize.height),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
