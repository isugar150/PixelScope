import type { ExtensionMessage, ExtensionResponse } from '../../shared/messages';

export interface CaptureManagerOptions {
  readonly capture: () => Promise<string>;
  readonly load: (dataUrl: string) => Promise<void>;
  readonly beforeCapture?: () => void | Promise<void>;
  readonly afterCapture?: () => void;
  readonly debounceMs?: number;
}

export async function captureVisibleTab(): Promise<string> {
  const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({ type: 'CAPTURE_VISIBLE_TAB' });
  if (!response.ok || response.dataUrl === undefined) throw new Error(response.ok ? '캡처 데이터가 없습니다.' : response.error);
  return response.dataUrl;
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export class CaptureManager {
  readonly #options: CaptureManagerOptions;
  #generation = 0;
  #timer: number | null = null;
  #inFlight = false;
  #pending = false;
  #destroyed = false;

  public constructor(options: CaptureManagerOptions) { this.#options = options; }

  public async refresh(): Promise<boolean> {
    if (this.#destroyed) return false;
    const generation = ++this.#generation;
    if (this.#inFlight) { this.#pending = true; return false; }
    this.#inFlight = true;
    try {
      await this.#options.beforeCapture?.();
      const dataUrl = await this.#options.capture();
      if (generation !== this.#generation) return false;
      await this.#options.load(dataUrl);
      return generation === this.#generation;
    } catch (error: unknown) {
      if (isExtensionContextInvalidated(error)) this.destroy();
      throw error;
    } finally {
      this.#options.afterCapture?.();
      this.#inFlight = false;
      if (this.#pending) { this.#pending = false; this.#refreshSafely(); }
    }
  }

  public schedule(): void {
    if (this.#destroyed) return;
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => { this.#timer = null; this.#refreshSafely(); }, this.#options.debounceMs ?? 180);
  }

  public cancelScheduled(): void {
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = false;
  }

  public destroy(): void {
    this.#destroyed = true;
    this.#generation += 1;
    this.cancelScheduled();
  }

  #refreshSafely(): void {
    void this.refresh().catch(() => undefined);
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}
