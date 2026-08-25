import './viewer.css';
import { deleteExpiredCaptures, getCapture } from '../capture/capture-store';
import type { StoredCapture } from '../shared/capture';
import { adjustCropRect, createInitialCropRect, imagePointFromViewport, isCropRectWithinBounds } from './crop';
import type { CropHandle, CropInteraction, CropPoint, CropRect } from './crop';

const captureId = new URLSearchParams(location.search).get('id');
const title = requiredElement('title', HTMLHeadingElement);
const meta = requiredElement('meta', HTMLParagraphElement);
const stage = requiredElement('stage', HTMLElement);
const empty = requiredElement('empty', HTMLDivElement);
const imageShell = requiredElement('image-shell', HTMLDivElement);
const image = requiredElement('capture', HTMLImageElement);
const zoomValue = requiredElement('zoom-value', HTMLOutputElement);
const toast = requiredElement('toast', HTMLParagraphElement);
const zoomOut = requiredElement('zoom-out', HTMLButtonElement);
const zoomIn = requiredElement('zoom-in', HTMLButtonElement);
const fitButton = requiredElement('fit', HTMLButtonElement);
const cropButton = requiredElement('crop', HTMLButtonElement);
const resetCropButton = requiredElement('reset-crop', HTMLButtonElement);
const copyButton = requiredElement('copy', HTMLButtonElement);
const downloadButton = requiredElement('download', HTMLButtonElement);
const cropToolbar = requiredElement('crop-toolbar', HTMLElement);
const cropLayer = requiredElement('crop-layer', HTMLDivElement);
const cropSelection = requiredElement('crop-selection', HTMLDivElement);
const cropSize = requiredElement('crop-size', HTMLSpanElement);
const cropSummary = requiredElement('crop-summary', HTMLOutputElement);
const cropApplyButton = requiredElement('crop-apply', HTMLButtonElement);
const cropCancelButton = requiredElement('crop-cancel', HTMLButtonElement);
const cropInputs = {
  x: requiredElement('crop-x', HTMLInputElement),
  y: requiredElement('crop-y', HTMLInputElement),
  width: requiredElement('crop-width', HTMLInputElement),
  height: requiredElement('crop-height', HTMLInputElement),
};

let sourceCapture: StoredCapture | null = null;
let currentBlob: Blob | null = null;
let currentWidth = 0;
let currentHeight = 0;
let objectUrl: string | null = null;
let zoom = 1;
let cropRect: CropRect | null = null;
let cropDrag: { readonly pointerId: number; readonly start: CropPoint; readonly previous: CropRect; readonly interaction: CropInteraction } | null = null;
let cropMode = false;
let edited = false;
let toastTimer: number | null = null;

void initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  showError(`캡처 이미지를 불러오지 못했습니다: ${message}`);
});

async function initialize(): Promise<void> {
  await deleteExpiredCaptures();
  if (captureId === null) { showError('캡처 식별자가 없습니다.'); return; }
  sourceCapture = await getCapture(captureId);
  if (sourceCapture === null) { showError('캡처 데이터가 만료되었거나 이미 제거되었습니다.'); return; }
  title.textContent = sourceCapture.title;
  document.title = `${sourceCapture.title} · PixelScope`;
  await setCurrentImage(sourceCapture.blob, sourceCapture.width, sourceCapture.height);
  empty.hidden = true;
  fitToWidth();
}

zoomOut.addEventListener('click', () => setZoom(zoom - 0.25));
zoomIn.addEventListener('click', () => setZoom(zoom + 0.25));
fitButton.addEventListener('click', fitToWidth);
cropButton.addEventListener('click', startCrop);
resetCropButton.addEventListener('click', () => void resetCrop());
copyButton.addEventListener('click', () => void copyCapture());
downloadButton.addEventListener('click', downloadCapture);
cropApplyButton.addEventListener('click', () => void applyCrop());
cropCancelButton.addEventListener('click', () => cancelCrop(true));
cropLayer.addEventListener('pointerdown', beginCropDrag);
cropLayer.addEventListener('pointermove', updateCropDrag);
cropLayer.addEventListener('pointerup', endCropDrag);
cropLayer.addEventListener('pointercancel', cancelCropDrag);
for (const input of Object.values(cropInputs)) input.addEventListener('input', updateCropFromInputs);
window.addEventListener('keydown', handleKeydown);
window.addEventListener('pagehide', () => {
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
});

async function setCurrentImage(blob: Blob, width: number, height: number): Promise<void> {
  const nextUrl = URL.createObjectURL(blob);
  const loader = new Image();
  loader.src = nextUrl;
  try {
    await loader.decode();
  } catch (error: unknown) {
    URL.revokeObjectURL(nextUrl);
    throw error;
  }
  image.src = nextUrl;
  image.hidden = false;
  imageShell.hidden = false;
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  objectUrl = nextUrl;
  currentBlob = blob;
  currentWidth = width;
  currentHeight = height;
  meta.textContent = `${String(width)} × ${String(height)} px · ${formatBytes(blob.size)}`;
  setZoom(zoom);
}

function fitToWidth(): void {
  if (currentWidth === 0) return;
  setZoom(Math.min(1, Math.max(0.1, (stage.clientWidth - 64) / currentWidth)));
}

function setZoom(value: number): void {
  zoom = Math.min(4, Math.max(0.1, Math.round(value * 20) / 20));
  imageShell.style.width = `${String(Math.round(currentWidth * zoom))}px`;
  zoomValue.value = `${String(Math.round(zoom * 100))}%`;
}

function startCrop(): void {
  if (currentBlob === null || cropMode) return;
  cropMode = true;
  cropToolbar.hidden = false;
  cropLayer.hidden = false;
  cropButton.setAttribute('aria-pressed', 'true');
  imageShell.classList.add('is-cropping');
  copyButton.disabled = true;
  downloadButton.disabled = true;
  resetCropButton.disabled = true;
  setCropRect(createInitialCropRect(imageBounds()), true);
  cropLayer.focus({ preventScroll: true });
}

function cancelCrop(restoreFocus: boolean): void {
  if (!cropMode) return;
  if (cropDrag !== null && cropLayer.hasPointerCapture(cropDrag.pointerId)) cropLayer.releasePointerCapture(cropDrag.pointerId);
  cropMode = false;
  cropDrag = null;
  cropRect = null;
  cropSelection.classList.remove('is-dragging');
  cropToolbar.hidden = true;
  cropLayer.hidden = true;
  cropButton.setAttribute('aria-pressed', 'false');
  imageShell.classList.remove('is-cropping');
  copyButton.disabled = false;
  downloadButton.disabled = false;
  resetCropButton.disabled = false;
  if (restoreFocus) cropButton.focus({ preventScroll: true });
}

function beginCropDrag(event: PointerEvent): void {
  if (!cropMode || cropRect === null || event.button !== 0 || !event.isPrimary) return;
  const interaction = getCropInteraction(event.target);
  if (interaction === null) return;
  event.preventDefault();
  const start = pointerToImagePoint(event);
  cropDrag = { pointerId: event.pointerId, start, previous: cropRect, interaction };
  cropLayer.setPointerCapture(event.pointerId);
  cropSelection.classList.add('is-dragging');
}

function updateCropDrag(event: PointerEvent): void {
  if (cropDrag === null || event.pointerId !== cropDrag.pointerId) return;
  event.preventDefault();
  const current = pointerToImagePoint(event);
  setCropRect(adjustCropRect(
    cropDrag.previous,
    cropDrag.interaction,
    { x: current.x - cropDrag.start.x, y: current.y - cropDrag.start.y },
    imageBounds(),
  ), true);
}

function endCropDrag(event: PointerEvent): void {
  if (cropDrag === null || event.pointerId !== cropDrag.pointerId) return;
  event.preventDefault();
  updateCropDrag(event);
  cropLayer.releasePointerCapture(event.pointerId);
  cropDrag = null;
  cropSelection.classList.remove('is-dragging');
}

function cancelCropDrag(event: PointerEvent): void {
  if (cropDrag === null || event.pointerId !== cropDrag.pointerId) return;
  const previous = cropDrag.previous;
  if (cropLayer.hasPointerCapture(event.pointerId)) cropLayer.releasePointerCapture(event.pointerId);
  cropDrag = null;
  cropSelection.classList.remove('is-dragging');
  setCropRect(previous, true);
}

function getCropInteraction(target: EventTarget | null): CropInteraction | null {
  if (!(target instanceof Element) || !cropSelection.contains(target)) return null;
  const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle;
  return isCropHandle(handle) ? handle : 'move';
}

function isCropHandle(value: string | undefined): value is CropHandle {
  return value === 'n' || value === 'ne' || value === 'e' || value === 'se' ||
    value === 's' || value === 'sw' || value === 'w' || value === 'nw';
}

function pointerToImagePoint(event: PointerEvent): CropPoint {
  return imagePointFromViewport(
    { x: event.clientX, y: event.clientY },
    image.getBoundingClientRect(),
    imageBounds(),
  );
}

function updateCropFromInputs(): void {
  cropRect = readCropInputs();
  renderCropRect();
}

function readCropInputs(): CropRect | null {
  const rect = {
    x: readInteger(cropInputs.x),
    y: readInteger(cropInputs.y),
    width: readInteger(cropInputs.width),
    height: readInteger(cropInputs.height),
  };
  const complete = Object.values(rect).every((value) => value !== null);
  const candidate: CropRect | null = complete ? {
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
  } : null;
  const valid = candidate !== null && isCropRectWithinBounds(candidate, imageBounds());
  for (const input of Object.values(cropInputs)) input.setAttribute('aria-invalid', String(!valid));
  return valid ? candidate : null;
}

function readInteger(input: HTMLInputElement): number | null {
  if (input.value.trim() === '') return null;
  const value = Number(input.value);
  return Number.isInteger(value) ? value : null;
}

function setCropRect(rect: CropRect, syncInputs: boolean): void {
  cropRect = rect;
  if (syncInputs) {
    cropInputs.x.value = String(rect.x);
    cropInputs.y.value = String(rect.y);
    cropInputs.width.value = String(rect.width);
    cropInputs.height.value = String(rect.height);
    cropInputs.x.max = String(Math.max(0, currentWidth - 1));
    cropInputs.y.max = String(Math.max(0, currentHeight - 1));
    cropInputs.width.max = String(currentWidth - rect.x);
    cropInputs.height.max = String(currentHeight - rect.y);
    for (const input of Object.values(cropInputs)) input.setAttribute('aria-invalid', 'false');
  }
  renderCropRect();
}

function renderCropRect(): void {
  const valid = cropRect !== null && isCropRectWithinBounds(cropRect, imageBounds());
  cropApplyButton.disabled = !valid;
  cropSelection.hidden = !valid;
  cropSummary.value = valid && cropRect !== null ? `${String(cropRect.width)} × ${String(cropRect.height)} px` : '올바른 영역을 입력하세요';
  if (!valid || cropRect === null) return;
  cropSelection.style.left = `${String(cropRect.x / currentWidth * 100)}%`;
  cropSelection.style.top = `${String(cropRect.y / currentHeight * 100)}%`;
  cropSelection.style.width = `${String(cropRect.width / currentWidth * 100)}%`;
  cropSelection.style.height = `${String(cropRect.height / currentHeight * 100)}%`;
  cropSize.textContent = `${String(cropRect.width)} × ${String(cropRect.height)} px`;
}

async function applyCrop(): Promise<void> {
  if (currentBlob === null || cropRect === null || !isCropRectWithinBounds(cropRect, imageBounds())) return;
  if (cropRect.x === 0 && cropRect.y === 0 && cropRect.width === currentWidth && cropRect.height === currentHeight) {
    cancelCrop(true);
    showToast('이미지 전체가 선택되어 있어 변경하지 않았습니다.');
    return;
  }
  cropApplyButton.disabled = true;
  cropApplyButton.setAttribute('aria-busy', 'true');
  try {
    const nextBlob = await cropImage(currentBlob, cropRect);
    const nextWidth = cropRect.width;
    const nextHeight = cropRect.height;
    cancelCrop(false);
    await setCurrentImage(nextBlob, nextWidth, nextHeight);
    edited = true;
    resetCropButton.hidden = false;
    fitToWidth();
    cropButton.focus({ preventScroll: true });
    showToast(`${String(nextWidth)} × ${String(nextHeight)} px로 크롭했습니다.`);
  } catch {
    showToast('이미지를 크롭하지 못했습니다.');
  } finally {
    cropApplyButton.disabled = false;
    cropApplyButton.removeAttribute('aria-busy');
  }
}

async function resetCrop(): Promise<void> {
  if (sourceCapture === null) return;
  resetCropButton.disabled = true;
  try {
    await setCurrentImage(sourceCapture.blob, sourceCapture.width, sourceCapture.height);
    edited = false;
    resetCropButton.hidden = true;
    fitToWidth();
    showToast('원본 이미지로 복원했습니다.');
  } catch {
    showToast('원본 이미지를 복원하지 못했습니다.');
  } finally {
    resetCropButton.disabled = false;
  }
}

async function cropImage(blob: Blob, rect: CropRect): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D context is unavailable.');
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return await canvasToPng(canvas);
  } finally {
    bitmap.close();
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob === null ? reject(new Error('PNG encoding failed.')) : resolve(blob), 'image/png');
  });
}

async function copyCapture(): Promise<void> {
  if (currentBlob === null) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': currentBlob })]);
    showToast('이미지를 클립보드에 복사했습니다.');
  } catch { showToast('이 환경에서는 이미지 클립보드 복사를 사용할 수 없습니다.'); }
}

function downloadCapture(): void {
  if (sourceCapture === null || objectUrl === null) return;
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = captureFilename(sourceCapture.title, edited);
  anchor.click();
  showToast('PNG 저장을 시작했습니다.');
}

function handleKeydown(event: KeyboardEvent): void {
  if (!cropMode) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelCrop(true);
  } else if (event.key === 'Enter' && !cropApplyButton.disabled) {
    event.preventDefault();
    void applyCrop();
  } else if (cropRect !== null && event.target === cropLayer && isArrowKey(event.key)) {
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    const delta = event.key === 'ArrowLeft' ? { x: -distance, y: 0 }
      : event.key === 'ArrowRight' ? { x: distance, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: -distance }
          : { x: 0, y: distance };
    setCropRect(adjustCropRect(cropRect, 'move', delta, imageBounds()), true);
  }
}

function isArrowKey(value: string): value is 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' {
  return value === 'ArrowLeft' || value === 'ArrowRight' || value === 'ArrowUp' || value === 'ArrowDown';
}

function imageBounds(): { readonly width: number; readonly height: number } {
  return { width: currentWidth, height: currentHeight };
}

function captureFilename(captureTitle: string, isEdited: boolean): string {
  const printableTitle = Array.from(captureTitle, (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const safeTitle = printableTitle
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 170);
  return `${safeTitle || 'PixelScope-capture'}${isEdited ? '-cropped' : ''}.png`;
}

function showError(message: string): void {
  empty.classList.add('error');
  empty.replaceChildren(document.createTextNode(message));
  meta.textContent = '임시 데이터 없음';
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('visible');
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
