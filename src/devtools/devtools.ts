import { cssBaselineStorageKey, type CssResourceBaseline, type DevtoolsCssBaseline } from '../shared/css-baseline';

const MAX_BASELINE_CHARACTERS = 650_000;
let captureSequence = 0;
let captureStopped = false;

const onNavigated = (url: string): void => scheduleBaselineCapture(url);

scheduleBaselineCapture('');
chrome.devtools.network.onNavigated.addListener(onNavigated);

function scheduleBaselineCapture(pageUrl: string): void {
  if (captureStopped) return;
  void captureBaseline(pageUrl).catch((error: unknown) => {
    if (isExtensionContextInvalidated(error)) {
      captureStopped = true;
      captureSequence += 1;
      try { chrome.devtools.network.onNavigated.removeListener(onNavigated); }
      catch { /* The stale DevTools context can no longer remove its listener. */ }
      return;
    }
    console.warn('[PixelScope] CSS baseline capture failed.', error);
  });
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
  await chrome.storage.session.set({ [cssBaselineStorageKey(chrome.devtools.inspectedWindow.tabId)]: baseline });
}

function getStyleSheetUrls(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.devtools.network.getHAR((log) => resolve(log.entries
      .filter((entry) => entry.response.content.mimeType.toLowerCase().split(';')[0] === 'text/css')
      .map((entry) => entry.request.url)));
  });
}

function getResources(): Promise<chrome.devtools.inspectedWindow.Resource[]> {
  return new Promise((resolve) => chrome.devtools.inspectedWindow.getResources(resolve));
}

function getResourceContent(resource: chrome.devtools.inspectedWindow.Resource): Promise<string | null> {
  return new Promise((resolve) => resource.getContent((content) => resolve(typeof content === 'string' ? content : null)));
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
