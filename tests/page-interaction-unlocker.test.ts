// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageInteractionUnlocker } from '../src/content/page-interaction-unlocker';

describe('page interaction unlocker', () => {
  let unlocker: PageInteractionUnlocker | null = null;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    unlocker?.dispose();
    unlocker = null;
    document.documentElement.removeAttribute('data-pixelscope-tool-active');
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('toggles selection overrides on and removes its status toast after three seconds', () => {
    unlocker = new PageInteractionUnlocker();
    expect(unlocker.toggle()).toBe(true);
    expect(unlocker.active).toBe(true);

    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(true);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-style]')?.textContent).toContain('user-select: text !important');
    const toast = document.querySelector('[data-pixelscope-interaction-unlock-toast]');
    expect(toast?.shadowRoot?.textContent).toContain('우클릭·드래그 해제 켜짐');
    expect(toast?.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();

    vi.advanceTimersByTime(3_000);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-toast]')).toBeNull();
    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(true);
  });

  it('toggles selection overrides off and announces the disabled state', () => {
    unlocker = new PageInteractionUnlocker();
    unlocker.toggle();

    expect(unlocker.toggle()).toBe(false);
    expect(unlocker.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(false);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-style]')).toBeNull();
    expect(document.querySelector('[data-pixelscope-interaction-unlock-toast]')?.shadowRoot?.textContent).toContain('우클릭·드래그 해제 꺼짐');
  });

  it('cleans up the shortcut, style, state, and toast on dispose', () => {
    unlocker = new PageInteractionUnlocker();
    unlocker.toggle();
    unlocker.dispose();
    unlocker = null;

    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(false);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-style]')).toBeNull();
    expect(document.querySelector('[data-pixelscope-interaction-unlock-toast]')).toBeNull();
  });
});
