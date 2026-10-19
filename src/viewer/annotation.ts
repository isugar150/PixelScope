import type { CropPoint, CropRect, CropSize } from './crop';

export type AnnotationTool = 'pen' | 'marker' | 'rect' | 'ellipse' | 'arrow' | 'mosaic';
export type ShapeTool = 'rect' | 'ellipse' | 'arrow';

/**
 * Every annotation is stored in source-capture pixels, so crop and "restore original" only change
 * the offset it is drawn at; the drawing itself is never rewritten.
 */
export type Annotation =
  | { readonly kind: 'stroke'; readonly tool: 'pen' | 'marker'; readonly points: readonly CropPoint[]; readonly color: string; readonly width: number }
  | { readonly kind: 'shape'; readonly tool: ShapeTool; readonly start: CropPoint; readonly end: CropPoint; readonly color: string; readonly width: number; readonly fill: boolean }
  | { readonly kind: 'mosaic'; readonly rect: CropRect; readonly block: number };

export interface AnnotationHistory {
  readonly past: readonly (readonly Annotation[])[];
  readonly present: readonly Annotation[];
  readonly future: readonly (readonly Annotation[])[];
}

export const MARKER_OPACITY = 0.35;
const MARKER_WIDTH_FACTOR = 4;
const MOSAIC_BLOCK_FACTOR = 3;
const MINIMUM_MOSAIC_BLOCK = 4;

/** Only closed shapes can be filled; the toggle is ignored for lines, strokes and mosaic. */
export function isFillableTool(tool: AnnotationTool): tool is 'rect' | 'ellipse' {
  return tool === 'rect' || tool === 'ellipse';
}

export function isAnnotationTool(value: string | undefined): value is AnnotationTool {
  return value === 'pen' || value === 'marker' || value === 'rect' || value === 'ellipse' || value === 'arrow' || value === 'mosaic';
}

export function createHistory(): AnnotationHistory {
  return { past: [], present: [], future: [] };
}

export function commitAnnotation(history: AnnotationHistory, annotation: Annotation): AnnotationHistory {
  return { past: [...history.past, history.present], present: [...history.present, annotation], future: [] };
}

/** Clearing is an ordinary undoable step, so an accidental "clear all" can be taken back. */
export function clearAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (history.present.length === 0) return history;
  return { past: [...history.past, history.present], present: [], future: [] };
}

export function undoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}

/**
 * The size slider is in screen pixels so a stroke looks the same at every zoom level; convert it to
 * source pixels at the moment the stroke starts.
 */
export function strokeWidthForTool(tool: 'pen' | 'marker' | ShapeTool, screenSize: number, zoom: number): number {
  const width = screenSize * (tool === 'marker' ? MARKER_WIDTH_FACTOR : 1);
  return Math.max(1, width / Math.max(zoom, 0.01));
}

export function mosaicBlockSize(screenSize: number, zoom: number): number {
  return Math.max(MINIMUM_MOSAIC_BLOCK, Math.round(screenSize * MOSAIC_BLOCK_FACTOR / Math.max(zoom, 0.01)));
}

/** Pointer events arrive faster than they add detail; skip points closer than `minimumDistance`. */
export function appendStrokePoint(points: readonly CropPoint[], point: CropPoint, minimumDistance: number): readonly CropPoint[] {
  const last = points.at(-1);
  if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < minimumDistance) return points;
  return [...points, point];
}

export function rectFromPoints(start: CropPoint, end: CropPoint): CropRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Integer pixel rect clipped to the image, or null when nothing of it is inside. */
export function clipRect(rect: CropRect, bounds: CropRect): CropRect | null {
  const left = Math.max(Math.floor(rect.x), Math.floor(bounds.x));
  const top = Math.max(Math.floor(rect.y), Math.floor(bounds.y));
  const right = Math.min(Math.ceil(rect.x + rect.width), Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(Math.ceil(rect.y + rect.height), Math.ceil(bounds.y + bounds.height));
  return right <= left || bottom <= top ? null : { x: left, y: top, width: right - left, height: bottom - top };
}

export function mosaicCells(size: CropSize, block: number): CropSize {
  return { width: Math.max(1, Math.ceil(size.width / block)), height: Math.max(1, Math.ceil(size.height / block)) };
}

/** A drag shorter than this is treated as a stray click rather than a shape. */
export function isMeaningfulAnnotation(annotation: Annotation, minimumSize: number): boolean {
  if (annotation.kind === 'stroke') return annotation.points.length > 0;
  if (annotation.kind === 'mosaic') return annotation.rect.width >= minimumSize && annotation.rect.height >= minimumSize;
  return Math.hypot(annotation.end.x - annotation.start.x, annotation.end.y - annotation.start.y) >= minimumSize;
}

export interface ArrowGeometry {
  /** Where the shaft stops so its square end does not poke through the head's tip. */
  readonly shaftEnd: CropPoint;
  readonly head: readonly [CropPoint, CropPoint, CropPoint];
}

export function arrowGeometry(start: CropPoint, end: CropPoint, width: number): ArrowGeometry {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const headLength = Math.min(Math.max(width * 4, 10), length);
  const headHalfWidth = Math.max(width * 2.2, 6);
  if (length === 0) return { shaftEnd: end, head: [end, end, end] };
  const unitX = (end.x - start.x) / length;
  const unitY = (end.y - start.y) / length;
  const base = { x: end.x - unitX * headLength, y: end.y - unitY * headLength };
  return {
    shaftEnd: base,
    head: [
      { x: base.x - unitY * headHalfWidth, y: base.y + unitX * headHalfWidth },
      end,
      { x: base.x + unitY * headHalfWidth, y: base.y - unitX * headHalfWidth },
    ],
  };
}
