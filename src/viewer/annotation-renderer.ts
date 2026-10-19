import { MARKER_OPACITY, arrowGeometry, clipRect, mosaicCells, rectFromPoints, type Annotation } from './annotation';
import type { CropPoint, CropSize } from './crop';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The currently displayed (possibly cropped) image and where it sits in source-capture pixels. */
export interface AnnotationBase {
  readonly image: CanvasImageSource;
  readonly offset: CropPoint;
  readonly size: CropSize;
}

/**
 * Draws one annotation in source-capture pixels. The caller translates the context by the crop
 * offset, so the same call serves the on-screen layer and the exported PNG.
 */
export function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation, base: AnnotationBase): void {
  context.save();
  if (annotation.kind === 'mosaic') drawMosaic(context, annotation.rect, annotation.block, base);
  else if (annotation.kind === 'stroke') drawStroke(context, annotation.points, annotation.color, annotation.width, annotation.tool === 'marker');
  else {
    context.strokeStyle = annotation.color;
    context.fillStyle = annotation.color;
    context.lineWidth = annotation.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const rect = rectFromPoints(annotation.start, annotation.end);
    context.beginPath();
    if (annotation.tool === 'rect' || annotation.tool === 'ellipse') {
      if (annotation.tool === 'rect') context.rect(rect.x, rect.y, rect.width, rect.height);
      else context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      if (annotation.fill) context.fill();
      context.stroke();
    } else {
      const arrow = arrowGeometry(annotation.start, annotation.end, annotation.width);
      context.moveTo(annotation.start.x, annotation.start.y);
      context.lineTo(arrow.shaftEnd.x, arrow.shaftEnd.y);
      context.stroke();
      context.beginPath();
      const [left, tip, right] = arrow.head;
      context.moveTo(left.x, left.y);
      context.lineTo(tip.x, tip.y);
      context.lineTo(right.x, right.y);
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}

function drawStroke(context: CanvasRenderingContext2D, points: readonly CropPoint[], color: string, width: number, marker: boolean): void {
  const [first, ...rest] = points;
  if (first === undefined) return;
  // One path per stroke keeps a translucent marker evenly tinted where its segments overlap.
  if (marker) context.globalAlpha = MARKER_OPACITY;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (rest.length === 0) {
    context.arc(first.x, first.y, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.stroke();
}

/** Pixelates the capture itself (not earlier drawings) by averaging into blocks and scaling back up. */
function drawMosaic(context: CanvasRenderingContext2D, rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, block: number, base: AnnotationBase): void {
  const area = clipRect(rect, { x: base.offset.x, y: base.offset.y, width: base.size.width, height: base.size.height });
  if (area === null) return;
  const cells = mosaicCells(area, block);
  const sample = document.createElement('canvas');
  sample.width = cells.width;
  sample.height = cells.height;
  const sampleContext = sample.getContext('2d');
  if (sampleContext === null) return;
  sampleContext.imageSmoothingEnabled = true;
  sampleContext.imageSmoothingQuality = 'high';
  sampleContext.drawImage(base.image, area.x - base.offset.x, area.y - base.offset.y, area.width, area.height, 0, 0, cells.width, cells.height);
  context.beginPath();
  context.rect(area.x, area.y, area.width, area.height);
  context.clip();
  context.imageSmoothingEnabled = false;
  context.drawImage(sample, 0, 0, cells.width, cells.height, area.x, area.y, cells.width * block, cells.height * block);
}

/**
 * Live preview of the annotation being dragged. SVG keeps per-move updates cheap even on very tall
 * captures, where redrawing a full-resolution canvas every frame would stall.
 */
export function renderPreview(svg: SVGSVGElement, annotation: Annotation | null, offset: CropPoint, size: CropSize): void {
  svg.setAttribute('viewBox', `${String(offset.x)} ${String(offset.y)} ${String(Math.max(1, size.width))} ${String(Math.max(1, size.height))}`);
  if (annotation === null) { svg.replaceChildren(); return; }
  svg.replaceChildren(previewElement(annotation));
}

function previewElement(annotation: Annotation): SVGElement {
  if (annotation.kind === 'mosaic') {
    const rect = svgElement('rect', {
      x: annotation.rect.x, y: annotation.rect.y, width: annotation.rect.width, height: annotation.rect.height,
      fill: 'rgba(106, 82, 214, 0.18)', stroke: '#6a52d6', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke',
    });
    return rect;
  }
  const stroke = { stroke: annotation.color, 'stroke-width': annotation.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' };
  if (annotation.kind === 'stroke') {
    const points = annotation.points.length === 1 ? [...annotation.points, ...annotation.points] : annotation.points;
    return svgElement('polyline', {
      ...stroke,
      points: points.map((point) => `${String(point.x)},${String(point.y)}`).join(' '),
      'stroke-opacity': annotation.tool === 'marker' ? MARKER_OPACITY : 1,
    });
  }
  const rect = rectFromPoints(annotation.start, annotation.end);
  const closed = { ...stroke, fill: annotation.fill ? annotation.color : 'none' };
  if (annotation.tool === 'rect') return svgElement('rect', { ...closed, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  if (annotation.tool === 'ellipse') {
    return svgElement('ellipse', { ...closed, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 });
  }
  const arrow = arrowGeometry(annotation.start, annotation.end, annotation.width);
  const group = svgElement('g', {});
  group.append(
    svgElement('line', { ...stroke, x1: annotation.start.x, y1: annotation.start.y, x2: arrow.shaftEnd.x, y2: arrow.shaftEnd.y }),
    svgElement('polygon', { fill: annotation.color, points: arrow.head.map((point) => `${String(point.x)},${String(point.y)}`).join(' ') }),
  );
  return group;
}

function svgElement(name: string, attributes: Readonly<Record<string, string | number>>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
