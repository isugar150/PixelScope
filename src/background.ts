import { isExtensionMessage, type ExtensionMessage, type ExtensionResponse } from './shared/messages';
import type { ToolMode } from './shared/tool-state';

const CONTENT_SCRIPT = 'content.js';
const tabStates = new Map<number, ToolMode>();

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isExtensionMessage(raw)) return false;
  void handleMessage(raw, sender).then(sendResponse).catch((error: unknown) => {
    sendResponse({ ok: false, error: getErrorMessage(error) } satisfies ExtensionResponse);
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => tabStates.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') tabStates.delete(tabId);
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'GET_TOOL_STATE': {
      if (message.tabId === undefined) return { ok: true, tool: 'idle' };
      const tool = await queryContentState(message.tabId);
      tabStates.set(message.tabId, tool);
      return { ok: true, tool };
    }
    case 'ACTIVATE_TOOL':
      await ensureContentScript(message.tabId);
      await sendToolCommand(message.tabId, message.tool);
      tabStates.set(message.tabId, message.tool);
      return { ok: true, tool: message.tool };
    case 'DEACTIVATE_TOOL':
      await sendToolCommand(message.tabId, 'idle');
      tabStates.set(message.tabId, 'idle');
      return { ok: true, tool: 'idle' };
    case 'CAPTURE_VISIBLE_TAB': {
      if (sender.tab?.windowId === undefined) return { ok: false, error: '캡처할 탭을 확인할 수 없습니다.' };
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      return { ok: true, dataUrl };
    }
    case 'TOOL_STATE_CHANGED':
      if (sender.tab?.id !== undefined) tabStates.set(sender.tab.id, message.tool);
      return { ok: true, tool: message.tool };
    case 'TOOL_COMMAND': return { ok: false, error: '잘못된 메시지 발신자입니다.' };
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'GET_TOOL_STATE' } satisfies ExtensionMessage);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
  }
}

async function sendToolCommand(tabId: number, tool: ToolMode): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'TOOL_COMMAND', tool } satisfies ExtensionMessage);
}

async function queryContentState(tabId: number): Promise<ToolMode> {
  try {
    const response = await chrome.tabs.sendMessage<ExtensionMessage, ExtensionResponse>(tabId, { type: 'GET_TOOL_STATE' });
    return response.ok ? response.tool ?? 'idle' : 'idle';
  } catch { return 'idle'; }
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot access|chrome:\/\/|extensions gallery/i.test(message)
    ? '이 페이지에서는 PixelScope를 실행할 수 없습니다.' : message;
}
