// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DevTools CSS baseline capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('stops quietly when an extension reload invalidates the DevTools context', async () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const getHAR = vi.fn((callback: (log: { entries: unknown[] }) => void) => callback({ entries: [] }));
    const getResources = vi.fn((callback: (resources: unknown[]) => void) => callback([]));
    const set = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    Reflect.set(globalThis, 'chrome', {
      runtime: { id: 'pixelscope-test' },
      devtools: {
        inspectedWindow: { tabId: 7, getResources },
        network: { getHAR, onNavigated: { addListener, removeListener } },
      },
      storage: { session: { set } },
    });

    await import('../src/devtools/devtools');
    await vi.waitFor(() => expect(removeListener).toHaveBeenCalledOnce());
    const listener = addListener.mock.calls[0]?.[0] as ((url: string) => void) | undefined;
    listener?.('https://example.com/next');
    await Promise.resolve();

    expect(getHAR).toHaveBeenCalledOnce();
    expect(getResources).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
  });
});
