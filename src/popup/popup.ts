import './popup.css';
import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import type { CaptureProgressState } from '../shared/capture';
import { DEFAULT_SETTINGS, isColorPickerScope, isCopyFormat, isMeasurementUnit, type ActiveTool, type ToolMode } from '../shared/tool-state';
import { pickScreenColorInPage } from '../screen-color-picker';

const COLOR_PICKER_SCOPE_VERSION = 1;
const accordionCards = Array.from(document.querySelectorAll<HTMLElement>('[data-accordion]'));
const toolCards = Array.from(document.querySelectorAll<HTMLElement>('[data-tool-card]'));
const startButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const stopButton = requiredElement('stop', HTMLButtonElement);
const stopLabel = requiredElement('stop-label', HTMLElement);
const captureState = requiredElement('capture-state', HTMLElement);
const captureStateLabel = requiredElement('capture-state-label', HTMLElement);
const captureStateCount = requiredElement('capture-state-count', HTMLOutputElement);
const captureStateBar = requiredElement('capture-state-bar', HTMLElement);
const errorText = requiredElement('error', HTMLParagraphElement);
const copyFormat = requiredElement('copy-format', HTMLSelectElement);
const colorPickerScope = requiredElement('color-picker-scope', HTMLSelectElement);
const measurementUnit = requiredElement('measurement-unit', HTMLSelectElement);
let tabId: number | null = null;
let pollTimer: number | null = null;
let lastCaptureProgress: CaptureProgressState | undefined;

void initialize();

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const settings = await chrome.storage.local.get({
    copyFormat: DEFAULT_SETTINGS.copyFormat,
    colorPickerScope: DEFAULT_SETTINGS.colorPickerScope,
    colorPickerScopeVersion: 0,
    measurementUnit: DEFAULT_SETTINGS.measurementUnit,
  });
  copyFormat.value = isCopyFormat(settings.copyFormat) ? settings.copyFormat : DEFAULT_SETTINGS.copyFormat;
  const migrateColorPickerScope = settings.colorPickerScopeVersion !== COLOR_PICKER_SCOPE_VERSION;
  colorPickerScope.value = migrateColorPickerScope
    ? DEFAULT_SETTINGS.colorPickerScope
    : isColorPickerScope(settings.colorPickerScope) ? settings.colorPickerScope : DEFAULT_SETTINGS.colorPickerScope;
  measurementUnit.value = isMeasurementUnit(settings.measurementUnit) ? settings.measurementUnit : DEFAULT_SETTINGS.measurementUnit;
  if (migrateColorPickerScope) {
    await chrome.storage.local.set({ colorPickerScope: colorPickerScope.value, colorPickerScopeVersion: COLOR_PICKER_SCOPE_VERSION });
  }
  if (tabId === null) { showError('현재 탭을 확인할 수 없습니다.'); return; }
  const response = await send({ type: 'GET_TOOL_STATE', tabId });
  if (response.ok) renderState(response.tool ?? 'idle', response.captureProgress); else showError(response.error);
}

for (const card of accordionCards) {
  card.querySelector<HTMLButtonElement>('.tool-more')?.addEventListener('click', () => toggleAccordion(card));
}
for (const button of startButtons) {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool === 'color-picker' && colorPickerScope.value === 'screen') { startScreenColorPicker(); return; }
    if (tool === 'measure' || tool === 'color-picker' || tool === 'capture-element' || tool === 'capture-page') void activate(tool);
  });
}
stopButton.addEventListener('click', () => void deactivate());
copyFormat.addEventListener('change', () => void saveSettings());
colorPickerScope.addEventListener('change', () => void saveSettings());
measurementUnit.addEventListener('change', () => void saveSettings());
window.addEventListener('pagehide', stopPolling);

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
  if (tool === 'capture-element' || tool === 'capture-page') lastCaptureProgress = undefined;
  await saveSettings();
  const response = await send({ type: 'ACTIVATE_TOOL', tabId, tool });
  if (!response.ok) { showError(response.error); return; }
  if (tool === 'capture-page') renderState(tool, response.captureProgress);
  else window.close();
}
async function deactivate(): Promise<void> {
  if (tabId === null) return;
  const response = await send({ type: 'DEACTIVATE_TOOL', tabId });
  if (response.ok) renderState('idle'); else showError(response.error);
}
function startScreenColorPicker(): void {
  if (tabId === null) return;
  const format = isCopyFormat(copyFormat.value) ? copyFormat.value : DEFAULT_SETTINGS.copyFormat;
  errorText.textContent = '';
  // EyeDropper.open() must run synchronously from this trusted popup click.
  // User activation does not transfer through chrome.scripting.executeScript().
  const execution = pickScreenColorInPage(format);
  void send({ type: 'DEACTIVATE_TOOL', tabId });
  void saveSettings();
  void execution.then((result) => {
    if (result.status === 'error') showError(result.error);
  }).catch((error: unknown) => {
    showError(error instanceof Error ? error.message : String(error));
  });
}
function renderState(tool: ToolMode, captureProgress?: CaptureProgressState): void {
  const capturing = tool === 'capture-element' || tool === 'capture-page';
  if (!capturing) lastCaptureProgress = undefined;
  else if (captureProgress !== undefined) lastCaptureProgress = captureProgress;
  document.body.classList.toggle('capture-running', capturing);
  stopButton.hidden = tool === 'idle';
  stopLabel.textContent = capturing ? '캡처 중지' : '도구 종료';
  captureState.hidden = !capturing;
  renderCaptureProgress(capturing, captureProgress ?? lastCaptureProgress);
  for (const card of toolCards) {
    const active = card.dataset.toolCard === tool || (card.dataset.toolCard === 'capture' && (tool === 'capture-element' || tool === 'capture-page'));
    card.classList.toggle('active', active);
    if (card.dataset.toolCard === 'capture') card.classList.toggle('capturing', capturing);
  }
  for (const button of startButtons) if (button.dataset.tool?.startsWith('capture-') === true) button.disabled = capturing;
  for (const button of startButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  if (capturing) startPolling(); else stopPolling();
}
function renderCaptureProgress(capturing: boolean, progress?: CaptureProgressState): void {
  if (!capturing) return;
  if (progress === undefined) {
    captureStateLabel.textContent = '캡처 페이지 계산 중'; captureStateCount.value = '준비 중'; captureStateBar.style.width = '0%';
    return;
  }
  const compositing = progress.phase === 'compositing';
  const percentage = Math.round(progress.completed / Math.max(1, progress.total) * 100);
  captureStateLabel.textContent = compositing
    ? `총 ${String(progress.total)}페이지 캡처 완료`
    : progress.completed === 0
      ? `총 ${String(progress.total)}페이지 캡처 준비 중`
      : `총 ${String(progress.total)}페이지 중 ${String(progress.completed)}페이지 캡처 중`;
  captureStateCount.value = compositing ? 'PNG 합성 중' : `${String(percentage)}%`;
  captureStateBar.style.width = `${String(compositing ? 100 : percentage)}%`;
}
function startPolling(): void {
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(() => void refreshState(), 350);
}
function stopPolling(): void {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer); pollTimer = null;
}
async function refreshState(): Promise<void> {
  if (tabId === null) return;
  const response = await send({ type: 'GET_TOOL_STATE', tabId });
  if (response.ok) renderState(response.tool ?? 'idle', response.captureProgress);
}
async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({
    copyFormat: copyFormat.value,
    colorPickerScope: colorPickerScope.value,
    colorPickerScopeVersion: COLOR_PICKER_SCOPE_VERSION,
    measurementUnit: measurementUnit.value,
  });
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
