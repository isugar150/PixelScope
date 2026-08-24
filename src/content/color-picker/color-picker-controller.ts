import type { CopyFormat, UserSettings } from '../../shared/tool-state';
import { viewportToDocument, type Point } from '../coordinate';
import type { ToolLifecycle } from '../tool-controller';
import { rgbToHex, rgbToHsl, type RgbColor } from './color-converter';
import { ColorPickerOverlay } from './color-picker-overlay';
import { captureVisibleTab, CaptureManager, nextPaint } from './capture-manager';
import { PixelSampler } from './pixel-sampler';

export class ColorPickerController implements ToolLifecycle {
  readonly #onExit: () => void;
  #overlay: ColorPickerOverlay | null = null;
  #sampler: PixelSampler | null = null;
  #capture: CaptureManager | null = null;
  #style: HTMLStyleElement | null = null;
  #settings: UserSettings = { copyFormat: 'hex', keepColorPickerActive: true };
  #active = false;
  #frame: number | null = null;
  #lastPoint: Point | null = null;
  #lastColor: RgbColor | null = null;
  #refreshTimer: number | null = null;

  public constructor(onExit: () => void) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public async enable(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    this.#settings = await loadSettings();
    this.#overlay = new ColorPickerOverlay();
    this.#sampler = new PixelSampler();
    this.#style = document.createElement('style');
    this.#style.textContent = 'html,html *{cursor:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'%3E%3Cpath fill=\'%23fff\' stroke=\'%230f172a\' d=\'m16 2 6 6-3 3-1-1-7 7v3l-3 2-2-2 2-3h3l7-7-1-1z\'/%3E%3C/svg%3E") 2 22,crosshair!important}';
    document.documentElement.append(this.#style);
    this.#capture = new CaptureManager({
      capture: captureVisibleTab,
      load: async (dataUrl) => this.#sampler?.load(dataUrl),
      beforeCapture: async () => { this.#overlay?.setCaptureHidden(true); await nextPaint(); },
      afterCapture: () => this.#overlay?.setCaptureHidden(false),
    });
    this.#addListeners();
    await this.#capture.refresh();
    this.#refreshTimer = window.setInterval(() => this.#capture?.schedule(), 2_000);
  }

  public disable(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#removeListeners();
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    if (this.#refreshTimer !== null) window.clearInterval(this.#refreshTimer);
    this.#frame = null; this.#refreshTimer = null;
    this.#capture?.destroy(); this.#capture = null;
    this.#overlay?.destroy(); this.#overlay = null;
    this.#sampler = null;
    this.#style?.remove(); this.#style = null;
    this.#lastPoint = null; this.#lastColor = null;
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    this.#lastPoint = { x: event.clientX, y: event.clientY };
    if (this.#frame === null) this.#frame = window.requestAnimationFrame(this.#render);
  };
  readonly #render = (): void => {
    this.#frame = null;
    if (this.#lastPoint === null || this.#sampler === null) return;
    const color = this.#sampler.sample(this.#lastPoint, { width: window.innerWidth, height: window.innerHeight });
    if (color === null) return;
    this.#lastColor = color;
    this.#overlay?.update(color, this.#lastPoint, viewportToDocument(this.#lastPoint, { x: window.scrollX, y: window.scrollY }), this.#sampler);
  };
  readonly #onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.#lastColor === null) return;
    void this.#copyColor(this.#lastColor);
  };
  readonly #onContextMenu = (event: MouseEvent): void => { event.stopImmediatePropagation(); };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.#onExit();
  };
  readonly #onViewportChange = (): void => this.#capture?.schedule();

  async #copyColor(color: RgbColor): Promise<void> {
    const text = formatColor(color, this.#settings.copyFormat);
    try {
      await navigator.clipboard.writeText(text);
      this.#overlay?.showToast(`${text} 복사됨`);
      if (!this.#settings.keepColorPickerActive) this.#onExit();
    } catch { this.#overlay?.showToast('클립보드 복사에 실패했습니다.', true); }
  }

  #addListeners(): void {
    window.addEventListener('mousemove', this.#onMouseMove, { capture: true, passive: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('contextmenu', this.#onContextMenu, { capture: true });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
    window.addEventListener('scroll', this.#onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.#onViewportChange, { passive: true });
  }
  #removeListeners(): void {
    window.removeEventListener('mousemove', this.#onMouseMove, true);
    window.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('contextmenu', this.#onContextMenu, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
    window.removeEventListener('scroll', this.#onViewportChange, true);
    window.removeEventListener('resize', this.#onViewportChange);
  }
}

function formatColor(color: RgbColor, format: CopyFormat): string {
  if (format === 'rgb') return `rgb(${String(color.r)}, ${String(color.g)}, ${String(color.b)})`;
  if (format === 'hsl') { const hsl = rgbToHsl(color); return `hsl(${String(hsl.h)}, ${String(hsl.s)}%, ${String(hsl.l)}%)`; }
  return rgbToHex(color);
}
async function loadSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get({ copyFormat: 'hex', keepColorPickerActive: true });
  return {
    copyFormat: stored.copyFormat === 'rgb' || stored.copyFormat === 'hsl' ? stored.copyFormat : 'hex',
    keepColorPickerActive: stored.keepColorPickerActive !== false,
  };
}
