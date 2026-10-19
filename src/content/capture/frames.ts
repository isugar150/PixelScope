import type { Point } from '../coordinate';

/**
 * Same-origin iframe support for capture. Blog platforms such as Naver render the whole post in a
 * full-window same-origin iframe, so pointer events, hit testing and scrolling all happen inside
 * that frame's document while this content script only runs in the top frame. Everything here
 * translates between a frame's own viewport and the top viewport that captureVisibleTab() sees.
 */

/** Top-viewport position of a frame's content box, given its border-box rect, border and padding. */
export function frameContentOrigin(
  frameRect: { readonly left: number; readonly top: number },
  border: { readonly left: number; readonly top: number },
  padding: { readonly left: number; readonly top: number },
): Point {
  return { x: frameRect.left + border.left + padding.left, y: frameRect.top + border.top + padding.top };
}

export function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** The frame's document when it is same-origin and loaded; cross-origin frames stay opaque. */
export function accessibleFrameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    const frameDocument = frame.contentDocument;
    return frameDocument?.documentElement == null ? null : frameDocument;
  } catch {
    return null;
  }
}

/** Offset that converts `ownerDocument` viewport coordinates into top-viewport coordinates. */
export function frameOffset(ownerDocument: Document): Point {
  let offset = { x: 0, y: 0 };
  let current: Document = ownerDocument;
  while (current !== document) {
    const frame = current.defaultView?.frameElement;
    if (frame == null) break;
    const style = styleOf(frame);
    offset = addPoints(offset, frameContentOrigin(
      frame.getBoundingClientRect(),
      { left: frame.clientLeft, top: frame.clientTop },
      { left: parseFloat(style.paddingLeft) || 0, top: parseFloat(style.paddingTop) || 0 },
    ));
    current = frame.ownerDocument;
  }
  return offset;
}

/** Bounding rect of any element, including one inside a same-origin frame, in top-viewport pixels. */
export function viewportRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  const offset = frameOffset(element.ownerDocument);
  return new DOMRect(rect.left + offset.x, rect.top + offset.y, rect.width, rect.height);
}

/**
 * Hit test that descends into same-origin iframes and open shadow roots instead of stopping at the
 * <iframe> element or the shadow host.
 */
export function deepElementFromPoint(point: Point): Element | null {
  let currentDocument: Document = document;
  let local = point;
  for (let depth = 0; depth < 8; depth += 1) {
    const hit = descendShadowRoots(currentDocument.elementFromPoint(local.x, local.y), local);
    if (hit === null || !isIframeElement(hit)) return hit;
    const frameDocument = accessibleFrameDocument(hit);
    if (frameDocument === null) return hit;
    const origin = frameOffset(frameDocument);
    local = { x: point.x - origin.x, y: point.y - origin.y };
    currentDocument = frameDocument;
  }
  return null;
}

function descendShadowRoots(hit: Element | null, point: Point): Element | null {
  let current = hit;
  for (let depth = 0; current?.shadowRoot != null && depth < 16; depth += 1) {
    const inner = current.shadowRoot.elementFromPoint(point.x, point.y);
    if (inner === null || inner === current) break;
    current = inner;
  }
  return current;
}

/** Parent element across shadow-root boundaries (but not out of a frame's document). */
export function composedParent(element: Element): Element | null {
  if (element.parentElement !== null) return element.parentElement;
  const root = element.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

/** `contains()` that also looks through shadow roots and same-origin frame boundaries. */
export function composedContains(ancestor: Element, node: Element): boolean {
  let current: Element | null = node;
  for (let depth = 0; current !== null && depth < 512; depth += 1) {
    if (current === ancestor) return true;
    current = composedParent(current) ?? current.ownerDocument.defaultView?.frameElement ?? null;
  }
  return false;
}

/** Every reachable same-origin frame document below `root`, nested frames included. */
export function sameOriginFrameDocuments(root: Document = document): Document[] {
  const documents: Document[] = [];
  for (const frame of root.querySelectorAll('iframe')) {
    const frameDocument = accessibleFrameDocument(frame);
    if (frameDocument === null) continue;
    documents.push(frameDocument, ...sameOriginFrameDocuments(frameDocument));
  }
  return documents;
}

/** Converts a pointer event from any same-origin frame into top-viewport coordinates. */
export function eventViewportPoint(event: MouseEvent): Point {
  const target = event.target;
  const ownerDocument = target instanceof Node ? (target.ownerDocument ?? (isDocument(target) ? target : document)) : document;
  return addPoints({ x: event.clientX, y: event.clientY }, frameOffset(ownerDocument));
}

/** `instanceof HTMLElement` is false for nodes from another frame's realm; check against their own. */
export function isHtmlElement(node: Element): node is HTMLElement {
  const view = node.ownerDocument.defaultView;
  return node instanceof HTMLElement || (view !== null && node instanceof view.HTMLElement);
}

export function isIframeElement(node: Element): node is HTMLIFrameElement {
  const view = node.ownerDocument.defaultView;
  return node instanceof HTMLIFrameElement || (view !== null && node instanceof view.HTMLIFrameElement);
}

export function styleOf(element: Element): CSSStyleDeclaration {
  return (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node;
}

function isDocument(node: Node): node is Document {
  return node.nodeType === Node.DOCUMENT_NODE;
}
