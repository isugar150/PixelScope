import { createServer } from 'node:http';
import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('Alt+Backquote toggles page interaction unlock on its first visit without opening the popup', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><p id="text">Protected page text</p><script>
      for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
        document.addEventListener(type, (event) => event.preventDefault());
      }
    </script></body></html>`);
  });
  await new Promise<void>((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('테스트 서버 주소를 확인할 수 없습니다.');

  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${String(address.port)}`);

    await page.keyboard.press('Alt+Backquote');

    await expect(page.locator('[data-pixelscope-interaction-unlock-toast]')).toHaveCount(1);
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.textContent ?? '')).toContain('우클릭·드래그 해제 켜짐');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.querySelector('.toast')?.getAttribute('data-state'))).toBe('enabled');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => {
      const shackle = element.shadowRoot?.querySelector('.lock-shackle');
      return shackle === undefined || shackle === null ? '' : getComputedStyle(shackle).animationName;
    })).toBe('pixelscope-unlock-shackle');
    await expect.poll(() => page.evaluate(() => ['contextmenu', 'dragstart', 'selectstart'].every((type) => (
      document.body.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    )))).toBe(true);
    await expect(page.locator('#text')).toHaveCSS('user-select', 'text');

    await page.keyboard.press('Alt+Backquote');

    await expect(page.locator('html')).not.toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.textContent ?? '')).toContain('우클릭·드래그 해제 꺼짐');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.querySelector('.toast')?.getAttribute('data-state'))).toBe('disabled');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => {
      const shackle = element.shadowRoot?.querySelector('.lock-shackle');
      return shackle === undefined || shackle === null ? '' : getComputedStyle(shackle).animationName;
    })).toBe('pixelscope-lock-shackle');
    await expect.poll(() => page.evaluate(() => ['contextmenu', 'dragstart', 'selectstart'].every((type) => (
      !document.body.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    )))).toBe(true);
  } finally {
    await context.close();
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  }
});
