// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickScreenColorInPage } from '../src/screen-color-picker';

describe('screen color picker', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockClear();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(window, 'EyeDropper');
    vi.useRealTimers();
  });

  it.each([
    ['hex', '#12AB34'],
    ['rgb', 'rgb(18, 171, 52)'],
    ['hsl', 'hsl(133, 81%, 37.1%)'],
  ] as const)('copies an outside-screen pixel using the %s setting', async (format, expected) => {
    Reflect.set(window, 'EyeDropper', class { public open(): Promise<{ sRGBHex: string }> { return Promise.resolve({ sRGBHex: '#12ab34' }); } });

    await expect(pickScreenColorInPage(format)).resolves.toEqual({ status: 'picked', text: expected });
    expect(writeText).toHaveBeenCalledWith(expected);
    const toast = document.querySelector('[data-pixelscope-screen-color-toast]');
    expect(toast?.shadowRoot?.textContent).toContain(`${expected} 복사됨`);
    vi.advanceTimersByTime(2200);
    expect(document.querySelector('[data-pixelscope-screen-color-toast]')).toBeNull();
  });

  it('treats Escape as a silent cancellation', async () => {
    Reflect.set(window, 'EyeDropper', class { public open(): Promise<never> { return Promise.reject(new DOMException('cancelled', 'AbortError')); } });

    await expect(pickScreenColorInPage('hex')).resolves.toEqual({ status: 'cancelled' });
    expect(writeText).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pixelscope-screen-color-toast]')).toBeNull();
  });

  it('reports unsupported Chromium versions without touching the clipboard', async () => {
    await expect(pickScreenColorInPage('hex')).resolves.toEqual({
      status: 'error',
      error: '이 Chrome 버전에서는 화면 전체 컬러 피커를 사용할 수 없습니다.',
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
