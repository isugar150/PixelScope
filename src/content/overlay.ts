import type { CaptureViewport, PixelSampler } from './color-picker/pixel-sampler';
import type { MeasurementUnit } from '../shared/tool-state';
import { clampLabelPosition, type Point, type Rect } from './coordinate';
import { calculateMagnifierPosition, describeElement, formatMeasurement, formatMeasurementCoordinate } from './measure-utils';
import { overlayStyles } from './styles';

export class MeasurementOverlay {
  readonly #host: HTMLDivElement;
  readonly #box: HTMLDivElement;
  readonly #label: HTMLDivElement;
  readonly #horizontal: HTMLDivElement;
  readonly #vertical: HTMLDivElement;
  readonly #panel: HTMLDivElement;
  readonly #magnifier: HTMLDivElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #magnifierMeta: HTMLSpanElement;

  public constructor() {
    this.#host = document.createElement('div');
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = this.#host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = overlayStyles;
    this.#box = createElement('div', 'box'); this.#label = createElement('div', 'label');
    this.#horizontal = createElement('div', 'line horizontal'); this.#vertical = createElement('div', 'line vertical');
    this.#panel = createElement('div', 'panel'); this.#magnifier = createElement('div', 'magnifier loading');
    this.#canvas = document.createElement('canvas'); this.#canvas.width = 120; this.#canvas.height = 120;
    this.#magnifierMeta = createElement('span', 'meta'); this.#magnifier.append(this.#canvas, this.#magnifierMeta);
    shadow.append(style, this.#box, this.#horizontal, this.#vertical, this.#label, this.#panel, this.#magnifier);
    document.documentElement.append(this.#host);
  }

  public get host(): HTMLElement { return this.#host; }
  public capturePointer(pointerId: number): void { try { this.#host.setPointerCapture(pointerId); } catch { /* Capture is best effort. */ } }
  public releasePointer(pointerId: number): void { if (this.#host.hasPointerCapture(pointerId)) this.#host.releasePointerCapture(pointerId); }

  public renderCrosshair(point: Point): void {
    this.#host.dataset.pixelscopePointerAids = 'visible';
    const x = alignPixel(point.x), y = alignPixel(point.y);
    this.#vertical.style.display = 'block'; this.#horizontal.style.display = 'block';
    this.#vertical.style.transform = `translate3d(${String(x)}px,0,0)`;
    this.#horizontal.style.transform = `translate3d(0,${String(y)}px,0)`;
  }

  public renderElement(element: Element, locked: boolean, unit: MeasurementUnit): void {
    this.#host.dataset.pixelscopeMode = locked ? 'element-locked' : 'element-hover';
    const source = element.getBoundingClientRect();
    const rect = { left: source.left, top: source.top, width: source.width, height: source.height };
    this.#renderBox(rect, true);
    this.#renderLabel(rect, formatMeasurement(rect.width, rect.height, unit), describeElement(element));
    if (locked) this.renderPanel('Element', rect, unit, describeElement(element)); else this.#panel.style.display = 'none';
  }

  public renderArea(rect: Rect, start: Point, end: Point, unit: MeasurementUnit): void {
    this.#host.dataset.pixelscopeMode = 'area';
    this.#renderBox(rect, false);
    this.#renderLabel(rect, formatMeasurement(rect.width, rect.height, unit));
    this.renderPanel('Area', rect, unit, undefined, start, end);
  }

  public renderPanel(mode: 'Element' | 'Area', rect: Rect, unit: MeasurementUnit, descriptor?: string, start?: Point, end?: Point): void {
    const position = `${formatMeasurement(rect.width, rect.height, unit)} · X ${formatMeasurementCoordinate(rect.left, unit, 'x')} · Y ${formatMeasurementCoordinate(rect.top, unit, 'y')}`;
    const coordinates = start === undefined || end === undefined ? '' : ` · Start ${formatMeasurementCoordinate(start.x, unit, 'x')},${formatMeasurementCoordinate(start.y, unit, 'y')} · End ${formatMeasurementCoordinate(end.x, unit, 'x')},${formatMeasurementCoordinate(end.y, unit, 'y')}`;
    this.#panel.textContent = `${mode}${descriptor === undefined ? '' : ` · ${descriptor}`} · ${position}${coordinates} · Esc 다시 선택`;
    this.#panel.style.display = 'block';
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

  public hideMeasurement(): void { this.#host.dataset.pixelscopeMode = 'idle'; this.#box.style.display = 'none'; this.#label.style.display = 'none'; this.#panel.style.display = 'none'; }
  public setCaptureHidden(hidden: boolean): void { this.#host.style.visibility = hidden ? 'hidden' : 'visible'; }
  public destroy(): void { this.#host.remove(); }

  #renderBox(rect: Rect, isElement: boolean): void { setRectStyles(this.#box, rect); this.#box.className = isElement ? 'box element' : 'box'; this.#box.style.display = 'block'; }
  #renderLabel(rect: Rect, size: string, descriptor?: string): void {
    this.#label.replaceChildren(document.createTextNode(size));
    if (descriptor !== undefined) { const tag = createElement('span', 'tag'); tag.textContent = descriptor; this.#label.append(tag); }
    this.#label.style.display = 'block';
    const bounds = this.#label.getBoundingClientRect();
    const preferredY = rect.top >= bounds.height + 6 ? rect.top - bounds.height - 4 : rect.top + 4;
    const position = clampLabelPosition({ x: rect.left, y: preferredY }, { width: bounds.width, height: bounds.height }, { width: innerWidth, height: innerHeight }, 8);
    this.#label.style.transform = `translate3d(${String(position.x)}px,${String(position.y)}px,0)`;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] { const value = document.createElement(tag); value.className = className; return value; }
function setRectStyles(target: HTMLElement, rect: Rect): void { target.style.left = `${String(rect.left)}px`; target.style.top = `${String(rect.top)}px`; target.style.width = `${String(rect.width)}px`; target.style.height = `${String(rect.height)}px`; }
function alignPixel(value: number): number { const ratio = devicePixelRatio || 1; return Math.round(value * ratio) / ratio; }
