import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('privacy policy is bundled as a public standalone page', async () => {
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
    await page.goto(`chrome-extension://${extensionId}/privacy-policy.html`);
    await expect(page.getByRole('heading', { name: '개인정보처리방침', exact: true })).toBeVisible();
    await expect(page.getByText('PixelScope는 사용자의 데이터를 외부 서버로 전송하지 않습니다.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '2. 처리하는 데이터' })).toBeVisible();
    await expect(page.locator('script')).toHaveCount(0);
  } finally { await context.close(); }
});

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
    await expect(page.locator('.app-logo')).toHaveAttribute('src', '/icons/icon-48.png');
    await expect(page.getByRole('button', { name: '영역 측정', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '컬러 피커', exact: true })).toBeVisible();
    await expect(page.locator('#status')).toHaveCount(0);
    await expect(page.locator('.summary-copy small, .capture-actions small')).toHaveCount(0);
    const measureMore = page.locator('button[aria-controls="measure-options"]');
    const colorMore = page.locator('button[aria-controls="color-options"]');
    await expect(measureMore.locator('path')).toHaveAttribute('d', 'm6 8 4 4 4-4');
    await expect(measureMore.locator('circle')).toHaveCount(0);
    await expect(page.getByText('캡처가 끝나면 복사·저장·확대가 가능한 새 뷰어 탭이 열립니다.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('선택 영역의 너비와 높이에 적용됩니다.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('색상을 복사한 뒤에도 피커는 계속 활성화됩니다.', { exact: true })).toHaveCount(0);
    await expect(measureMore).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '영역 측정', exact: true })).toHaveAttribute('aria-pressed', 'false');
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
    await expect(page.locator('#capture-state')).toBeHidden();
    await expect(page.locator('#capture-state-label')).toHaveText('캡처 페이지 계산 중');
    await expect(page.locator('[data-tool-card="capture"] .tool-panel')).toHaveCSS('grid-template-rows', /\d+px/);
    expect(await page.evaluate(() => document.getElementById('measure-options')?.closest('[data-tool-card]')?.getAttribute('data-tool-card'))).toBe('measure');
    expect(await page.evaluate(() => document.getElementById('color-options')?.closest('[data-tool-card]')?.getAttribute('data-tool-card'))).toBe('color-picker');
    await expect(page.getByText('복사 후 계속 선택', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('복사 형식')).toHaveValue('rgb');
    await expect(page.getByLabel('측정 단위')).toHaveValue('rem');
    await page.evaluate(() => {
      document.body.classList.add('capture-running');
      const captureState = document.getElementById('capture-state');
      const stop = document.getElementById('stop');
      if (captureState !== null) captureState.hidden = false;
      if (stop !== null) stop.hidden = false;
    });
    await expect(page.locator('#capture-state')).toBeVisible();
    await expect(page.locator('#stop')).toBeVisible();
    await expect(page.locator('[data-tool-card="measure"]')).toBeHidden();
    await expect(page.locator('[data-tool-card="color-picker"]')).toBeHidden();
    await expect(page.locator('[data-tool-card="capture"]')).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  } finally { await context.close(); }
});

test('capture viewer loads ephemeral PNG and supports pixel-accurate crop and export actions', async () => {
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
      const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80;
      const context = canvas.getContext('2d'); if (context === null) throw new Error('canvas unavailable');
      context.fillStyle = '#38bdf8'; context.fillRect(0, 0, 100, 80);
      const blob = await new Promise<Blob>((resolveBlob, reject) => canvas.toBlob((value) => value === null ? reject(new Error('blob unavailable')) : resolveBlob(value), 'image/png'));
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open('pixelscope-captures', 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('captures')) request.result.createObjectStore('captures', { keyPath: 'id' }); };
        request.onsuccess = () => resolveDatabase(request.result); request.onerror = () => reject(request.error ?? new Error('database unavailable'));
      });
      await new Promise<void>((resolveWrite, reject) => {
        const transaction = database.transaction('captures', 'readwrite');
        transaction.objectStore('captures').put({ id: 'viewer-test', blob, width: 100, height: 80, title: 'Viewer test', createdAt: Date.now() });
        transaction.oncomplete = () => resolveWrite(); transaction.onerror = () => reject(transaction.error ?? new Error('write unavailable'));
      });
      database.close();
    });
    await page.goto(`chrome-extension://${extensionId}/src/viewer/viewer.html?id=viewer-test`);
    await expect(page.getByRole('heading', { name: 'Viewer test' })).toBeVisible();
    await expect(page.getByAltText('캡처 결과')).toBeVisible();
    await expect(page.getByText('캡처 이미지를 준비하고 있습니다', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: '축소' })).toBeVisible();
    await expect(page.getByRole('button', { name: '확대' })).toBeVisible();
    const cropButton = page.getByRole('button', { name: '크롭', exact: true });
    const copyButton = page.getByRole('button', { name: '클립보드 복사' });
    const downloadButton = page.getByRole('button', { name: 'PNG 저장' });
    await expect(cropButton).toBeVisible();
    await expect(cropButton.locator('.button-icon')).toBeVisible();
    await expect(cropButton.locator('span')).toHaveCount(0);
    await expect(copyButton.locator('.button-icon')).toBeVisible();
    await expect(copyButton.locator('span')).toHaveText('클립보드 복사');
    await expect(downloadButton.locator('.button-icon')).toBeVisible();
    await expect(downloadButton.locator('span')).toHaveText('PNG 저장');
    await expect(page.getByRole('button', { name: '원본 복원' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Chrome 저장' })).toHaveCount(0);
    expect(await page.evaluate(() => chrome.runtime.getManifest().permissions?.includes('downloads'))).toBe(false);
    await page.getByRole('button', { name: '확대' }).click();
    await expect(page.locator('#zoom-value')).not.toHaveText('100%');
    await page.getByRole('button', { name: '크롭', exact: true }).click();
    await expect(page.locator('#crop-toolbar')).toBeVisible();
    await expect(page.getByLabel('크롭할 영역을 드래그하세요. 위쪽 숫자 입력으로도 조정할 수 있습니다.')).toBeFocused();
    const cropLayer = page.locator('#crop-layer');
    const bounds = await cropLayer.boundingBox();
    if (bounds === null) throw new Error('crop layer unavailable');
    await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#crop-width')).toHaveValue('50');
    await expect(page.locator('#crop-height')).toHaveValue('40');
    await page.getByRole('button', { name: '크롭 적용' }).click();
    await expect(page.locator('#meta')).toContainText('50 × 40 px');
    await expect(page.getByRole('button', { name: '원본 복원' })).toBeVisible();
    await page.getByRole('button', { name: '원본 복원' }).click();
    await expect(page.locator('#meta')).toContainText('100 × 80 px');
    await page.setViewportSize({ width: 375, height: 720 });
    await page.getByRole('button', { name: '크롭', exact: true }).click();
    expect(await page.locator('.zoom').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#crop-toolbar')).toBeHidden();
  } finally { await context.close(); }
});

test('object capture suppresses a fixed header and restores page styles', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<style>::-webkit-scrollbar{width:20px;height:20px}#header{position:fixed;inset:0 0 auto;height:60px;visibility:visible!important;background:white;z-index:9997}#floating{position:fixed;right:16px;bottom:16px;width:64px;height:64px;background:blue;z-index:9998}#absolute{position:absolute;top:90px;right:10px;width:80px;height:40px;background:red}#target{margin-top:80px;width:760px;height:1400px;background:linear-gradient(#123,#def)}</style><header id="header">Header</header><aside id="floating">Chat</aside><div id="shadow-widget"></div><aside id="absolute">Absolute</aside><div id="target">Target</div>`);
    await page.evaluate(() => {
      const shadowHost = document.getElementById('shadow-widget');
      const shadowRoot = shadowHost?.attachShadow({ mode: 'open' });
      const shadowButton = document.createElement('button');
      shadowButton.id = 'shadow-floating';
      shadowButton.textContent = 'Help';
      shadowButton.style.cssText = 'position:fixed;right:16px;bottom:96px;width:64px;height:64px';
      shadowRoot?.append(shadowButton);
      const testWindow = window as Window & {
        captureListener?: (...args: unknown[]) => unknown;
        captureRequested?: boolean;
        captureRequest?: { viewport?: { width?: number }; screenshotViewport?: { width?: number } };
        resolveCapture?: (response: { ok: false; error: string }) => void;
      };
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: {
          addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.captureListener = listener; },
          removeListener: () => undefined,
        },
        sendMessage: (message: { type?: string; viewport?: { width?: number }; screenshotViewport?: { width?: number } }) => {
          if (message.type !== 'CAPTURE_DOCUMENT') return Promise.resolve({ ok: true });
          testWindow.captureRequested = true;
          testWindow.captureRequest = message;
          return new Promise((resolveCapture) => { testWindow.resolveCapture = resolveCapture; });
        },
      } });
      Object.defineProperty(window.chrome, 'storage', { configurable: true, value: { local: { get: () => Promise.resolve({}) } } });
    });
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await page.evaluate(async () => {
      const listener = (window as Window & { captureListener?: (...args: unknown[]) => unknown }).captureListener;
      await new Promise<void>((resolveActivation) => listener?.({ type: 'TOOL_COMMAND', tool: 'capture-element' }, {}, () => resolveActivation()));
    });
    await page.mouse.move(300, 200);
    await page.mouse.click(300, 200);
    await expect.poll(() => page.evaluate(() => (window as Window & { captureRequested?: boolean }).captureRequested)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const request = (window as Window & { captureRequest?: { viewport?: { width?: number }; screenshotViewport?: { width?: number } } }).captureRequest;
      return (request?.screenshotViewport?.width ?? 0) - (request?.viewport?.width ?? 0);
    })).toBe(20);
    await page.evaluate(async () => {
      const listener = (window as Window & { captureListener?: (...args: unknown[]) => unknown }).captureListener;
      await new Promise<void>((resolveScroll) => listener?.(
        { type: 'CAPTURE_SCROLL_TO', position: { x: 0, y: 0 }, suppressViewportFixed: false },
        {},
        () => resolveScroll(),
      ));
    });
    await expect(page.locator('#header')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#floating')).toHaveCSS('visibility', 'visible');
    await expect.poll(() => page.locator('#shadow-widget').evaluate((element) => {
      const button = element.shadowRoot?.getElementById('shadow-floating');
      return button instanceof HTMLElement ? getComputedStyle(button).visibility : null;
    })).toBe('visible');
    await page.evaluate(async () => {
      const listener = (window as Window & { captureListener?: (...args: unknown[]) => unknown }).captureListener;
      await new Promise<void>((resolveScroll) => listener?.(
        { type: 'CAPTURE_SCROLL_TO', position: { x: 0, y: 600 }, suppressViewportFixed: true },
        {},
        () => resolveScroll(),
      ));
    });
    await expect(page.locator('#header')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#header')).toHaveAttribute('data-pixelscope-capture-fixed', '');
    await expect(page.locator('#floating')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#floating')).toHaveAttribute('data-pixelscope-capture-fixed', '');
    await expect(page.locator('#shadow-widget')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#shadow-widget')).not.toHaveAttribute('data-pixelscope-capture-fixed');
    await expect.poll(() => page.locator('#shadow-widget').evaluate((element) => {
      const button = element.shadowRoot?.getElementById('shadow-floating');
      return button instanceof HTMLElement ? getComputedStyle(button).visibility : null;
    })).toBe('hidden');
    await expect(page.locator('#absolute')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#absolute')).not.toHaveAttribute('data-pixelscope-capture-fixed');
    await expect(page.locator('[data-pixelscope-capture-preparation]')).toHaveCount(1);
    await page.evaluate(() => {
      (window as Window & { resolveCapture?: (response: { ok: false; error: string }) => void }).resolveCapture?.({ ok: false, error: 'test capture finished' });
    });
    await expect(page.locator('#header')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#header')).not.toHaveAttribute('data-pixelscope-capture-fixed');
    await expect(page.locator('#floating')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#floating')).not.toHaveAttribute('data-pixelscope-capture-fixed');
    await expect.poll(() => page.locator('#shadow-widget').evaluate((element) => {
      const button = element.shadowRoot?.getElementById('shadow-floating');
      return button instanceof HTMLElement ? getComputedStyle(button).visibility : null;
    })).toBe('visible');
    await expect(page.locator('[data-pixelscope-capture-preparation]')).toHaveCount(0);
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
