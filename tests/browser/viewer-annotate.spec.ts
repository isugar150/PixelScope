import { chromium, expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PAGE_URL = 'http://pixelscope.test/';
// White page whose top-left 400×300 is 2px black/white stripes, so a mosaic visibly averages to gray.
const PAGE = `<!doctype html><title>annotate</title><style>
  html, body { margin: 0; background: #fff; }
  #stripes { width: 400px; height: 300px; background: repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px); }
</style><div id="stripes"></div>`;

type Rgb = readonly number[];

/** Samples pixels from a PNG data URL inside the viewer page. */
async function samplePng(viewer: Page, dataUrl: string, points: readonly (readonly [number, number])[]): Promise<Rgb[]> {
  return viewer.evaluate(async ([url, samplePoints]) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('test canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    return samplePoints.map(([x, y]) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
  }, [dataUrl, points.map(([x, y]) => [x, y] as [number, number])] as const);
}

function expectNear(actual: Rgb | undefined, expected: Rgb): void {
  for (const [index, channel] of expected.entries()) expect(Math.abs((actual?.[index] ?? -999) - channel)).toBeLessThanOrEqual(10);
}

test('viewer draws pen, shape and mosaic annotations and flattens them into copy and download', async () => {
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
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(PAGE_URL);
    const tabId = await worker.evaluate(async (url: string) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id ?? null, PAGE_URL);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await page.bringToFront();
    const viewerPromise = context.waitForEvent('page', { predicate: (candidate) => candidate.url().includes('/src/viewer/viewer.html'), timeout: 20_000 });
    await popup.evaluate((targetTabId) => chrome.runtime.sendMessage({ type: 'ACTIVATE_TOOL', tabId: targetTabId, tool: 'capture-page' }), tabId);

    const viewer = await viewerPromise;
    await viewer.setViewportSize({ width: 1100, height: 900 });
    const image = viewer.locator('#capture');
    await expect(image).toBeVisible({ timeout: 20_000 });
    await viewer.evaluate(() => {
      const testWindow = window as Window & { copiedPng?: string };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0]?.getType('image/png');
          if (blob === undefined) throw new Error('no png');
          testWindow.copiedPng = await new Promise<string>((done) => {
            const reader = new FileReader();
            reader.onload = () => done(typeof reader.result === 'string' ? reader.result : '');
            reader.readAsDataURL(blob);
          });
        },
      } });
    });
    const copy = async (): Promise<string> => {
      await viewer.evaluate(() => { delete (window as Window & { copiedPng?: string }).copiedPng; });
      await viewer.keyboard.press('Control+KeyC');
      await expect.poll(() => viewer.evaluate(() => (window as Window & { copiedPng?: string }).copiedPng ?? null)).not.toBeNull();
      return viewer.evaluate(() => (window as Window & { copiedPng?: string }).copiedPng ?? '');
    };

    // Page CSS pixels → captured image pixels → viewer screen pixels.
    const scale = await image.evaluate((element: HTMLImageElement) => element.naturalWidth / 800);
    const toScreen = async (x: number, y: number): Promise<{ x: number; y: number }> => {
      const box = await image.boundingBox();
      const natural = await image.evaluate((element: HTMLImageElement) => ({ width: element.naturalWidth, height: element.naturalHeight }));
      if (box === null) throw new Error('image not laid out');
      return { x: box.x + x * scale * box.width / natural.width, y: box.y + y * scale * box.height / natural.height };
    };
    const drag = async (from: readonly [number, number], to: readonly [number, number]): Promise<void> => {
      // Playwright's click() scrolls even sticky-header buttons into view; keep the image below the header.
      await viewer.evaluate(() => { window.scrollTo(0, 0); });
      const start = await toScreen(...from);
      const end = await toScreen(...to);
      await viewer.mouse.move(start.x, start.y);
      await viewer.mouse.down();
      await viewer.mouse.move(end.x, end.y, { steps: 8 });
      await viewer.mouse.up();
    };
    const px = (x: number, y: number): [number, number] => [x * scale, y * scale];

    await viewer.locator('#annotate').click();
    await expect(viewer.locator('#annotate')).toHaveAttribute('aria-pressed', 'true');
    await expect(viewer.locator('#annotate-toolbar')).toBeVisible();

    await viewer.locator('[data-annotate-tool="rect"]').click();
    await drag([500, 100], [700, 250]);
    await viewer.locator('[data-annotate-tool="mosaic"]').click();
    await expect(viewer.locator('[data-annotate-color="#3b82f6"]')).toBeDisabled();
    await drag([40, 40], [360, 260]);

    // Fill applies only to rectangles and ellipses.
    await expect(viewer.locator('#annotate-fill')).toBeDisabled();
    await viewer.locator('[data-annotate-tool="ellipse"]').click();
    await viewer.locator('[data-annotate-color="#22c55e"]').click();
    await viewer.locator('#annotate-fill').click();
    await expect(viewer.locator('#annotate-fill')).toHaveAttribute('aria-pressed', 'true');
    await drag([500, 450], [600, 550]);

    await viewer.locator('[data-annotate-tool="pen"]').click();
    await viewer.locator('[data-annotate-color="#3b82f6"]').click();
    await expect(viewer.locator('[data-annotate-color="#3b82f6"]')).toHaveAttribute('aria-pressed', 'true');
    await drag([500, 400], [700, 400]);
    await expect(viewer.locator('#annotate-undo')).toBeEnabled();

    const [firstRectEdge, firstPenLine, mosaic, stripesOutside, blank, ellipseCenter, rectCenter] = await samplePng(viewer, await copy(), [
      px(500, 175), px(600, 400), px(200, 150), px(380, 150), px(760, 560), px(550, 500), px(600, 175),
    ]);
    expectNear(ellipseCenter, [34, 197, 94]);
    expectNear(rectCenter, [255, 255, 255]);
    let rectEdge = firstRectEdge;
    let penLine = firstPenLine;
    expectNear(rectEdge, [239, 68, 68]);
    expectNear(penLine, [59, 130, 246]);
    expect(mosaic?.[0]).toBeGreaterThan(50);
    expect(mosaic?.[0]).toBeLessThan(205);
    // Just outside the mosaic the stripes stay crisp black or white.
    expect(Math.min(stripesOutside?.[0] ?? 128, 255 - (stripesOutside?.[0] ?? 128))).toBeLessThan(30);
    expectNear(blank, [255, 255, 255]);

    // Undo removes only the pen stroke; redo brings it back.
    await viewer.keyboard.press('Control+KeyZ');
    [penLine, rectEdge] = await samplePng(viewer, await copy(), [px(600, 400), px(500, 175)]);
    expectNear(penLine, [255, 255, 255]);
    expectNear(rectEdge, [239, 68, 68]);
    await viewer.keyboard.press('Control+Shift+KeyZ');
    [penLine] = await samplePng(viewer, await copy(), [px(600, 400)]);
    expectNear(penLine, [59, 130, 246]);

    // Leaving draw mode keeps the drawings, and Ctrl+S saves them.
    await viewer.keyboard.press('Escape');
    await expect(viewer.locator('#annotate-toolbar')).toBeHidden();
    await expect(viewer.locator('#annotation-canvas')).toBeVisible();
    const downloadPromise = viewer.waitForEvent('download');
    await viewer.keyboard.press('Control+KeyS');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-annotated\.png$/);
    const downloadPath = await download.path();
    const downloadedUrl = `data:image/png;base64,${(await readFile(downloadPath)).toString('base64')}`;
    [rectEdge, penLine] = await samplePng(viewer, downloadedUrl, [px(500, 175), px(600, 400)]);
    expectNear(rectEdge, [239, 68, 68]);
    expectNear(penLine, [59, 130, 246]);

    // Cropping keeps drawings anchored to the same image content.
    await viewer.locator('#crop').click();
    await viewer.locator('#crop-x').fill(String(400 * scale));
    await viewer.locator('#crop-y').fill(String(50 * scale));
    await viewer.locator('#crop-width').fill(String(400 * scale));
    await viewer.locator('#crop-height').fill(String(400 * scale));
    await viewer.locator('#crop-apply').click();
    await expect(viewer.locator('#reset-crop')).toBeVisible();
    [rectEdge, penLine] = await samplePng(viewer, await copy(), [px(100, 125), px(200, 350)]);
    expectNear(rectEdge, [239, 68, 68]);
    expectNear(penLine, [59, 130, 246]);

    // Clear all is undoable too.
    await viewer.locator('#annotate').click();
    await viewer.locator('#annotate-clear').click();
    await expect(viewer.locator('#annotation-canvas')).toBeHidden();
    await viewer.keyboard.press('Control+KeyZ');
    await expect(viewer.locator('#annotation-canvas')).toBeVisible();
  } finally { await context.close(); }
});
