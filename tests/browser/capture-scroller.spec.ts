import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { resolve } from 'node:path';

const PAGE_URL = 'http://pixelscope.test/';
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 128, 0];
const YELLOW = [255, 255, 0];
const GRAY = [128, 128, 128];

/**
 * App-shell layout: the document is locked and an inner <main> scrolls, next to a full-height
 * gray sidebar. Content: 300px red, a 1000px blue card with a 100px yellow bottom border, 200px green.
 */
const APP_SHELL = `<!doctype html><title>shell</title><style>
  html { overflow: hidden; } body { margin: 0; height: 100vh; }
  aside { position: fixed; inset: 0 auto 0 0; width: 200px; background: rgb(128, 128, 128); }
  main { position: absolute; inset: 0 0 0 200px; overflow: auto; }
  #head { height: 300px; background: rgb(255, 0, 0); }
  #card { height: 900px; background: rgb(0, 0, 255); border-bottom: 100px solid rgb(255, 255, 0); }
  #tail { height: 200px; background: rgb(0, 128, 0); }
</style><aside></aside><main><div id="head"></div><div id="card"></div><div id="tail"></div></main>`;

/**
 * Naver-blog layout: the top document is locked and the whole post lives in a full-window
 * same-origin iframe whose own document scrolls. Same 1500px content as the app shell.
 */
const FRAME_HOST = `<!doctype html><title>frame host</title><style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  #mainFrame { display: block; width: 100%; height: 100%; border: 0; }
</style><iframe id="mainFrame" src="/post.html" title="post"></iframe>`;
const FRAME_POST = `<!doctype html><title>post</title><style>
  body { margin: 0; }
  #head { height: 300px; background: rgb(255, 0, 0); }
  #card { height: 900px; background: rgb(0, 0, 255); border-bottom: 100px solid rgb(255, 255, 0); }
  #tail { height: 200px; background: rgb(0, 128, 0); }
</style><div id="head"></div><div id="card"></div><div id="tail"></div>`;

async function launch(): Promise<{ context: BrowserContext; worker: Worker; extensionId: string }> {
  const extensionPath = resolve(import.meta.dirname, '../../dist');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 800, height: 600 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  return { context, worker, extensionId: new URL(worker.url()).host };
}

async function openShell(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: APP_SHELL }));
  await page.goto(PAGE_URL);
  return page;
}

async function openFrameHost(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: route.request().url().endsWith('/post.html') ? FRAME_POST : FRAME_HOST,
  }));
  await page.goto(PAGE_URL);
  await expect(page.frameLocator('#mainFrame').locator('#card')).toBeVisible();
  return page;
}

async function activate(context: BrowserContext, worker: Worker, extensionId: string, page: Page, tool: 'capture-page' | 'capture-element'): Promise<void> {
  const tabId = await worker.evaluate(async (url: string) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id ?? null, PAGE_URL);
  expect(tabId).not.toBeNull();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  // captureVisibleTab only accepts the active tab, so the page goes back in front before activation.
  await page.bringToFront();
  const response = await popup.evaluate(async ([targetTabId, activeTool]) => JSON.stringify(
    await chrome.runtime.sendMessage({ type: 'ACTIVATE_TOOL', tabId: targetTabId, tool: activeTool }) ?? null,
  ), [tabId, tool] as const);
  expect(JSON.parse(response)).toMatchObject({ ok: true, tool });
}

interface CaptureResult {
  readonly width: number;
  readonly height: number;
  pixel(x: number, y: number): Promise<number[]>;
}

async function readCapture(context: BrowserContext): Promise<CaptureResult> {
  const viewer = await context.waitForEvent('page', { predicate: (candidate) => candidate.url().includes('/src/viewer/viewer.html'), timeout: 20_000 });
  const image = viewer.locator('#capture');
  await expect(image).toBeVisible({ timeout: 20_000 });
  const size = await image.evaluate((element: HTMLImageElement) => element.decode().then(() => ({ width: element.naturalWidth, height: element.naturalHeight })));
  return {
    ...size,
    pixel: (x, y) => image.evaluate((element: HTMLImageElement, [px, py]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const context2d = canvas.getContext('2d');
      if (context2d === null) throw new Error('test canvas unavailable');
      context2d.drawImage(element, px, py, 1, 1, 0, 0, 1, 1);
      return Array.from(context2d.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, [x, y] as const),
  };
}

function expectColor(actual: number[], expected: number[]): void {
  for (const [index, channel] of expected.entries()) expect(Math.abs((actual[index] ?? -1) - channel)).toBeLessThanOrEqual(8);
}

test('full-page capture grows an app-shell inner scroller and keeps the sidebar frame', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openShell(context);
    await activate(context, worker, extensionId, page, 'capture-page');
    const capture = await readCapture(context);
    const scale = capture.width / 800;
    expect(capture.height).toBe(Math.ceil(1_500 * scale));
    expectColor(await capture.pixel(400 * scale, 100 * scale), RED);
    expectColor(await capture.pixel(400 * scale, 700 * scale), BLUE);
    expectColor(await capture.pixel(400 * scale, 1_250 * scale), YELLOW);
    expectColor(await capture.pixel(400 * scale, 1_450 * scale), GREEN);
    // The sidebar column below the original viewport is filled from its bottom edge.
    expectColor(await capture.pixel(100 * scale, 1_450 * scale), GRAY);
    await expect.poll(() => page.locator('main').evaluate((element) => element.scrollTop)).toBe(0);
  } finally { await context.close(); }
});

test('element capture scrolls the clipping inner container to capture the whole element', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openShell(context);
    const mainWidth = await page.locator('main').evaluate((element) => element.clientWidth);
    await activate(context, worker, extensionId, page, 'capture-element');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.mouse.move(400, 450);
    await page.mouse.down();
    await page.mouse.up();
    const capture = await readCapture(context);
    const scale = capture.width / mainWidth;
    expect(capture.height).toBe(Math.ceil(1_000 * scale));
    expectColor(await capture.pixel(10 * scale, 50 * scale), BLUE);
    expectColor(await capture.pixel(10 * scale, 850 * scale), BLUE);
    expectColor(await capture.pixel(10 * scale, 950 * scale), YELLOW);
    await expect.poll(() => page.locator('main').evaluate((element) => element.scrollTop)).toBe(0);
  } finally { await context.close(); }
});

test('element capture of a scroll container captures its entire scrolled content', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openShell(context);
    // Leave room at the bottom of the scroller so the click lands on <main> itself.
    await page.locator('#tail').evaluate((element) => { element.style.height = '200px'; element.style.marginRight = '100px'; });
    const mainWidth = await page.locator('main').evaluate((element) => { element.scrollTop = 1_000; return element.clientWidth; });
    await activate(context, worker, extensionId, page, 'capture-element');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.mouse.move(200 + mainWidth - 50, 550);
    await page.mouse.down();
    await page.mouse.up();
    const capture = await readCapture(context);
    const scale = capture.width / mainWidth;
    expect(capture.height).toBe(Math.ceil(1_500 * scale));
    expectColor(await capture.pixel(10 * scale, 100 * scale), RED);
    expectColor(await capture.pixel(10 * scale, 1_250 * scale), YELLOW);
    await expect.poll(() => page.locator('main').evaluate((element) => element.scrollTop)).toBe(900);
  } finally { await context.close(); }
});

test('element capture selects inside a same-origin iframe and scrolls that frame to capture the whole element', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openFrameHost(context);
    const frame = page.frameLocator('#mainFrame');
    const cardWidth = await frame.locator('#card').evaluate((element) => element.getBoundingClientRect().width);
    await activate(context, worker, extensionId, page, 'capture-element');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.mouse.move(400, 450);
    await page.mouse.down();
    await page.mouse.up();
    const capture = await readCapture(context);
    const scale = capture.width / cardWidth;
    expect(capture.height).toBe(Math.ceil(1_000 * scale));
    expectColor(await capture.pixel(10 * scale, 50 * scale), BLUE);
    expectColor(await capture.pixel(10 * scale, 850 * scale), BLUE);
    expectColor(await capture.pixel(10 * scale, 950 * scale), YELLOW);
    await expect.poll(() => frame.locator('html').evaluate((element) => element.ownerDocument.defaultView?.scrollY ?? -1)).toBe(0);
  } finally { await context.close(); }
});

test('full-page capture scrolls a full-window same-origin iframe document', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openFrameHost(context);
    await activate(context, worker, extensionId, page, 'capture-page');
    const capture = await readCapture(context);
    const scale = capture.width / 800;
    expect(capture.height).toBe(Math.ceil(1_500 * scale));
    expectColor(await capture.pixel(400 * scale, 100 * scale), RED);
    expectColor(await capture.pixel(400 * scale, 700 * scale), BLUE);
    expectColor(await capture.pixel(400 * scale, 1_250 * scale), YELLOW);
    expectColor(await capture.pixel(400 * scale, 1_450 * scale), GREEN);
  } finally { await context.close(); }
});

/** Shared 1500px post: 300px red, 1000px blue card with a 100px yellow bottom border, 200px green. */
const POST_STYLE = `#head { height: 300px; background: rgb(255, 0, 0); }
  #card { height: 900px; background: rgb(0, 0, 255); border-bottom: 100px solid rgb(255, 255, 0); }
  #tail { height: 200px; background: rgb(0, 128, 0); }`;
const POST_BODY = '<div id="head"></div><div id="card"></div><div id="tail"></div>';

async function openPages(context: BrowserContext, pages: Readonly<Record<string, string>>): Promise<Page> {
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: pages[new URL(route.request().url()).pathname] ?? pages['/'] ?? '',
  }));
  await page.goto(PAGE_URL);
  return page;
}

async function expectFullPost(capture: CaptureResult, cssWidth: number, x: number): Promise<void> {
  const scale = capture.width / cssWidth;
  expect(capture.height).toBe(Math.ceil(1_500 * scale));
  expectColor(await capture.pixel(x * scale, 100 * scale), RED);
  expectColor(await capture.pixel(x * scale, 700 * scale), BLUE);
  expectColor(await capture.pixel(x * scale, 1_250 * scale), YELLOW);
  expectColor(await capture.pixel(x * scale, 1_450 * scale), GREEN);
}

test('full-page capture scrolls <body> when the root is locked and the body is the scroller', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openPages(context, { '/': `<!doctype html><title>body scroller</title><style>
      html { height: 100%; overflow: hidden; } body { margin: 0; height: 100%; overflow: auto; } ${POST_STYLE}
    </style>${POST_BODY}` });
    await activate(context, worker, extensionId, page, 'capture-page');
    await expectFullPost(await readCapture(context), 800, 400);
  } finally { await context.close(); }
});

test('full-page capture finds a scroller inside an open shadow root', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openPages(context, { '/': `<!doctype html><title>shadow scroller</title><style>
      html, body { margin: 0; height: 100%; overflow: hidden; } app-root { display: block; height: 100%; }
    </style><app-root><template shadowrootmode="open"><style>
      .scroll { height: 100%; overflow: auto; } ${POST_STYLE}
    </style><div class="scroll">${POST_BODY}</div></template></app-root>` });
    await activate(context, worker, extensionId, page, 'capture-page');
    await expectFullPost(await readCapture(context), 800, 400);
  } finally { await context.close(); }
});

test('element capture selects an element inside an open shadow root instead of its host', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openPages(context, { '/': `<!doctype html><title>shadow element</title><style>
      body { margin: 0; } #host { display: block; width: 600px; height: 400px; background: rgb(128, 128, 128); }
    </style><div id="host"><template shadowrootmode="open"><style>
      #inner { width: 200px; height: 150px; margin: 50px; background: rgb(255, 0, 0); border-top: 30px solid rgb(0, 0, 255); }
    </style><div id="inner"></div></template></div>` });
    await activate(context, worker, extensionId, page, 'capture-element');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.mouse.move(150, 160);
    await page.mouse.down();
    await page.mouse.up();
    const capture = await readCapture(context);
    const scale = capture.width / 200;
    expect(capture.height).toBe(Math.ceil(180 * scale));
    expectColor(await capture.pixel(100 * scale, 10 * scale), BLUE);
    expectColor(await capture.pixel(100 * scale, 120 * scale), RED);
  } finally { await context.close(); }
});

test('full-page capture finds an app-shell scroller inside a same-origin iframe', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openPages(context, { '/': FRAME_HOST, '/post.html': APP_SHELL });
    await expect(page.frameLocator('#mainFrame').locator('#card')).toBeVisible();
    await activate(context, worker, extensionId, page, 'capture-page');
    const capture = await readCapture(context);
    await expectFullPost(capture, 800, 400);
    // The gray sidebar beside the frame's scroller is kept and extended down the grown image.
    const scale = capture.width / 800;
    expectColor(await capture.pixel(100 * scale, 1_450 * scale), GRAY);
  } finally { await context.close(); }
});

test('element capture brings a scroll box that straddles the fold into view before tiling it', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    // The horizontally scrolling box spans y 400–800 in a 600px viewport, so its bottom starts hidden.
    const page = await openPages(context, { '/': `<!doctype html><title>fold</title><style>
      body { margin: 0; } #spacer { height: 400px; } #box { height: 400px; overflow-x: auto; overflow-y: hidden; }
      #wide { width: 1600px; height: 385px; background: linear-gradient(to bottom, rgb(255, 0, 0) 0 300px, rgb(255, 255, 0) 300px 385px); }
      #after { height: 2000px; }
    </style><div id="spacer"></div><div id="box"><div id="wide"></div></div><div id="after"></div>` });
    await activate(context, worker, extensionId, page, 'capture-element');
    await expect(page.locator('[data-pixelscope-overlay]')).toHaveCount(1);
    await page.mouse.move(400, 500);
    await page.mouse.down();
    await page.mouse.up();
    const capture = await readCapture(context);
    const scale = capture.width / 1_600;
    expect(capture.height).toBe(Math.ceil(385 * scale));
    expectColor(await capture.pixel(100 * scale, 100 * scale), RED);
    expectColor(await capture.pixel(100 * scale, 350 * scale), YELLOW);
    expectColor(await capture.pixel(1_500 * scale, 350 * scale), YELLOW);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  } finally { await context.close(); }
});

test('full-page capture tiles the scrolling body of a modal <dialog>', async () => {
  const { context, worker, extensionId } = await launch();
  try {
    const page = await openPages(context, { '/': `<!doctype html><title>dialog</title><style>
      body { margin: 0; } dialog { width: 600px; height: 450px; padding: 0; border: 0; }
      .scroll { height: 100%; overflow: auto; } ${POST_STYLE}
    </style><p>behind</p><dialog><div class="scroll">${POST_BODY}</div></dialog>
    <script>document.querySelector('dialog').showModal();</script>` });
    const scrollWidth = await page.locator('dialog .scroll').evaluate((element) => element.clientWidth);
    await activate(context, worker, extensionId, page, 'capture-page');
    await expectFullPost(await readCapture(context), scrollWidth, 100);
  } finally { await context.close(); }
});
