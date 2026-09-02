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

  it('toggles selection overrides on and removes its status toast after one second', () => {
    unlocker = new PageInteractionUnlocker();
    expect(unlocker.toggle()).toBe(true);
    expect(unlocker.active).toBe(true);

    expect(document.documentElement.hasAttribute('data-pixelscope-interactions-unlocked')).toBe(true);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-style]')?.textContent).toContain('user-select: text !important');
    const toast = document.querySelector('[data-pixelscope-interaction-unlock-toast]');
    expect(toast?.shadowRoot?.textContent).toContain('우클릭·드래그 해제 켜짐');
    expect(toast?.shadowRoot?.querySelector('[role="status"]')?.classList.contains('enabled')).toBe(true);
    expect(toast?.shadowRoot?.querySelector('[role="status"]')?.getAttribute('data-state')).toBe('enabled');
    expect(toast?.shadowRoot?.querySelector('.lock-shackle')?.getAttribute('d')).toBe('M5 10V7a4.5 4.5 0 0 1 9 0v3');
    expect(toast?.shadowRoot?.querySelector('style')?.textContent).toContain('42% { transform: translateY(-2px) rotateY(0); }');
    expect(toast?.shadowRoot?.querySelector('style')?.textContent).toContain('100% { transform: translateY(-2px) rotateY(180deg); }');

    vi.advanceTimersByTime(999);
    expect(document.querySelector('[data-pixelscope-interaction-unlock-toast]')).not.toBeNull();
    vi.advanceTimersByTime(1);
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
    const toast = document.querySelector('[data-pixelscope-interaction-unlock-toast]');
    expect(toast?.shadowRoot?.textContent).toContain('우클릭·드래그 해제 꺼짐');
    expect(toast?.shadowRoot?.querySelector('[role="status"]')?.classList.contains('disabled')).toBe(true);
    expect(toast?.shadowRoot?.querySelector('[role="status"]')?.getAttribute('data-state')).toBe('disabled');
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
