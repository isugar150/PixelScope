import type { Point } from '../coordinate';
import type { DesignOverlayBlendMode, DesignOverlayScale } from '../../shared/tool-state';
import type { ToolLifecycle } from '../tool-controller';

const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

export class DesignOverlayController implements ToolLifecycle {
  readonly #onExit: () => void;
  #host: HTMLDivElement | null = null;
  #img: HTMLImageElement | null = null;
  #active = false;
  #scaleSetting: DesignOverlayScale = '1';
  #documentPosition: Point = { x: 0, y: 0 };
  #drag: { readonly pointerId: number; readonly startViewport: Point; readonly startPosition: Point } | null = null;

  public constructor(onExit: () => void) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public enable(): void {
    if (this.#active) return;
    this.#active = true;
    this.#host = document.createElement('div');
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    const shadow = this.#host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .img { position:absolute; left:0; top:0; transform-origin:0 0; display:none; max-width:none; cursor:move; pointer-events:auto; outline:none; box-shadow:0 0 0 1px rgba(56,189,248,.6); will-change:transform; }
      .img:focus-visible { box-shadow:0 0 0 2px #38bdf8; }
    `;
    this.#img = document.createElement('img');
    this.#img.className = 'img';
    this.#img.tabIndex = -1;
    this.#img.alt = '';
    shadow.append(style, this.#img);
    document.documentElement.append(this.#host);
    this.#addListeners();
  }

  public disable(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#removeListeners();
    this.#drag = null;
    this.#host?.remove(); this.#host = null; this.#img = null;
  }

  public updateSettings(imageDataUrl: string | undefined, opacity: number, blendMode: DesignOverlayBlendMode, scale: DesignOverlayScale): void {
    if (!this.#active || this.#img === null) return;
    this.#scaleSetting = scale;
    if (imageDataUrl !== undefined) {
      this.#documentPosition = { x: scrollX, y: scrollY };
      this.#img.src = imageDataUrl;
      this.#img.style.display = 'block';
    }
    this.#applyTransform();
    this.#img.style.opacity = blendMode === 'difference' ? '1' : String(opacity / 100);
    this.#img.style.mixBlendMode = blendMode;
  }

  #computeScale(): number {
    if (this.#scaleSetting !== 'fit') return Number(this.#scaleSetting);
    const naturalWidth = this.#img?.naturalWidth ?? 0;
    return naturalWidth > 0 ? document.documentElement.clientWidth / naturalWidth : 1;
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.#img || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.#img?.focus();
    this.#img?.setPointerCapture(event.pointerId);
    this.#drag = { pointerId: event.pointerId, startViewport: { x: event.clientX, y: event.clientY }, startPosition: this.#documentPosition };
  };
  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#drag === null || this.#drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - this.#drag.startViewport.x;
    const dy = event.clientY - this.#drag.startViewport.y;
    this.#documentPosition = { x: this.#drag.startPosition.x + dx, y: this.#drag.startPosition.y + dy };
    this.#applyTransform();
  };
  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#drag?.pointerId !== event.pointerId) return;
    if (this.#img?.hasPointerCapture(event.pointerId) === true) this.#img.releasePointerCapture(event.pointerId);
    this.#drag = null;
  };
  readonly #onImageKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    const delta = { ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step }, ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 } }[event.key];
    if (delta === undefined) return;
    event.preventDefault(); event.stopPropagation();
    this.#documentPosition = { x: this.#documentPosition.x + delta.x, y: this.#documentPosition.y + delta.y };
    this.#applyTransform();
  };
  readonly #onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.#onExit();
  };
  readonly #onScroll = (): void => { this.#applyTransform(); };
  readonly #onResize = (): void => { if (this.#scaleSetting === 'fit') this.#applyTransform(); };
  readonly #onImageLoad = (): void => { if (this.#scaleSetting === 'fit') this.#applyTransform(); };

  #applyTransform(): void {
    if (this.#img === null) return;
    const x = this.#documentPosition.x - scrollX;
    const y = this.#documentPosition.y - scrollY;
    this.#img.style.transform = `translate3d(${String(x)}px,${String(y)}px,0) scale(${String(this.#computeScale())})`;
  }

  #addListeners(): void {
    this.#img?.addEventListener('pointerdown', this.#onPointerDown);
    this.#img?.addEventListener('pointermove', this.#onPointerMove);
    this.#img?.addEventListener('pointerup', this.#onPointerUp);
    this.#img?.addEventListener('pointercancel', this.#onPointerUp);
    this.#img?.addEventListener('keydown', this.#onImageKeyDown);
    this.#img?.addEventListener('load', this.#onImageLoad);
    window.addEventListener('keydown', this.#onWindowKeyDown, { capture: true });
    window.addEventListener('scroll', this.#onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.#onResize, { passive: true });
  }
  #removeListeners(): void {
    this.#img?.removeEventListener('pointerdown', this.#onPointerDown);
    this.#img?.removeEventListener('pointermove', this.#onPointerMove);
    this.#img?.removeEventListener('pointerup', this.#onPointerUp);
    this.#img?.removeEventListener('pointercancel', this.#onPointerUp);
    this.#img?.removeEventListener('keydown', this.#onImageKeyDown);
    this.#img?.removeEventListener('load', this.#onImageLoad);
    window.removeEventListener('keydown', this.#onWindowKeyDown, true);
    window.removeEventListener('scroll', this.#onScroll, true);
    window.removeEventListener('resize', this.#onResize);
  }
}
