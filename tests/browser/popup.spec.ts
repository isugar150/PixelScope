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
    await expect(page.getByRole('button', { name: 'CSS 변경 추출', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CSS 변경 추출', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: '우클릭·드래그 해제', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Alt+`');
    await expect(page.getByRole('button', { name: '우클릭·드래그 해제', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#unlock-interactions .lock-shackle')).toHaveCSS('transform', 'none');
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
    await expect(page.getByLabel('X/Y 좌표 표시')).not.toBeChecked();
    await page.getByLabel('측정 단위').selectOption('rem');
    await page.getByLabel('X/Y 좌표 표시').check();
    await colorMore.click();
    await expect(measureMore).toHaveAttribute('aria-expanded', 'false');
    await expect(colorMore).toHaveAttribute('aria-expanded', 'true');
    const screenScope = page.getByRole('radio', { name: '화면 전체' });
    const pageScope = page.getByRole('radio', { name: '웹페이지만' });
    await expect(page.locator('select#color-picker-scope')).toHaveCount(0);
    await expect(screenScope).toBeChecked();
    await screenScope.focus();
    await page.keyboard.press('ArrowRight');
    await expect(pageScope).toBeChecked();
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
    await page.locator('button[aria-controls="color-options"]').click();
    await expect(page.getByRole('radio', { name: '웹페이지만' })).toBeChecked();
    await expect(page.getByLabel('복사 형식')).toHaveValue('rgb');
    await expect(page.getByLabel('측정 단위')).toHaveValue('rem');
    await expect(page.getByLabel('X/Y 좌표 표시')).toBeChecked();
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
    await expect(page.locator('[data-tool-card="css-changes"]')).toBeHidden();
    await expect(page.locator('[data-tool-card="unlock-interactions"]')).toBeHidden();
    await expect(page.locator('[data-tool-card="capture"]')).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  } finally { await context.close(); }
});

test('interaction unlock button animates between closed and open lock states', async () => {
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
    const button = page.locator('#unlock-interactions');
    const shackle = button.locator('.lock-shackle');

    await expect(shackle).toHaveCSS('transform', 'none');
    await button.evaluate((element) => element.setAttribute('aria-pressed', 'true'));
    await expect(shackle).not.toHaveCSS('transform', 'none');
    await button.evaluate((element) => element.setAttribute('aria-pressed', 'false'));
    await expect(shackle).toHaveCSS('transform', 'none');
  } finally { await context.close(); }
});

test('screen picker opens directly inside the trusted popup click', async () => {
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
    await page.evaluate(() => {
      const testWindow = window as Window & { screenPickerUserActivation?: boolean };
      Object.defineProperty(window, 'EyeDropper', {
        configurable: true,
        value: class {
          public open(): Promise<never> {
            testWindow.screenPickerUserActivation = navigator.userActivation.isActive;
            return Promise.reject(new DOMException('cancelled', 'AbortError'));
          }
        },
      });
      Object.defineProperty(chrome.scripting, 'executeScript', { configurable: true, value: () => { throw new Error('screen picker must not be injected'); } });
    });
    await page.locator('button[aria-controls="color-options"]').click();
    await expect(page.getByRole('radio', { name: '화면 전체' })).toBeChecked();
    await page.getByRole('button', { name: '컬러 피커', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { screenPickerUserActivation?: boolean }).screenPickerUserActivation)).toBe(true);
    await expect(page.locator('#error')).toHaveText('');
  } finally { await context.close(); }
});

test('Alt+Backquote unlock shortcut shows a temporary page status toast', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setContent('<p>Protected page text</p>');
    await page.evaluate(() => {
      const testWindow = window as Window & { unlockListener?: (...args: unknown[]) => unknown };
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: {
          addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.unlockListener = listener; },
          removeListener: () => undefined,
        },
        sendMessage: (message: { type?: string }) => {
          if (message.type === 'TOGGLE_PAGE_INTERACTION_UNLOCK') testWindow.unlockListener?.(message, {}, () => undefined);
          return Promise.resolve({ ok: true });
        },
      } });
      Object.defineProperty(window.chrome, 'storage', { configurable: true, value: { local: { get: () => Promise.resolve({}) } } });
    });
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await page.addScriptTag({ path: resolve(extensionPath, 'shortcut-listener.js') });

    await page.keyboard.press('Alt+Backquote');

    await expect(page.locator('html')).toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect(page.locator('[data-pixelscope-interaction-unlock-toast]')).toHaveCount(1);
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.textContent ?? '')).toContain('우클릭·드래그 해제 켜짐');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => {
      const toast = element.shadowRoot?.querySelector('.toast');
      if (toast === undefined || toast === null) return false;
      const rect = toast.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 1
        && Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < 1;
    })).toBe(true);
    await expect(page.locator('[data-pixelscope-interaction-unlock-toast]')).toHaveCount(0, { timeout: 2_000 });
    await expect(page.locator('html')).toHaveAttribute('data-pixelscope-interactions-unlocked', '');

    await page.keyboard.press('Alt+Backquote');
    await expect(page.locator('html')).not.toHaveAttribute('data-pixelscope-interactions-unlocked', '');
    await expect.poll(() => page.locator('[data-pixelscope-interaction-unlock-toast]').evaluate((element) => element.shadowRoot?.textContent ?? '')).toContain('우클릭·드래그 해제 꺼짐');
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
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 160;
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
        transaction.objectStore('captures').put({ id: 'viewer-test', blob, width: 200, height: 160, title: 'Viewer test', createdAt: Date.now() });
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
    await page.getByRole('button', { name: '화면 맞춤' }).click();
    await expect(page.locator('#zoom-value')).toHaveText('100%');
    await page.getByRole('button', { name: '크롭', exact: true }).click();
    await expect(page.locator('#crop-toolbar')).toBeVisible();
    const cropLayer = page.getByRole('region', { name: /크롭 선택 상자입니다/ });
    await expect(cropLayer).toBeFocused();
    await expect(page.locator('#crop-x')).toHaveValue('50');
    await expect(page.locator('#crop-y')).toHaveValue('30');
    await expect(page.locator('#crop-width')).toHaveValue('100');
    await expect(page.locator('#crop-height')).toHaveValue('100');
    await expect(page.locator('[data-crop-handle]')).toHaveCount(8);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#crop-x')).toHaveValue('51');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#crop-x')).toHaveValue('50');

    const southeastHandle = page.locator('[data-crop-handle="se"]');
    const handleBounds = await southeastHandle.boundingBox();
    if (handleBounds === null) throw new Error('crop resize handle unavailable');
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 20, handleBounds.y + handleBounds.height / 2 + 15, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#crop-width')).toHaveValue('120');
    await expect(page.locator('#crop-height')).toHaveValue('115');

    const selectionBounds = await page.locator('#crop-selection').boundingBox();
    if (selectionBounds === null) throw new Error('crop selection unavailable');
    await page.mouse.move(selectionBounds.x + selectionBounds.width / 2, selectionBounds.y + selectionBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(selectionBounds.x + selectionBounds.width / 2 + 10, selectionBounds.y + selectionBounds.height / 2 + 5, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#crop-x')).toHaveValue('60');
    await expect(page.locator('#crop-y')).toHaveValue('35');
    await page.getByRole('button', { name: '크롭 적용' }).click();
    await expect(page.locator('#meta')).toContainText('120 × 115 px');
    await expect(page.getByRole('button', { name: '원본 복원' })).toBeVisible();
    await page.getByRole('button', { name: '원본 복원' }).click();
    await expect(page.locator('#meta')).toContainText('200 × 160 px');
    await page.setViewportSize({ width: 375, height: 720 });
    await page.getByRole('button', { name: '크롭', exact: true }).click();
    expect(await page.locator('.zoom').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#crop-toolbar')).toBeHidden();

    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 2000;
      const context = canvas.getContext('2d'); if (context === null) throw new Error('canvas unavailable');
      context.fillStyle = '#0f172a'; context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolveBlob, reject) => canvas.toBlob((value) => value === null ? reject(new Error('blob unavailable')) : resolveBlob(value), 'image/png'));
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open('pixelscope-captures', 1);
        request.onsuccess = () => resolveDatabase(request.result); request.onerror = () => reject(request.error ?? new Error('database unavailable'));
      });
      await new Promise<void>((resolveWrite, reject) => {
        const transaction = database.transaction('captures', 'readwrite');
        transaction.objectStore('captures').put({ id: 'viewer-tall-test', blob, width: 400, height: 2000, title: 'Tall viewer test', createdAt: Date.now() });
        transaction.oncomplete = () => resolveWrite(); transaction.onerror = () => reject(transaction.error ?? new Error('write unavailable'));
      });
      database.close();
    });
    await page.goto(`chrome-extension://${extensionId}/src/viewer/viewer.html?id=viewer-tall-test`);
    await expect(page.getByAltText('캡처 결과')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 850));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await page.getByRole('button', { name: '크롭', exact: true }).click();
    const expectedVisibleCropY = await page.evaluate(() => {
      const image = document.getElementById('capture');
      const header = document.getElementById('viewer-header');
      if (!(image instanceof HTMLImageElement) || !(header instanceof HTMLElement)) throw new Error('viewer geometry unavailable');
      const imageRect = image.getBoundingClientRect();
      const visibleTop = Math.max(imageRect.top, 0, header.getBoundingClientRect().bottom);
      const visibleBottom = Math.min(imageRect.bottom, window.innerHeight);
      const sourceCenterY = ((visibleTop + visibleBottom) / 2 - imageRect.top) * 2000 / imageRect.height;
      return Math.min(1900, Math.max(0, Math.floor(sourceCenterY - 50)));
    });
    expect(expectedVisibleCropY).not.toBe(950);
    await expect(page.locator('#crop-y')).toHaveValue(String(expectedVisibleCropY));
    const tallSelectionBounds = await page.locator('#crop-selection').boundingBox();
    const tallHeaderBounds = await page.locator('#viewer-header').boundingBox();
    if (tallSelectionBounds === null || tallHeaderBounds === null) throw new Error('visible crop bounds unavailable');
    expect(tallSelectionBounds.y).toBeGreaterThan(tallHeaderBounds.y + tallHeaderBounds.height);
    expect(tallSelectionBounds.y + tallSelectionBounds.height).toBeLessThanOrEqual(600);
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
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 300, y: 200 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><a id="target" href="#clicked" style="display:block;width:160px;height:80px"><span id="child" style="display:block;width:60px;height:30px">Target</span></a><div style="height:2000px"></div>');
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
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-selection-mode', 'active');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-guide-position', 'top');
    await page.mouse.move(140, 10);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-guide-position', 'bottom');
    await page.mouse.move(140, 830);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-guide-position', 'top');
    await page.mouse.move(140, 70);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-hover');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 8, x: 140, y: 70 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(0);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '1');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-coordinates-visible', 'false');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-pointer-aids', 'visible');
    await page.mouse.move(140, 70);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'idle');
    await page.mouse.click(140, 70);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '0');
    await page.mouse.click(140, 70);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '1');
    await page.mouse.move(20, 15);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'element-hover');
    await page.mouse.click(20, 15);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '2');
    await page.mouse.move(20, 15);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'idle');
    await page.mouse.move(200, 120); await page.mouse.down(); await page.mouse.move(300, 180, { steps: 3 }); await page.mouse.up();
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '3');
    await page.mouse.move(250, 150);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-mode', 'idle');
    await page.mouse.click(250, 150);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '2');
    await page.mouse.move(200, 120); await page.mouse.down(); await page.mouse.move(300, 180, { steps: 3 }); await page.mouse.up();
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '3');
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
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '4');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-pointer-aids', 'visible');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-pixelscope-touch-drag', '');
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '4');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-selection-mode', 'viewing');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '4');
    await expect(page.locator('html')).not.toHaveAttribute('data-pixelscope-touch-drag');
    await expect.poll(() => page.locator('html').evaluate((element) => getComputedStyle(element).cursor)).not.toBe('crosshair');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#target').click({ position: { x: 140, y: 70 } });
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(1);
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-measurement-count', '4');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);
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
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveAttribute('data-pixelscope-selection-mode', 'viewing');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(0);
    await page.locator('#target').click();
    await expect.poll(() => page.evaluate(() => (window as Window & { linkClicks?: number }).linkClicks)).toBe(2);
  } finally { await context.close(); }
});
