import type { ExtensionMessage, ExtensionResponse } from '../../shared/messages';
import type { CaptureProgressState, CaptureRect, CaptureScrollPosition } from '../../shared/capture';
import type { ToolLifecycle } from '../tool-controller';
import { calculateAutoScroll, rectangleFromPoints, revealOffset, type Point } from '../coordinate';
import { findInspectableElement, isAreaDrag } from '../measure-utils';
import { CaptureOverlay } from './capture-overlay';
import {
  accessibleFrameDocument, composedContains, composedParent, deepElementFromPoint, eventViewportPoint, frameOffset, isHtmlElement,
  isIframeElement, sameOriginFrameDocuments, styleOf, viewportRect,
} from './frames';

export type CaptureMode = 'element' | 'page';
const FIXED_CAPTURE_ATTRIBUTE = 'data-pixelscope-capture-fixed';
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);
const INTERACTION_STYLE = 'html,html *{cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important}';

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
  /** Same capture-preparation style inside the scrolled frame's document, when that is not the top one. */
  #frameCaptureStyle: HTMLStyleElement | null = null;
  /** Same-origin frames that receive this tool's listeners and crosshair cursor. */
  readonly #frameDocuments = new Map<Document, HTMLStyleElement>();
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
  /** Window scroll before a partly off-screen scroll box was brought into view; restored afterwards. */
  #originalWindowScroll: CaptureScrollPosition | null = null;
  /** Inner scroll container to tile through instead of the window; null means the document scrolls. */
  #scrollTarget: HTMLElement | null = null;
  /** Capture the scroll target's entire content (warming it first) rather than a fixed rect within it. */
  #captureWholeTarget = false;
  /** Composite the rest of the viewport around the grown scroll target (app-shell full-page capture). */
  #frameCapture = false;
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
    this.#style.textContent = INTERACTION_STYLE;
    document.documentElement.append(this.#style);
    this.#addListeners();
    this.#attachFrames();
    if (this.#mode === 'page') queueMicrotask(() => {
      if (!this.#active) return;
      const scroller = isPageScrollable() ? null : findPageScroller();
      this.#scrollTarget = scroller;
      this.#captureWholeTarget = true;
      this.#frameCapture = scroller !== null && findViewportAttachedRoot(scroller) === null;
      void this.#capture(this.#targetRect(), document.title);
    });
  }
  public disable(): void {
    if (!this.#active) return;
    this.#captureAbortController?.abort(); this.#captureAbortController = null;
    if (this.#capturing) notifyCaptureCancel();
    this.#active = false; this.#capturing = false;
    this.#progress = null;
    this.#restorePage(); this.#removeListeners(); this.#detachFrames();
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
    const point = eventViewportPoint(event);
    const element = this.#elementAt(point);
    if (element !== null) this.#overlay?.renderElement(element, viewportRect(element));
    if (event.pointerType !== 'touch') {
      event.preventDefault();
      // A pointer pressed inside a frame keeps delivering to that frame; capture only works in this document.
      if (!isFromFrame(event)) this.#overlay?.capturePointer(event.pointerId);
    }
    this.#elementState = { type: 'pending', element, startViewport: point, pointerId: event.pointerId, pointerType: event.pointerType };
  };
  readonly #onPointerMove = (event: PointerEvent): void => {
    if (this.#mode !== 'element' || this.#capturing || !event.isPrimary) return;
    this.#point = eventViewportPoint(event);
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
    if (element !== null) this.#overlay?.renderElement(element, viewportRect(element));
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
      const element = this.#elementAt(eventViewportPoint(event)) ?? this.#elementState.element;
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
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse | undefined>({
        type: 'CAPTURE_REGION', rect, screenshotViewport: { width: innerWidth, height: innerHeight }, title: document.title,
      });
      if (response === undefined) throw new Error('캡처 요청에 대한 응답이 없습니다.');
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

  /**
   * A scroll container is captured with its whole scrolled content. Any other element is captured at
   * its full border box, scrolling whichever container clips it (an app-shell main, a modal body)
   * rather than assuming the document itself scrolls.
   */
  #captureElement(element: Element): void {
    this.#captureTarget = element;
    const title = `${document.title} - ${element.tagName.toLowerCase()}`;
    if (isHtmlElement(element) && isScrollContainer(element)) {
      this.#scrollTarget = element;
      this.#captureWholeTarget = true;
      void this.#capture(this.#targetRect(), title);
      return;
    }
    this.#scrollTarget = findClippingScroller(element);
    void this.#capture(this.#elementRect(element), title);
  }
  #elementRect(element: Element): CaptureRect {
    const source = viewportRect(element);
    if (this.#scrollTarget === null) return { left: source.left + scrollX, top: source.top + scrollY, width: source.width, height: source.height };
    const origin = clientOrigin(this.#scrollTarget);
    const content = this.#targetRect();
    const offsetX = this.#scrollTarget.scrollLeft - origin.x;
    const offsetY = this.#scrollTarget.scrollTop - origin.y;
    const left = Math.max(0, source.left + offsetX);
    const top = Math.max(0, source.top + offsetY);
    const right = Math.min(content.width, source.right + offsetX);
    const bottom = Math.min(content.height, source.bottom + offsetY);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  #elementAt(point: { readonly x: number; readonly y: number }): Element | null {
    return findInspectableElement(deepElementFromPoint(point), this.#overlay?.host ?? null);
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
    this.#originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    this.#preparePageForCapture();
    if (this.#mode === 'element') {
      this.#revealScrollTarget();
      this.#snapshotViewportElements();
    }
    this.#overlay?.showPreparing(rect);
    try {
      if (this.#mode === 'element') await waitForPageFocus(abortController.signal);
      await waitForFonts(abortController.signal);
      const captureRect = this.#captureWholeTarget ? await this.#warmFullPage(abortController.signal) : rect;
      this.#overlay?.updatePreparingSize(captureRect);
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse | undefined>({
        type: 'CAPTURE_DOCUMENT', rect: captureRect, viewport: this.#targetClientSize(), screenshotViewport: { width: innerWidth, height: innerHeight },
        viewportOffset: this.#targetViewportOffset(), title,
        ...(this.#mode === 'element' ? { preferredPosition: this.#originalScroll } : {}),
        ...(this.#frameCapture ? { frame: true } : {}),
      });
      if (response === undefined) throw new Error('캡처 요청에 대한 응답이 없습니다.');
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
      notifyCaptureCancel();
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
    this.#frameCaptureStyle?.remove(); this.#frameCaptureStyle = null;
    document.documentElement.style.scrollBehavior = this.#originalScrollBehavior;
    if (this.#originalScroll !== null) this.#targetScrollTo(this.#originalScroll);
    this.#originalScroll = null;
    if (this.#originalWindowScroll !== null) window.scrollTo(this.#originalWindowScroll.x, this.#originalWindowScroll.y);
    this.#originalWindowScroll = null;
    this.#scrollTarget = null; this.#captureWholeTarget = false; this.#frameCapture = false;
    this.#overlay?.setCaptureHidden(false);
  }
  /**
   * Tiles only ever scroll the inner box, so a box that straddles the window edge (a wide code block
   * just below the fold) would be photographed partly off-screen. Scroll the window just enough to
   * show the box's scrollport first; the window position is restored with everything else.
   */
  #revealScrollTarget(): void {
    const target = this.#scrollTarget;
    if (target === null || target.ownerDocument !== document || target === document.scrollingElement) return;
    const origin = clientOrigin(target);
    const deltaX = revealOffset(origin.x, target.clientWidth, document.documentElement.clientWidth);
    const deltaY = revealOffset(origin.y, target.clientHeight, document.documentElement.clientHeight);
    if (deltaX === 0 && deltaY === 0) return;
    this.#originalWindowScroll = { x: window.scrollX, y: window.scrollY };
    window.scrollBy(deltaX, deltaY);
  }
  #targetRect(): CaptureRect {
    return this.#scrollTarget === null ? pageRect() : {
      left: 0, top: 0,
      width: Math.max(this.#scrollTarget.scrollWidth, this.#scrollTarget.clientWidth),
      height: Math.max(this.#scrollTarget.scrollHeight, this.#scrollTarget.clientHeight),
    };
  }
  #targetClientSize(): { readonly width: number; readonly height: number } {
    return this.#scrollTarget === null
      ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
      : { width: this.#scrollTarget.clientWidth, height: this.#scrollTarget.clientHeight };
  }
  #targetPosition(): CaptureScrollPosition {
    return this.#scrollTarget === null ? { x: window.scrollX, y: window.scrollY } : { x: this.#scrollTarget.scrollLeft, y: this.#scrollTarget.scrollTop };
  }
  #targetScrollTo(position: CaptureScrollPosition): void {
    if (this.#scrollTarget === null) window.scrollTo(position.x, position.y);
    else this.#scrollTarget.scrollTo(position.x, position.y);
  }
  #targetViewportOffset(): CaptureScrollPosition {
    return this.#scrollTarget === null ? { x: 0, y: 0 } : clientOrigin(this.#scrollTarget);
  }
  #preparePageForCapture(): void {
    this.#captureStyle?.remove();
    this.#frameCaptureStyle?.remove(); this.#frameCaptureStyle = null;
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
    const targetDocument = this.#scrollTarget?.ownerDocument;
    if (targetDocument !== undefined && targetDocument !== document) {
      this.#frameCaptureStyle = targetDocument.createElement('style');
      this.#frameCaptureStyle.textContent = this.#captureStyle.textContent;
      targetDocument.documentElement.append(this.#frameCaptureStyle);
    }
  }
  #setViewportFixedSuppressed(suppressed: boolean): void {
    if (!suppressed) {
      for (const [element, original] of this.#suppressedElements) {
        element.removeAttribute(FIXED_CAPTURE_ATTRIBUTE);
        if (original.visibility === '') element.style.removeProperty('visibility');
        else element.style.setProperty('visibility', original.visibility, original.priority);
      }
      this.#suppressedElements.clear();
      return;
    }
    const currentPosition = this.#targetPosition();
    const snapshotMoved = this.#viewportSnapshotPosition !== null
      && (Math.abs(currentPosition.x - this.#viewportSnapshotPosition.x) > 1
        || Math.abs(currentPosition.y - this.#viewportSnapshotPosition.y) > 1);
    const scrollTarget = this.#scrollTarget;
    const captureTarget = this.#captureTarget;
    for (const element of this.#captureCandidates()) {
      if (element.hasAttribute('data-pixelscope-overlay') || this.#suppressedElements.has(element)
        || element.closest(`[${FIXED_CAPTURE_ATTRIBUTE}]`) !== null) continue;
      if (scrollTarget !== null && composedContains(element, scrollTarget)) continue;
      // A captured element keeps its own content, but sticky parts of a captured scroller still tile once.
      if (captureTarget !== null && captureTarget !== scrollTarget
        && (composedContains(element, captureTarget) || composedContains(captureTarget, element))) continue;
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
    this.#viewportSnapshot.clear();
    this.#viewportSnapshotPosition = this.#targetPosition();
    const scrollTarget = this.#scrollTarget;
    for (const element of this.#captureCandidates()) {
      if (element.hasAttribute('data-pixelscope-overlay')) continue;
      if (scrollTarget !== null && composedContains(element, scrollTarget)) continue;
      const rect = viewportRect(element);
      if (intersectsViewport(rect)) this.#viewportSnapshot.set(element, rect);
    }
  }
  /**
   * Elements that may need hiding on later tiles. Inside a fixed overlay only that overlay matters;
   * an app-shell scroller can be covered by fixed page chrome, so the whole page is considered.
   */
  #captureCandidates(): HTMLElement[] {
    const root = this.#scrollTarget === null ? null : findViewportAttachedRoot(this.#scrollTarget);
    const ownerDocument = (this.#scrollTarget ?? this.#captureTarget)?.ownerDocument ?? document;
    return captureElements(root ?? ownerDocument.body);
  }
  #addListeners(): void {
    window.addEventListener('pointerdown', this.#onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', this.#onPointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', this.#onPointerCancel, { capture: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
    // `load` does not bubble, but a capturing window listener still sees every iframe's load event.
    window.addEventListener('load', this.#onFrameLoad, true);
  }
  /**
   * Pointer events over a same-origin iframe never reach this window, so each such frame gets the
   * same listeners and cursor. Frames that (re)load while the tool is active are picked up too.
   */
  #attachFrames(): void {
    const current = new Set(sameOriginFrameDocuments());
    for (const [frameDocument, style] of this.#frameDocuments) {
      if (current.has(frameDocument)) continue;
      style.remove();
      if (frameDocument.defaultView !== null) removeToolListeners(frameDocument.defaultView, this);
      this.#frameDocuments.delete(frameDocument);
    }
    for (const frameDocument of current) {
      const view = frameDocument.defaultView;
      if (this.#frameDocuments.has(frameDocument) || view === null) continue;
      const style = frameDocument.createElement('style');
      style.dataset.pixelscopeInteraction = '';
      style.textContent = INTERACTION_STYLE;
      frameDocument.documentElement.append(style);
      addToolListeners(view, this);
      this.#frameDocuments.set(frameDocument, style);
    }
  }
  #detachFrames(): void {
    for (const [frameDocument, style] of this.#frameDocuments) {
      style.remove();
      if (frameDocument.defaultView !== null) removeToolListeners(frameDocument.defaultView, this);
    }
    this.#frameDocuments.clear();
  }
  readonly #onFrameLoad = (event: Event): void => {
    if (event.target instanceof Element && isIframeElement(event.target)) this.#attachFrames();
  };
  get listeners(): ToolListeners {
    return {
      pointerdown: this.#onPointerDown, pointermove: this.#onPointerMove, pointerup: this.#onPointerUp,
      pointercancel: this.#onPointerCancel, click: this.#onClick, keydown: this.#onKeyDown,
    };
  }
  #removeListeners(): void {
    window.removeEventListener('pointerdown', this.#onPointerDown, true);
    window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('pointerup', this.#onPointerUp, true);
    window.removeEventListener('pointercancel', this.#onPointerCancel, true);
    window.removeEventListener('click', this.#onClick, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
    window.removeEventListener('load', this.#onFrameLoad, true);
  }
}

/**
 * When the document itself can't scroll (an app shell with a locked root, a modal that locks body
 * scroll, or a blog that renders the post in a full-window same-origin iframe), full-page capture
 * would otherwise scroll nothing and produce a single viewport. Pick the largest visible container
 * or frame document that actually scrolls vertically and tile through it instead.
 */
function findPageScroller(rootDocument: Document = document, depth = 0): HTMLElement | null {
  const body = rootDocument.querySelector('body');
  if (body === null) return null;
  const viewportArea = innerWidth * innerHeight;
  let best: HTMLElement | null = null;
  let bestArea = 0;
  // <body> itself is a candidate: `html { overflow: hidden }` + `body { overflow: auto }` scrolls the body.
  for (const element of [body, ...captureElements(body)]) {
    if (element.hasAttribute('data-pixelscope-overlay')) continue;
    const candidate = scrollCandidate(element, depth);
    if (candidate === null) continue;
    // A frame document's own scroll is measured by its <iframe>; anything else by the scroller itself.
    const box = candidate === candidate.ownerDocument.scrollingElement ? element : candidate;
    const rect = viewportRect(box);
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const width = Math.min(rect.right, innerWidth) - left;
    const height = Math.min(rect.bottom, innerHeight) - top;
    const area = Math.max(0, width) * Math.max(0, height);
    if (area < viewportArea * 0.3 || area <= bestArea) continue;
    // A scroller hidden behind a modal backdrop is not what the user is looking at.
    const hit = deepElementFromPoint({ x: left + width / 2, y: top + height / 2 });
    if (hit === null || !composedContains(box, hit)) continue;
    bestArea = area; best = candidate;
  }
  return best;
}

/**
 * What would scroll if this element were the page: an overflowing scroll box, or for a same-origin
 * iframe its document (or, when that document is locked like an app shell, the scroller inside it).
 */
function scrollCandidate(element: HTMLElement, depth: number): HTMLElement | null {
  if (isIframeElement(element)) {
    const frameDocument = accessibleFrameDocument(element);
    if (frameDocument === null) return null;
    return scrollableFrameRoot(element) ?? (depth < 4 ? findPageScroller(frameDocument, depth + 1) : null);
  }
  if (element.scrollHeight <= element.clientHeight + 2) return null;
  return SCROLLABLE_OVERFLOW.has(styleOf(element).overflowY) ? element : null;
}

/** For a same-origin iframe whose own document scrolls, that document's scrolling element. */
function scrollableFrameRoot(element: Element): HTMLElement | null {
  if (!isIframeElement(element)) return null;
  const frameDocument = accessibleFrameDocument(element);
  const view = frameDocument?.defaultView;
  const scroller = frameDocument?.scrollingElement;
  if (view == null || scroller == null || !isHtmlElement(scroller) || !isPageScrollable(view)) return null;
  return scroller;
}

function isScrollContainer(element: HTMLElement): boolean {
  if (element === element.ownerDocument.documentElement || element === element.ownerDocument.scrollingElement) return false;
  const style = styleOf(element);
  return (SCROLLABLE_OVERFLOW.has(style.overflowY) && element.scrollHeight > element.clientHeight + 2)
    || (SCROLLABLE_OVERFLOW.has(style.overflowX) && element.scrollWidth > element.clientWidth + 2);
}

/**
 * The nearest scroll container that hides part of the element, so capture can scroll it into view.
 * Inside a same-origin frame the frame's own document scroll counts too, and the search continues
 * outward through the <iframe> element into the parent document.
 */
function findClippingScroller(element: Element): HTMLElement | null {
  const bounds = viewportRect(element);
  let node: Element = element;
  for (let depth = 0; depth < 8; depth += 1) {
    const ownerDocument = node.ownerDocument;
    for (let current = composedParent(node); current !== null && current !== ownerDocument.documentElement; current = composedParent(current)) {
      if (isHtmlElement(current) && isScrollContainer(current) && clips(bounds, current)) return current;
    }
    const view = ownerDocument.defaultView;
    if (ownerDocument === document || view === null) return null;
    const frameScroller = ownerDocument.scrollingElement;
    if (frameScroller !== null && isHtmlElement(frameScroller) && isPageScrollable(view) && clips(bounds, frameScroller)) return frameScroller;
    const frame = view.frameElement;
    if (frame === null) return null;
    node = frame;
  }
  return null;
}

function clips(bounds: DOMRect, scroller: HTMLElement): boolean {
  const origin = clientOrigin(scroller);
  return bounds.left < origin.x - 1 || bounds.top < origin.y - 1
    || bounds.right > origin.x + scroller.clientWidth + 1 || bounds.bottom > origin.y + scroller.clientHeight + 1;
}

/**
 * Top-viewport position of the element's scrollport, inside its borders. A frame document's
 * scrolling element is that frame's viewport, which starts at the frame's content box.
 */
function clientOrigin(element: HTMLElement): CaptureScrollPosition {
  const offset = frameOffset(element.ownerDocument);
  if (element === element.ownerDocument.scrollingElement) return offset;
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left + element.clientLeft + offset.x, y: bounds.top + element.clientTop + offset.y };
}

interface ToolListeners {
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointermove: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
  readonly click: (event: MouseEvent) => void;
  readonly keydown: (event: KeyboardEvent) => void;
}

function addToolListeners(view: Window, controller: { readonly listeners: ToolListeners }): void {
  const { pointerdown, pointermove, pointerup, pointercancel, click, keydown } = controller.listeners;
  view.addEventListener('pointerdown', pointerdown, { capture: true, passive: false });
  view.addEventListener('pointermove', pointermove, { capture: true, passive: false });
  view.addEventListener('pointerup', pointerup, { capture: true, passive: false });
  view.addEventListener('pointercancel', pointercancel, { capture: true });
  view.addEventListener('click', click, { capture: true, passive: false });
  view.addEventListener('keydown', keydown, { capture: true, passive: false });
}

function removeToolListeners(view: Window, controller: { readonly listeners: ToolListeners }): void {
  const { pointerdown, pointermove, pointerup, pointercancel, click, keydown } = controller.listeners;
  view.removeEventListener('pointerdown', pointerdown, true);
  view.removeEventListener('pointermove', pointermove, true);
  view.removeEventListener('pointerup', pointerup, true);
  view.removeEventListener('pointercancel', pointercancel, true);
  view.removeEventListener('click', click, true);
  view.removeEventListener('keydown', keydown, true);
}

function isFromFrame(event: Event): boolean {
  return event.target instanceof Node && event.target.ownerDocument !== null && event.target.ownerDocument !== document;
}

function findViewportAttachedRoot(element: HTMLElement): HTMLElement | null {
  // Walk through shadow hosts too, so a fixed custom-element dialog still counts as an overlay.
  for (let current: Element | null = element; current !== null; current = composedParent(current)) {
    const position = styleOf(current).position;
    if ((position === 'fixed' || position === 'sticky') && isHtmlElement(current)) return current;
  }
  return null;
}

/**
 * scrollHeight isn't affected by `overflow: hidden`, so it can't tell us whether the page
 * actually scrolls (a common scroll-lock pattern used behind modal dialogs). Probe it directly.
 */
/**
 * chrome.runtime.sendMessage throws synchronously (not a rejected promise) once the extension
 * context is invalidated (e.g. the extension was reloaded while this page is still open), so a
 * plain `.catch()` can't protect a call made from outside an async function — wrap it here too.
 */
function notifyCaptureCancel(): void {
  try { void chrome.runtime.sendMessage({ type: 'CAPTURE_CANCEL' } satisfies ExtensionMessage).catch(() => undefined); }
  catch { /* Extension context invalidated; nothing to cancel on the other end. */ }
}

function isPageScrollable(view: Window = window): boolean {
  const viewDocument = view.document;
  const scrolling = viewDocument.scrollingElement ?? viewDocument.documentElement;
  if (scrolling.scrollHeight <= viewDocument.documentElement.clientHeight + 2) return false;
  const originalY = view.scrollY;
  view.scrollTo(view.scrollX, originalY + 1);
  const moved = view.scrollY !== originalY;
  view.scrollTo(view.scrollX, originalY);
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
  const style = styleOf(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const rect = viewportRect(element);
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
function captureElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const visit = (root: ParentNode): void => {
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element.hasAttribute('data-pixelscope-overlay')) continue;
      elements.push(element);
      if (element.shadowRoot !== null) visit(element.shadowRoot);
    }
  };
  visit(root);
  return elements;
}
