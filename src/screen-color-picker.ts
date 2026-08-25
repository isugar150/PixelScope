import type { CopyFormat } from './shared/tool-state';

export type ScreenColorPickResult =
  | { readonly status: 'picked'; readonly text: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: string };

interface EyeDropperResult { readonly sRGBHex: string }
interface EyeDropperInstance { open(): Promise<EyeDropperResult> }
interface EyeDropperConstructor { new(): EyeDropperInstance }

/** Call directly from the popup click handler so EyeDropper receives transient user activation. */
export async function pickScreenColorInPage(copyFormat: CopyFormat): Promise<ScreenColorPickResult> {
  const eyeDropperValue: unknown = Reflect.get(window, 'EyeDropper');
  const isEyeDropperConstructor = (value: unknown): value is EyeDropperConstructor => {
    if (typeof value !== 'function') return false;
    const prototype: unknown = Reflect.get(value, 'prototype');
    return typeof prototype === 'object' && prototype !== null && typeof Reflect.get(prototype, 'open') === 'function';
  };
  if (!isEyeDropperConstructor(eyeDropperValue)) {
    return { status: 'error', error: '이 Chrome 버전에서는 화면 전체 컬러 피커를 사용할 수 없습니다.' };
  }
  const EyeDropperApi = eyeDropperValue;

  const formatColor = (hexValue: string): string | null => {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hexValue);
    if (match === null) return null;
    const redHex = match[1], greenHex = match[2], blueHex = match[3];
    if (redHex === undefined || greenHex === undefined || blueHex === undefined) return null;
    const red = Number.parseInt(redHex, 16), green = Number.parseInt(greenHex, 16), blue = Number.parseInt(blueHex, 16);
    if (copyFormat === 'rgb') return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
    if (copyFormat === 'hsl') {
      const normalizedRed = red / 255, normalizedGreen = green / 255, normalizedBlue = blue / 255;
      const maximum = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
      const minimum = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
      const lightness = (maximum + minimum) / 2;
      let hue = 0, saturation = 0;
      if (maximum !== minimum) {
        const delta = maximum - minimum;
        saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
        if (maximum === normalizedRed) hue = (normalizedGreen - normalizedBlue) / delta + (normalizedGreen < normalizedBlue ? 6 : 0);
        else if (maximum === normalizedGreen) hue = (normalizedBlue - normalizedRed) / delta + 2;
        else hue = (normalizedRed - normalizedGreen) / delta + 4;
        hue *= 60;
      }
      const roundOne = (value: number): number => Math.round(value * 10) / 10;
      return `hsl(${String(Math.round(hue))}, ${String(roundOne(saturation * 100))}%, ${String(roundOne(lightness * 100))}%)`;
    }
    return hexValue.toUpperCase();
  };

  const showToast = (message: string, color: string, error = false): void => {
    document.querySelector('[data-pixelscope-screen-color-toast]')?.remove();
    const host = document.createElement('div');
    host.dataset.pixelscopeScreenColorToast = '';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial!important;position:fixed!important;left:50%!important;bottom:24px!important;z-index:2147483647!important;pointer-events:none!important;transform:translateX(-50%)!important}.toast{display:flex;align-items:center;gap:9px;padding:10px 13px;border:1px solid rgba(135,206,255,.35);border-radius:7px;background:rgba(8,17,29,.96);box-shadow:0 10px 30px rgba(0,0,0,.38);color:#f1f7ff;font:600 12px/1.3 "Segoe UI",Arial,sans-serif;white-space:nowrap}.toast.error{border-color:rgba(255,135,148,.55);color:#ffd8dc}.swatch{width:16px;height:16px;border:1px solid rgba(255,255,255,.42);border-radius:4px;background:var(--picked-color);box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}';
    const toast = document.createElement('div');
    toast.className = error ? 'toast error' : 'toast';
    if (!error) {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.setProperty('--picked-color', color);
      toast.append(swatch);
    }
    const label = document.createElement('span');
    label.textContent = message;
    toast.append(label);
    shadow.append(style, toast);
    document.documentElement.append(host);
    window.setTimeout(() => host.remove(), 2200);
  };

  try {
    const result = await new EyeDropperApi().open();
    const text = formatColor(result.sRGBHex);
    if (text === null) return { status: 'error', error: '선택한 색상 값을 읽을 수 없습니다.' };
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${text} 복사됨`, result.sRGBHex);
      return { status: 'picked', text };
    } catch {
      const error = '색상은 선택했지만 클립보드에 복사하지 못했습니다.';
      showToast(error, result.sRGBHex, true);
      return { status: 'error', error };
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' };
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}
