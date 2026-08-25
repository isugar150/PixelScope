// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CaptureManager } from '../src/content/color-picker/capture-manager';

describe('CaptureManager', () => {
  it('prevents concurrent capture and applies only the newest generation', async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    const capture = vi.fn(() => capture.mock.calls.length === 1
      ? new Promise<string>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve('new'));
    const load = vi.fn(() => Promise.resolve());
    const manager = new CaptureManager({ capture, load });
    const first = manager.refresh();
    await Promise.resolve();
    const second = manager.refresh();
    resolveFirst?.('old');
    await first; await second; await Promise.resolve(); await Promise.resolve();
    expect(load).not.toHaveBeenCalledWith('old');
    expect(capture).toHaveBeenCalledTimes(2);
    manager.destroy();
  });

  it('debounces viewport-change capture refreshes', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(() => Promise.resolve('image'));
    const manager = new CaptureManager({ capture, load: () => Promise.resolve(), debounceMs: 100 });
    manager.schedule(); manager.schedule();
    await vi.advanceTimersByTimeAsync(101);
    expect(capture).toHaveBeenCalledOnce();
    manager.destroy(); vi.useRealTimers();
  });

  it('cancels a scheduled capture refresh', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(() => Promise.resolve('image'));
    const manager = new CaptureManager({ capture, load: () => Promise.resolve(), debounceMs: 100 });
    manager.schedule();
    manager.cancelScheduled();
    await vi.advanceTimersByTimeAsync(101);
    expect(capture).not.toHaveBeenCalled();
    manager.destroy(); vi.useRealTimers();
  });

  it('absorbs extension-context invalidation from scheduled captures and stops retrying', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
    const manager = new CaptureManager({ capture, load: () => Promise.resolve(), debounceMs: 10 });
    manager.schedule();
    await vi.advanceTimersByTimeAsync(11);
    manager.schedule();
    await vi.advanceTimersByTimeAsync(11);
    expect(capture.mock.calls).toHaveLength(1);
    manager.destroy(); vi.useRealTimers();
  });
});
