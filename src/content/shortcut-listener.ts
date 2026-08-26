import type { ExtensionMessage } from '../shared/messages';

window.addEventListener('keydown', (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.code !== 'Backquote') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try { void chrome.runtime.sendMessage({ type: 'TOGGLE_PAGE_INTERACTION_UNLOCK' } satisfies ExtensionMessage).catch(() => undefined); }
  catch { /* Extension context invalidated; the next document receives a fresh listener. */ }
}, { capture: true });
