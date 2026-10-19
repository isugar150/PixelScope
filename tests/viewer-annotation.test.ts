import { describe, expect, it } from 'vitest';
import {
  appendStrokePoint, arrowGeometry, clearAnnotations, clipRect, commitAnnotation, createHistory, isAnnotationTool, isFillableTool,
  isMeaningfulAnnotation, mosaicBlockSize, mosaicCells, rectFromPoints, redoAnnotation, strokeWidthForTool, undoAnnotation,
  type Annotation,
} from '../src/viewer/annotation';

const pen: Annotation = { kind: 'stroke', tool: 'pen', points: [{ x: 1, y: 1 }], color: '#ef4444', width: 4 };
const box = { kind: 'shape', tool: 'rect', start: { x: 0, y: 0 }, end: { x: 20, y: 10 }, color: '#3b82f6', width: 2, fill: false } as const satisfies Annotation;

describe('viewer annotation history', () => {
  it('undoes and redoes committed annotations in order', () => {
    const history = commitAnnotation(commitAnnotation(createHistory(), pen), box);
    expect(history.present).toEqual([pen, box]);
    const undone = undoAnnotation(history);
    expect(undone.present).toEqual([pen]);
    expect(redoAnnotation(undone).present).toEqual([pen, box]);
    expect(undoAnnotation(undoAnnotation(undone)).present).toEqual([]);
  });

  it('drops the redo branch when a new annotation is committed', () => {
    const history = commitAnnotation(undoAnnotation(commitAnnotation(createHistory(), pen)), box);
    expect(history.present).toEqual([box]);
    expect(history.future).toEqual([]);
    expect(redoAnnotation(history)).toBe(history);
  });

  it('makes clear-all undoable and ignores it when there is nothing to clear', () => {
    const empty = createHistory();
    expect(clearAnnotations(empty)).toBe(empty);
    const cleared = clearAnnotations(commitAnnotation(empty, pen));
    expect(cleared.present).toEqual([]);
    expect(undoAnnotation(cleared).present).toEqual([pen]);
  });
});

describe('viewer annotation geometry', () => {
  it('recognizes only the supported tools', () => {
    expect(isAnnotationTool('mosaic')).toBe(true);
    expect(isAnnotationTool('eraser')).toBe(false);
    expect(isAnnotationTool(undefined)).toBe(false);
  });

  it('offers fill only for closed shapes', () => {
    expect(isFillableTool('rect')).toBe(true);
    expect(isFillableTool('ellipse')).toBe(true);
    expect(isFillableTool('arrow')).toBe(false);
    expect(isFillableTool('pen')).toBe(false);
    expect(isFillableTool('mosaic')).toBe(false);
  });

  it('keeps on-screen thickness constant across zoom and widens the marker', () => {
    expect(strokeWidthForTool('pen', 4, 0.5)).toBe(8);
    expect(strokeWidthForTool('pen', 4, 2)).toBe(2);
    expect(strokeWidthForTool('marker', 4, 1)).toBe(16);
    expect(strokeWidthForTool('rect', 1, 4)).toBe(1);
    expect(mosaicBlockSize(4, 1)).toBe(12);
    expect(mosaicBlockSize(1, 4)).toBe(4);
  });

  it('skips stroke points closer than the minimum distance', () => {
    const points = appendStrokePoint([{ x: 0, y: 0 }], { x: 0.5, y: 0 }, 1);
    expect(points).toEqual([{ x: 0, y: 0 }]);
    expect(appendStrokePoint(points, { x: 3, y: 4 }, 1)).toEqual([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
  });

  it('normalizes a reverse drag into a positive rect', () => {
    expect(rectFromPoints({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 });
  });

  it('clips mosaic areas to whole pixels inside the visible image', () => {
    expect(clipRect({ x: -5.5, y: 10.2, width: 30, height: 20 }, { x: 0, y: 0, width: 100, height: 25 }))
      .toEqual({ x: 0, y: 10, width: 25, height: 15 });
    expect(clipRect({ x: 200, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 })).toBeNull();
    expect(mosaicCells({ width: 25, height: 15 }, 12)).toEqual({ width: 3, height: 2 });
  });

  it('ignores stray clicks for shapes and mosaic but keeps a single-point pen dot', () => {
    expect(isMeaningfulAnnotation(pen, 2)).toBe(true);
    expect(isMeaningfulAnnotation({ ...box, end: { x: 1, y: 1 } }, 2)).toBe(false);
    expect(isMeaningfulAnnotation({ kind: 'mosaic', rect: { x: 0, y: 0, width: 40, height: 1 }, block: 8 }, 2)).toBe(false);
  });

  it('builds an arrow head at the end point with the shaft stopping at its base', () => {
    const arrow = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(arrow.shaftEnd).toEqual({ x: 84, y: 0 });
    expect(arrow.head[1]).toEqual({ x: 100, y: 0 });
    expect(arrow.head[0].x).toBeCloseTo(84);
    expect(Math.abs(arrow.head[0].y - arrow.head[2].y)).toBeCloseTo(17.6);
    expect(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 4).shaftEnd).toEqual({ x: 5, y: 5 });
  });
});
