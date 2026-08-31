import { deleteCapture, deleteExpiredCaptures, saveCapture } from './capture/capture-store';
import { createCaptureTiles, intersectCaptureRect, shouldSuppressViewportFixed } from './capture/tile-plan';
import { isExtensionMessage, type ExtensionMessage, type ExtensionResponse } from './shared/messages';
import type { CaptureProgressState, CaptureRect, CaptureScrollPosition, CaptureViewportSize } from './shared/capture';
import type { ToolMode } from './shared/tool-state';
import { installPageInteractionUnlock } from './page-interaction-unlock-main';

class FileAccessRequiredError extends Error {
  readonly code = 'file-access-required' as const;
  constructor() { super('이 페이지에서는 PixelScope를 실행할 수 없습니다.'); }
}
function isCapturingTool(tool: ToolMode | undefined): tool is 'capture-element' | 'capture-page' {
  return tool === 'capture-element' || tool === 'capture-page';
}
function isRestrictedPageError(message: string): boolean {
  return /Cannot access|chrome:\/\/|extensions gallery/i.test(message);
}

const CONTENT_SCRIPT = 'content.js';
const CAPTURE_INTERVAL_MS = 550;
const MAX_CANVAS_DIMENSION = 32_767;
const MAX_CANVAS_PIXELS = 268_000_000;
const tabStates = new Map<number, ToolMode>();
const captureAbortControllers = new Map<number, AbortController>();
const captureProgressStates = new Map<number, CaptureProgressState>();
const viewerCaptures = new Map<number, string>();

void deleteExpiredCaptures().catch(() => undefined);

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isExtensionMessage(raw)) return false;
  void handleMessage(raw, sender).then(sendResponse).catch((error: unknown) => {
    const code = error instanceof FileAccessRequiredError ? error.code : undefined;
    sendResponse({ ok: false, error: getErrorMessage(error), code } satisfies ExtensionResponse);
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  captureAbortControllers.get(tabId)?.abort();
  captureAbortControllers.delete(tabId);
  captureProgressStates.delete(tabId);
  const captureId = viewerCaptures.get(tabId);
  if (captureId !== undefined) {
    viewerCaptures.delete(tabId);
    void deleteCapture(captureId).catch(() => undefined);
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStates.delete(tabId); captureProgressStates.delete(tabId);
    void setCaptureBadge(tabId, 'idle').catch(() => undefined);
  }
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'GET_TOOL_STATE': {
      if (message.tabId === undefined) return { ok: true, tool: 'idle' };
      const cachedTool = tabStates.get(message.tabId);
      const contentState = await queryContentState(message.tabId);
      const tool = isCapturingTool(cachedTool) ? cachedTool : contentState.tool;
      tabStates.set(message.tabId, tool);
      return { ok: true, tool, captureProgress: captureProgressStates.get(message.tabId) ?? contentState.captureProgress, interactionsUnlocked: contentState.interactionsUnlocked };
    }
    case 'TOGGLE_PAGE_INTERACTION_UNLOCK': {
      const targetTabId = message.tabId ?? sender.tab?.id;
      if (targetTabId === undefined) return { ok: false, error: '현재 탭을 확인할 수 없습니다.' };
      await ensureContentScript(targetTabId);
      await chrome.scripting.executeScript({ target: { tabId: targetTabId }, world: 'MAIN', func: installPageInteractionUnlock });
      return await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(targetTabId, { type: 'TOGGLE_PAGE_INTERACTION_UNLOCK' });
    }
    case 'ACTIVATE_TOOL':
      await ensureContentScript(message.tabId);
      {
        const tool = await sendToolCommand(message.tabId, message.tool);
        tabStates.set(message.tabId, tool);
        void setCaptureBadge(message.tabId, tool).catch(() => undefined);
        return { ok: true, tool };
      }
    case 'DEACTIVATE_TOOL':
      captureAbortControllers.get(message.tabId)?.abort();
      captureProgressStates.delete(message.tabId);
      {
        const tool = await sendToolCommand(message.tabId, 'idle');
        tabStates.set(message.tabId, tool);
        void setCaptureBadge(message.tabId, tool).catch(() => undefined);
        return { ok: true, tool };
      }
    case 'CAPTURE_VISIBLE_TAB': {
      if (sender.tab?.windowId === undefined) return { ok: false, error: '캡처할 탭을 확인할 수 없습니다.' };
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      return { ok: true, dataUrl };
    }
    case 'CAPTURE_DOCUMENT': {
      if (sender.tab?.id === undefined) return { ok: false, error: '캡처할 탭을 확인할 수 없습니다.' };
      const captureId = await captureDocument(sender.tab.id, sender.tab.windowId, message.rect, message.viewport, message.screenshotViewport, message.viewportOffset, message.title, message.preferredPosition);
      return { ok: true, captureId };
    }
    case 'CAPTURE_REGION': {
      if (sender.tab?.windowId === undefined) return { ok: false, error: '캡처할 탭을 확인할 수 없습니다.' };
      const captureId = await captureRegion(sender.tab.windowId, message.rect, message.screenshotViewport, message.title);
      return { ok: true, captureId };
    }
    case 'DESIGN_OVERLAY_UPDATE':
      return chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(message.tabId, message);
    case 'CAPTURE_CANCEL':
      if (sender.tab?.id !== undefined) captureAbortControllers.get(sender.tab.id)?.abort();
      return { ok: true };
    case 'TOOL_STATE_CHANGED':
      if (sender.tab?.id !== undefined) {
        tabStates.set(sender.tab.id, message.tool);
        void setCaptureBadge(sender.tab.id, message.tool).catch(() => undefined);
      }
      return { ok: true, tool: message.tool };
    case 'TOOL_COMMAND':
    case 'CAPTURE_SCROLL_TO':
    case 'CAPTURE_PROGRESS': return { ok: false, error: '잘못된 메시지 발신자입니다.' };
  }
}

async function captureDocument(tabId: number, windowId: number, rect: CaptureRect, viewport: CaptureViewportSize, screenshotViewport: CaptureViewportSize, viewportOffset: CaptureScrollPosition, title: string, preferredPosition?: CaptureScrollPosition): Promise<string> {
  captureAbortControllers.get(tabId)?.abort();
  const abortController = new AbortController();
  captureAbortControllers.set(tabId, abortController);
  const tiles = createCaptureTiles(rect, viewport, preferredPosition);
  if (tiles.length === 0) throw new Error('캡처할 영역의 크기가 올바르지 않습니다.');
  captureProgressStates.set(tabId, { phase: 'capturing', completed: 0, total: tiles.length });

  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let scaleX = 1;
  let scaleY = 1;
  const firstPageRowY = tiles[0]?.position.y ?? 0;
  try {
    for (const [index, tile] of tiles.entries()) {
      throwIfAborted(abortController.signal);
      const suppressViewportFixed = shouldSuppressViewportFixed(preferredPosition, tile.position, firstPageRowY);
      let scrollResponse = await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(tabId, {
        type: 'CAPTURE_SCROLL_TO',
        position: tile.position,
        suppressViewportFixed,
      });
      if (!scrollResponse.ok || scrollResponse.position === undefined) throw new Error(scrollResponse.ok ? '페이지 스크롤 위치를 확인할 수 없습니다.' : scrollResponse.error);
      if (index > 0) await delay(CAPTURE_INTERVAL_MS, abortController.signal);
      if (suppressViewportFixed) {
        scrollResponse = await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(tabId, {
          type: 'CAPTURE_SCROLL_TO',
          position: scrollResponse.position,
          suppressViewportFixed: true,
        });
        if (!scrollResponse.ok || scrollResponse.position === undefined) throw new Error(scrollResponse.ok ? '페이지 스크롤 위치를 확인할 수 없습니다.' : scrollResponse.error);
      }
      await assertCaptureTabActive(tabId, windowId);
      const dataUrl = await captureTabWithRetry(windowId, abortController.signal);
      const bitmap = await dataUrlToBitmap(dataUrl);
      try {
        if (canvas === null) {
          scaleX = bitmap.width / screenshotViewport.width;
          scaleY = bitmap.height / screenshotViewport.height;
          const outputWidth = Math.ceil(rect.width * scaleX);
          const outputHeight = Math.ceil(rect.height * scaleY);
          assertCanvasSize(outputWidth, outputHeight);
          canvas = new OffscreenCanvas(outputWidth, outputHeight);
          context = canvas.getContext('2d');
          if (context === null) throw new Error('캡처 이미지를 합성할 수 없습니다.');
        }
        if (context === null) throw new Error('캡처 이미지를 합성할 수 없습니다.');
        drawTile(context, bitmap, rect, viewport, scrollResponse.position, viewportOffset, scaleX, scaleY);
      } finally { bitmap.close(); }
      void chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PROGRESS', completed: index + 1, total: tiles.length } satisfies ExtensionMessage).catch(() => undefined);
      captureProgressStates.set(tabId, { phase: 'capturing', completed: index + 1, total: tiles.length });
    }
    if (canvas === null) throw new Error('캡처 이미지가 생성되지 않았습니다.');
    captureProgressStates.set(tabId, { phase: 'compositing', completed: tiles.length, total: tiles.length });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const captureId = crypto.randomUUID();
    await saveCapture({ id: captureId, blob, width: canvas.width, height: canvas.height, title: sanitizeTitle(title), createdAt: Date.now() });
    await openViewerTab(captureId);
    return captureId;
  } finally {
    captureProgressStates.delete(tabId);
    if (captureAbortControllers.get(tabId) === abortController) captureAbortControllers.delete(tabId);
  }
}

/**
 * A single-shot alternative to captureDocument for the region-select tool: no tiling, no
 * scroll-and-settle wait, no animation pausing — just crop whatever is on screen right now, so
 * the result matches exactly what the user saw when they released the drag.
 */
async function captureRegion(windowId: number, rect: CaptureRect, screenshotViewport: CaptureViewportSize, title: string): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await dataUrlToBitmap(dataUrl);
  try {
    const scaleX = bitmap.width / screenshotViewport.width;
    const scaleY = bitmap.height / screenshotViewport.height;
    const outputWidth = Math.round(rect.width * scaleX);
    const outputHeight = Math.round(rect.height * scaleY);
    assertCanvasSize(outputWidth, outputHeight);
    const canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('캡처 이미지를 합성할 수 없습니다.');
    context.drawImage(bitmap, rect.left * scaleX, rect.top * scaleY, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const captureId = crypto.randomUUID();
    await saveCapture({ id: captureId, blob, width: canvas.width, height: canvas.height, title: sanitizeTitle(title), createdAt: Date.now() });
    await openViewerTab(captureId);
    return captureId;
  } finally {
    bitmap.close();
  }
}

async function openViewerTab(captureId: string): Promise<void> {
  const viewerTab = await chrome.tabs.create({ url: chrome.runtime.getURL(`src/viewer/viewer.html?id=${encodeURIComponent(captureId)}`) });
  if (viewerTab.id !== undefined) viewerCaptures.set(viewerTab.id, captureId);
}

async function assertCaptureTabActive(tabId: number, windowId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.windowId !== windowId) throw new Error('캡처 중에는 원본 탭을 다른 탭으로 전환하지 마세요.');
}

function drawTile(context: OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap, target: CaptureRect, viewport: CaptureViewportSize, position: CaptureScrollPosition, viewportOffset: CaptureScrollPosition, scaleX: number, scaleY: number): void {
  const intersection = intersectCaptureRect(target, position, viewport);
  if (intersection === null) return;
  const sourceX = (intersection.left - position.x + viewportOffset.x) * scaleX;
  const sourceY = (intersection.top - position.y + viewportOffset.y) * scaleY;
  const sourceWidth = intersection.width * scaleX;
  const sourceHeight = intersection.height * scaleY;
  const destinationX = (intersection.left - target.left) * scaleX;
  const destinationY = (intersection.top - target.top) * scaleY;
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, sourceWidth, sourceHeight);
}

async function captureTabWithRetry(windowId: number, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(signal);
    try { return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }); }
    catch (error: unknown) {
      if (attempt === 2 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|too many|quota/i.test(getErrorMessage(error))) throw error;
      await delay(CAPTURE_INTERVAL_MS, signal);
    }
  }
  throw new Error('화면 캡처에 실패했습니다.');
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  return createImageBitmap(await response.blob());
}
function assertCanvasSize(width: number, height: number): void {
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    throw new Error('페이지가 너무 커서 한 장의 PNG로 합성할 수 없습니다.');
  }
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('캡처가 중단되었습니다.', 'AbortError');
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('캡처가 중단되었습니다.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}
function sanitizeTitle(title: string): string {
  const value = title.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return value.length === 0 ? 'PixelScope capture' : value.slice(0, 120);
}
async function ensureContentScript(tabId: number): Promise<void> {
  try { await chrome.tabs.sendMessage(tabId, { type: 'GET_TOOL_STATE' } satisfies ExtensionMessage); }
  catch {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] }); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRestrictedPageError(message)) throw new FileAccessRequiredError();
      throw error;
    }
  }
}
async function sendToolCommand(tabId: number, tool: ToolMode): Promise<ToolMode> {
  const response = await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(tabId, { type: 'TOOL_COMMAND', tool });
  if (!response.ok) throw new Error(response.error);
  return response.tool ?? tool;
}
async function queryContentState(tabId: number): Promise<{ tool: ToolMode; captureProgress?: CaptureProgressState; interactionsUnlocked?: boolean }> {
  try {
    const response = await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(tabId, { type: 'GET_TOOL_STATE' });
    return response.ok ? { tool: response.tool ?? 'idle', captureProgress: response.captureProgress, interactionsUnlocked: response.interactionsUnlocked } : { tool: 'idle' };
  } catch { return { tool: 'idle' }; }
}
function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isRestrictedPageError(message) ? '이 페이지에서는 PixelScope를 실행할 수 없습니다.' : message;
}
async function setCaptureBadge(tabId: number, tool: ToolMode): Promise<void> {
  const capturing = isCapturingTool(tool);
  if (capturing) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  await chrome.action.setBadgeText({ tabId, text: capturing ? 'REC' : '' });
}
