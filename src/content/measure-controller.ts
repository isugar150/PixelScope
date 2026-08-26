import { calculateAutoScroll, documentRectToViewport, isPointInsideRect, rectangleFromPoints, viewportToDocument, type Point, type Rect } from './coordinate';
import type { MeasurementUnit } from '../shared/tool-state';
import { captureVisibleTab, CaptureManager, nextPaint } from './color-picker/capture-manager';
import { getCaptureViewport, PixelSampler } from './color-picker/pixel-sampler';
import { captureScrollSnapshot, findInspectableElement, formatMeasurement, isAreaDrag, isInspectableElement, resolveAreaViewportRect, type ScrollSnapshot } from './measure-utils';
import { MeasurementOverlay, type SavedMeasurement } from './overlay';
import { interactionStyles } from './styles';

type MeasureInteractionState =
  | { readonly type: 'idle' }
  | { readonly type: 'hovering'; readonly element: Element }
  | { readonly type: 'pointer-pending'; readonly element: Element | null; readonly toggleIndex: number | null; readonly startViewport: Point; readonly startDocument: Point; readonly pointerId: number; readonly pointerType: string }
  | { readonly type: 'area-dragging'; readonly start: Point; readonly current: Point; readonly pointerId: number }
  | { readonly type: 'area-moving'; readonly index: number; readonly originRect: Rect; readonly startDocument: Point; readonly current: Point; readonly pointerId: number };

type SavedMeasurementState =
  | { readonly type: 'element'; readonly element: Element }
  | { readonly type: 'area'; readonly viewportRect: Rect; readonly scrollSnapshot: ScrollSnapshot };

export class MeasureController {
  readonly #onExit: () => void;
  #overlay: MeasurementOverlay | null = null;
  #interactionStyle: HTMLStyleElement | null = null;
  #sampler: PixelSampler | null = null;
  #capture: CaptureManager | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #state: MeasureInteractionState = { type: 'idle' };
  #active = false;
  #selecting = false;
  #lastViewport: Point | null = null;
  #frameId: number | null = null;
  #measurementUnit: MeasurementUnit = 'px';
  #showCoordinates = false;
  #showBoxModel = false;
  #savedMeasurements: SavedMeasurementState[] = [];

  public constructor(onExit: () => void = () => this.disable()) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public async enable(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    this.#selecting = true;
    const settings = await chrome.storage.local.get({ measurementUnit: 'px', showMeasurementCoordinates: false, showBoxModel: false });
    this.#measurementUnit = isStoredMeasurementUnit(settings.measurementUnit) ? settings.measurementUnit : 'px';
    this.#showCoordinates = settings.showMeasurementCoordinates === true;
    this.#showBoxModel = settings.showBoxModel === true;
    this.#overlay = new MeasurementOverlay();
    this.#overlay.showSelectionGuide();
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
    this.#addBaseListeners();
    this.#addInteractionListeners();
  }

  public disable(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#selecting = false;
    this.#releasePointer();
    this.#disconnectObserver();
    this.#removeInteractionListeners();
    this.#removeBaseListeners();
    this.#cancelFrame();
    this.#capture?.destroy(); this.#capture = null; this.#sampler = null;
    this.#overlay?.destroy(); this.#overlay = null;
    this.#interactionStyle?.remove(); this.#interactionStyle = null;
    this.#setTouchDragEnabled(false);
    this.#setHoverMoveCursor(false);
    this.#state = { type: 'idle' }; this.#lastViewport = null;
    this.#savedMeasurements = [];
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || !isSupportedPointer(event.pointerType) || event.button !== 0) return;
    if (event.pointerType !== 'touch') { event.preventDefault(); event.stopImmediatePropagation(); }
    const viewport = { x: event.clientX, y: event.clientY };
    const element = this.#elementAt(viewport);
    this.#lastViewport = viewport;
    this.#state = {
      type: 'pointer-pending',
      element,
      toggleIndex: this.#toggleMeasurementAt(viewport, element),
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
    this.#overlay?.moveSelectionGuideAwayFrom(this.#lastViewport);
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
    if (this.#state.type !== 'pointer-pending' && this.#state.type !== 'area-dragging' && this.#state.type !== 'area-moving') return;
    if (this.#state.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.#lastViewport = { x: event.clientX, y: event.clientY };
    if (this.#state.type === 'pointer-pending') {
      if (this.#state.pointerType !== 'touch' && isAreaDrag(this.#state.startViewport, this.#lastViewport)) {
        this.#saveArea(this.#state.startDocument, this.#toDocument(this.#lastViewport));
      } else {
        if (this.#state.toggleIndex === null) {
          const element = this.#state.element;
          if (element !== null) this.#saveElement(element);
        } else this.#removeMeasurement(this.#state.toggleIndex);
      }
    } else if (this.#state.type === 'area-dragging') {
      this.#saveArea(this.#state.start, this.#toDocument(this.#lastViewport));
    } else {
      this.#moveArea(this.#state.index, this.#state.originRect, this.#state.startDocument, this.#toDocument(this.#lastViewport));
    }
    this.#state = { type: 'idle' };
    if (event.pointerType !== 'touch') this.#overlay?.releasePointer(event.pointerId);
    this.#render();
    this.#cancelFrame();
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (this.#state.type !== 'pointer-pending' && this.#state.type !== 'area-dragging' && this.#state.type !== 'area-moving') return;
    this.#overlay?.releasePointer(event.pointerId);
    this.#state = { type: 'idle' };
    this.#setTouchDragEnabled(true);
    this.#ensureFrame();
  };

  readonly #onClick = (event: MouseEvent): void => {
    if (event.button === 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  };

  readonly #onViewportChange = (): void => {
    if (this.#selecting) this.#capture?.schedule();
    this.#ensureFrame();
  };
  readonly #onBlur = (): void => {
    if (this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging' || this.#state.type === 'area-moving') { this.#state = { type: 'idle' }; this.#setTouchDragEnabled(true); }
    this.#releasePointer(); this.#ensureFrame();
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.#selecting) this.#exitSelectionMode();
      else this.#onExit();
      return;
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
    if (!this.#selecting) {
      this.#pruneSavedMeasurements();
      this.#renderSavedMeasurements();
      return;
    }
    if (this.#state.type === 'pointer-pending' && this.#state.pointerType !== 'touch' && isAreaDrag(this.#state.startViewport, this.#lastViewport)) {
      const toggleIndex = this.#state.toggleIndex;
      const movingArea = toggleIndex === null ? null : this.#savedMeasurements[toggleIndex];
      if (movingArea?.type === 'area' && toggleIndex !== null) {
        const liveRect = resolveAreaViewportRect(movingArea);
        const origin = this.#toDocument({ x: liveRect.left, y: liveRect.top });
        this.#state = { type: 'area-moving', index: toggleIndex, originRect: { ...liveRect, left: origin.x, top: origin.y }, startDocument: this.#state.startDocument, current: this.#toDocument(this.#lastViewport), pointerId: this.#state.pointerId };
      } else {
        this.#state = { type: 'area-dragging', start: this.#state.startDocument, current: this.#toDocument(this.#lastViewport), pointerId: this.#state.pointerId };
      }
      this.#overlay?.hideMeasurement();
    }
    if (this.#state.type === 'area-dragging' || this.#state.type === 'area-moving') {
      const delta = calculateAutoScroll(this.#lastViewport, { width: innerWidth, height: innerHeight });
      if (delta.x !== 0 || delta.y !== 0) window.scrollBy(delta.x, delta.y);
      this.#state = { ...this.#state, current: this.#toDocument(this.#lastViewport) };
    } else if (this.#state.type === 'idle' || this.#state.type === 'hovering') {
      const element = this.#hoverElementAt(this.#lastViewport);
      this.#state = element === null ? { type: 'idle' } : { type: 'hovering', element };
      this.#setHoverMoveCursor(element === null && this.#isOverSavedArea(this.#lastViewport));
    }
    this.#render();
    if (this.#state.type === 'area-dragging' || this.#state.type === 'area-moving') this.#ensureFrame();
  };

  #render(): void {
    if (this.#lastViewport === null) return;
    this.#pruneSavedMeasurements();
    this.#renderSavedMeasurements();
    this.#overlay?.renderCrosshair(this.#lastViewport);
    let measurement: string | undefined;
    if (this.#state.type === 'hovering') {
      if (!this.#state.element.isConnected) { this.#state = { type: 'idle' }; this.#overlay?.hideMeasurement(); }
      else {
        this.#overlay?.renderElement(this.#state.element, this.#measurementUnit, this.#showBoxModel);
        const rect = this.#state.element.getBoundingClientRect(); measurement = formatMeasurement(rect.width, rect.height, this.#measurementUnit);
      }
    } else if (this.#state.type === 'area-dragging') {
      const end = this.#state.current;
      const documentRect = rectangleFromPoints(this.#state.start, end);
      const viewportRect = documentRectToViewport(documentRect, { x: scrollX, y: scrollY });
      this.#overlay?.renderArea(viewportRect, this.#measurementUnit, this.#showCoordinates);
      measurement = formatMeasurement(documentRect.width, documentRect.height, this.#measurementUnit);
    } else if (this.#state.type === 'area-moving') {
      measurement = formatMeasurement(this.#state.originRect.width, this.#state.originRect.height, this.#measurementUnit);
    } else if (this.#state.type === 'idle') this.#overlay?.hideMeasurement();
    this.#overlay?.renderMagnifier(this.#lastViewport, this.#sampler, getCaptureViewport(), measurement);
  }

  #elementAt(point: Point): Element | null { return findInspectableElement(document.elementFromPoint(point.x, point.y), this.#overlay?.host); }
  #hoverElementAt(point: Point): Element | null {
    const element = this.#elementAt(point);
    if (element !== null && this.#savedMeasurements.some((measurement) => measurement.type === 'element' && measurement.element === element)) return null;
    if (element !== null && this.#savedMeasurements.some((measurement) => measurement.type === 'element' && measurement.element.contains(element))) return element;
    return this.#isOverSavedArea(point) ? null : element;
  }
  #toggleMeasurementAt(point: Point, element: Element | null): number | null {
    const elementIndex = element === null ? -1 : this.#savedMeasurements.findIndex((measurement) => measurement.type === 'element' && measurement.element === element);
    if (elementIndex >= 0) return elementIndex;
    if (element !== null && this.#savedMeasurements.some((measurement) => measurement.type === 'element' && measurement.element.contains(element))) return null;
    for (let index = this.#savedMeasurements.length - 1; index >= 0; index -= 1) {
      const measurement = this.#savedMeasurements[index];
      if (measurement?.type === 'area' && isPointInsideRect(point, resolveAreaViewportRect(measurement))) return index;
    }
    return null;
  }
  #toDocument(point: Point): Point { return viewportToDocument(point, { x: scrollX, y: scrollY }); }
  #saveElement(element: Element): void {
    this.#savedMeasurements.push({ type: 'element', element });
    this.#observe(element);
  }
  #saveArea(start: Point, end: Point): void {
    const viewportRect = documentRectToViewport(rectangleFromPoints(start, end), { x: scrollX, y: scrollY });
    this.#savedMeasurements.push({ type: 'area', viewportRect, scrollSnapshot: captureScrollSnapshot(rectCenter(viewportRect), this.#overlay?.host) });
  }
  #moveArea(index: number, originRect: Rect, start: Point, end: Point): void {
    const measurement = this.#savedMeasurements[index];
    if (measurement?.type !== 'area') return;
    const viewportRect = documentRectToViewport(offsetRect(originRect, end, start), { x: scrollX, y: scrollY });
    this.#savedMeasurements[index] = { type: 'area', viewportRect, scrollSnapshot: captureScrollSnapshot(rectCenter(viewportRect), this.#overlay?.host) };
  }
  #isOverSavedArea(viewport: Point): boolean {
    return this.#savedMeasurements.some((measurement) => measurement.type === 'area' && isPointInsideRect(viewport, resolveAreaViewportRect(measurement)));
  }
  #setHoverMoveCursor(enabled: boolean): void {
    document.documentElement.toggleAttribute('data-pixelscope-hover-move', enabled);
  }
  #removeMeasurement(index: number): void {
    const measurement = this.#savedMeasurements[index];
    if (measurement?.type === 'element') this.#resizeObserver?.unobserve(measurement.element);
    this.#savedMeasurements.splice(index, 1);
  }
  #observe(element: Element): void {
    this.#resizeObserver ??= new ResizeObserver(() => this.#ensureFrame());
    this.#resizeObserver.observe(element);
  }
  #pruneSavedMeasurements(): void {
    this.#savedMeasurements = this.#savedMeasurements.filter((measurement) => measurement.type === 'area' || measurement.element.isConnected);
  }
  #renderSavedMeasurements(): void {
    const movingState = this.#state.type === 'area-moving' ? this.#state : null;
    const viewportMeasurements = this.#savedMeasurements.map((measurement, index): SavedMeasurement => {
      if (measurement.type !== 'area') return measurement;
      if (index === movingState?.index) {
        const documentRect = offsetRect(movingState.originRect, movingState.current, movingState.startDocument);
        return { type: 'area', rect: documentRectToViewport(documentRect, { x: scrollX, y: scrollY }) };
      }
      return { type: 'area', rect: resolveAreaViewportRect(measurement) };
    });
    this.#overlay?.renderSavedMeasurements(viewportMeasurements, this.#measurementUnit, this.#showCoordinates);
  }
  #disconnectObserver(): void { this.#resizeObserver?.disconnect(); this.#resizeObserver = null; }
  #setTouchDragEnabled(enabled: boolean): void {
    document.documentElement.toggleAttribute('data-pixelscope-touch-drag', enabled);
  }
  #releasePointer(): void {
    if (this.#state.type === 'pointer-pending' || this.#state.type === 'area-dragging' || this.#state.type === 'area-moving') this.#overlay?.releasePointer(this.#state.pointerId);
  }
  #ensureFrame(): void { if (this.#frameId === null) this.#frameId = requestAnimationFrame(this.#tick); }
  #cancelFrame(): void { if (this.#frameId !== null) cancelAnimationFrame(this.#frameId); this.#frameId = null; }

  #exitSelectionMode(): void {
    this.#selecting = false;
    this.#releasePointer();
    this.#state = { type: 'idle' };
    this.#removeInteractionListeners();
    this.#cancelFrame();
    this.#capture?.destroy(); this.#capture = null; this.#sampler = null;
    this.#interactionStyle?.remove(); this.#interactionStyle = null;
    this.#setTouchDragEnabled(false);
    this.#setHoverMoveCursor(false);
    this.#overlay?.hideMeasurement();
    this.#overlay?.hidePointerAids();
    this.#overlay?.hideSelectionGuide();
    this.#pruneSavedMeasurements();
    this.#renderSavedMeasurements();
  }

  #addBaseListeners(): void {
    window.addEventListener('scroll', this.#onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.#onViewportChange, { passive: true });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, passive: false });
  }
  #removeBaseListeners(): void {
    window.removeEventListener('scroll', this.#onViewportChange, true);
    window.removeEventListener('resize', this.#onViewportChange);
    window.removeEventListener('keydown', this.#onKeyDown, true);
  }
  #addInteractionListeners(): void {
    window.addEventListener('pointerdown', this.#onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', this.#onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', this.#onPointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', this.#onPointerCancel, { capture: true });
    window.addEventListener('click', this.#onClick, { capture: true, passive: false });
    window.addEventListener('blur', this.#onBlur);
    window.addEventListener('dragstart', this.#preventInteraction, { capture: true, passive: false });
    window.addEventListener('selectstart', this.#preventInteraction, { capture: true, passive: false });
  }
  #removeInteractionListeners(): void {
    window.removeEventListener('pointerdown', this.#onPointerDown, true); window.removeEventListener('pointermove', this.#onPointerMove, true);
    window.removeEventListener('pointerup', this.#onPointerUp, true); window.removeEventListener('pointercancel', this.#onPointerCancel, true);
    window.removeEventListener('click', this.#onClick, true); window.removeEventListener('blur', this.#onBlur);
    window.removeEventListener('dragstart', this.#preventInteraction, true);
    window.removeEventListener('selectstart', this.#preventInteraction, true);
  }
}

function offsetRect(rect: Rect, current: Point, start: Point): Rect {
  return { ...rect, left: rect.left + (current.x - start.x), top: rect.top + (current.y - start.y) };
}

function rectCenter(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function isSupportedPointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen';
}

function isStoredMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'px' || value === 'rem' || value === 'viewport';
}
