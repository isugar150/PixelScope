import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('popup exposes keyboard-accessible tools and persisted settings', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await expect(page.getByRole('heading', { name: 'PixelScope' })).toBeVisible();
    await expect(page.getByRole('button', { name: /영역 측정/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /컬러 피커/ })).toBeVisible();
    await page.getByLabel('복사 형식').selectOption('rgb');
    await page.reload();
    await expect(page.getByLabel('복사 형식')).toHaveValue('rgb');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  } finally { await context.close(); }
});

test('measure mode blocks page clicks and Escape restores the page', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setContent('<a id="target" href="#clicked" style="display:block;width:160px;height:80px">Target</a>');
    await page.evaluate(() => {
      const testWindow = window as Window & { measureListener?: (...args: unknown[]) => unknown; linkClicks?: number };
      testWindow.linkClicks = 0;
      document.getElementById('target')?.addEventListener('click', () => { testWindow.linkClicks = (testWindow.linkClicks ?? 0) + 1; });
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: { addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.measureListener = listener; } },
        sendMessage: () => Promise.resolve({ ok: false, error: 'capture unavailable in test' }),
      } });
    });
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await page.evaluate(async () => {
      const testWindow = window as Window & { measureListener?: (...args: unknown[]) => unknown };
      await new Promise<void>((resolveActivation) => {
        testWindow.measureListener?.({ type: 'TOOL_COMMAND', tool: 'measure' }, {}, () => resolveActivation());
      });
    });
    await page.mouse.move(40, 30);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-hover');
    await page.locator('#target').click({ position: { x: 40, y: 30 } });
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(0);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-locked');
    await page.mouse.move(40, 30); await page.mouse.down(); await page.mouse.move(120, 90, { steps: 3 }); await page.mouse.up();
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'area');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);
    await page.locator('#target').click();
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(1);
  } finally { await context.close(); }
});
