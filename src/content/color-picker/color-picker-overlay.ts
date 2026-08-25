import { clampLabelPosition, type Point } from '../coordinate';
import { contrastRatio, isLightColor, rgbToCmyk, rgbToHex, rgbToHex8, rgbToHsl, rgbToHsv, type RgbColor } from './color-converter';
import { getCaptureViewport, type PixelSampler } from './pixel-sampler';

export class ColorPickerOverlay {
  readonly #host = document.createElement('div');
  readonly #panel = document.createElement('div');
  readonly #swatch = document.createElement('span');
  readonly #primary = document.createElement('strong');
  readonly #details = document.createElement('div');
  readonly #loupe = document.createElement('div');
  readonly #canvas = document.createElement('canvas');
  readonly #loupeHex = document.createElement('span');
  readonly #toast = document.createElement('div');
  #toastTimer: number | null = null;

  public constructor() {
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = this.#host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.#panel.className = 'panel';
    this.#swatch.className = 'swatch';
    this.#primary.className = 'primary';
    this.#details.className = 'details';
    this.#panel.append(this.#swatch, this.#primary, this.#details);
    this.#loupe.className = 'loupe';
    this.#canvas.width = 126; this.#canvas.height = 126;
    this.#loupeHex.className = 'loupe-hex';
    this.#loupe.append(this.#canvas, this.#loupeHex);
    this.#toast.className = 'toast';
    shadow.append(style, this.#panel, this.#loupe, this.#toast);
    document.documentElement.append(this.#host);
  }

  public update(color: RgbColor, viewport: Point, documentPoint: Point, sampler: PixelSampler): void {
    const hex = rgbToHex(color), hsl = rgbToHsl(color), hsv = rgbToHsv(color), cmyk = rgbToCmyk(color);
    this.#swatch.style.background = hex;
    this.#primary.textContent = `${hex} · rgb(${String(color.r)}, ${String(color.g)}, ${String(color.b)})`;
    const alpha = color.a ?? 1;
    const details = [
      `X ${String(Math.round(viewport.x))} · Y ${String(Math.round(viewport.y))}`,
      `Page X ${String(Math.round(documentPoint.x))} · Page Y ${String(Math.round(documentPoint.y))}`,
      `hsl(${String(hsl.h)}, ${String(hsl.s)}%, ${String(hsl.l)}%)`,
      `hsv(${String(hsv.h)}, ${String(hsv.s)}%, ${String(hsv.v)}%)`,
      `cmyk(${String(cmyk.c)}%, ${String(cmyk.m)}%, ${String(cmyk.y)}%, ${String(cmyk.k)}%)`,
      `${isLightColor(color) ? 'Light' : 'Dark'} · 대비 흰색 ${String(contrastRatio(color, 'white'))}:1 · 검정 ${String(contrastRatio(color, 'black'))}:1`,
    ];
    if (alpha < 1) details.push(`${rgbToHex8(color)} · rgba(${String(color.r)}, ${String(color.g)}, ${String(color.b)}, ${alpha.toFixed(2)}) · hsla(${String(hsl.h)}, ${String(hsl.s)}%, ${String(hsl.l)}%, ${alpha.toFixed(2)})`);
    this.#details.textContent = details.join('  |  ');
    this.#loupeHex.textContent = hex;
    const context = this.#canvas.getContext('2d');
    if (context !== null) {
      sampler.drawZoom(context, viewport, getCaptureViewport());
      context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(56, 56, 14, 14);
      context.strokeStyle = '#111827'; context.lineWidth = 1; context.strokeRect(57, 57, 12, 12);
    }
    const position = clampLabelPosition(
      { x: viewport.x + 18, y: viewport.y + 18 },
      { width: 142, height: 164 },
      { width: window.innerWidth, height: window.innerHeight }, 8,
    );
    this.#loupe.style.transform = `translate(${String(position.x)}px, ${String(position.y)}px)`;
  }

  public showToast(message: string, error = false): void {
    this.#toast.textContent = message;
    this.#toast.className = error ? 'toast visible error' : 'toast visible';
    if (this.#toastTimer !== null) window.clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => { this.#toast.className = 'toast'; }, 1_800);
  }

  public setCaptureHidden(hidden: boolean): void { this.#host.style.visibility = hidden ? 'hidden' : 'visible'; }
  public destroy(): void {
    if (this.#toastTimer !== null) window.clearTimeout(this.#toastTimer);
    this.#host.remove();
  }
}

const styles = `
  :host { all: initial; }
  .panel { position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:min(760px,calc(100vw - 16px));box-sizing:border-box;padding:8px 12px;border:1px solid #334155;border-radius:8px;background:rgba(15,23,42,.94);box-shadow:0 8px 28px rgba(0,0,0,.35);color:#e2e8f0;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none; }
  .swatch { display:inline-block;width:18px;height:18px;margin-right:8px;border:1px solid rgba(255,255,255,.65);border-radius:4px;vertical-align:middle; }
  .primary { color:#fff;font-size:13px;vertical-align:middle; }
  .details { margin-top:5px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis; }
  .loupe { position:fixed;width:142px;padding:7px;box-sizing:border-box;border:1px solid #475569;border-radius:8px;background:#0f172a;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none; }
  canvas { display:block;width:126px;height:126px;border-radius:3px;background:#111827; }
  .loupe-hex { display:block;padding-top:5px;color:#fff;font:600 12px/1.2 monospace;text-align:center; }
  .toast { position:fixed;left:50%;top:76px;transform:translate(-50%,-8px);padding:7px 11px;border-radius:6px;background:#166534;color:white;font:600 12px/1.3 sans-serif;opacity:0;transition:opacity .15s,transform .15s; }
  .toast.visible { opacity:1;transform:translate(-50%,0); } .toast.error { background:#991b1b; }
`;
