import type { CssResourceBaseline, DevtoolsCssBaseline } from '../shared/css-baseline';

const MAX_BASELINE_CHARACTERS = 650_000;
const CSS_BASELINE_STORAGE_PREFIX = 'pixelscope:css-baseline:';
let captureSequence = 0;
let captureStopped = false;

const onNavigated = (url: string): void => scheduleBaselineCapture(url);
const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  if (!isExtensionContextInvalidated(event.reason)) return;
  event.preventDefault();
  stopBaselineCapture();
};

window.addEventListener('unhandledrejection', onUnhandledRejection);
startBaselineCapture();

function startBaselineCapture(): void {
  try {
    chrome.devtools.network.onNavigated.addListener(onNavigated);
    scheduleBaselineCapture('');
  } catch (error: unknown) {
    if (isExtensionContextInvalidated(error)) stopBaselineCapture();
    else console.warn('[PixelScope] CSS baseline initialization failed.', error);
  }
}

function scheduleBaselineCapture(pageUrl: string): void {
  if (captureStopped) return;
  void captureBaseline(pageUrl).catch((error: unknown) => {
    if (isExtensionContextInvalidated(error)) {
      stopBaselineCapture();
      return;
    }
    console.warn('[PixelScope] CSS baseline capture failed.', error);
  });
}

function stopBaselineCapture(): void {
  if (captureStopped) return;
  captureStopped = true;
  captureSequence += 1;
  try { chrome.devtools.network.onNavigated.removeListener(onNavigated); }
  catch { /* The stale DevTools context can no longer remove its listener. */ }
}

async function captureBaseline(pageUrl: string): Promise<void> {
  const sequence = ++captureSequence;
  const styleSheetUrls = await getStyleSheetUrls();
  const resources = await getResources();
  const resourceByUrl = new Map(resources.map((resource) => [normalizeUrl(resource.url), resource]));
  const baselines: CssResourceBaseline[] = [];
  let characterCount = 0;
  for (const url of styleSheetUrls) {
    const resource = resourceByUrl.get(normalizeUrl(url));
    if (resource === undefined) continue;
    const content = await getResourceContent(resource);
    if (content === null || content.length === 0 || characterCount + content.length > MAX_BASELINE_CHARACTERS) continue;
    baselines.push({ url, content });
    characterCount += content.length;
  }
  if (sequence !== captureSequence) return;
  const baseline: DevtoolsCssBaseline = { pageUrl, capturedAt: Date.now(), resources: baselines };
  const storageKey = `${CSS_BASELINE_STORAGE_PREFIX}${String(chrome.devtools.inspectedWindow.tabId)}`;
  await chrome.storage.session.set({ [storageKey]: baseline });
}

function getStyleSheetUrls(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const returned: unknown = chrome.devtools.network.getHAR((log) => resolve(log.entries
        .filter((entry) => entry.response.content.mimeType.toLowerCase().split(';')[0] === 'text/css')
        .map((entry) => entry.request.url)));
      forwardReturnedPromiseRejection(returned, reject);
    } catch (error: unknown) {
      reject(toError(error));
    }
  });
}

function getResources(): Promise<chrome.devtools.inspectedWindow.Resource[]> {
  return new Promise((resolve, reject) => {
    try {
      const returned: unknown = chrome.devtools.inspectedWindow.getResources(resolve);
      forwardReturnedPromiseRejection(returned, reject);
    } catch (error: unknown) {
      reject(toError(error));
    }
  });
}

function getResourceContent(resource: chrome.devtools.inspectedWindow.Resource): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const returned: unknown = resource.getContent((content) => resolve(typeof content === 'string' ? content : null));
      forwardReturnedPromiseRejection(returned, reject);
    } catch (error: unknown) {
      reject(toError(error));
    }
  });
}

function forwardReturnedPromiseRejection(returned: unknown, reject: (reason?: unknown) => void): void {
  // Chrome 151+ exposes Promise variants while older typings only describe callbacks.
  // Observe a Promise when the runtime returns one so context invalidation cannot go unhandled.
  if (!isPromiseLike(returned)) return;
  void Promise.resolve(returned).catch((reason: unknown) => reject(toError(reason)));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'then') === 'function';
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('DevTools API request failed.');
}

function normalizeUrl(url: string): string {
  try { return new URL(url).href; }
  catch { return url; }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  if (error instanceof Error && /Extension context invalidated/i.test(error.message)) return true;
  try { return typeof chrome.runtime.id !== 'string'; }
  catch { return true; }
}
