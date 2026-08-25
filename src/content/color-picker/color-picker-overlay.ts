import { clampLabelPosition, type Point } from '../coordinate';
import { rgbToCmyk, rgbToHex, rgbToHsl, rgbToHsv, type RgbColor } from './color-converter';
import { getCaptureViewport, type PixelSampler } from './pixel-sampler';

export type ColorPanelPosition = 'top' | 'bottom';

export interface ColorValue {
  readonly label: string;
  readonly value: string;
}

interface ColorValueRow {
  readonly element: HTMLDivElement;
  readonly value: HTMLSpanElement;
  readonly copyButton: HTMLButtonElement;
}

export class ColorPickerOverlay {
  readonly #onCopy: (value: string) => void;
  readonly #host = document.createElement('div');
  readonly #panel = document.createElement('div');
  readonly #swatch = document.createElement('span');
  readonly #values = document.createElement('div');
  readonly #rows: ColorValueRow[];
  readonly #loupe = document.createElement('div');
  readonly #canvas = document.createElement('canvas');
  readonly #loupeHex = document.createElement('span');
  readonly #toast = document.createElement('div');
  #panelPosition: ColorPanelPosition = 'top';
  #locked = false;
  #toastTimer: number | null = null;

  public constructor(onCopy: (value: string) => void) {
    this.#onCopy = onCopy;
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.dataset.pixelscopePickerState = 'sampling';
    this.#host.dataset.pixelscopePointerAids = 'visible';
    this.#host.dataset.pixelscopePanelPosition = 'top';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.#panel.className = 'panel top';
    this.#panel.hidden = true;
    this.#swatch.className = 'swatch';
    this.#values.className = 'values';
    this.#rows = COLOR_VALUE_LABELS.map((label) => this.#createValueRow(label));
    this.#values.append(...this.#rows.map((row) => row.element));
    this.#panel.append(this.#swatch, this.#values);
    this.#loupe.className = 'loupe';
    this.#canvas.width = 126;
    this.#canvas.height = 126;
    this.#loupeHex.className = 'loupe-hex';
    this.#loupe.append(this.#canvas, this.#loupeHex);
    this.#toast.className = 'toast';
    this.#toast.setAttribute('role', 'status');
    this.#toast.setAttribute('aria-live', 'polite');
    shadow.append(style, this.#panel, this.#loupe, this.#toast);
    document.documentElement.append(this.#host);
  }

  public get host(): HTMLElement { return this.#host; }

  public update(color: RgbColor, viewport: Point, sampler: PixelSampler): void {
    const values = formatColorValues(color);
    this.#panel.hidden = false;
    this.#swatch.style.background = rgbToHex(color);
    for (const [index, row] of this.#rows.entries()) {
      const colorValue = values[index];
      if (colorValue === undefined) continue;
      row.value.textContent = colorValue.value;
      row.copyButton.dataset.copyValue = colorValue.value;
    }
    this.#loupeHex.textContent = rgbToHex(color);
    const context = this.#canvas.getContext('2d');
    if (context !== null) {
      sampler.drawZoom(context, viewport, getCaptureViewport());
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.strokeRect(56, 56, 14, 14);
      context.strokeStyle = '#111827';
      context.lineWidth = 1;
      context.strokeRect(57, 57, 12, 12);
    }
    const position = clampLabelPosition(
      { x: viewport.x + 18, y: viewport.y + 18 },
      { width: 142, height: 164 },
      { width: window.innerWidth, height: window.innerHeight }, 8,
    );
    this.#loupe.style.transform = `translate(${String(position.x)}px, ${String(position.y)}px)`;
    this.movePanelAwayFrom(viewport);
  }

  public lockSelection(): void {
    this.#locked = true;
    this.#host.dataset.pixelscopePickerState = 'locked';
    this.#host.dataset.pixelscopePointerAids = 'hidden';
    this.#panel.classList.add('locked');
    this.#loupe.style.display = 'none';
  }

  public movePanelAwayFrom(pointer: Point): void {
    if (this.#locked || this.#panel.hidden) return;
    const bounds = this.#panel.getBoundingClientRect();
    const nextPosition = calculateColorPanelPosition(
      this.#panelPosition,
      pointer.y,
      { top: bounds.top, bottom: bounds.bottom },
      window.innerHeight,
    );
    this.#setPanelPosition(nextPosition);
  }

  public resetPanelPosition(): void {
    this.#locked = false;
    this.#setPanelPosition('top');
  }

  public isCopyControl(event: Event): boolean {
    return event.composedPath().some((target) => target instanceof HTMLButtonElement && target.hasAttribute('data-pixelscope-copy'));
  }

  public showToast(message: string, error = false): void {
    this.#toast.textContent = message;
    this.#toast.className = error ? 'toast visible error' : 'toast visible';
    if (this.#toastTimer !== null) window.clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => { this.#toast.className = 'toast'; }, 1_800);
  }

  public setCaptureHidden(hidden: boolean): void { this.#host.style.visibility = hidden ? 'hidden' : 'visible'; }

  public destroy(): void {
    this.resetPanelPosition();
    if (this.#toastTimer !== null) window.clearTimeout(this.#toastTimer);
    this.#host.remove();
  }

  #createValueRow(label: string): ColorValueRow {
    const element = document.createElement('div');
    element.className = 'value-row';
    const name = document.createElement('span');
    name.className = 'value-name';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'value-text';
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.type = 'button';
    copyButton.dataset.pixelscopeCopy = '';
    copyButton.setAttribute('aria-label', `${label} 값 복사`);
    copyButton.title = `${label} 값 복사`;
    copyButton.append(createCopyIcon());
    copyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const copyValue = copyButton.dataset.copyValue;
      if (copyValue !== undefined) this.#onCopy(copyValue);
    });
    element.append(name, value, copyButton);
    return { element, value, copyButton };
  }

  #setPanelPosition(position: ColorPanelPosition): void {
    if (position === this.#panelPosition && this.#panel.classList.contains(position)) return;
    this.#panelPosition = position;
    this.#host.dataset.pixelscopePanelPosition = position;
    this.#panel.classList.toggle('top', position === 'top');
    this.#panel.classList.toggle('bottom', position === 'bottom');
  }
}

const COLOR_VALUE_LABELS = ['HEX', 'RGB', 'HSL', 'HSV', 'CMYK'] as const;

export function formatColorValues(color: RgbColor): readonly ColorValue[] {
  const hsl = rgbToHsl(color), hsv = rgbToHsv(color), cmyk = rgbToCmyk(color);
  return [
    { label: 'HEX', value: rgbToHex(color) },
    { label: 'RGB', value: `rgb(${String(color.r)}, ${String(color.g)}, ${String(color.b)})` },
    { label: 'HSL', value: `hsl(${String(hsl.h)}, ${String(hsl.s)}%, ${String(hsl.l)}%)` },
    { label: 'HSV', value: `hsv(${String(hsv.h)}, ${String(hsv.s)}%, ${String(hsv.v)}%)` },
    { label: 'CMYK', value: `cmyk(${String(cmyk.c)}%, ${String(cmyk.m)}%, ${String(cmyk.y)}%, ${String(cmyk.k)}%)` },
  ];
}

export function calculateColorPanelPosition(
  current: ColorPanelPosition,
  pointerY: number,
  panel: { readonly top: number; readonly bottom: number },
  viewportHeight: number,
  gap = 20,
): ColorPanelPosition {
  if (current === 'top' && pointerY <= panel.bottom + gap) return 'bottom';
  if (current === 'bottom' && pointerY >= Math.max(0, panel.top - gap) && pointerY <= viewportHeight) return 'top';
  return current;
}

function createCopyIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('aria-hidden', 'true');
  const back = document.createElementNS(namespace, 'rect');
  back.setAttribute('x', '4'); back.setAttribute('y', '3'); back.setAttribute('width', '9'); back.setAttribute('height', '10'); back.setAttribute('rx', '2');
  const front = document.createElementNS(namespace, 'rect');
  front.setAttribute('x', '7'); front.setAttribute('y', '7'); front.setAttribute('width', '9'); front.setAttribute('height', '10'); front.setAttribute('rx', '2');
  icon.append(back, front);
  return icon;
}

const styles = `
  :host { all: initial; }
  .panel[hidden] { display:none; }
  .panel { position:fixed;left:50%;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:8px 10px;border:1px solid #334155;border-radius:10px;background:rgba(15,23,42,.96);box-shadow:0 8px 28px rgba(0,0,0,.35);color:#e2e8f0;font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transform:translateX(-50%);pointer-events:none; }
  .panel.top { top:8px;bottom:auto; } .panel.bottom { top:auto;bottom:8px; }
  .panel.locked { pointer-events:auto; }
  .swatch { flex:0 0 26px;width:26px;height:26px;border:1px solid rgba(255,255,255,.72);border-radius:7px;box-shadow:inset 0 0 0 1px rgba(15,23,42,.18); }
  .values { display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0; }
  .value-row { display:grid;grid-template-columns:auto auto;align-items:center;gap:6px;min-height:28px;padding:0 4px 0 8px;border:1px solid #334155;border-radius:7px;background:rgba(30,41,59,.86); }
  .panel.locked .value-row { grid-template-columns:auto auto 28px; }
  .value-name { color:#93c5fd;font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.04em; }
  .value-text { color:#fff;font:600 11px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap; }
  .copy-button { display:none;width:28px;height:28px;align-items:center;justify-content:center;margin:0;padding:0;border:0;border-left:1px solid #334155;border-radius:0 6px 6px 0;background:transparent;color:#cbd5e1;cursor:pointer; }
  .panel.locked .copy-button { display:flex; }
  .copy-button:hover { background:#334155;color:#fff; } .copy-button:active { background:#475569; }
  .copy-button:focus-visible { outline:2px solid #60a5fa;outline-offset:-2px; }
  .copy-button svg { width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5; }
  .loupe { position:fixed;width:142px;padding:7px;box-sizing:border-box;border:1px solid #475569;border-radius:8px;background:#0f172a;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none; }
  canvas { display:block;width:126px;height:126px;border-radius:3px;background:#111827; }
  .loupe-hex { display:block;padding-top:5px;color:#fff;font:600 12px/1.2 monospace;text-align:center; }
  .toast { position:fixed;left:50%;top:82px;transform:translate(-50%,-8px);padding:7px 11px;border-radius:6px;background:#166534;color:white;font:600 12px/1.3 sans-serif;opacity:0;transition:opacity .15s,transform .15s;pointer-events:none; }
  .panel.bottom ~ .toast { top:auto;bottom:82px; }
  .toast.visible { opacity:1;transform:translate(-50%,0); } .toast.error { background:#991b1b; }
  @media (max-width:640px) { .panel { align-items:flex-start; } .swatch { margin-top:1px; } .values { max-height:112px;overflow:auto; } }
  @media (prefers-reduced-motion:reduce) { .toast { transition:none; } }
`;
