import type { CaptureViewport, PixelSampler } from './color-picker/pixel-sampler';
import type { MeasurementUnit } from '../shared/tool-state';
import { clampLabelPosition, type Point, type Rect } from './coordinate';
import { calculateMagnifierPosition, describeElement, formatCssPixels, formatMeasurement, formatMeasurementCoordinate, measureBoxModel, type BoxModel, type BoxModelSides } from './measure-utils';
import { overlayStyles } from './styles';

export type SavedMeasurement =
  | { readonly type: 'element'; readonly element: Element }
  | { readonly type: 'area'; readonly rect: Rect };

export type SelectionGuidePosition = 'top' | 'bottom';

export class MeasurementOverlay {
  readonly #host: HTMLDivElement;
  readonly #box: HTMLDivElement;
  readonly #boxModel: HTMLDivElement;
  readonly #boxModelBorder: HTMLDivElement;
  readonly #boxModelPadding: HTMLDivElement;
  readonly #label: HTMLDivElement;
  readonly #horizontal: HTMLDivElement;
  readonly #vertical: HTMLDivElement;
  readonly #panel: HTMLDivElement;
  readonly #magnifier: HTMLDivElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #magnifierMeta: HTMLSpanElement;
  readonly #savedLayer: HTMLDivElement;
  readonly #guide: HTMLDivElement;
  #guidePosition: SelectionGuidePosition = 'top';

  public constructor() {
    this.#host = document.createElement('div');
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.dataset.pixelscopeGuidePosition = 'top';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = this.#host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = overlayStyles;
    this.#savedLayer = createElement('div', 'saved-layer');
    this.#guide = createElement('div', 'selection-guide top');
    this.#guide.textContent = '선택 모드를 종료하려면 ESC를 누르세요';
    this.#box = createElement('div', 'box'); this.#label = createElement('div', 'label');
    this.#boxModel = createElement('div', 'box-model');
    this.#boxModelBorder = createElement('div', 'bm-border');
    this.#boxModelPadding = createElement('div', 'bm-padding');
    this.#boxModelPadding.append(createElement('div', 'bm-content'));
    this.#boxModelBorder.append(this.#boxModelPadding);
    this.#boxModel.append(this.#boxModelBorder);
    this.#horizontal = createElement('div', 'line horizontal'); this.#vertical = createElement('div', 'line vertical');
    this.#panel = createElement('div', 'panel'); this.#magnifier = createElement('div', 'magnifier loading');
    this.#canvas = document.createElement('canvas'); this.#canvas.width = 120; this.#canvas.height = 120;
    this.#magnifierMeta = createElement('span', 'meta'); this.#magnifier.append(this.#canvas, this.#magnifierMeta);
    shadow.append(style, this.#savedLayer, this.#box, this.#boxModel, this.#horizontal, this.#vertical, this.#label, this.#panel, this.#magnifier, this.#guide);
    document.documentElement.append(this.#host);
  }

  public get host(): HTMLElement { return this.#host; }
  public showSelectionGuide(): void { this.#host.dataset.pixelscopeSelectionMode = 'active'; this.#guide.style.display = 'block'; }
  public hideSelectionGuide(): void { this.#host.dataset.pixelscopeSelectionMode = 'viewing'; this.#guide.style.display = 'none'; }
  public moveSelectionGuideAwayFrom(pointer: Point): void {
    const bounds = this.#guide.getBoundingClientRect();
    const position = calculateSelectionGuidePosition(this.#guidePosition, pointer.y, { top: bounds.top, bottom: bounds.bottom }, innerHeight);
    if (position === this.#guidePosition) return;
    this.#guidePosition = position;
    this.#host.dataset.pixelscopeGuidePosition = position;
    this.#guide.classList.toggle('top', position === 'top');
    this.#guide.classList.toggle('bottom', position === 'bottom');
  }
  public capturePointer(pointerId: number): void { try { this.#host.setPointerCapture(pointerId); } catch { /* Capture is best effort. */ } }
  public releasePointer(pointerId: number): void { if (this.#host.hasPointerCapture(pointerId)) this.#host.releasePointerCapture(pointerId); }

  public renderCrosshair(point: Point): void {
    this.#host.dataset.pixelscopePointerAids = 'visible';
    const x = alignPixel(point.x), y = alignPixel(point.y);
    this.#vertical.style.display = 'block'; this.#horizontal.style.display = 'block';
    this.#vertical.style.transform = `translate3d(${String(x)}px,0,0)`;
    this.#horizontal.style.transform = `translate3d(0,${String(y)}px,0)`;
  }

  public renderElement(element: Element, unit: MeasurementUnit, showBoxModel: boolean): void {
    this.#host.dataset.pixelscopeMode = 'element-hover';
    const source = element.getBoundingClientRect();
    const rect = { left: source.left, top: source.top, width: source.width, height: source.height };
    this.#renderLabel(rect, formatMeasurement(rect.width, rect.height, unit), describeElement(element));
    if (showBoxModel) {
      this.#box.style.display = 'none';
      const box = measureBoxModel(element);
      this.#renderBoxModel(rect, box);
      this.#panel.className = 'panel bm-info';
      this.#renderBoxModelBreakdown(box);
      this.#positionBelow(this.#panel, this.#label);
    } else {
      this.#hideBoxModel();
      this.#renderBox(rect, true);
      this.#panel.style.display = 'none';
    }
  }

  public renderArea(rect: Rect, unit: MeasurementUnit, showCoordinates: boolean): void {
    this.#host.dataset.pixelscopeMode = 'area';
    this.#hideBoxModel();
    this.#panel.className = 'panel';
    this.#renderBox(rect, false);
    this.#label.style.display = 'none';
    this.renderPanel(rect, unit, showCoordinates);
  }

  public renderSavedMeasurements(measurements: readonly SavedMeasurement[], unit: MeasurementUnit, showCoordinates: boolean): void {
    const entries = measurements.map((measurement) => {
      const rect = measurement.type === 'element'
        ? elementViewportRect(measurement.element)
        : measurement.rect;
      const box = createElement('div', measurement.type === 'element' ? 'box saved element' : 'box saved');
      const label = createElement('div', 'label saved');
      setRectStyles(box, rect);
      box.style.display = 'block';
      const descriptor = measurement.type === 'element' ? describeElement(measurement.element) : undefined;
      const mode = measurement.type === 'element' ? 'Element' : undefined;
      label.textContent = formatMeasurementInfo(rect, unit, showCoordinates, mode, descriptor);
      return { box, label, rect };
    });
    this.#savedLayer.replaceChildren(...entries.flatMap(({ box, label }) => [box, label]));
    entries.forEach(({ label, rect }) => this.#positionNearRect(label, rect));
    this.#host.dataset.pixelscopeMeasurementCount = String(measurements.length);
    this.#host.dataset.pixelscopeCoordinatesVisible = String(showCoordinates);
  }

  public renderPanel(rect: Rect, unit: MeasurementUnit, showCoordinates: boolean): void {
    this.#panel.textContent = `${formatMeasurementInfo(rect, unit, showCoordinates)} · 놓아서 추가`;
    this.#positionNearRect(this.#panel, rect);
  }

  public renderMagnifier(point: Point, sampler: PixelSampler | null, captureViewport: CaptureViewport, measurement?: string): void {
    this.#host.dataset.pixelscopePointerAids = 'visible';
    this.#magnifier.style.display = 'block';
    const position = calculateMagnifierPosition(point, { width: 136, height: 156 }, { width: innerWidth, height: innerHeight });
    this.#magnifier.style.transform = `translate3d(${String(position.x)}px,${String(position.y)}px,0)`;
    this.#magnifierMeta.textContent = `X: ${String(Math.round(point.x))}, Y: ${String(Math.round(point.y))}${measurement === undefined ? '' : ` · ${measurement}`}`;
    const context = this.#canvas.getContext('2d');
    if (sampler === null || context === null || sampler.size.width === 0) { this.#magnifier.className = 'magnifier loading'; return; }
    this.#magnifier.className = 'magnifier';
    sampler.drawZoom(context, point, captureViewport, 15);
    context.strokeStyle = '#fff'; context.lineWidth = 1; context.strokeRect(56.5, 56.5, 8, 8);
    context.beginPath(); context.moveTo(60.5, 53); context.lineTo(60.5, 68); context.moveTo(53, 60.5); context.lineTo(68, 60.5); context.stroke();
  }

  public hidePointerAids(): void {
    this.#host.dataset.pixelscopePointerAids = 'hidden';
    this.#horizontal.style.display = 'none';
    this.#vertical.style.display = 'none';
    this.#magnifier.style.display = 'none';
  }

  public hideMeasurement(): void {
    this.#host.dataset.pixelscopeMode = 'idle';
    this.#box.style.display = 'none'; this.#label.style.display = 'none'; this.#panel.style.display = 'none';
    this.#hideBoxModel();
  }
  public setCaptureHidden(hidden: boolean): void { this.#host.style.visibility = hidden ? 'hidden' : 'visible'; }
  public destroy(): void { this.#host.remove(); }

  #renderBox(rect: Rect, isElement: boolean): void { setRectStyles(this.#box, rect); this.#box.className = isElement ? 'box element' : 'box'; this.#box.style.display = 'block'; }
  #renderBoxModel(borderBoxRect: Rect, box: BoxModel): void {
    const left = borderBoxRect.left - box.margin.left;
    const top = borderBoxRect.top - box.margin.top;
    const width = borderBoxRect.width + box.margin.left + box.margin.right;
    const height = borderBoxRect.height + box.margin.top + box.margin.bottom;
    this.#boxModel.style.display = 'block';
    this.#boxModel.style.left = `${String(left)}px`;
    this.#boxModel.style.top = `${String(top)}px`;
    this.#boxModel.style.width = `${String(width)}px`;
    this.#boxModel.style.height = `${String(height)}px`;
    this.#boxModel.style.padding = sidesToCss(box.margin);
    this.#boxModelBorder.style.padding = sidesToCss(box.border);
    this.#boxModelPadding.style.padding = sidesToCss(box.padding);
  }
  #hideBoxModel(): void { this.#boxModel.style.display = 'none'; }
  #renderBoxModelBreakdown(box: BoxModel): void {
    this.#panel.replaceChildren();
    const sections: readonly [string, string, BoxModelSides][] = [
      ['M', '#f6b26b', box.margin],
      ['P', '#8bd17c', box.padding],
      ['B', '#f5d76e', box.border],
    ];
    sections.forEach(([label, color, sides], index) => {
      if (index > 0) this.#panel.append(document.createTextNode(' · '));
      const span = document.createElement('span');
      span.style.color = color;
      span.textContent = `${label} ${formatCssPixels(sides.top)} ${formatCssPixels(sides.right)} ${formatCssPixels(sides.bottom)} ${formatCssPixels(sides.left)}`;
      this.#panel.append(span);
    });
  }
  #positionBelow(target: HTMLDivElement, anchor: HTMLDivElement): void {
    target.style.display = 'block';
    const anchorBounds = anchor.getBoundingClientRect();
    const bounds = target.getBoundingClientRect();
    const position = clampLabelPosition({ x: anchorBounds.left, y: anchorBounds.bottom + 2 }, { width: bounds.width, height: bounds.height }, { width: innerWidth, height: innerHeight }, 8);
    target.style.transform = `translate3d(${String(position.x)}px,${String(position.y)}px,0)`;
  }
  #renderLabel(rect: Rect, size: string, descriptor?: string): void {
    this.#setLabel(this.#label, rect, size, descriptor);
  }
  #setLabel(label: HTMLDivElement, rect: Rect, size: string, descriptor?: string): void {
    label.replaceChildren(document.createTextNode(size));
    if (descriptor !== undefined) { const tag = createElement('span', 'tag'); tag.textContent = descriptor; label.append(tag); }
    this.#positionNearRect(label, rect);
  }
  #positionNearRect(target: HTMLDivElement, rect: Rect): void {
    target.style.display = 'block';
    const bounds = target.getBoundingClientRect();
    const preferredY = rect.top >= bounds.height + 6 ? rect.top - bounds.height - 4 : rect.top + 4;
    const position = clampLabelPosition({ x: rect.left, y: preferredY }, { width: bounds.width, height: bounds.height }, { width: innerWidth, height: innerHeight }, 8);
    target.style.transform = `translate3d(${String(position.x)}px,${String(position.y)}px,0)`;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] { const value = document.createElement(tag); value.className = className; return value; }
function setRectStyles(target: HTMLElement, rect: Rect): void { target.style.left = `${String(rect.left)}px`; target.style.top = `${String(rect.top)}px`; target.style.width = `${String(rect.width)}px`; target.style.height = `${String(rect.height)}px`; }
function alignPixel(value: number): number { const ratio = devicePixelRatio || 1; return Math.round(value * ratio) / ratio; }
function sidesToCss(sides: BoxModel['margin']): string { return `${String(sides.top)}px ${String(sides.right)}px ${String(sides.bottom)}px ${String(sides.left)}px`; }
function elementViewportRect(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function formatMeasurementInfo(rect: Rect, unit: MeasurementUnit, showCoordinates: boolean, mode?: 'Element', descriptor?: string): string {
  const prefix = mode === undefined ? '' : `${mode}${descriptor === undefined ? '' : ` · ${descriptor}`} · `;
  const coordinates = showCoordinates ? ` · X ${formatMeasurementCoordinate(rect.left, unit, 'x')} · Y ${formatMeasurementCoordinate(rect.top, unit, 'y')}` : '';
  return `${prefix}${formatMeasurement(rect.width, rect.height, unit)}${coordinates}`;
}

export function calculateSelectionGuidePosition(
  current: SelectionGuidePosition,
  pointerY: number,
  guide: { readonly top: number; readonly bottom: number },
  viewportHeight: number,
  gap = 20,
): SelectionGuidePosition {
  if (current === 'top' && pointerY <= guide.bottom + gap) return 'bottom';
  if (current === 'bottom' && pointerY >= Math.max(0, guide.top - gap) && pointerY <= viewportHeight) return 'top';
  return current;
}
