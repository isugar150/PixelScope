// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('always-on page shortcut listener', () => {
  afterEach(() => {
    window.__pixelScopeShortcutRuntime__?.dispose();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, 'chrome');
    document.documentElement.removeAttribute('data-pixelscope-interactions-unlocked');
    document.documentElement.removeAttribute('data-pixelscope-tool-active');
  });

  it('requests interaction unlock on the first Alt+Backquote press', async () => {
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve(message.type === 'GET_PAGE_INTERACTION_UNLOCK_STATE'
      ? { ok: true, interactionsUnlocked: false, toolActive: false }
      : { ok: true }));
    const addListener = vi.fn();
    const removeListener = vi.fn();
    Reflect.set(globalThis, 'chrome', { runtime: { sendMessage, onMessage: { addListener, removeListener } } });
    await import('../src/content/shortcut-listener');

    const event = new KeyboardEvent('keydown', { code: 'Backquote', altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TOGGLE_PAGE_INTERACTION_UNLOCK' });
  });

  it('applies the background state without showing a toast in a child frame runtime', async () => {
    let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | undefined;
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, interactionsUnlocked: false, toolActive: false }));
    Reflect.set(globalThis, 'chrome', {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn((nextListener: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) => { listener = nextListener; }),
          removeListener: vi.fn(),
        },
      },
    });
    await import('../src/content/shortcut-listener');

    const sendResponse = vi.fn();
    expect(listener?.({ type: 'SET_PAGE_INTERACTION_UNLOCK', enabled: true, toolActive: true, announce: false }, {}, sendResponse)).toBe(false);

    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(true);
    expect(document.documentElement.hasAttribute('data-pixelscope-tool-active')).toBe(true);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-style]')).not.toBeNull();
    expect(document.querySelector('[data-pixelscope-interaction-unlock-toast]')).toBeNull();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, interactionsUnlocked: true, toolActive: true });
  });
});
