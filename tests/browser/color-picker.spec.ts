import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('page color picker locks once, restores the cursor, and exposes per-format copy controls', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent('<style>html{cursor:grab}#target{display:block;width:100%;height:600px;background:#112233}</style><button id="target" type="button">Target</button>');
    const captureDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const context2d = canvas.getContext('2d');
      if (context2d === null) throw new Error('test canvas unavailable');
      context2d.fillStyle = '#112233';
      context2d.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    await page.evaluate((dataUrl) => {
      const testWindow = window as Window & {
        pickerListener?: (...args: unknown[]) => unknown;
        pageClicks?: number;
        copiedValue?: string;
      };
      testWindow.pageClicks = 0;
      document.getElementById('target')?.addEventListener('click', () => { testWindow.pageClicks = (testWindow.pageClicks ?? 0) + 1; });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: (value: string) => { testWindow.copiedValue = value; return Promise.resolve(); },
      } });
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: {
          addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.pickerListener = listener; },
          removeListener: () => undefined,
        },
        sendMessage: (message: { type?: string }) => Promise.resolve(
          message.type === 'CAPTURE_VISIBLE_TAB' ? { ok: true, dataUrl } : { ok: true },
        ),
      } });
      Object.defineProperty(window.chrome, 'storage', { configurable: true, value: { local: { get: () => Promise.resolve({}) } } });
    }, captureDataUrl);
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await page.evaluate(async () => {
      const listener = (window as Window & { pickerListener?: (...args: unknown[]) => unknown }).pickerListener;
      await new Promise<void>((resolveActivation) => {
        listener?.({ type: 'TOOL_COMMAND', tool: 'color-picker' }, {}, () => resolveActivation());
      });
    });

    const overlay = page.locator('[data-pixelscope-overlay]');
    await expect(overlay).toHaveAttribute('data-pixelscope-picker-state', 'sampling');
    await expect(overlay).toHaveAttribute('data-pixelscope-pointer-aids', 'visible');
    await expect(overlay).toHaveAttribute('data-pixelscope-panel-position', 'top');
    await expect.poll(() => page.locator('html').evaluate((element) => getComputedStyle(element).cursor)).toContain('2 30');
    await page.mouse.move(400, 12);
    await expect(overlay).toHaveAttribute('data-pixelscope-panel-position', 'bottom');
    await page.mouse.move(400, 588);
    await expect(overlay).toHaveAttribute('data-pixelscope-panel-position', 'top');

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 400, y: 300 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: 400, y: 240 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(overlay).toHaveAttribute('data-pixelscope-picker-state', 'sampling');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: 400, y: 300 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => (window as Window & { pageClicks?: number }).pageClicks)).toBe(0);
    await expect(overlay).toHaveAttribute('data-pixelscope-picker-state', 'locked');
    await expect(overlay).toHaveAttribute('data-pixelscope-pointer-aids', 'hidden');
    await expect(page.locator('[data-pixelscope-interaction]')).toHaveCount(0);
    await expect.poll(() => page.locator('html').evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');

    const copyButtons = overlay.getByRole('button', { name: /값 복사/ });
    await expect(copyButtons).toHaveCount(5);
    await expect(overlay.locator('.value-text').filter({ hasText: '#112233' })).toBeVisible();
    await overlay.getByRole('button', { name: 'HEX 값 복사' }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { copiedValue?: string }).copiedValue)).toBe('#112233');
    await expect(overlay.locator('.toast')).toContainText('#112233 복사됨');

    await page.mouse.move(400, 12);
    await expect(overlay).toHaveAttribute('data-pixelscope-panel-position', 'top');
    await page.mouse.click(400, 300);
    await expect.poll(() => page.evaluate(() => (window as Window & { pageClicks?: number }).pageClicks)).toBe(0);
    await expect(overlay).toHaveAttribute('data-pixelscope-picker-state', 'locked');

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('[data-pixelscope-interaction]')).toHaveCount(0);
  } finally { await context.close(); }
});
