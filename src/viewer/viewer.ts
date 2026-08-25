import './viewer.css';
import { deleteExpiredCaptures, getCapture } from '../capture/capture-store';
import type { StoredCapture } from '../shared/capture';

const captureId = new URLSearchParams(location.search).get('id');
const title = requiredElement('title', HTMLHeadingElement);
const meta = requiredElement('meta', HTMLParagraphElement);
const stage = requiredElement('stage', HTMLElement);
const empty = requiredElement('empty', HTMLDivElement);
const image = requiredElement('capture', HTMLImageElement);
const zoomValue = requiredElement('zoom-value', HTMLOutputElement);
const toast = requiredElement('toast', HTMLParagraphElement);
const zoomOut = requiredElement('zoom-out', HTMLButtonElement);
const zoomIn = requiredElement('zoom-in', HTMLButtonElement);
const fitButton = requiredElement('fit', HTMLButtonElement);
const copyButton = requiredElement('copy', HTMLButtonElement);
const downloadButton = requiredElement('download', HTMLButtonElement);
const chromeSaveButton = requiredElement('chrome-save', HTMLButtonElement);
let capture: StoredCapture | null = null;
let objectUrl: string | null = null;
let zoom = 1;
let toastTimer: number | null = null;

void initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  showError(`캡처 이미지를 불러오지 못했습니다: ${message}`);
});

async function initialize(): Promise<void> {
  await deleteExpiredCaptures();
  if (captureId === null) { showError('캡처 식별자가 없습니다.'); return; }
  capture = await getCapture(captureId);
  if (capture === null) { showError('캡처 데이터가 만료되었거나 이미 제거되었습니다.'); return; }
  objectUrl = URL.createObjectURL(capture.blob);
  image.src = objectUrl;
  await image.decode();
  title.textContent = capture.title;
  document.title = `${capture.title} · PixelScope`;
  meta.textContent = `${String(capture.width)} × ${String(capture.height)} px · ${formatBytes(capture.blob.size)}`;
  empty.hidden = true; image.hidden = false;
  fitToWidth();
}

zoomOut.addEventListener('click', () => setZoom(zoom - .25));
zoomIn.addEventListener('click', () => setZoom(zoom + .25));
fitButton.addEventListener('click', fitToWidth);
copyButton.addEventListener('click', () => void copyCapture());
downloadButton.addEventListener('click', downloadCapture);
chromeSaveButton.addEventListener('click', () => void saveCaptureWithChrome());
window.addEventListener('pagehide', () => {
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
});

function fitToWidth(): void {
  if (capture === null) return;
  setZoom(Math.min(1, Math.max(.1, (stage.clientWidth - 64) / capture.width)));
}
function setZoom(value: number): void {
  zoom = Math.min(4, Math.max(.1, Math.round(value * 20) / 20));
  image.style.width = `${String(Math.round((capture?.width ?? 0) * zoom))}px`;
  zoomValue.value = `${String(Math.round(zoom * 100))}%`;
}
async function copyCapture(): Promise<void> {
  if (capture === null) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': capture.blob })]);
    showToast('이미지를 클립보드에 복사했습니다.');
  } catch { showToast('이 환경에서는 이미지 클립보드 복사를 사용할 수 없습니다.'); }
}
function downloadCapture(): void {
  if (capture === null || objectUrl === null) return;
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = captureFilename(capture.title); anchor.click();
  showToast('PNG 저장을 시작했습니다.');
}
async function saveCaptureWithChrome(): Promise<void> {
  if (capture === null || objectUrl === null) return;
  chromeSaveButton.disabled = true;
  chromeSaveButton.setAttribute('aria-busy', 'true');
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: captureFilename(capture.title),
      conflictAction: 'uniquify',
      saveAs: true,
    });
    showToast('Chrome 저장을 시작했습니다.');
  } catch {
    showToast('Chrome 저장이 취소되었거나 시작되지 않았습니다.');
  } finally {
    chromeSaveButton.disabled = false;
    chromeSaveButton.removeAttribute('aria-busy');
  }
}
function captureFilename(captureTitle: string): string {
  const printableTitle = Array.from(captureTitle, (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const safeTitle = printableTitle
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  return `${safeTitle || 'PixelScope-capture'}.png`;
}
function showError(message: string): void { empty.classList.add('error'); empty.replaceChildren(document.createTextNode(message)); meta.textContent = '임시 데이터 없음'; }
function showToast(message: string): void {
  toast.textContent = message; toast.classList.add('visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2_000);
}
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}
