import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PAGE_URL = 'http://pixelscope.test/';

test('viewer copies with Ctrl+C and saves with Ctrl+S, mirroring the toolbar buttons', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 800, height: 600 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<title>shortcuts</title><div style="height:300px;background:#123456"></div>' }));
    await page.goto(PAGE_URL);
    const tabId = await worker.evaluate(async (url: string) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id ?? null, PAGE_URL);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await page.bringToFront();
    const viewerPromise = context.waitForEvent('page', { predicate: (candidate) => candidate.url().includes('/src/viewer/viewer.html'), timeout: 20_000 });
    await popup.evaluate((targetTabId) => chrome.runtime.sendMessage({ type: 'ACTIVATE_TOOL', tabId: targetTabId, tool: 'capture-page' }), tabId);

    const viewer = await viewerPromise;
    await expect(viewer.locator('#capture')).toBeVisible({ timeout: 20_000 });
    await viewer.evaluate(() => {
      const testWindow = window as Window & { copiedItems?: number };
      testWindow.copiedItems = 0;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: (items: ClipboardItem[]) => { testWindow.copiedItems = (testWindow.copiedItems ?? 0) + items.length; return Promise.resolve(); },
      } });
    });
    const copiedItems = (): Promise<number> => viewer.evaluate(() => (window as Window & { copiedItems?: number }).copiedItems ?? 0);

    await viewer.keyboard.press('Control+KeyC');
    await expect.poll(copiedItems).toBe(1);
    await expect(viewer.locator('#toast')).toHaveText('이미지를 클립보드에 복사했습니다.');

    const download = viewer.waitForEvent('download');
    await viewer.keyboard.press('Control+KeyS');
    expect((await download).suggestedFilename()).toMatch(/\.png$/);

    // While cropping the toolbar actions are disabled, so the shortcuts do nothing and Ctrl+C in an input stays native.
    await viewer.locator('#crop').click();
    await expect(viewer.locator('#crop-toolbar')).toBeVisible();
    let downloaded = false;
    viewer.on('download', () => { downloaded = true; });
    await viewer.keyboard.press('Control+KeyS');
    await viewer.locator('#crop-x').focus();
    await viewer.keyboard.press('Control+KeyC');
    await viewer.waitForTimeout(300);
    expect(downloaded).toBe(false);
    expect(await copiedItems()).toBe(1);
  } finally { await context.close(); }
});
