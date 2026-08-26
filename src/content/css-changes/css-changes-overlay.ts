import type { CssRuleChange } from './css-snapshot';

interface CssChangesOverlayActions {
  readonly onCopy: () => void;
  readonly onCopyChange: (change: CssRuleChange) => void;
  readonly onDelete: (change: CssRuleChange) => void;
  readonly onRevertAll: () => void;
  readonly onClose: () => void;
}

export class CssChangesOverlay {
  readonly #host: HTMLDivElement;
  readonly #status: HTMLDivElement;
  readonly #list: HTMLDivElement;
  readonly #notice: HTMLParagraphElement;
  readonly #copyButton: HTMLButtonElement;
  readonly #resetButton: HTMLButtonElement;
  readonly #actions: CssChangesOverlayActions;

  public constructor(actions: CssChangesOverlayActions) {
    this.#actions = actions;
    this.#host = document.createElement('div');
    this.#host.dataset.pixelscopeOverlay = '';
    this.#host.dataset.pixelscopeCssChanges = '';
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'CSS 변경 추출');
    const header = document.createElement('header');
    const heading = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'CSS 변경 추출';
    this.#status = document.createElement('div');
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    this.#status.setAttribute('aria-live', 'polite');
    this.#status.setAttribute('aria-atomic', 'true');
    this.#status.textContent = '변경사항을 기다리는 중';
    heading.append(title, this.#status);
    const close = createButton('종료', 'close');
    close.setAttribute('aria-label', 'CSS 변경 추출 종료');
    close.addEventListener('click', actions.onClose);
    header.append(heading, close);

    this.#list = document.createElement('div');
    this.#list.className = 'changes';
    this.#list.tabIndex = 0;
    this.#list.setAttribute('aria-label', '감지된 CSS 변경사항');
    this.#notice = document.createElement('p');
    this.#notice.className = 'notice';

    const footer = document.createElement('footer');
    this.#copyButton = createButton('변경사항 복사', 'primary');
    this.#copyButton.disabled = true;
    this.#copyButton.addEventListener('click', actions.onCopy);
    this.#resetButton = createButton('임의 CSS 초기화', 'danger');
    this.#resetButton.disabled = true;
    this.#resetButton.addEventListener('click', actions.onRevertAll);
    footer.append(this.#copyButton, this.#resetButton);
    panel.append(header, this.#list, this.#notice, footer);
    shadow.append(style, panel);
    document.documentElement.append(this.#host);
  }

  public update(changes: readonly CssRuleChange[], unreadableStyleSheets: number): void {
    const propertyCount = changes.reduce((total, change) => total + change.properties.length, 0);
    this.#host.dataset.pixelscopeCssRuleCount = String(changes.length);
    this.#host.dataset.pixelscopeCssPropertyCount = String(propertyCount);
    this.#status.textContent = propertyCount === 0
      ? '변경사항을 기다리는 중'
      : `선택자 ${String(changes.length)}개 · 변경 ${String(propertyCount)}개`;
    this.#copyButton.disabled = propertyCount === 0;
    this.#resetButton.disabled = propertyCount === 0;
    this.#list.replaceChildren(...(changes.length === 0 ? [createEmptyState()] : changes.map((change) => createChangeGroup(change, this.#actions))));
    this.#notice.textContent = unreadableStyleSheets === 0
      ? '활성화 이후의 CSSOM 및 인라인 스타일 변경을 비교합니다.'
      : `외부 출처 스타일시트 ${String(unreadableStyleSheets)}개는 브라우저 보안 정책으로 읽을 수 없습니다.`;
  }

  public announce(message: string): void { this.#status.textContent = message; }

  public destroy(): void { this.#host.remove(); }
}

function createChangeGroup(change: CssRuleChange, actions: CssChangesOverlayActions): HTMLElement {
  const article = document.createElement('article');
  const heading = document.createElement('div');
  heading.className = 'change-heading';
  const identity = document.createElement('div');
  const source = document.createElement('span');
  source.className = 'source';
  source.textContent = change.source;
  source.title = change.source;
  const selector = document.createElement('code');
  selector.className = 'selector';
  selector.textContent = [...change.context, change.selector].join('  ');
  identity.append(source, selector);
  const blockActions = document.createElement('div');
  blockActions.className = 'block-actions';
  const copy = createButton('복사', 'block-copy');
  copy.setAttribute('aria-label', `${change.selector} CSS 블록 복사`);
  copy.addEventListener('click', () => actions.onCopyChange(change));
  const remove = createButton('삭제', 'block-delete');
  remove.setAttribute('aria-label', `${change.selector} CSS 블록 삭제`);
  remove.addEventListener('click', () => actions.onDelete(change));
  blockActions.append(copy, remove);
  heading.append(identity, blockActions);
  article.append(heading);
  for (const property of change.properties) {
    const row = document.createElement('code');
    row.className = `property ${property.kind}`;
    const priority = property.priority === '' ? '' : ` !${property.priority}`;
    if (property.kind === 'changed') {
      const previousPriority = property.previousPriority === '' ? '' : ` !${property.previousPriority}`;
      row.textContent = `~ ${property.name}: ${property.previousValue}${previousPriority} → ${property.value}${priority};`;
    } else {
      row.textContent = `${property.kind === 'added' ? '+' : '−'} ${property.name}: ${property.value}${priority};`;
    }
    article.append(row);
  }
  return article;
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'DevTools에서 CSS를 수정하면 여기에 추가·삭제 내역이 표시됩니다.';
  return empty;
}

function createButton(label: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

const CSS_TEXT = `
  :host { all: initial; position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; pointer-events: none; color-scheme: light; }
  * { box-sizing: border-box; }
  .panel { width: min(420px, calc(100vw - 24px)); max-height: min(620px, calc(100dvh - 24px)); display: grid; grid-template-rows: auto minmax(92px, 1fr) auto auto; overflow: hidden; border: 1px solid #d7c5f2; border-radius: 14px; background: #fff; color: #3c3653; box-shadow: 0 16px 46px rgba(45, 35, 80, .24); font: 13px/1.45 "Pretendard", "Segoe UI", system-ui, sans-serif; pointer-events: auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 10px 10px 10px 14px; border-bottom: 1px solid #e8def8; background: #faf7ff; }
  header strong { display: block; font-size: 14px; }
  .status { margin-top: 2px; color: #6a52d6; font-size: 11px; font-weight: 600; }
  button { min-height: 36px; padding: 0 11px; border: 1px solid #d7c5f2; border-radius: 8px; background: #fff; color: #51466f; font: inherit; font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; touch-action: manipulation; }
  button:hover { background: #f4eefc; }
  button:active { background: #e1d3fc; }
  button:focus-visible { outline: 2px solid #6a52d6; outline-offset: 2px; }
  button:disabled { cursor: default; opacity: .45; }
  .close { min-width: 48px; }
  .changes { overflow: auto; overscroll-behavior: contain; padding: 8px; background: #f7f3fd; }
  .changes:focus-visible { outline: 2px solid #6a52d6; outline-offset: -3px; }
  article { padding: 10px; border: 1px solid #e8def8; border-radius: 10px; background: #fff; }
  article + article { margin-top: 8px; }
  .change-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; }
  .change-heading > div { min-width: 0; }
  .source { display: block; overflow: hidden; color: #8a84a3; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  .selector { display: block; margin: 3px 0 7px; color: #3c3653; font-weight: 700; }
  .property { display: block; padding: 3px 6px; border-radius: 5px; white-space: pre-wrap; }
  .property + .property { margin-top: 2px; }
  .change-heading > .block-actions { display: flex; min-width: max-content; gap: 4px; }
  .block-actions button { min-height: 36px; padding: 0 8px; }
  .block-copy { color: #6a52d6; }
  .block-delete { border-color: #f4c4d3; color: #a5264e; }
  .added { background: #e1f8f0; color: #176b54; }
  .removed { background: #ffe7ee; color: #a5264e; text-decoration: line-through; }
  .changed { background: #fff3d9; color: #7b5808; }
  .empty { max-width: 310px; margin: 30px auto; color: #716a86; text-align: center; }
  .notice { margin: 0; padding: 8px 12px; border-top: 1px solid #e8def8; color: #716a86; font-size: 10px; background: #fff; }
  footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 10px; border-top: 1px solid #e8def8; background: #fff; }
  footer .primary { border-color: #6a52d6; background: #6a52d6; color: #fff; }
  footer .primary:hover { background: #5942c2; }
  footer .danger { border-color: #f4c4d3; background: #ffe7ee; color: #a5264e; }
  footer .danger:hover { background: #ffdbe6; }
  @media (max-width: 480px) { :host { right: 8px; bottom: 8px; } .panel { width: calc(100vw - 16px); max-height: min(520px, calc(100dvh - 16px)); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;
