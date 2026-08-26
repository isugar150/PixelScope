const UNLOCKED_ATTRIBUTE = 'data-pixelscope-interactions-unlocked';
const TOOL_ACTIVE_ATTRIBUTE = 'data-pixelscope-tool-active';
const STYLE_ATTRIBUTE = 'data-pixelscope-interaction-unlock-style';
const TOAST_ATTRIBUTE = 'data-pixelscope-interaction-unlock-toast';
const TOAST_DURATION_MS = 1_000;

export class PageInteractionUnlocker {
  #style: HTMLStyleElement | null = null;
  #toastHost: HTMLElement | null = null;
  #toastTimer: number | null = null;

  public get active(): boolean {
    return document.documentElement.hasAttribute(UNLOCKED_ATTRIBUTE);
  }

  public toggle(): boolean {
    const enabled = !this.active;
    this.#setEnabled(enabled, true);
    return enabled;
  }

  public dispose(): void {
    this.#setEnabled(false, false);
  }

  #setEnabled(enabled: boolean, announce: boolean): void {
    document.documentElement.toggleAttribute(UNLOCKED_ATTRIBUTE, enabled);
    if (enabled) this.#ensureStyle();
    else {
      this.#style?.remove();
      this.#style = null;
    }
    if (announce) this.#showToast(enabled);
    else this.#removeToast();
  }

  #ensureStyle(): void {
    if (this.#style?.isConnected === true) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_ATTRIBUTE, '');
    style.textContent = `
      html[${UNLOCKED_ATTRIBUTE}]:not([${TOOL_ACTIVE_ATTRIBUTE}]),
      html[${UNLOCKED_ATTRIBUTE}]:not([${TOOL_ACTIVE_ATTRIBUTE}]) * {
        -webkit-user-select: text !important;
        user-select: text !important;
        -webkit-touch-callout: default !important;
      }
      html[${UNLOCKED_ATTRIBUTE}]:not([${TOOL_ACTIVE_ATTRIBUTE}]) img,
      html[${UNLOCKED_ATTRIBUTE}]:not([${TOOL_ACTIVE_ATTRIBUTE}]) a {
        -webkit-user-drag: auto !important;
      }
    `;
    document.documentElement.append(style);
    this.#style = style;
  }

  #showToast(enabled: boolean): void {
    this.#removeToast();
    const host = document.createElement('div');
    host.setAttribute(TOAST_ATTRIBUTE, '');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        left: 50% !important;
        top: 50% !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        transform: translate(-50%, -50%) !important;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: calc(100vw - 32px);
        padding: 15px 20px;
        border: 1px solid rgba(167, 243, 208, 0.56);
        border-radius: 12px;
        background: rgba(8, 17, 29, 0.97);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.48);
        color: #ecfdf5;
        font: 650 15px/1.35 "Segoe UI", Arial, sans-serif;
        white-space: nowrap;
      }
      svg { width: 22px; height: 22px; flex: none; overflow: visible; perspective: 40px; fill: none; stroke: #6ee7b7; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .lock-shackle { transform-box: view-box; transform-origin: 5px 10px; backface-visibility: visible; }
      @media (prefers-reduced-motion: no-preference) {
        .toast { animation: pixelscope-toast-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
        .toast.enabled .lock-shackle { animation: pixelscope-unlock-shackle 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .toast.disabled .lock-shackle { animation: pixelscope-lock-shackle 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
        @keyframes pixelscope-toast-in { from { opacity: 0; transform: translateY(6px); } }
        @keyframes pixelscope-unlock-shackle {
          0% { transform: translateY(0) rotateY(0); }
          42% { transform: translateY(-2px) rotateY(0); }
          100% { transform: translateY(-2px) rotateY(180deg); }
        }
        @keyframes pixelscope-lock-shackle {
          0% { transform: translateY(-2px) rotateY(180deg); }
          58% { transform: translateY(-2px) rotateY(0); }
          100% { transform: translateY(0) rotateY(0); }
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast.enabled .lock-shackle { transform: translateY(-2px) rotateY(180deg); }
        .toast.disabled .lock-shackle { transform: translateY(0) rotateY(0); }
      }
    `;
    const toast = document.createElement('div');
    toast.className = `toast ${enabled ? 'enabled' : 'disabled'}`;
    toast.dataset.state = enabled ? 'enabled' : 'disabled';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 20 20');
    for (const [className, pathData] of [['lock-shackle', 'M5 10V7a4.5 4.5 0 0 1 9 0v3'], ['', 'M4 10h12v8H4zM10 13v2']] as const) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (className !== '') path.setAttribute('class', className);
      path.setAttribute('d', pathData);
      icon.append(path);
    }
    const message = document.createElement('span');
    message.textContent = `우클릭·드래그 해제 ${enabled ? '켜짐' : '꺼짐'}`;
    toast.append(icon, message);
    shadow.append(style, toast);
    document.documentElement.append(host);
    this.#toastHost = host;
    this.#toastTimer = window.setTimeout(() => this.#removeToast(), TOAST_DURATION_MS);
  }

  #removeToast(): void {
    if (this.#toastTimer !== null) window.clearTimeout(this.#toastTimer);
    this.#toastTimer = null;
    this.#toastHost?.remove();
    this.#toastHost = null;
  }
}
