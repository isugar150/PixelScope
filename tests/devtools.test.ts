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

  it('does not reject module initialization when listener registration sees a stale context', async () => {
    const contextError = new Error('Extension context invalidated.');
    const addListener = vi.fn(() => { throw contextError; });
    const removeListener = vi.fn();
    const getHAR = vi.fn();
    Reflect.set(globalThis, 'chrome', {
      runtime: { id: undefined },
      devtools: {
        inspectedWindow: { tabId: 7, getResources: vi.fn() },
        network: { getHAR, onNavigated: { addListener, removeListener } },
      },
      storage: { session: { set: vi.fn() } },
    });

    await expect(import('../src/devtools/devtools')).resolves.toBeDefined();

    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(getHAR).not.toHaveBeenCalled();
  });

  it('handles the Promise rejection returned by a callback-style DevTools API', async () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const getHAR = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    const getResources = vi.fn();
    Reflect.set(globalThis, 'chrome', {
      runtime: { id: 'pixelscope-test' },
      devtools: {
        inspectedWindow: { tabId: 7, getResources },
        network: { getHAR, onNavigated: { addListener, removeListener } },
      },
      storage: { session: { set: vi.fn() } },
    });

    await import('../src/devtools/devtools');
    await vi.waitFor(() => expect(removeListener).toHaveBeenCalledOnce());

    expect(getHAR).toHaveBeenCalledOnce();
    expect(getResources).not.toHaveBeenCalled();
  });
});
