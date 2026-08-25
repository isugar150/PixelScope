import './popup.css';
import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { DEFAULT_SETTINGS, isCopyFormat, isMeasurementUnit, type ActiveTool, type ToolMode } from '../shared/tool-state';

const accordionCards = Array.from(document.querySelectorAll<HTMLElement>('[data-accordion]'));
const toolCards = Array.from(document.querySelectorAll<HTMLElement>('[data-tool-card]'));
const startButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const stopButton = requiredElement('stop', HTMLButtonElement);
const status = requiredElement('status', HTMLSpanElement);
const errorText = requiredElement('error', HTMLParagraphElement);
const copyFormat = requiredElement('copy-format', HTMLSelectElement);
const measurementUnit = requiredElement('measurement-unit', HTMLSelectElement);
let tabId: number | null = null;

void initialize();

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const settings = await chrome.storage.local.get({
    copyFormat: DEFAULT_SETTINGS.copyFormat,
    measurementUnit: DEFAULT_SETTINGS.measurementUnit,
  });
  copyFormat.value = isCopyFormat(settings.copyFormat) ? settings.copyFormat : DEFAULT_SETTINGS.copyFormat;
  measurementUnit.value = isMeasurementUnit(settings.measurementUnit) ? settings.measurementUnit : DEFAULT_SETTINGS.measurementUnit;
  if (tabId === null) { showError('현재 탭을 확인할 수 없습니다.'); return; }
  const response = await send({ type: 'GET_TOOL_STATE', tabId });
  if (response.ok) renderState(response.tool ?? 'idle'); else showError(response.error);
}

for (const card of accordionCards) {
  card.querySelector<HTMLButtonElement>('.tool-more')?.addEventListener('click', () => toggleAccordion(card));
}
for (const button of startButtons) {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool === 'measure' || tool === 'color-picker' || tool === 'capture-element' || tool === 'capture-page') void activate(tool);
  });
}
stopButton.addEventListener('click', () => void deactivate());
copyFormat.addEventListener('change', () => void saveSettings());
measurementUnit.addEventListener('change', () => void saveSettings());

function toggleAccordion(selected: HTMLElement): void {
  const open = !selected.classList.contains('open');
  for (const card of accordionCards) setAccordionOpen(card, card === selected && open);
}
function setAccordionOpen(card: HTMLElement, open: boolean): void {
  card.classList.toggle('open', open);
  const moreButton = card.querySelector<HTMLButtonElement>('.tool-more');
  const panelId = moreButton?.getAttribute('aria-controls');
  const panel = panelId === null || panelId === undefined ? null : document.getElementById(panelId);
  moreButton?.setAttribute('aria-expanded', String(open));
  moreButton?.setAttribute('aria-label', `${card.dataset.toolCard === 'measure' ? '영역 측정' : '컬러 피커'} 설정 ${open ? '닫기' : '열기'}`);
  panel?.setAttribute('aria-hidden', String(!open));
  panel?.classList.toggle('open', open);
  if (panel !== null) panel.inert = !open;
}
async function activate(tool: ActiveTool): Promise<void> {
  if (tabId === null) return;
  await saveSettings();
  const response = await send({ type: 'ACTIVATE_TOOL', tabId, tool });
  if (!response.ok) { showError(response.error); return; }
  window.close();
}
async function deactivate(): Promise<void> {
  if (tabId === null) return;
  const response = await send({ type: 'DEACTIVATE_TOOL', tabId });
  if (response.ok) renderState('idle'); else showError(response.error);
}
function renderState(tool: ToolMode): void {
  status.textContent = tool === 'idle' ? '대기' : tool === 'measure' ? '영역 측정 중' : tool === 'color-picker' ? '컬러 피커 중' : '캡처 중';
  stopButton.hidden = tool === 'idle';
  for (const card of toolCards) {
    const active = card.dataset.toolCard === tool || (card.dataset.toolCard === 'capture' && (tool === 'capture-element' || tool === 'capture-page'));
    card.classList.toggle('active', active);
  }
}
async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ copyFormat: copyFormat.value, measurementUnit: measurementUnit.value });
}
async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  try { return await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>(message); }
  catch (error: unknown) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
function showError(message: string): void { errorText.textContent = message; }
function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}
