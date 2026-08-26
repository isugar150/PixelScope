import './popup.css';
import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import type { CaptureProgressState } from '../shared/capture';
import { DEFAULT_SETTINGS, isColorPickerScope, isCopyFormat, isDesignOverlayBlendMode, isDesignOverlayScale, isMeasurementUnit, type ActiveTool, type ColorPickerScope, type DesignOverlayBlendMode, type DesignOverlayScale, type ToolMode } from '../shared/tool-state';
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
const fileAccessGuide = requiredElement('file-access-guide', HTMLDivElement);
const openFileAccessSettings = requiredElement('open-file-access-settings', HTMLButtonElement);
const copyFormat = requiredElement('copy-format', HTMLSelectElement);
const colorPickerScopes = requiredRadioGroup('color-picker-scope');
const measurementUnit = requiredElement('measurement-unit', HTMLSelectElement);
const measurementCoordinates = requiredElement('measurement-coordinates', HTMLInputElement);
const measurementBoxModel = requiredElement('measurement-box-model', HTMLInputElement);
const designOverlayFile = requiredElement('design-overlay-file', HTMLInputElement);
const designOverlayScale = requiredElement('design-overlay-scale', HTMLSelectElement);
const designOverlayOpacity = requiredElement('design-overlay-opacity', HTMLInputElement);
const designOverlayBlendModes = requiredRadioGroup('design-overlay-blend');
const unlockInteractionsButton = requiredElement('unlock-interactions', HTMLButtonElement);
let tabId: number | null = null;
let pollTimer: number | null = null;
let lastCaptureProgress: CaptureProgressState | undefined;
let designOverlayImageDataUrl: string | null = null;
let interactionsUnlocked = false;

void initialize();

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const settings = await chrome.storage.local.get({
    copyFormat: DEFAULT_SETTINGS.copyFormat,
    colorPickerScope: DEFAULT_SETTINGS.colorPickerScope,
    colorPickerScopeVersion: 0,
    measurementUnit: DEFAULT_SETTINGS.measurementUnit,
    showMeasurementCoordinates: DEFAULT_SETTINGS.showMeasurementCoordinates,
    showBoxModel: DEFAULT_SETTINGS.showBoxModel,
    designOverlayOpacity: DEFAULT_SETTINGS.designOverlayOpacity,
    designOverlayBlendMode: DEFAULT_SETTINGS.designOverlayBlendMode,
    designOverlayScale: DEFAULT_SETTINGS.designOverlayScale,
  });
  copyFormat.value = isCopyFormat(settings.copyFormat) ? settings.copyFormat : DEFAULT_SETTINGS.copyFormat;
  const migrateColorPickerScope = settings.colorPickerScopeVersion !== COLOR_PICKER_SCOPE_VERSION;
  const colorPickerScope = migrateColorPickerScope
    ? DEFAULT_SETTINGS.colorPickerScope
    : isColorPickerScope(settings.colorPickerScope) ? settings.colorPickerScope : DEFAULT_SETTINGS.colorPickerScope;
  setColorPickerScope(colorPickerScope);
  measurementUnit.value = isMeasurementUnit(settings.measurementUnit) ? settings.measurementUnit : DEFAULT_SETTINGS.measurementUnit;
  measurementCoordinates.checked = settings.showMeasurementCoordinates === true;
  measurementBoxModel.checked = settings.showBoxModel === true;
  designOverlayOpacity.value = String(typeof settings.designOverlayOpacity === 'number' ? settings.designOverlayOpacity : DEFAULT_SETTINGS.designOverlayOpacity);
  setDesignOverlayBlendMode(isDesignOverlayBlendMode(settings.designOverlayBlendMode) ? settings.designOverlayBlendMode : DEFAULT_SETTINGS.designOverlayBlendMode);
  designOverlayScale.value = isDesignOverlayScale(settings.designOverlayScale) ? settings.designOverlayScale : DEFAULT_SETTINGS.designOverlayScale;
  if (migrateColorPickerScope) {
    await chrome.storage.local.set({ colorPickerScope, colorPickerScopeVersion: COLOR_PICKER_SCOPE_VERSION });
  }
  if (tabId === null) { showError('현재 탭을 확인할 수 없습니다.'); return; }
  const response = await send({ type: 'GET_TOOL_STATE', tabId });
  if (response.ok) renderState(response.tool ?? 'idle', response.captureProgress, response.interactionsUnlocked); else showError(response.error, response.code);
}

for (const card of accordionCards) {
  card.querySelector<HTMLButtonElement>('.tool-more')?.addEventListener('click', () => toggleAccordion(card));
}
for (const button of startButtons) {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool !== undefined && button.getAttribute('aria-pressed') === 'true') { void deactivate(); return; }
    if (tool === 'color-picker' && getColorPickerScope() === 'screen') { startScreenColorPicker(); return; }
    if (tool === 'measure' || tool === 'color-picker' || tool === 'capture-element' || tool === 'capture-page' || tool === 'design-overlay' || tool === 'css-changes') void activate(tool);
  });
}
stopButton.addEventListener('click', () => void deactivate());
unlockInteractionsButton.addEventListener('click', () => void togglePageInteractionUnlock());
openFileAccessSettings.addEventListener('click', () => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
copyFormat.addEventListener('change', () => void saveSettings());
for (const scope of colorPickerScopes) scope.addEventListener('change', () => void saveSettings());
measurementUnit.addEventListener('change', () => void saveSettings());
measurementCoordinates.addEventListener('change', () => void saveSettings());
measurementBoxModel.addEventListener('change', () => void saveSettings());
designOverlayFile.addEventListener('change', () => void onDesignOverlayFileChange());
designOverlayScale.addEventListener('change', () => { void saveSettings(); void sendDesignOverlayUpdate(false); });
designOverlayOpacity.addEventListener('input', () => { void saveSettings(); void sendDesignOverlayUpdate(false); });
for (const mode of designOverlayBlendModes) mode.addEventListener('change', () => { void saveSettings(); void sendDesignOverlayUpdate(false); });
window.addEventListener('pagehide', stopPolling);

function toggleAccordion(selected: HTMLElement): void {
  const open = !selected.classList.contains('open');
  for (const card of accordionCards) setAccordionOpen(card, card === selected && open);
}
const ACCORDION_LABELS: Record<string, string> = { measure: '영역 측정', 'color-picker': '컬러 피커', 'design-overlay': '디자인 오버레이' };
function setAccordionOpen(card: HTMLElement, open: boolean): void {
  card.classList.toggle('open', open);
  const moreButton = card.querySelector<HTMLButtonElement>('.tool-more');
  const panelId = moreButton?.getAttribute('aria-controls');
  const panel = panelId === null || panelId === undefined ? null : document.getElementById(panelId);
  const label = ACCORDION_LABELS[card.dataset.toolCard ?? ''] ?? '';
  moreButton?.setAttribute('aria-expanded', String(open));
  moreButton?.setAttribute('aria-label', `${label} 설정 ${open ? '닫기' : '열기'}`);
  panel?.setAttribute('aria-hidden', String(!open));
  panel?.classList.toggle('open', open);
  if (panel !== null) panel.inert = !open;
}
async function activate(tool: ActiveTool): Promise<void> {
  if (tabId === null) return;
  if (tool === 'design-overlay' && designOverlayImageDataUrl === null) { showError('시안 이미지를 먼저 선택해주세요.'); return; }
  if (isCapturingTool(tool)) lastCaptureProgress = undefined;
  showError('');
  await saveSettings();
  const response = await send({ type: 'ACTIVATE_TOOL', tabId, tool });
  if (!response.ok) { showError(response.error, response.code); return; }
  if (tool === 'design-overlay') { await sendDesignOverlayUpdate(true); renderState(tool); return; }
  if (tool === 'capture-page') renderState(tool, response.captureProgress);
  else window.close();
}
async function deactivate(): Promise<void> {
  if (tabId === null) return;
  const response = await send({ type: 'DEACTIVATE_TOOL', tabId });
  if (response.ok) renderState('idle'); else showError(response.error, response.code);
}
async function togglePageInteractionUnlock(): Promise<void> {
  if (tabId === null) return;
  showError('');
  const response = await send({ type: 'TOGGLE_PAGE_INTERACTION_UNLOCK', tabId });
  if (response.ok) window.close(); else showError(response.error, response.code);
}
function startScreenColorPicker(): void {
  if (tabId === null) return;
  const format = isCopyFormat(copyFormat.value) ? copyFormat.value : DEFAULT_SETTINGS.copyFormat;
  showError('');
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
function renderState(tool: ToolMode, captureProgress?: CaptureProgressState, nextInteractionsUnlocked?: boolean): void {
  if (nextInteractionsUnlocked !== undefined) interactionsUnlocked = nextInteractionsUnlocked;
  const capturing = isCapturingTool(tool);
  const staysOpen = capturing || tool === 'design-overlay';
  if (!capturing) lastCaptureProgress = undefined;
  else if (captureProgress !== undefined) lastCaptureProgress = captureProgress;
  document.body.classList.toggle('capture-running', capturing);
  stopButton.hidden = tool === 'idle';
  stopLabel.textContent = capturing ? '캡처 중지' : '도구 종료';
  captureState.hidden = !capturing;
  renderCaptureProgress(capturing, captureProgress ?? lastCaptureProgress);
  for (const card of toolCards) {
    const active = card.dataset.toolCard === tool
      || (card.dataset.toolCard === 'capture' && isCapturingTool(tool))
      || (card.dataset.toolCard === 'unlock-interactions' && interactionsUnlocked);
    card.classList.toggle('active', active);
    if (card.dataset.toolCard === 'capture') card.classList.toggle('capturing', capturing);
  }
  for (const button of startButtons) if (button.dataset.tool?.startsWith('capture-') === true) button.disabled = capturing;
  for (const button of startButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  unlockInteractionsButton.setAttribute('aria-pressed', String(interactionsUnlocked));
  if (staysOpen) startPolling(); else stopPolling();
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
  if (response.ok) renderState(response.tool ?? 'idle', response.captureProgress, response.interactionsUnlocked);
}
async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({
    copyFormat: copyFormat.value,
    colorPickerScope: getColorPickerScope(),
    colorPickerScopeVersion: COLOR_PICKER_SCOPE_VERSION,
    measurementUnit: measurementUnit.value,
    showMeasurementCoordinates: measurementCoordinates.checked,
    showBoxModel: measurementBoxModel.checked,
    designOverlayOpacity: Number(designOverlayOpacity.value),
    designOverlayBlendMode: getDesignOverlayBlendMode(),
    designOverlayScale: getDesignOverlayScale(),
  });
}
async function onDesignOverlayFileChange(): Promise<void> {
  const file = designOverlayFile.files?.[0];
  if (file === undefined) return;
  const reader = new FileReader();
  const dataUrl = await new Promise<string | null>((resolve) => {
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  designOverlayImageDataUrl = dataUrl;
  if (dataUrl !== null) { showError(''); await sendDesignOverlayUpdate(true); }
}
async function sendDesignOverlayUpdate(includeImage: boolean): Promise<void> {
  if (tabId === null) return;
  const opacity = Number(designOverlayOpacity.value);
  const blendMode = getDesignOverlayBlendMode();
  const scale = getDesignOverlayScale();
  await send({
    type: 'DESIGN_OVERLAY_UPDATE', tabId, opacity, blendMode, scale,
    ...(includeImage && designOverlayImageDataUrl !== null ? { imageDataUrl: designOverlayImageDataUrl } : {}),
  });
}
async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  try { return await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>(message); }
  catch (error: unknown) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
function showError(message: string, code?: 'file-access-required'): void {
  errorText.textContent = message;
  fileAccessGuide.hidden = code !== 'file-access-required';
}
function getColorPickerScope(): ColorPickerScope {
  const selected = colorPickerScopes.find((scope) => scope.checked)?.value;
  return isColorPickerScope(selected) ? selected : DEFAULT_SETTINGS.colorPickerScope;
}
function setColorPickerScope(value: ColorPickerScope): void {
  for (const scope of colorPickerScopes) scope.checked = scope.value === value;
}
function getDesignOverlayBlendMode(): DesignOverlayBlendMode {
  const selected = designOverlayBlendModes.find((mode) => mode.checked)?.value;
  return isDesignOverlayBlendMode(selected) ? selected : DEFAULT_SETTINGS.designOverlayBlendMode;
}
function setDesignOverlayBlendMode(value: DesignOverlayBlendMode): void {
  for (const mode of designOverlayBlendModes) mode.checked = mode.value === value;
}
function getDesignOverlayScale(): DesignOverlayScale {
  return isDesignOverlayScale(designOverlayScale.value) ? designOverlayScale.value : DEFAULT_SETTINGS.designOverlayScale;
}
function isCapturingTool(tool: ToolMode): boolean {
  return tool === 'capture-element' || tool === 'capture-page';
}
function requiredRadioGroup(name: string): HTMLInputElement[] {
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));
  if (radios.length === 0) throw new Error(`필수 라디오 그룹을 찾을 수 없습니다: ${name}`);
  return radios;
}
function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}
