import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('CSS changes tool reports CSSOM and inline style edits, resets, and exits with Escape', async () => {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const styleSheetIds: string[] = [];
    cdp.on('CSS.styleSheetAdded', (event) => { styleSheetIds.push(event.header.styleSheetId); });
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await page.setViewportSize({ width: 390, height: 844 });
    const originalCss = '@media (min-width: 300px) { .card { color: red; padding: 8px; } }';
    const styleSheetUrl = `data:text/css;charset=utf-8,${encodeURIComponent(originalCss)}`;
    await page.setContent(`<link id="theme" rel="stylesheet" href="${styleSheetUrl}"><div class="card" id="target">Target</div>`);
    await expect.poll(() => page.locator('#target').evaluate((element) => getComputedStyle(element).color)).toBe('rgb(255, 0, 0)');
    const pageUrl = page.url();
    await page.evaluate(({ baselinePageUrl, baselineStyleSheetUrl, baselineCss }) => {
      const testWindow = window as Window & {
        cssChangesListener?: (...args: unknown[]) => unknown;
        copiedCss?: string;
        baselineRequestUrls?: readonly string[];
      };
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: {
        onMessage: {
          addListener: (listener: (...args: unknown[]) => unknown) => { testWindow.cssChangesListener = listener; },
          removeListener: () => undefined,
        },
        sendMessage: (message: { type?: string; styleSheetUrls?: readonly string[] }) => {
          if (message.type !== 'GET_CSS_BASELINE') return Promise.resolve({ ok: true });
          testWindow.baselineRequestUrls = message.styleSheetUrls;
          return Promise.resolve({
            ok: true,
            cssBaseline: { pageUrl: baselinePageUrl, capturedAt: Date.now(), resources: [{ url: baselineStyleSheetUrl, content: baselineCss }] },
          });
        },
      } });
      Object.defineProperty(window.chrome, 'storage', { configurable: true, value: { local: { get: () => Promise.resolve({}) } } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: (value: string) => { testWindow.copiedCss = value; return Promise.resolve(); },
      } });
    }, { baselinePageUrl: pageUrl, baselineStyleSheetUrl: styleSheetUrl, baselineCss: originalCss });
    let editableStyleSheetId: string | null = null;
    for (const styleSheetId of styleSheetIds) {
      const result = await cdp.send('CSS.getStyleSheetText', { styleSheetId });
      if (result.text.includes('.card')) { editableStyleSheetId = styleSheetId; break; }
    }
    if (editableStyleSheetId === null) throw new Error('editable test stylesheet unavailable');
    await cdp.send('CSS.setStyleSheetText', {
      styleSheetId: editableStyleSheetId,
      text: '@media (min-width: 300px) { .card { color: blue; padding: 8px; } }',
    });
    await page.addScriptTag({ path: resolve(extensionPath, 'content.js') });
    await page.evaluate(async () => {
      const listener = (window as Window & { cssChangesListener?: (...args: unknown[]) => unknown }).cssChangesListener;
      await new Promise<void>((resolveActivation) => listener?.({ type: 'TOOL_COMMAND', tool: 'css-changes' }, {}, () => resolveActivation()));
    });
    await expect.poll(() => page.evaluate(() => (
      window as Window & { baselineRequestUrls?: readonly string[] }
    ).baselineRequestUrls)).toEqual([styleSheetUrl]);
    const overlay = page.locator('[data-pixelscope-css-changes]');
    await expect(overlay).toHaveAttribute('data-pixelscope-css-property-count', '1');
    await page.evaluate(() => {
      const target = document.getElementById('target');
      if (!(target instanceof HTMLElement)) throw new Error('test target unavailable');
      target.style.display = 'grid';
    });
    await expect(overlay).toHaveAttribute('data-pixelscope-css-rule-count', '2');
    await expect(overlay).toHaveAttribute('data-pixelscope-css-property-count', '2');
    await expect.poll(() => overlay.evaluate((host) => host.shadowRoot?.textContent ?? '')).toContain('~ color: red → blue;');
    await expect.poll(() => overlay.evaluate((host) => host.shadowRoot?.textContent ?? '')).toContain('+ display: grid;');
    await expect.poll(() => overlay.evaluate((host) => host.shadowRoot?.textContent ?? '')).toContain('@media (min-width: 300px)');
    await page.getByRole('button', { name: '.card CSS 블록 복사', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { copiedCss?: string }).copiedCss ?? '')).toContain('~ color: red -> blue;');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '.card CSS 블록 삭제', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const sheet = (document.getElementById('theme') as HTMLLinkElement | null)?.sheet;
      const mediaRule = sheet?.cssRules.item(0);
      const rule = mediaRule instanceof CSSMediaRule ? mediaRule.cssRules.item(0) : null;
      return rule instanceof CSSStyleRule ? rule.style.color : null;
    })).toBe('red');
    await expect(overlay).toHaveAttribute('data-pixelscope-css-property-count', '1');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '임의 CSS 초기화', exact: true }).click();
    await expect.poll(() => page.locator('#target').evaluate((element) => element instanceof HTMLElement ? element.style.display : null)).toBe('');
    await expect(overlay).toHaveAttribute('data-pixelscope-css-property-count', '0');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  } finally { await context.close(); }
});
