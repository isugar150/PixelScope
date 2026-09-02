import { createServer } from 'node:http';
import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('Alt+Backquote toggles page interaction unlock from focused and dynamically added iframes', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (request.url === '/frame' || request.url === '/late-frame') {
      response.end(`<!doctype html><html><head><style>* { user-select: none; }</style></head><body><button id="frame-focus">Focus frame</button><p id="frame-text">Protected frame text</p><script>
        for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
          document.addEventListener(type, (event) => event.preventDefault());
        }
      </script></body></html>`);
      return;
    }
    response.end(`<!doctype html><html><head><style>* { user-select: none; }</style></head><body><p id="text">Protected page text</p><iframe id="child" src="/frame"></iframe><script>
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
    const child = page.frameLocator('#child');
    await child.locator('#frame-focus').click();

    await page.keyboard.press('Alt+Backquote');

    await expect(page.locator('[data-pixelscope-interaction-unlock-toast]')).toHaveCount(1);
    await expect(child.locator('[data-pixelscope-interaction-unlock-toast]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect(child.locator('html')).toHaveAttribute('data-pixelscope-interactions-unlocked', '');
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
    await expect(child.locator('#frame-text')).toHaveCSS('user-select', 'text');
    await expect.poll(() => child.locator('body').evaluate((body) => ['contextmenu', 'dragstart', 'selectstart'].every((type) => (
      body.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    )))).toBe(true);

    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.id = 'late-child';
      iframe.src = '/late-frame';
      document.body.append(iframe);
    });
    const lateChild = page.frameLocator('#late-child');
    await expect(lateChild.locator('html')).toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect(lateChild.locator('#frame-text')).toHaveCSS('user-select', 'text');
    await expect.poll(() => lateChild.locator('body').evaluate((body) => ['contextmenu', 'dragstart', 'selectstart'].every((type) => (
      body.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    )))).toBe(true);

    await child.locator('#frame-focus').click();
    await page.keyboard.press('Alt+Backquote');

    await expect(page.locator('html')).not.toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect(child.locator('html')).not.toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect(lateChild.locator('html')).not.toHaveAttribute('data-pixelscope-interactions-unlocked', '');
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
