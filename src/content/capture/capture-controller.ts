import type { ExtensionMessage, ExtensionResponse } from '../../shared/messages';
import type { CaptureRect, CaptureScrollPosition } from '../../shared/capture';
import type { ToolLifecycle } from '../tool-controller';
import { findInspectableElement } from '../measure-utils';
import { CaptureOverlay } from './capture-overlay';

export type CaptureMode = 'element' | 'page';

export class CaptureController implements ToolLifecycle {
  readonly #mode: CaptureMode;
  readonly #onExit: () => void;
  #overlay: CaptureOverlay | null = null;
  #style: HTMLStyleElement | null = null;
  #hovered: Element | null = null;
  #frame: number | null = null;
  #point = { x: 0, y: 0 };
  #active = false;
  #capturing = false;
  #originalScroll: CaptureScrollPosition | null = null;
  #originalScrollBehavior = '';

  public constructor(mode: CaptureMode, onExit: () => void) { this.#mode = mode; this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public enable(): void {
    if (this.#active) return;
    this.#active = true;
    this.#overlay = new CaptureOverlay(() => this.#stop());
    this.#style = document.createElement('style'); this.#style.dataset.pixelscopeInteraction = '';
    this.#style.textContent = 'html,html *{cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important}';
    document.documentElement.append(this.#style);
    this.#addListeners();
    if (this.#mode === 'page') queueMicrotask(() => { if (this.#active) void this.#capture(pageRect(), document.title); });
  }
  public disable(): void {
    if (!this.#active) return;
    if (this.#capturing) void chrome.runtime.sendMessage({ type: 'CAPTURE_CANCEL' } satisfies ExtensionMessage).catch(() => undefined);
    this.#active = false; this.#capturing = false;
    this.#restorePage(); this.#removeListeners();
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null; this.#overlay?.destroy(); this.#overlay = null; this.#style?.remove(); this.#style = null; this.#hovered = null;
  }

  public async prepareViewport(position: CaptureScrollPosition): Promise<CaptureScrollPosition> {
    if (!this.#active || !this.#capturing) throw new Error('캡처가 활성화되어 있지 않습니다.');
    this.#overlay?.setCaptureHidden(true);
    window.scrollTo(position.x, position.y);
    await nextStablePaint();
    return { x: window.scrollX, y: window.scrollY };
  }
  public updateProgress(completed: number, total: number): void { if (this.#capturing) this.#overlay?.showProgress(completed, total); }

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || !event.isPrimary) return;
    this.#point = { x: event.clientX, y: event.clientY };
    if (this.#frame === null) this.#frame = requestAnimationFrame(this.#renderHover);
  };
  readonly #renderHover = (): void => {
    this.#frame = null;
    const element = findInspectableElement(document.elementFromPoint(this.#point.x, this.#point.y), this.#overlay?.host ?? null);
    this.#hovered = element;
    if (element !== null) this.#overlay?.renderElement(element);
  };
  readonly #onClick = (event: MouseEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.#hovered === null) return;
    const source = this.#hovered.getBoundingClientRect();
    const rect = { left: source.left + scrollX, top: source.top + scrollY, width: source.width, height: source.height };
    void this.#capture(rect, `${document.title} - ${this.#hovered.tagName.toLowerCase()}`);
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.#stop();
  };

  async #capture(rect: CaptureRect, title: string): Promise<void> {
    if (this.#capturing) return;
    this.#capturing = true; this.#originalScroll = { x: scrollX, y: scrollY };
    this.#originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    this.#overlay?.showPreparing(rect);
    try {
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({
        type: 'CAPTURE_DOCUMENT', rect, viewport: { width: innerWidth, height: innerHeight }, title,
        ...(this.#mode === 'element' ? { preferredPosition: this.#originalScroll } : {}),
      });
      if (!response.ok) throw new Error(response.error);
      this.#capturing = false; this.#restorePage(); this.#onExit();
    } catch (error: unknown) {
      this.#capturing = false; this.#restorePage();
      const message = error instanceof Error ? error.message : String(error);
      if (/AbortError|중단/.test(message)) this.#onExit(); else this.#overlay?.showError(message);
    }
  }
  #stop(): void {
    if (this.#capturing) void chrome.runtime.sendMessage({ type: 'CAPTURE_CANCEL' } satisfies ExtensionMessage).catch(() => undefined);
    else this.#onExit();
  }
  #restorePage(): void {
    document.documentElement.style.scrollBehavior = this.#originalScrollBehavior;
    if (this.#originalScroll !== null) window.scrollTo(this.#originalScroll.x, this.#originalScroll.y);
    this.#originalScroll = null;
    this.#overlay?.setCaptureHidden(false);
  }
  #addListeners(): void {
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
  }
  #removeListeners(): void {
    window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
  }
}

function pageRect(): CaptureRect {
  const scrolling = document.scrollingElement ?? document.documentElement;
  return { left: 0, top: 0, width: Math.max(scrolling.scrollWidth, innerWidth), height: Math.max(scrolling.scrollHeight, innerHeight) };
}
function nextStablePaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 100))));
}
