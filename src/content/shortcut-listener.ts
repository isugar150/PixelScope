import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { PageInteractionUnlocker } from './page-interaction-unlocker';

const TOOL_ACTIVE_ATTRIBUTE = 'data-pixelscope-tool-active';

interface ShortcutRuntime {
  dispose(): void;
}

declare global {
  interface Window {
    __pixelScopeShortcutRuntime__?: ShortcutRuntime;
  }
}

window.__pixelScopeShortcutRuntime__?.dispose();

const unlocker = new PageInteractionUnlocker();
let receivedExplicitState = false;

const applyState = (enabled: boolean, toolActive: boolean, announce: boolean): void => {
  document.documentElement.toggleAttribute(TOOL_ACTIVE_ATTRIBUTE, toolActive);
  unlocker.setEnabled(enabled, announce && window === window.top);
};

const onKeyDown = (event: KeyboardEvent): void => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.code !== 'Backquote') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try { void chrome.runtime.sendMessage({ type: 'TOGGLE_PAGE_INTERACTION_UNLOCK' } satisfies ExtensionMessage).catch(() => undefined); }
  catch { /* Extension context invalidated; reinjection installs a fresh runtime. */ }
};

const onMessage = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: ExtensionResponse) => void): boolean => {
  if (!isSetInteractionMessage(message)) return false;
  receivedExplicitState = true;
  applyState(message.enabled, message.toolActive, message.announce);
  sendResponse({ ok: true, interactionsUnlocked: unlocker.active, toolActive: message.toolActive });
  return false;
};

const runtime: ShortcutRuntime = {
  dispose(): void {
    window.removeEventListener('keydown', onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    unlocker.dispose();
    document.documentElement.removeAttribute(TOOL_ACTIVE_ATTRIBUTE);
    if (window.__pixelScopeShortcutRuntime__ === runtime) delete window.__pixelScopeShortcutRuntime__;
  },
};

window.__pixelScopeShortcutRuntime__ = runtime;
window.addEventListener('keydown', onKeyDown, { capture: true });
chrome.runtime.onMessage.addListener(onMessage);

try {
  void chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({ type: 'GET_PAGE_INTERACTION_UNLOCK_STATE' })
    .then((response) => {
      if (!receivedExplicitState && response.ok) applyState(response.interactionsUnlocked === true, response.toolActive === true, false);
    })
    .catch(() => undefined);
} catch { /* Extension context invalidated; reinjection installs a fresh runtime. */ }

function isSetInteractionMessage(value: unknown): value is Extract<ExtensionMessage, { type: 'SET_PAGE_INTERACTION_UNLOCK' }> {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'SET_PAGE_INTERACTION_UNLOCK'
    && 'enabled' in value && typeof value.enabled === 'boolean'
    && 'toolActive' in value && typeof value.toolActive === 'boolean'
    && 'announce' in value && typeof value.announce === 'boolean';
}
