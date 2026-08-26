import type { ToolLifecycle } from '../tool-controller';
import { CssChangesOverlay } from './css-changes-overlay';
import { collectCssSnapshot, diffCssSnapshots, formatCssChanges, mergeCssResourceBaseline, revertCssRuleChange, type CssRuleChange, type CssSnapshot } from './css-snapshot';
import type { ExtensionMessage, ExtensionResponse } from '../../shared/messages';

const REFRESH_INTERVAL_MS = 500;

export class CssChangesController implements ToolLifecycle {
  readonly #onExit: () => void;
  #active = false;
  #baseline: CssSnapshot | null = null;
  #changes: readonly CssRuleChange[] = [];
  #overlay: CssChangesOverlay | null = null;
  #intervalId: number | null = null;

  public constructor(onExit: () => void) { this.#onExit = onExit; }
  public get active(): boolean { return this.#active; }

  public enable(): void {
    if (this.#active) return;
    this.#baseline = collectCssSnapshot();
    this.#active = true;
    this.#overlay = new CssChangesOverlay({
      onCopy: () => void this.#copy(),
      onCopyChange: (change) => void this.#copyChange(change),
      onDelete: (change) => this.#delete(change),
      onRevertAll: () => this.#revertAll(),
      onClose: this.#onExit,
    });
    this.#refresh();
    void this.#loadDevtoolsBaseline();
    this.#intervalId = window.setInterval(() => this.#refresh(), REFRESH_INTERVAL_MS);
    window.addEventListener('keydown', this.#onKeyDown, true);
  }

  public disable(): void {
    if (this.#intervalId !== null) window.clearInterval(this.#intervalId);
    this.#intervalId = null;
    window.removeEventListener('keydown', this.#onKeyDown, true);
    this.#overlay?.destroy();
    this.#overlay = null;
    this.#baseline = null;
    this.#changes = [];
    this.#active = false;
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.#onExit();
  };

  #refresh(): void {
    if (!this.#active || this.#baseline === null) return;
    const current = collectCssSnapshot();
    this.#changes = diffCssSnapshots(this.#baseline, current);
    this.#overlay?.update(this.#changes, current.unreadableStyleSheets);
  }

  async #loadDevtoolsBaseline(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>({ type: 'GET_CSS_BASELINE' });
      if (!this.#active || this.#baseline === null || !response.ok || response.cssBaseline === undefined) return;
      if (response.cssBaseline.pageUrl !== '' && withoutHash(response.cssBaseline.pageUrl) !== withoutHash(location.href)) return;
      this.#baseline = mergeCssResourceBaseline(this.#baseline, response.cssBaseline.resources);
      this.#refresh();
    } catch { /* Extension context invalidated or no DevTools baseline is available. */ }
  }

  #delete(change: CssRuleChange): void {
    if (this.#baseline === null) return;
    if (!window.confirm(`"${change.selector}" CSS 변경 블록을 삭제하고 원래 값으로 되돌릴까요?`)) return;
    const reverted = revertCssRuleChange(change, this.#baseline, collectCssSnapshot());
    this.#refresh();
    this.#overlay?.announce(reverted ? `${change.selector} CSS 블록을 삭제했습니다` : '삭제된 규칙 자체는 자동으로 원복할 수 없습니다');
  }

  #revertAll(): void {
    if (this.#baseline === null || this.#changes.length === 0) return;
    if (!window.confirm('DevTools에서 적용한 임의 CSS를 활성화 시점으로 초기화할까요?')) return;
    const current = collectCssSnapshot();
    const total = this.#changes.length;
    let reverted = 0;
    for (const change of this.#changes) if (revertCssRuleChange(change, this.#baseline, current)) reverted += 1;
    this.#refresh();
    this.#overlay?.announce(reverted === total
      ? '임의 CSS를 모두 초기화했습니다'
      : `${String(reverted)}개 선택자를 원복했습니다. 삭제된 규칙은 제외됐습니다`);
  }

  async #copy(): Promise<void> {
    await this.#writeChanges(this.#changes, `전체 변경 ${String(this.#changes.reduce((total, change) => total + change.properties.length, 0))}개를 복사했습니다`);
  }

  async #copyChange(change: CssRuleChange): Promise<void> {
    await this.#writeChanges([change], `${change.selector} CSS 블록을 복사했습니다`);
  }

  async #writeChanges(changes: readonly CssRuleChange[], successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatCssChanges(changes));
      this.#overlay?.announce(successMessage);
    } catch {
      this.#overlay?.announce('복사하지 못했습니다. 페이지 권한을 확인해주세요');
    }
  }
}

function withoutHash(url: string): string {
  const hashIndex = url.indexOf('#');
  return hashIndex < 0 ? url : url.slice(0, hashIndex);
}
