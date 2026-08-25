import { calculateAutoScroll, documentRectToViewport, rectangleFromPoints, viewportToDocument, type Point } from './coordinate';
import type { MeasurementUnit } from '../shared/tool-state';
import { captureVisibleTab, CaptureManager, nextPaint } from './color-picker/capture-manager';
import { getCaptureViewport, PixelSampler } from './color-picker/pixel-sampler';
import { findInspectableElement, formatMeasurement, isAreaDrag, isInspectableElement } from './measure-utils';
import { MeasurementOverlay } from './overlay';
import { interactionStyles } from './styles';

type MeasureInteractionState =
  | { readonly type: 'idle' }
  | { readonly type: 'hovering'; readonly element: Element }
  | { readonly type: 'pointer-pending'; readonly element: Element | null; readonly startViewport: Point; readonly startDocument: Point; readonly pointerId: number; readonly pointerType: string }
  | { readonly type: 'element-locked'; readonly element: Element }
  | { readonly type: 'area-dragging'; readonly start: Point; readonly current: Point; readonly pointerId: number }
  | { readonly type: 'area-locked'; readonly start: Point; readonly end: Point };

export class MeasureController {
  readonly #onExit: () => void;
  #overlay: MeasurementOverlay | null = null;
  #interactionStyle: HTMLStyleElement | null = null;
  #sampler: PixelSampler | null = null;
  #capture: CaptureManager | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #state: MeasureInteractionState = { type: 'idle' };
  #active = false;
  #lastViewport: Point | null = null;
  #frameId: number | null = null;
  #measurementUnit: MeasurementUnit = 'px';

  public constructor(onExit: () => void = () => this.disable()) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public async enable(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    const settings = await chrome.storage.local.get({ measurementUnit: 'px' });
    this.#measurementUnit = isStoredMeasurementUnit(settings.measurementUnit) ? settings.measurementUnit : 'px';
    this.#overlay = new MeasurementOverlay();
    this.#interactionStyle = document.createElement('style');
    this.#interactionStyle.dataset.pixelscopeInteraction = '';
    this.#interactionStyle.textContent = interactionStyles;
    document.documentElement.append(this.#interactionStyle);
    this.#setTouchDragEnabled(true);
    this.#sampler = new PixelSampler();
    this.#capture = new CaptureManager({
      capture: captureVisibleTab,
      load: (dataUrl) => this.#sampler?.load(dataUrl) ?? Promise.resolve(),
      beforeCapture: async () => { this.#overlay?.setCaptureHidden(true); await nextPaint(); },
      afterCapture: () => this.#overlay?.setCaptureHidden(false),
    });
    void this.#capture.refresh().catch(() => undefined);
    this.#addListeners();
  }

  public disable(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#releasePointer();
    this.#disconnectObserver();
    this.#removeListeners();
    this.#cancelFrame();
    this.#capture?.destroy(); this.#capture = null; this.#sampler = null;
    this.#overlay?.destroy(); this.#overlay = null;
    this.#interactionStyle?.remove(); this.#interactionStyle = null;
    this.#setTouchDragEnabled(false);
    this.#state = { type: 'idle' }; this.#lastViewport = null;
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || !isSupportedPointer(event.pointerType) || event.button !== 0) return;
    if (this.#state.type === 'element-locked' || this.#state.type === 'area-locked') return;
    if (event.pointerType !== 'touch') { event.preventDefault(); event.stopImmediatePropagation(); }
    const viewport = { x: event.clientX, y: event.clientY };
    this.#lastViewport = viewport;
    this.#disconnectObserver();
    this.#state = {
      type: 'pointer-pending',
      element: this.#elementAt(viewport),
      startViewport: viewport,
      startDocument: this.#toDocument(viewport),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    };
    if (event.pointerType !== 'touch') this.#overlay?.capturePointer(event.pointerId);
    this.#ensureFrame();
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (!event.isPrimary || !isSupportedPointer(event.pointerType)) return;
    const activePointerId = this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging' ? this.#state.pointerId : null;
    if (event.pointerType !== 'mouse' && activePointerId !== event.pointerId) return;
    this.#lastViewport = { x: event.clientX, y: event.clientY };
    if (this.#state.type === 'pointer-pending' && this.#state.pointerType === 'touch' && isAreaDrag(this.#state.startViewport, this.#lastViewport)) {
      this.#state = { type: 'idle' };
      this.#overlay?.hideMeasurement();
      return;
    }
    if (this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging') {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    this.#ensureFrame();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (!event.isPrimary || !isSupportedPointer(event.pointerType) || event.button !== 0) return;
    if (this.#state.type !== 'pointer-pending' && this.#state.type !== 'area-dragging') return;
    if (this.#state.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.#lastViewport = { x: event.clientX, y: event.clientY };
    if (this.#state.type === 'pointer-pending') {
      if (this.#state.pointerType !== 'touch' && isAreaDrag(this.#state.startViewport, this.#lastViewport)) {
        this.#state = { type: 'area-locked', start: this.#state.startDocument, end: this.#toDocument(this.#lastViewport) };
        this.#lockSelection();
      } else {
        const element = this.#state.element;
        this.#state = element === null ? { type: 'idle' } : { type: 'element-locked', element };
        if (element !== null) this.#observe(element);
        if (element !== null) this.#lockSelection();
      }
    } else {
      this.#state = { type: 'area-locked', start: this.#state.start, end: this.#toDocument(this.#lastViewport) };
      this.#lockSelection();
    }
    if (event.pointerType !== 'touch') this.#overlay?.releasePointer(event.pointerId);
    this.#render();
    this.#cancelFrame();
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (this.#state.type !== 'pointer-pending' && this.#state.type !== 'area-dragging') return;
    this.#overlay?.releasePointer(event.pointerId);
    this.#state = { type: 'idle' };
    this.#setTouchDragEnabled(true);
    this.#ensureFrame();
  };

  readonly #onClick = (event: MouseEvent): void => {
    if (event.button === 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  };

  readonly #onViewportChange = (): void => {
    if (this.#state.type !== 'element-locked' && this.#state.type !== 'area-locked') this.#capture?.schedule();
    this.#ensureFrame();
  };
  readonly #onBlur = (): void => {
    if (this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging') { this.#state = { type: 'idle' }; this.#setTouchDragEnabled(true); }
    this.#releasePointer(); this.#ensureFrame();
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.#state.type === 'element-locked' || this.#state.type === 'area-locked') {
        this.#disconnectObserver();
        this.#state = { type: 'idle' };
        this.#setTouchDragEnabled(true);
        this.#overlay?.hideMeasurement();
        this.#capture?.schedule();
        return;
      }
      this.#onExit(); return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const element = this.#state.type === 'hovering' ? this.#state.element : null;
    if (element === null) return;
    const next = event.key === 'ArrowUp'
      ? findInspectableElement(element.parentElement, this.#overlay?.host)
      : Array.from(element.children).find((child) => isInspectableElement(child, this.#overlay?.host)) ?? null;
    if (next === null) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.#state = { type: 'hovering', element: next };
    this.#ensureFrame();
  };
  readonly #preventInteraction = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation(); };

  readonly #tick = (): void => {
    this.#frameId = null;
    if (!this.#active || this.#lastViewport === null) return;
    if (this.#state.type === 'pointer-pending' && this.#state.pointerType !== 'touch' && isAreaDrag(this.#state.startViewport, this.#lastViewport)) {
      this.#state = { type: 'area-dragging', start: this.#state.startDocument, current: this.#toDocument(this.#lastViewport), pointerId: this.#state.pointerId };
      this.#overlay?.hideMeasurement();
    }
    if (this.#state.type === 'area-dragging') {
      const delta = calculateAutoScroll(this.#lastViewport, { width: innerWidth, height: innerHeight });
      if (delta.x !== 0 || delta.y !== 0) window.scrollBy(delta.x, delta.y);
      this.#state = { ...this.#state, current: this.#toDocument(this.#lastViewport) };
    } else if (this.#state.type === 'idle' || this.#state.type === 'hovering') {
      const element = this.#elementAt(this.#lastViewport);
      this.#state = element === null ? { type: 'idle' } : { type: 'hovering', element };
    }
    this.#render();
    if (this.#state.type === 'area-dragging') this.#ensureFrame();
  };

  #render(): void {
    if (this.#lastViewport === null) return;
    const selectionLocked = this.#state.type === 'element-locked' || this.#state.type === 'area-locked';
    if (selectionLocked) this.#overlay?.hidePointerAids();
    else this.#overlay?.renderCrosshair(this.#lastViewport);
    let measurement: string | undefined;
    if (this.#state.type === 'hovering' || this.#state.type === 'element-locked') {
      if (!this.#state.element.isConnected) { this.#disconnectObserver(); this.#state = { type: 'idle' }; this.#setTouchDragEnabled(true); this.#overlay?.hideMeasurement(); }
      else {
        this.#overlay?.renderElement(this.#state.element, this.#state.type === 'element-locked', this.#measurementUnit);
        const rect = this.#state.element.getBoundingClientRect(); measurement = formatMeasurement(rect.width, rect.height, this.#measurementUnit);
      }
    } else if (this.#state.type === 'area-dragging' || this.#state.type === 'area-locked') {
      const end = this.#state.type === 'area-dragging' ? this.#state.current : this.#state.end;
      const documentRect = rectangleFromPoints(this.#state.start, end);
      const viewportRect = documentRectToViewport(documentRect, { x: scrollX, y: scrollY });
      this.#overlay?.renderArea(viewportRect, this.#state.start, end, this.#measurementUnit);
      measurement = formatMeasurement(documentRect.width, documentRect.height, this.#measurementUnit);
    } else if (this.#state.type === 'idle') this.#overlay?.hideMeasurement();
    if (!selectionLocked) this.#overlay?.renderMagnifier(this.#lastViewport, this.#sampler, getCaptureViewport(), measurement);
  }

  #elementAt(point: Point): Element | null { return findInspectableElement(document.elementFromPoint(point.x, point.y), this.#overlay?.host); }
  #toDocument(point: Point): Point { return viewportToDocument(point, { x: scrollX, y: scrollY }); }
  #observe(element: Element): void {
    this.#disconnectObserver();
    this.#resizeObserver = new ResizeObserver(() => this.#ensureFrame());
    this.#resizeObserver.observe(element);
  }
  #disconnectObserver(): void { this.#resizeObserver?.disconnect(); this.#resizeObserver = null; }
  #setTouchDragEnabled(enabled: boolean): void {
    document.documentElement.toggleAttribute('data-pixelscope-touch-drag', enabled);
  }
  #lockSelection(): void {
    this.#capture?.cancelScheduled();
    this.#setTouchDragEnabled(false);
  }
  #releasePointer(): void {
    if (this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging') this.#overlay?.releasePointer(this.#state.pointerId);
  }
  #ensureFrame(): void { if (this.#frameId === null) this.#frameId = requestAnimationFrame(this.#tick); }
  #cancelFrame(): void { if (this.#frameId !== null) cancelAnimationFrame(this.#frameId); this.#frameId = null; }

  #addListeners(): void {
    window.addEventListener('pointerdown', this.#onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', this.#onPointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', this.#onPointerCancel, { capture: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('scroll', this.#onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.#onViewportChange, { passive: true });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
    window.addEventListener('blur', this.#onBlur);
    window.addEventListener('dragstart', this.#preventInteraction, { capture: true, passive: false });
    window.addEventListener('selectstart', this.#preventInteraction, { capture: true, passive: false });
  }
  #removeListeners(): void {
    window.removeEventListener('pointerdown', this.#onPointerDown, true); window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('pointerup', this.#onPointerUp, true); window.removeEventListener('pointercancel', this.#onPointerCancel, true);
    window.removeEventListener('click', this.#onClick, true); window.removeEventListener('scroll', this.#onViewportChange, true);
    window.removeEventListener('resize', this.#onViewportChange); window.removeEventListener('keydown', this.#onKeyDown, true);
    window.removeEventListener('blur', this.#onBlur); window.removeEventListener('dragstart', this.#preventInteraction, true);
    window.removeEventListener('selectstart', this.#preventInteraction, true);
  }
}

function isSupportedPointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen';
}

function isStoredMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'px' || value === 'rem' || value === 'viewport';
}
