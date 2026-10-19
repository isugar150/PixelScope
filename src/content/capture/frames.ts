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

/** Hit test that descends into same-origin iframes instead of stopping at the <iframe> element. */
export function deepElementFromPoint(point: Point): Element | null {
  let currentDocument: Document = document;
  let local = point;
  for (let depth = 0; depth < 8; depth += 1) {
    const hit = currentDocument.elementFromPoint(local.x, local.y);
    if (hit === null || !isIframeElement(hit)) return hit;
    const frameDocument = accessibleFrameDocument(hit);
    if (frameDocument === null) return hit;
    const origin = frameOffset(frameDocument);
    local = { x: point.x - origin.x, y: point.y - origin.y };
    currentDocument = frameDocument;
  }
  return null;
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

function isDocument(node: Node): node is Document {
  return node.nodeType === Node.DOCUMENT_NODE;
}
