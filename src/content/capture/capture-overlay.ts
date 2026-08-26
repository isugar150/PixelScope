import type { CaptureRect } from '../../shared/capture';
import { describeElement } from '../measure-utils';

export class CaptureOverlay {
  readonly #host = document.createElement('div');
  readonly #box = document.createElement('div');
  readonly #label = document.createElement('div');
  readonly #progress = document.createElement('section');
  readonly #status = document.createElement('strong');
  readonly #count = document.createElement('span');
  readonly #bar = document.createElement('span');
  readonly #detail = document.createElement('span');
  readonly #stop = document.createElement('button');

  public constructor(onStop: () => void) {
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = this.#host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = styles;
    this.#box.className = 'box'; this.#label.className = 'label'; this.#progress.className = 'progress';
    const header = document.createElement('div'); header.className = 'progress-head';
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
    this.#status.textContent = '캡처 페이지 계산 중'; this.#count.textContent = '준비 중';
    header.append(dot, this.#status, this.#count);
    const track = document.createElement('span'); track.className = 'track'; this.#bar.className = 'bar'; track.append(this.#bar);
    this.#detail.className = 'detail'; this.#detail.textContent = '캡처할 화면을 준비하고 있습니다.';
    this.#stop.type = 'button'; this.#stop.className = 'stop'; this.#stop.textContent = '캡처 중단'; this.#stop.addEventListener('click', onStop);
    this.#progress.append(header, track, this.#detail, this.#stop);
    shadow.append(style, this.#box, this.#label, this.#progress);
    document.documentElement.append(this.#host);
  }

  public get host(): HTMLElement { return this.#host; }

  public renderElement(element: Element): void {
    const rect = element.getBoundingClientRect();
    this.#box.style.cssText = `display:block;left:${String(rect.left)}px;top:${String(rect.top)}px;width:${String(rect.width)}px;height:${String(rect.height)}px`;
    this.#label.textContent = `캡처 · ${describeElement(element)} · ${String(Math.round(rect.width))} × ${String(Math.round(rect.height))} px`;
    this.#label.style.display = 'block';
    const labelTop = rect.top > 34 ? rect.top - 30 : rect.top + 6;
    this.#label.style.transform = `translate3d(${String(Math.max(8, Math.min(rect.left, innerWidth - 280)))}px,${String(Math.max(8, labelTop))}px,0)`;
  }
  public renderArea(rect: CaptureRect): void {
    this.#box.style.cssText = `display:block;left:${String(rect.left)}px;top:${String(rect.top)}px;width:${String(rect.width)}px;height:${String(rect.height)}px`;
    this.#label.textContent = `${String(Math.round(rect.width))} × ${String(Math.round(rect.height))} px · 놓아서 캡처`;
    this.#label.style.display = 'block';
    const labelTop = rect.top > 34 ? rect.top - 30 : rect.top + 6;
    this.#label.style.transform = `translate3d(${String(Math.max(8, Math.min(rect.left, innerWidth - 280)))}px,${String(Math.max(8, labelTop))}px,0)`;
  }
  public capturePointer(pointerId: number): void { try { this.#host.setPointerCapture(pointerId); } catch { /* Capture is best effort. */ } }
  public releasePointer(pointerId: number): void { if (this.#host.hasPointerCapture(pointerId)) this.#host.releasePointerCapture(pointerId); }
  public hideElement(): void { this.#box.style.display = 'none'; this.#label.style.display = 'none'; }
  public showPreparing(rect: CaptureRect): void {
    this.#box.style.display = 'none'; this.#label.style.display = 'none';
    this.#progress.style.display = 'block'; this.#status.textContent = '캡처 페이지 계산 중'; this.#count.textContent = '준비 중';
    this.#bar.style.width = '0%'; this.#detail.textContent = `${String(Math.round(rect.width))} × ${String(Math.round(rect.height))} px`;
  }
  public updatePreparingSize(rect: CaptureRect): void {
    this.#detail.textContent = `${String(Math.round(rect.width))} × ${String(Math.round(rect.height))} px`;
  }
  public showProgress(completed: number, total: number): void {
    this.#host.style.visibility = 'visible'; this.#progress.style.display = 'block';
    const percentage = Math.round(completed / Math.max(total, 1) * 100);
    this.#status.textContent = completed === total
      ? `총 ${String(total)}페이지 캡처 완료`
      : `총 ${String(total)}페이지 중 ${String(completed)}페이지 캡처 중`;
    this.#count.textContent = `${String(percentage)}%`;
    this.#bar.style.width = `${String(percentage)}%`;
    this.#detail.textContent = completed === total ? 'PNG 이미지를 합성하고 있습니다.' : '다음 페이지를 준비하고 있습니다.';
  }
  public showError(message: string): void {
    this.#host.style.visibility = 'visible'; this.#progress.style.display = 'block'; this.#progress.classList.add('error');
    this.#status.textContent = '캡처 실패'; this.#count.textContent = ''; this.#detail.textContent = message; this.#stop.textContent = '닫기';
  }
  public setCaptureHidden(hidden: boolean): void { this.#host.style.visibility = hidden ? 'hidden' : 'visible'; }
  public destroy(): void { this.#host.remove(); }
}

const styles = `
  :host { all:initial; }
  .box { position:fixed;display:none;box-sizing:border-box;border:2px solid #38bdf8;background:rgba(14,165,233,.14);box-shadow:0 0 0 1px rgba(255,255,255,.6) inset;pointer-events:none; }
  .label { position:fixed;display:none;max-width:272px;box-sizing:border-box;padding:5px 8px;border-radius:5px;background:#0f172a;color:#fff;font:600 11px/1.35 ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none; }
  .progress { position:fixed;display:none;left:50%;top:22px;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:14px;border:1px solid #334d6c;border-radius:14px;background:rgba(8,17,31,.97);box-shadow:0 14px 46px rgba(0,0,0,.42);color:#eff6ff;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transform:translateX(-50%);pointer-events:auto; }
  .progress-head { display:grid;grid-template-columns:10px 1fr auto;align-items:center;gap:8px; }
  .progress-head i { width:7px;height:7px;border-radius:50%;background:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.12); }
  .progress-head strong { font-size:13px; } .progress-head span { color:#a5b4c8;font-variant-numeric:tabular-nums; }
  .track { display:block;height:3px;margin:12px 0 8px;border-radius:3px;background:#1e3048;overflow:hidden; }
  .bar { display:block;width:0;height:100%;border-radius:inherit;background:#38bdf8;transition:width .18s ease; }
  .detail { display:block;color:#91a4bb; }
  .stop { width:100%;min-height:38px;margin-top:12px;border:1px solid #425b78;border-radius:999px;background:transparent;color:#e8f1fb;font:600 12px sans-serif;cursor:pointer; }
  .stop:hover,.stop:focus-visible { border-color:#7dd3fc;background:#12243a;outline:none; }
  .error .progress-head i,.error .bar { background:#fb7185; } .error .detail { color:#fecdd3; }
  @media (prefers-reduced-motion:reduce) { .bar { transition:none; } }
`;
