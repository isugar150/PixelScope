// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installPageInteractionUnlock } from '../src/page-interaction-unlock-main';

describe('main-world page interaction unlock', () => {
  beforeAll(() => installPageInteractionUnlock());
  afterEach(() => {
    document.documentElement.removeAttribute('data-pixelscope-interactions-unlocked');
    document.documentElement.removeAttribute('data-pixelscope-tool-active');
    document.body.replaceChildren();
  });

  it.each(['contextmenu', 'dragstart', 'selectstart'])('keeps %s uncancelled while the page is unlocked', (type) => {
    document.documentElement.setAttribute('data-pixelscope-interactions-unlocked', '');
    const target = document.createElement('div');
    document.body.append(target);
    document.addEventListener(type, (event) => event.preventDefault(), { once: true });

    const allowed = target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

    expect(allowed).toBe(true);
  });

  it('preserves PixelScope tool event cancellation while a tool is active', () => {
    document.documentElement.setAttribute('data-pixelscope-interactions-unlocked', '');
    document.documentElement.setAttribute('data-pixelscope-tool-active', '');
    const target = document.createElement('div');
    document.body.append(target);
    document.addEventListener('dragstart', (event) => event.preventDefault(), { once: true });

    const allowed = target.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));

    expect(allowed).toBe(false);
  });

  it('restores page event cancellation when interaction unlock is toggled off', () => {
    const target = document.createElement('div');
    document.body.append(target);
    document.addEventListener('contextmenu', (event) => event.preventDefault(), { once: true });

    const allowed = target.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));

    expect(allowed).toBe(false);
  });

  it('keeps Alt+Backquote observable when an earlier page listener stops immediate propagation', () => {
    const pageBlocker = (event: KeyboardEvent): void => event.stopImmediatePropagation();
    const shortcutListener = vi.fn();
    window.addEventListener('keydown', pageBlocker, true);
    window.addEventListener('keydown', shortcutListener, true);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', altKey: true }));
      expect(shortcutListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', pageBlocker, true);
      window.removeEventListener('keydown', shortcutListener, true);
    }
  });

  it('preserves immediate propagation blocking for unrelated keys', () => {
    const pageBlocker = (event: KeyboardEvent): void => event.stopImmediatePropagation();
    const laterListener = vi.fn();
    window.addEventListener('keydown', pageBlocker, true);
    window.addEventListener('keydown', laterListener, true);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      expect(laterListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', pageBlocker, true);
      window.removeEventListener('keydown', laterListener, true);
    }
  });
});
