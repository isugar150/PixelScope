import type { ExtensionMessage, ExtensionResponse } from '../../shared/messages';
import type { CaptureProgressState, CaptureRect, CaptureScrollPosition } from '../../shared/capture';
import type { ToolLifecycle } from '../tool-controller';
import { calculateAutoScroll, rectangleFromPoints, type Point } from '../coordinate';
import { findInspectableElement, isAreaDrag } from '../measure-utils';
import { CaptureOverlay } from './capture-overlay';

export type CaptureMode = 'element' | 'page';
const FIXED_CAPTURE_ATTRIBUTE = 'data-pixelscope-capture-fixed';

interface SuppressedStyle {
  readonly visibility: string;
  readonly priority: string;
}

/**
 * Unifies hover-to-highlight-an-element (click captures it) and drag-to-select-a-region
 * (release captures exactly that rect) into one interaction, mirroring how the measure tool
 * merges element-hover and area-drag. Touch has no hover, so a touch drag past the threshold
 * just cancels and lets the page scroll rather than starting a region drag.
 */
type ElementCaptureState =
  | { readonly type: 'idle' }
  | { readonly type: 'pending'; readonly element: Element | null; readonly startViewport: Point; readonly pointerId: number; readonly pointerType: string }
  | { readonly type: 'dragging'; readonly start: Point; readonly current: Point; readonly pointerId: number };

export class CaptureController implements ToolLifecycle {
  readonly #mode: CaptureMode;
  readonly #onExit: () => void;
  #overlay: CaptureOverlay | null = null;
  #style: HTMLStyleElement | null = null;
  #captureStyle: HTMLStyleElement | null = null;
  #captureTarget: Element | null = null;
  #frame: number | null = null;
  #point = { x: 0, y: 0 };
  #elementState: ElementCaptureState = { type: 'idle' };
  #autoScrollFrame: number | null = null;
  #active = false;
  #capturing = false;
  #captureAbortController: AbortController | null = null;
  #progress: CaptureProgressState | null = null;
  #originalScroll: CaptureScrollPosition | null = null;
  #originalScrollBehavior = '';
  #dialogTarget: HTMLElement | null = null;
  readonly #suppressedElements = new Map<HTMLElement, SuppressedStyle>();
  readonly #viewportSnapshot = new Map<HTMLElement, DOMRect>();
  #viewportSnapshotPosition: CaptureScrollPosition | null = null;

  public constructor(mode: CaptureMode, onExit: () => void) { this.#mode = mode; this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }
  public get progress(): CaptureProgressState | undefined { return this.#progress ?? undefined; }

  public enable(): void {
    if (this.#active) return;
    this.#active = true;
    this.#overlay = new CaptureOverlay(() => this.#stop());
    this.#style = document.createElement('style'); this.#style.dataset.pixelscopeInteraction = '';
    this.#style.textContent = 'html,html *{cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important}';
    document.documentElement.append(this.#style);
    this.#addListeners();
    if (this.#mode === 'page') queueMicrotask(() => {
      if (!this.#active) return;
      this.#dialogTarget = findScrollableOverlay();
      void this.#capture(this.#targetRect(), document.title);
    });
  }
  public disable(): void {
    if (!this.#active) return;
    this.#captureAbortController?.abort(); this.#captureAbortController = null;
    if (this.#capturing) void chrome.runtime.sendMessage({ type: 'CAPTURE_CANCEL' } satisfies ExtensionMessage).catch(() => undefined);
    this.#active = false; this.#capturing = false;
    this.#progress = null;
    this.#restorePage(); this.#removeListeners();
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    if (this.#autoScrollFrame !== null) cancelAnimationFrame(this.#autoScrollFrame);
    this.#frame = null; this.#autoScrollFrame = null; this.#elementState = { type: 'idle' };
    this.#overlay?.destroy(); this.#overlay = null; this.#style?.remove(); this.#style = null;
    this.#captureStyle?.remove(); this.#captureStyle = null; this.#captureTarget = null;
  }

  public async prepareViewport(position: CaptureScrollPosition, suppressViewportFixed: boolean): Promise<CaptureScrollPosition> {
    if (!this.#active || !this.#capturing) throw new Error('캡처가 활성화되어 있지 않습니다.');
    this.#overlay?.setCaptureHidden(true);
    this.#targetScrollTo(position);
    await nextStablePaint();
    this.#setViewportFixedSuppressed(suppressViewportFixed);
    if (suppressViewportFixed) await nextPaint(); else this.#snapshotViewportElements();
    return this.#targetPosition();
  }
  public updateProgress(completed: number, total: number): void {
    if (!this.#capturing) return;
    this.#progress = { phase: completed === total ? 'compositing' : 'capturing', completed, total };
    this.#overlay?.showProgress(completed, total);
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || !event.isPrimary || event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    const element = this.#elementAt(point);
    if (element !== null) this.#overlay?.renderElement(element);
    if (event.pointerType !== 'touch') { event.preventDefault(); this.#overlay?.capturePointer(event.pointerId); }
    this.#elementState = { type: 'pending', element, startViewport: point, pointerId: event.pointerId, pointerType: event.pointerType };
  };
  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || !event.isPrimary) return;
    this.#point = { x: event.clientX, y: event.clientY };
    if (this.#elementState.type === 'pending' && this.#elementState.pointerId === event.pointerId) {
      if (this.#elementState.pointerType === 'touch') {
        if (isAreaDrag(this.#elementState.startViewport, this.#point)) {
          this.#elementState = { type: 'idle' }; this.#overlay?.hideElement();
        }
        return;
      }
      event.preventDefault();
      if (isAreaDrag(this.#elementState.startViewport, this.#point)) {
        this.#overlay?.hideElement();
        this.#elementState = { type: 'dragging', start: this.#elementState.startViewport, current: this.#point, pointerId: event.pointerId };
        this.#ensureAutoScrollFrame();
      }
      return;
    }
    if (this.#elementState.type === 'dragging' && this.#elementState.pointerId === event.pointerId) {
      event.preventDefault();
      this.#elementState = { ...this.#elementState, current: this.#point };
      return;
    }
    if (this.#frame === null) this.#frame = requestAnimationFrame(this.#renderHover);
  };
  readonly #renderHover = (): void => {
    this.#frame = null;
    const element = this.#elementAt(this.#point);
    if (element !== null) this.#overlay?.renderElement(element);
  };
  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || !event.isPrimary) return;
    if (event.pointerType === 'touch') {
      if (this.#elementState.type !== 'pending' || this.#elementState.pointerId !== event.pointerId) return;
      const element = this.#elementState.element;
      this.#elementState = { type: 'idle' };
      if (element === null) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.#captureElement(element);
      return;
    }
    if (this.#elementState.type === 'pending' && this.#elementState.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.#overlay?.releasePointer(event.pointerId);
      const element = this.#elementAt({ x: event.clientX, y: event.clientY }) ?? this.#elementState.element;
      this.#elementState = { type: 'idle' };
      if (element !== null) this.#captureElement(element);
      return;
    }
    if (this.#elementState.type === 'dragging' && this.#elementState.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.#overlay?.releasePointer(event.pointerId);
      const { start, current } = this.#elementState;
      this.#elementState = { type: 'idle' };
      this.#overlay?.hideElement();
      if (isAreaDrag(start, current)) void this.#captureRegionNow(rectangleFromPoints(start, current));
    }
  };
  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (this.#elementState.type !== 'pending' && this.#elementState.type !== 'dragging') return;
    if (this.#elementState.pointerId !== event.pointerId) return;
    this.#overlay?.releasePointer(event.pointerId);
    this.#elementState = { type: 'idle' };
    this.#overlay?.hideElement();
  };
  readonly #onClick = (event: MouseEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  #ensureAutoScrollFrame(): void { if (this.#autoScrollFrame === null) this.#autoScrollFrame = requestAnimationFrame(this.#autoScrollTick); }
  readonly #autoScrollTick = (): void => {
    this.#autoScrollFrame = null;
    if (this.#elementState.type !== 'dragging') return;
    const delta = calculateAutoScroll(this.#elementState.current, { width: innerWidth, height: innerHeight });
    if (delta.x !== 0 || delta.y !== 0) window.scrollBy(delta.x, delta.y);
    this.#overlay?.renderArea(rectangleFromPoints(this.#elementState.start, this.#elementState.current));
    this.#ensureAutoScrollFrame();
  };
  async #captureRegionNow(rect: CaptureRect): Promise<void> {
    if (this.#capturing) return;
    this.#capturing = true;
    this.#overlay?.hideElement();
    this.#overlay?.setCaptureHidden(true);
    try {
      await nextPaint();
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({
        type: 'CAPTURE_REGION', rect, screenshotViewport: { width: innerWidth, height: innerHeight }, title: document.title,
      });
      if (!response.ok) throw new Error(response.error);
      this.#capturing = false;
      this.#onExit();
    } catch (error: unknown) {
      this.#capturing = false;
      this.#overlay?.setCaptureHidden(false);
      const message = error instanceof Error ? error.message : String(error);
      this.#overlay?.showError(message);
    }
  }

  #captureElement(element: Element): void {
    this.#captureTarget = element;
    const source = element.getBoundingClientRect();
    const rect = { left: source.left + scrollX, top: source.top + scrollY, width: source.width, height: source.height };
    void this.#capture(rect, `${document.title} - ${element.tagName.toLowerCase()}`);
  }
  #elementAt(point: { readonly x: number; readonly y: number }): Element | null {
    return findInspectableElement(document.elementFromPoint(point.x, point.y), this.#overlay?.host ?? null);
  }
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.#stop();
  };

  async #capture(rect: CaptureRect, title: string): Promise<void> {
    if (this.#capturing) return;
    const abortController = new AbortController();
    this.#captureAbortController = abortController;
    this.#progress = null;
    this.#capturing = true; this.#originalScroll = this.#targetPosition();
    if (this.#mode === 'element') this.#snapshotViewportElements();
    this.#originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    this.#preparePageForCapture();
    this.#overlay?.showPreparing(rect);
    try {
      if (this.#mode === 'element') await waitForPageFocus(abortController.signal);
      await waitForFonts(abortController.signal);
      const captureRect = this.#mode === 'page' ? await this.#warmFullPage(abortController.signal) : rect;
      this.#overlay?.updatePreparingSize(captureRect);
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({
        type: 'CAPTURE_DOCUMENT', rect: captureRect, viewport: this.#targetClientSize(), screenshotViewport: { width: innerWidth, height: innerHeight },
        viewportOffset: this.#targetViewportOffset(), title,
        ...(this.#mode === 'element' ? { preferredPosition: this.#originalScroll } : {}),
      });
      if (!response.ok) throw new Error(response.error);
      this.#captureAbortController = null; this.#capturing = false; this.#restorePage(); this.#onExit();
    } catch (error: unknown) {
      this.#captureAbortController = null; this.#capturing = false; this.#restorePage();
      const message = error instanceof Error ? error.message : String(error);
      if (/AbortError|중단/.test(message)) this.#onExit(); else this.#overlay?.showError(message);
    }
  }
  #stop(): void {
    if (this.#capturing) {
      this.#captureAbortController?.abort();
      void chrome.runtime.sendMessage({ type: 'CAPTURE_CANCEL' } satisfies ExtensionMessage).catch(() => undefined);
    }
    else this.#onExit();
  }
  async #warmFullPage(signal: AbortSignal): Promise<CaptureRect> {
    let position = 0;
    let previousBottomHeight = -1;
    let stableBottomChecks = 0;
    for (let frame = 0; frame < 500; frame += 1) {
      throwIfCaptureAborted(signal);
      this.#targetScrollTo({ x: 0, y: position });
      await nextStablePaint();
      throwIfCaptureAborted(signal);
      const rect = this.#targetRect();
      const viewportHeight = this.#targetClientSize().height;
      const maximumY = Math.max(0, rect.height - viewportHeight);
      const currentY = this.#targetPosition().y;
      const atBottom = currentY >= maximumY - 1;
      if (atBottom) {
        if (Math.abs(rect.height - previousBottomHeight) <= 1) stableBottomChecks += 1;
        else stableBottomChecks = 0;
        previousBottomHeight = rect.height;
        if (stableBottomChecks >= 1) return rect;
        position = maximumY;
      } else {
        stableBottomChecks = 0;
        position = Math.min(maximumY, currentY + viewportHeight);
      }
    }
    throw new Error('페이지 높이가 계속 변경되어 캡처를 준비할 수 없습니다.');
  }
  #restorePage(): void {
    this.#setViewportFixedSuppressed(false);
    this.#viewportSnapshot.clear();
    this.#viewportSnapshotPosition = null;
    this.#captureStyle?.remove(); this.#captureStyle = null;
    document.documentElement.style.scrollBehavior = this.#originalScrollBehavior;
    if (this.#originalScroll !== null) this.#targetScrollTo(this.#originalScroll);
    this.#originalScroll = null;
    this.#dialogTarget = null;
    this.#overlay?.setCaptureHidden(false);
  }
  #targetRect(): CaptureRect {
    return this.#dialogTarget === null ? pageRect() : {
      left: 0, top: 0,
      width: Math.max(this.#dialogTarget.scrollWidth, this.#dialogTarget.clientWidth),
      height: Math.max(this.#dialogTarget.scrollHeight, this.#dialogTarget.clientHeight),
    };
  }
  #targetClientSize(): { readonly width: number; readonly height: number } {
    return this.#dialogTarget === null
      ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
      : { width: this.#dialogTarget.clientWidth, height: this.#dialogTarget.clientHeight };
  }
  #targetPosition(): CaptureScrollPosition {
    return this.#dialogTarget === null ? { x: window.scrollX, y: window.scrollY } : { x: this.#dialogTarget.scrollLeft, y: this.#dialogTarget.scrollTop };
  }
  #targetScrollTo(position: CaptureScrollPosition): void {
    if (this.#dialogTarget === null) window.scrollTo(position.x, position.y);
    else this.#dialogTarget.scrollTo(position.x, position.y);
  }
  #targetViewportOffset(): CaptureScrollPosition {
    if (this.#dialogTarget === null) return { x: 0, y: 0 };
    const bounds = this.#dialogTarget.getBoundingClientRect();
    return { x: bounds.left, y: bounds.top };
  }
  #preparePageForCapture(): void {
    this.#captureStyle?.remove();
    this.#captureStyle = document.createElement('style');
    this.#captureStyle.dataset.pixelscopeCapturePreparation = '';
    this.#captureStyle.textContent = `
      html { scroll-behavior: auto !important; scroll-snap-type: none !important; }
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        scroll-snap-type: none !important;
      }
    `;
    document.documentElement.append(this.#captureStyle);
  }
  #setViewportFixedSuppressed(suppressed: boolean): void {
    if (this.#dialogTarget !== null) return;
    if (!suppressed) {
      for (const [element, original] of this.#suppressedElements) {
        element.removeAttribute(FIXED_CAPTURE_ATTRIBUTE);
        if (original.visibility === '') element.style.removeProperty('visibility');
        else element.style.setProperty('visibility', original.visibility, original.priority);
      }
      this.#suppressedElements.clear();
      return;
    }
    const snapshotMoved = this.#viewportSnapshotPosition !== null
      && (Math.abs(scrollX - this.#viewportSnapshotPosition.x) > 1 || Math.abs(scrollY - this.#viewportSnapshotPosition.y) > 1);
    for (const element of capturePageElements()) {
      if (element.hasAttribute('data-pixelscope-overlay') || this.#suppressedElements.has(element)
        || element.closest(`[${FIXED_CAPTURE_ATTRIBUTE}]`) !== null) continue;
      if (this.#captureTarget !== null
        && (element === this.#captureTarget || element.contains(this.#captureTarget) || this.#captureTarget.contains(element))) continue;
      if (!isViewportAttached(element, snapshotMoved ? this.#viewportSnapshot.get(element) : undefined)) continue;
      this.#suppressedElements.set(element, {
        visibility: element.style.getPropertyValue('visibility'),
        priority: element.style.getPropertyPriority('visibility'),
      });
      element.setAttribute(FIXED_CAPTURE_ATTRIBUTE, '');
      element.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  #snapshotViewportElements(): void {
    if (this.#dialogTarget !== null) return;
    this.#viewportSnapshot.clear();
    this.#viewportSnapshotPosition = { x: scrollX, y: scrollY };
    for (const element of capturePageElements()) {
      if (element.hasAttribute('data-pixelscope-overlay')) continue;
      const rect = element.getBoundingClientRect();
      if (intersectsViewport(rect)) this.#viewportSnapshot.set(element, rect);
    }
  }
  #addListeners(): void {
    window.addEventListener('pointerdown', this.#onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', this.#onPointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', this.#onPointerCancel, { capture: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
  }
  #removeListeners(): void {
    window.removeEventListener('pointerdown', this.#onPointerDown, true);
    window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('pointerup', this.#onPointerUp, true);
    window.removeEventListener('pointercancel', this.#onPointerCancel, true);
    window.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
  }
}

/**
 * When the page itself can't scroll (typical of a modal dialog that locks body scroll), full-page
 * capture would otherwise scroll nothing and produce duplicate tiles. This looks for the dialog's
 * own scrollable container so capture can scroll and tile through it instead.
 */
function findScrollableOverlay(): HTMLElement | null {
  if (isPageScrollable()) return null;
  const viewportArea = innerWidth * innerHeight;
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
    if (element.hasAttribute('data-pixelscope-overlay')) continue;
    if (element.scrollHeight <= element.clientHeight + 2) continue;
    const style = getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
    const rect = element.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < viewportArea * 0.3 || area <= bestArea) continue;
    bestArea = area; best = element;
  }
  return best;
}

/**
 * scrollHeight isn't affected by `overflow: hidden`, so it can't tell us whether the page
 * actually scrolls (a common scroll-lock pattern used behind modal dialogs). Probe it directly.
 */
function isPageScrollable(): boolean {
  const scrolling = document.scrollingElement ?? document.documentElement;
  if (scrolling.scrollHeight <= document.documentElement.clientHeight + 2) return false;
  const originalY = window.scrollY;
  window.scrollTo(window.scrollX, originalY + 1);
  const moved = window.scrollY !== originalY;
  window.scrollTo(window.scrollX, originalY);
  return moved;
}

function pageRect(): CaptureRect {
  const scrolling = document.scrollingElement ?? document.documentElement;
  return {
    left: 0,
    top: 0,
    width: Math.max(scrolling.scrollWidth, document.documentElement.clientWidth),
    height: Math.max(scrolling.scrollHeight, document.documentElement.clientHeight),
  };
}
function nextStablePaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 100))));
}
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
async function waitForFonts(signal: AbortSignal): Promise<void> {
  throwIfCaptureAborted(signal);
  await Promise.race([document.fonts.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 1_500))]);
  throwIfCaptureAborted(signal);
}
async function waitForPageFocus(signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + 1_500;
  while (performance.now() < deadline) {
    throwIfCaptureAborted(signal);
    window.focus();
    if (document.hasFocus()) {
      await nextStablePaint();
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error('DevTools 요소 하이라이트를 해제할 수 없습니다. 페이지를 한 번 클릭한 뒤 다시 캡처하세요.');
}
function throwIfCaptureAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('캡처가 중단되었습니다.', 'AbortError');
}
function isViewportAttached(element: HTMLElement, previousRect?: DOMRect): boolean {
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const rect = element.getBoundingClientRect();
  if (!intersectsViewport(rect)) return false;
  if (style.position === 'fixed' || style.position === 'sticky') return true;
  return previousRect !== undefined
    && Math.abs(rect.left - previousRect.left) <= 1
    && Math.abs(rect.top - previousRect.top) <= 1
    && Math.abs(rect.width - previousRect.width) <= 1
    && Math.abs(rect.height - previousRect.height) <= 1;
}
function intersectsViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}
function capturePageElements(): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const visit = (root: ParentNode): void => {
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element.hasAttribute('data-pixelscope-overlay')) continue;
      elements.push(element);
      if (element.shadowRoot !== null) visit(element.shadowRoot);
    }
  };
  visit(document.body);
  return elements;
}
