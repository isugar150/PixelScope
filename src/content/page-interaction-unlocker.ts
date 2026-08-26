const UNLOCKED_ATTRIBUTE = 'data-pixelscope-interactions-unlocked';
const TOOL_ACTIVE_ATTRIBUTE = 'data-pixelscope-tool-active';
const STYLE_ATTRIBUTE = 'data-pixelscope-interaction-unlock-style';
const TOAST_ATTRIBUTE = 'data-pixelscope-interaction-unlock-toast';
const TOAST_DURATION_MS = 3_000;

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
        bottom: 24px !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        transform: translateX(-50%) !important;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 9px;
        max-width: calc(100vw - 32px);
        padding: 11px 14px;
        border: 1px solid rgba(167, 243, 208, 0.42);
        border-radius: 8px;
        background: rgba(8, 17, 29, 0.96);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.38);
        color: #ecfdf5;
        font: 600 13px/1.35 "Segoe UI", Arial, sans-serif;
        white-space: nowrap;
      }
      svg { width: 17px; height: 17px; flex: none; fill: none; stroke: #6ee7b7; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      @media (prefers-reduced-motion: no-preference) {
        .toast { animation: pixelscope-toast-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1); }
        @keyframes pixelscope-toast-in { from { opacity: 0; transform: translateY(6px); } }
      }
    `;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 20 20');
    for (const pathData of ['M5 9V6a5 5 0 0 1 9.7-1.7M4 9h12v8H4z', 'm8 13 1.5 1.5L12.5 11']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
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
