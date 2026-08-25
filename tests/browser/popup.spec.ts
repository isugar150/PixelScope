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
    await expect(page.getByRole('button', { name: /영역 측정 요소와/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /컬러 피커 화면/ })).toBeVisible();
    const measureMore = page.locator('button[aria-controls="measure-options"]');
    const colorMore = page.locator('button[aria-controls="color-options"]');
    await expect(measureMore.locator('path')).toHaveAttribute('d', 'm6 8 4 4 4-4');
    await expect(measureMore.locator('circle')).toHaveCount(0);
    await expect(page.getByText('캡처가 끝나면 복사·저장·확대가 가능한 새 뷰어 탭이 열립니다.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('선택 영역의 너비와 높이에 적용됩니다.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('색상을 복사한 뒤에도 피커는 계속 활성화됩니다.', { exact: true })).toHaveCount(0);
    await expect(measureMore).toHaveAttribute('aria-expanded', 'false');
    await measureMore.click();
    await expect(measureMore).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel('측정 단위').selectOption('rem');
    await colorMore.click();
    await expect(measureMore).toHaveAttribute('aria-expanded', 'false');
    await expect(colorMore).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel('복사 형식').selectOption('rgb');
    await expect(page.getByText('화면 캡처', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /객체 캡처/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /전체 페이지/ })).toBeVisible();
    await expect(page.locator('[data-tool-card="capture"] .tool-panel')).toHaveCSS('grid-template-rows', /\d+px/);
    expect(await page.evaluate(() => {
      const capture = document.querySelector('[data-tool-card="capture"]');
      const settings = document.getElementById('color-options');
      return capture !== null && settings !== null && (capture.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    })).toBe(true);
    await expect(page.getByText('복사 후 계속 선택', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('복사 형식')).toHaveValue('rgb');
    await expect(page.getByLabel('측정 단위')).toHaveValue('rem');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  } finally { await context.close(); }
});

test('capture viewer loads ephemeral PNG and exposes zoom and export actions', async () => {
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
    await page.goto(`chrome-extension://${extensionId}/src/viewer/viewer.html`);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const context = canvas.getContext('2d'); if (context === null) throw new Error('canvas unavailable');
      context.fillStyle = '#38bdf8'; context.fillRect(0, 0, 2, 2);
      const blob = await new Promise<Blob>((resolveBlob, reject) => canvas.toBlob((value) => value === null ? reject(new Error('blob unavailable')) : resolveBlob(value), 'image/png'));
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open('pixelscope-captures', 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('captures')) request.result.createObjectStore('captures', { keyPath: 'id' }); };
        request.onsuccess = () => resolveDatabase(request.result); request.onerror = () => reject(request.error ?? new Error('database unavailable'));
      });
      await new Promise<void>((resolveWrite, reject) => {
        const transaction = database.transaction('captures', 'readwrite');
        transaction.objectStore('captures').put({ id: 'viewer-test', blob, width: 2, height: 2, title: 'Viewer test', createdAt: Date.now() });
        transaction.oncomplete = () => resolveWrite(); transaction.onerror = () => reject(transaction.error ?? new Error('write unavailable'));
      });
      database.close();
    });
    await page.goto(`chrome-extension://${extensionId}/src/viewer/viewer.html?id=viewer-test`);
    await expect(page.getByRole('heading', { name: 'Viewer test' })).toBeVisible();
    await expect(page.getByAltText('캡처 결과')).toBeVisible();
    await expect(page.getByRole('button', { name: '축소' })).toBeVisible();
    await expect(page.getByRole('button', { name: '확대' })).toBeVisible();
    await expect(page.getByRole('button', { name: '클립보드 복사' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PNG 저장' })).toBeVisible();
    await page.getByRole('button', { name: '확대' }).click();
    await expect(page.locator('#zoom-value')).not.toHaveText('100%');
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
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><a id="target" href="#clicked" style="display:block;width:160px;height:80px">Target</a><div style="height:2000px"></div>');
    await page.evaluate(() => {
      const testWindow = window as Window & { measureListener?: (...args: unknown[]) => unknown; linkClicks?: number };
      testWindow.linkClicks = 0;
      document.getElementById('target')?.addEventListener('click', () => { testWindow.linkClicks = (testWindow.linkClicks ?? 0) + 1; });
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: {
          addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.measureListener = listener; },
          removeListener: (listener: (...args: unknown[]) => unknown) => {
            if (testWindow.measureListener === listener) delete testWindow.measureListener;
          },
        },
        sendMessage: () => Promise.resolve({ ok: false, error: 'capture unavailable in test' }),
      } });
      Object.defineProperty(window.chrome, 'storage', { configurable: true, value: {
        local: { get: () => Promise.resolve({ measurementUnit: 'px' }) },
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
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-pointer-aids', 'hidden');
    await page.mouse.move(40, 30); await page.mouse.down(); await page.mouse.move(120, 90, { steps: 3 }); await page.mouse.up();
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-locked');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'idle');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 80, y: 180 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: 80, y: 60 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(() => {
      const dispatch = (type: string, x: number, y: number): void => {
        window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'pen', isPrimary: true, button: 0, clientX: x, clientY: y }));
      };
      dispatch('pointerdown', 80, 180);
      dispatch('pointermove', 80, 60);
      dispatch('pointerup', 80, 60);
    });
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'area');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-pointer-aids', 'hidden');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-pixelscope-touch-drag');
    const areaTopBeforeScroll = await page.locator('[data-pixelscope-overlay]').evaluate((host) => {
      const box = host.shadowRoot?.querySelector<HTMLElement>('.box');
      return Number.parseFloat(box?.style.top ?? 'NaN');
    });
    const visibilityMutations = await page.locator('[data-pixelscope-overlay]').evaluate(async (host) => new Promise<number>((resolveMutations) => {
      let mutations = 0;
      const observer = new MutationObserver(() => { mutations += 1; });
      observer.observe(host, { attributes: true, attributeFilter: ['style'] });
      window.scrollTo(0, 300);
      window.setTimeout(() => { observer.disconnect(); resolveMutations(mutations); }, 350);
    }));
    expect(visibilityMutations).toBe(0);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'area');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
    await expect.poll(() => page.locator('[data-pixelscope-overlay]').evaluate((host) => {
      const box = host.shadowRoot?.querySelector<HTMLElement>('.box');
      return Number.parseFloat(box?.style.top ?? 'NaN');
    })).toBe(areaTopBeforeScroll - 300);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#target').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 40, clientY: 30 });
    await page.locator('#target').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 40, clientY: 30 });
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-locked');
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);
    await page.evaluate(async () => {
      const testWindow = window as Window & { measureListener?: (...args: unknown[]) => unknown };
      await new Promise<void>((resolveActivation) => {
        testWindow.measureListener?.({ type: 'TOOL_COMMAND', tool: 'measure' }, {}, () => resolveActivation());
      });
    });
    await page.mouse.move(40, 30);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);
    await page.locator('#target').click();
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(1);
  } finally { await context.close(); }
});
