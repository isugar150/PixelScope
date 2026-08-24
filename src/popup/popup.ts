import './popup.css';
import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { DEFAULT_SETTINGS, type ActiveTool, type CopyFormat, type ToolMode } from '../shared/tool-state';

const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const stopButton = requiredElement('stop', HTMLButtonElement);
const status = requiredElement('status', HTMLSpanElement);
const errorText = requiredElement('error', HTMLParagraphElement);
const copyFormat = requiredElement('copy-format', HTMLSelectElement);
const keepActive = requiredElement('keep-active', HTMLInputElement);
let tabId: number | null = null;

void initialize();

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const settings = await chrome.storage.local.get({ copyFormat: DEFAULT_SETTINGS.copyFormat, keepColorPickerActive: DEFAULT_SETTINGS.keepColorPickerActive });
  copyFormat.value = isCopyFormat(settings.copyFormat) ? settings.copyFormat : DEFAULT_SETTINGS.copyFormat;
  keepActive.checked = settings.keepColorPickerActive !== false;
  if (tabId === null) { showError('현재 탭을 확인할 수 없습니다.'); return; }
  const response = await send({ type: 'GET_TOOL_STATE', tabId });
  if (response.ok) renderState(response.tool ?? 'idle'); else showError(response.error);
}

for (const button of toolButtons) {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool === 'measure' || tool === 'color-picker') void activate(tool);
  });
}
stopButton.addEventListener('click', () => void deactivate());
copyFormat.addEventListener('change', () => void saveSettings());
keepActive.addEventListener('change', () => void saveSettings());

async function activate(tool: ActiveTool): Promise<void> {
  if (tabId === null) return;
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
  status.textContent = tool === 'idle' ? '대기' : tool === 'measure' ? '영역 측정 중' : '컬러 피커 중';
  stopButton.hidden = tool === 'idle';
  for (const button of toolButtons) button.classList.toggle('active', button.dataset.tool === tool);
}
async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ copyFormat: copyFormat.value, keepColorPickerActive: keepActive.checked });
}
async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  try { return await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>(message); }
  catch (error: unknown) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
function showError(message: string): void { errorText.textContent = message; }
function isCopyFormat(value: unknown): value is CopyFormat { return value === 'hex' || value === 'rgb' || value === 'hsl'; }
function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}
