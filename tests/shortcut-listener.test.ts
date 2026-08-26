// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('always-on page shortcut listener', () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('requests interaction unlock on the first Alt+Backquote press', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));
    Reflect.set(globalThis, 'chrome', { runtime: { sendMessage } });
    await import('../src/content/shortcut-listener');

    const event = new KeyboardEvent('keydown', { code: 'Backquote', altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TOGGLE_PAGE_INTERACTION_UNLOCK' });
  });
});
