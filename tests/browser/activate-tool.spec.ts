import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PAGE_URL = 'http://pixelscope.test/';

/**
 * Regression test for the popup → background → content activation path. shortcut-listener.js runs on
 * every page, so a tab always has a message listener; probing it must not be mistaken for content.js
 * already being injected, or ACTIVATE_TOOL fails before the tool ever starts.
 */
for (const tool of ['measure', 'capture-element', 'capture-page'] as const) {
  test(`${tool} activates on a page that has never loaded content.js`, async () => {
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
      await page.route('**/*', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<h1 id="target">PixelScope</h1><div style="height:2000px"></div>',
      }));
      await page.goto(PAGE_URL);
      await expect(page.locator('#target')).toBeVisible();
      await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);

      const tabId = await worker.evaluate(async (url: string) => {
        const [tab] = await chrome.tabs.query({ url: `${url}*` });
        return tab?.id ?? null;
      }, PAGE_URL);
      expect(tabId).not.toBeNull();

      // An extension page is the only context that can reproduce the popup's own message sender.
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      const response = await popup.evaluate(async ([targetTabId, activeTool]) => {
        const result: unknown = await chrome.runtime.sendMessage({ type: 'ACTIVATE_TOOL', tabId: targetTabId, tool: activeTool });
        return JSON.stringify(result ?? null);
      }, [tabId, tool] as const);

      expect(JSON.parse(response)).toMatchObject({ ok: true, tool });
      await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    } finally { await context.close(); }
  });
}
