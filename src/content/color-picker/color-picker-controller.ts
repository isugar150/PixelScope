import type { Point } from '../coordinate';
import { colorPickerInteractionStyles } from '../styles';
import type { ToolLifecycle } from '../tool-controller';
import type { RgbColor } from './color-converter';
import { ColorPickerOverlay } from './color-picker-overlay';
import { captureVisibleTab, CaptureManager, nextPaint } from './capture-manager';
import { getCaptureViewport, PixelSampler } from './pixel-sampler';

export class ColorPickerController implements ToolLifecycle {
  readonly #onExit: () => void;
  #overlay: ColorPickerOverlay | null = null;
  #sampler: PixelSampler | null = null;
  #capture: CaptureManager | null = null;
  #style: HTMLStyleElement | null = null;
  #active = false;
  #locked = false;
  #frame: number | null = null;
  #lastPoint: Point | null = null;
  #lastColor: RgbColor | null = null;

  public constructor(onExit: () => void) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public async enable(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    this.#locked = false;
    this.#overlay = new ColorPickerOverlay((value) => { void this.#copyValue(value); });
    this.#sampler = new PixelSampler();
    this.#style = document.createElement('style');
    this.#style.dataset.pixelscopeInteraction = '';
    this.#style.textContent = colorPickerInteractionStyles;
    document.documentElement.append(this.#style);
    this.#capture = new CaptureManager({
      capture: captureVisibleTab,
      load: async (dataUrl) => this.#sampler?.load(dataUrl),
      beforeCapture: async () => { this.#overlay?.setCaptureHidden(true); await nextPaint(); },
      afterCapture: () => this.#overlay?.setCaptureHidden(false),
    });
    this.#addListeners();
    await this.#capture.refresh();
  }

  public disable(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#removeListeners();
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#capture?.destroy();
    this.#capture = null;
    this.#overlay?.resetPanelPosition();
    this.#overlay?.destroy();
    this.#overlay = null;
    this.#sampler = null;
    this.#style?.remove();
    this.#style = null;
    this.#locked = false;
    this.#lastPoint = null;
    this.#lastColor = null;
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#locked || !event.isPrimary || (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    this.#lastPoint = { x: event.clientX, y: event.clientY };
    if (this.#frame === null) this.#frame = window.requestAnimationFrame(this.#render);
  };

  readonly #render = (): void => {
    this.#frame = null;
    if (this.#locked || this.#lastPoint === null || this.#sampler === null) return;
    const color = this.#sample(this.#lastPoint);
    if (color === null) return;
    this.#lastColor = color;
    this.#overlay?.update(color, this.#lastPoint, this.#sampler);
  };

  readonly #onClick = (event: MouseEvent): void => {
    if (this.#overlay?.isCopyControl(event) === true) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.#locked) return;
    const point = { x: event.clientX, y: event.clientY };
    const color = this.#sample(point) ?? this.#lastColor;
    if (color === null) return;
    this.#lastPoint = point;
    this.#lastColor = color;
    if (this.#sampler !== null) this.#overlay?.update(color, point, this.#sampler);
    this.#lockSelection();
  };

  readonly #onContextMenu = (event: MouseEvent): void => { if (!this.#locked) event.stopImmediatePropagation(); };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#onExit();
  };
  readonly #onViewportChange = (): void => { if (!this.#locked) this.#capture?.schedule(); };

  #sample(point: Point): RgbColor | null {
    return this.#sampler?.sample(point, getCaptureViewport()) ?? null;
  }

  #lockSelection(): void {
    this.#locked = true;
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#capture?.destroy();
    this.#capture = null;
    this.#style?.remove();
    this.#style = null;
    this.#overlay?.lockSelection();
  }

  async #copyValue(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.#overlay?.showToast(`${value} 복사됨`);
    } catch {
      this.#overlay?.showToast('클립보드 복사에 실패했습니다.', true);
    }
  }

  #addListeners(): void {
    window.addEventListener('pointerdown', this.#onPointerMove, { capture: true, passive: true });
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('contextmenu', this.#onContextMenu, { capture: true });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
    window.addEventListener('scroll', this.#onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.#onViewportChange, { passive: true });
  }

  #removeListeners(): void {
    window.removeEventListener('pointerdown', this.#onPointerMove, true);
    window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('contextmenu', this.#onContextMenu, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
    window.removeEventListener('scroll', this.#onViewportChange, true);
    window.removeEventListener('resize', this.#onViewportChange);
  }
}
