import './viewer.css';
import { deleteCapture, deleteExpiredCaptures, getCapture } from '../capture/capture-store';
import type { StoredCapture } from '../shared/capture';
import { adjustCropRect, createInitialCropRect, imagePointFromViewport, isCropRectWithinBounds, visibleImageCenter } from './crop';
import type { CropHandle, CropInteraction, CropPoint, CropRect } from './crop';
import {
  TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, TEXT_LINE_HEIGHT, appendStrokePoint, clearAnnotations, commitAnnotation, createHistory,
  isAnnotationTool, isFillableTool, isMeaningfulAnnotation, mosaicBlockSize, rectFromPoints, redoAnnotation, snapToAngle,
  strokeWidthForTool, textFontSize, textLines, undoAnnotation,
} from './annotation';
import type { Annotation, AnnotationHistory, AnnotationTool } from './annotation';
import { drawAnnotation, renderPreview, type AnnotationBase } from './annotation-renderer';

const captureId = new URLSearchParams(location.search).get('id');
const title = requiredElement('title', HTMLHeadingElement);
const meta = requiredElement('meta', HTMLParagraphElement);
const header = requiredElement('viewer-header', HTMLElement);
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
const annotateButton = requiredElement('annotate', HTMLButtonElement);
const annotateToolbar = requiredElement('annotate-toolbar', HTMLElement);
const annotationCanvas = requiredElement('annotation-canvas', HTMLCanvasElement);
const annotationLayer = requiredElement('annotation-layer', HTMLDivElement);
const annotationPreview = requiredSvg('annotation-preview');
const annotateColorInput = requiredElement('annotate-color', HTMLInputElement);
const annotateFillButton = requiredElement('annotate-fill', HTMLButtonElement);
const annotateSizeInput = requiredElement('annotate-size', HTMLInputElement);
const annotateSizeLabel = requiredElement('annotate-size-label', HTMLSpanElement);
const annotationTextInput = requiredElement('annotation-text', HTMLTextAreaElement);
const annotateSizeValue = requiredElement('annotate-size-value', HTMLOutputElement);
const annotateUndoButton = requiredElement('annotate-undo', HTMLButtonElement);
const annotateRedoButton = requiredElement('annotate-redo', HTMLButtonElement);
const annotateClearButton = requiredElement('annotate-clear', HTMLButtonElement);
const annotateDoneButton = requiredElement('annotate-done', HTMLButtonElement);
const annotateToolButtons = Array.from(annotateToolbar.querySelectorAll<HTMLButtonElement>('[data-annotate-tool]'));
const annotateColorButtons = Array.from(annotateToolbar.querySelectorAll<HTMLButtonElement>('[data-annotate-color]'));
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
let cropStartFrame: number | null = null;
let edited = false;
let annotateMode = false;
let annotationTool: AnnotationTool = 'pen';
let annotationColor = '#000000';
let annotationFill = false;
let annotationHistory: AnnotationHistory = createHistory();
/** Where the current (cropped) image starts in source-capture pixels; annotations live in source pixels. */
let cropOffset: CropPoint = { x: 0, y: 0 };
let annotationDraft: { readonly pointerId: number; readonly start: CropPoint; annotation: Annotation } | null = null;
let previewFrame: number | null = null;
/** The text box being typed into; its position and size are in source-capture pixels. */
let textEdit: { readonly position: CropPoint; readonly fontSize: number; readonly color: string } | null = null;
const textMeasure = document.createElement('canvas').getContext('2d');
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
annotateButton.addEventListener('click', () => { if (annotateMode) stopAnnotate(true); else startAnnotate(); });
annotateDoneButton.addEventListener('click', () => stopAnnotate(true));
annotateUndoButton.addEventListener('click', () => setAnnotationHistory(undoAnnotation(annotationHistory)));
annotateRedoButton.addEventListener('click', () => setAnnotationHistory(redoAnnotation(annotationHistory)));
annotateClearButton.addEventListener('click', () => setAnnotationHistory(clearAnnotations(annotationHistory)));
for (const button of annotateToolButtons) button.addEventListener('click', () => selectAnnotationTool(button.dataset.annotateTool));
for (const button of annotateColorButtons) button.addEventListener('click', () => selectAnnotationColor(button.dataset.annotateColor ?? annotationColor));
annotateColorInput.addEventListener('input', () => selectAnnotationColor(annotateColorInput.value));
annotateFillButton.addEventListener('click', () => { annotationFill = !annotationFill; updateAnnotationControls(); });
annotateSizeInput.addEventListener('input', () => { annotateSizeValue.value = annotateSizeInput.value; });
annotationLayer.addEventListener('pointerdown', beginAnnotation);
annotationLayer.addEventListener('pointermove', updateAnnotation);
annotationLayer.addEventListener('pointerup', endAnnotation);
annotationLayer.addEventListener('pointercancel', cancelAnnotation);
annotationTextInput.addEventListener('input', layoutTextEditor);
annotationTextInput.addEventListener('keydown', handleTextEditorKey);
annotationTextInput.addEventListener('blur', commitTextEditor);
resetCropButton.addEventListener('click', () => void resetCrop());
copyButton.addEventListener('click', () => void copyCapture());
downloadButton.addEventListener('click', () => void downloadCapture());
cropApplyButton.addEventListener('click', () => void applyCrop());
cropCancelButton.addEventListener('click', () => cancelCrop(true));
cropLayer.addEventListener('pointerdown', beginCropDrag);
cropLayer.addEventListener('pointermove', updateCropDrag);
cropLayer.addEventListener('pointerup', endCropDrag);
cropLayer.addEventListener('pointercancel', cancelCropDrag);
for (const input of Object.values(cropInputs)) input.addEventListener('input', updateCropFromInputs);
window.addEventListener('keydown', handleKeydown);
window.addEventListener('pagehide', () => {
  if (cropStartFrame !== null) cancelAnimationFrame(cropStartFrame);
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  if (captureId !== null) void deleteCapture(captureId).catch(() => undefined);
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
  layoutTextEditor();
}

function startCrop(): void {
  if (currentBlob === null || cropMode) return;
  stopAnnotate(false);
  cropMode = true;
  cropToolbar.hidden = false;
  cropLayer.hidden = false;
  cropButton.setAttribute('aria-pressed', 'true');
  imageShell.classList.add('is-cropping');
  copyButton.disabled = true;
  downloadButton.disabled = true;
  resetCropButton.disabled = true;
  cropSelection.hidden = true;
  cropLayer.focus({ preventScroll: true });
  cropStartFrame = requestAnimationFrame(() => {
    if (!cropMode) return;
    setCropRect(createInitialCropRect(imageBounds(), 100, currentVisibleImageCenter()), true);
    cropSelection.hidden = true;
    cropStartFrame = requestAnimationFrame(() => {
      cropStartFrame = null;
      if (!cropMode) return;
      setCropRect(createInitialCropRect(imageBounds(), 100, currentVisibleImageCenter()), true);
    });
  });
}

function currentVisibleImageCenter(): CropPoint {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  return visibleImageCenter(
    image.getBoundingClientRect(),
    {
      left: 0,
      top: Math.max(0, header.getBoundingClientRect().bottom),
      right: viewportWidth,
      bottom: viewportHeight,
    },
    imageBounds(),
  );
}

function cancelCrop(restoreFocus: boolean): void {
  if (!cropMode) return;
  if (cropStartFrame !== null) {
    cancelAnimationFrame(cropStartFrame);
    cropStartFrame = null;
  }
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
    const nextOffset = { x: cropOffset.x + cropRect.x, y: cropOffset.y + cropRect.y };
    cancelCrop(false);
    await setCurrentImage(nextBlob, nextWidth, nextHeight);
    cropOffset = nextOffset;
    redrawAnnotations();
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
    cropOffset = { x: 0, y: 0 };
    redrawAnnotations();
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
    // A pending Blob keeps the click's user activation while drawings are being flattened.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob() })]);
    showToast('이미지를 클립보드에 복사했습니다.');
  } catch { showToast('이 환경에서는 이미지 클립보드 복사를 사용할 수 없습니다.'); }
}

async function downloadCapture(): Promise<void> {
  if (sourceCapture === null || objectUrl === null) return;
  const annotated = annotationHistory.present.length > 0;
  let url = objectUrl;
  try {
    if (annotated) url = URL.createObjectURL(await exportBlob());
  } catch {
    showToast('그린 내용을 이미지에 합성하지 못했습니다.');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = captureFilename(sourceCapture.title, edited, annotated);
  anchor.click();
  if (url !== objectUrl) window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  showToast('PNG 저장을 시작했습니다.');
}

/** The image as shown: current (possibly cropped) capture with every drawing flattened on top. */
async function exportBlob(): Promise<Blob> {
  if (currentBlob === null) throw new Error('캡처 이미지가 없습니다.');
  if (annotationHistory.present.length === 0) return currentBlob;
  const canvas = document.createElement('canvas');
  canvas.width = currentWidth;
  canvas.height = currentHeight;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas 2D context is unavailable.');
  context.drawImage(image, 0, 0, currentWidth, currentHeight);
  context.drawImage(annotationCanvas, 0, 0);
  return canvasToPng(canvas);
}

function startAnnotate(): void {
  if (currentBlob === null || annotateMode) return;
  cancelCrop(false);
  annotateMode = true;
  annotateToolbar.hidden = false;
  annotationLayer.hidden = false;
  annotateButton.setAttribute('aria-pressed', 'true');
  imageShell.classList.add('is-annotating');
  renderPreview(annotationPreview, null, cropOffset, imageBounds());
  updateAnnotationControls();
}

function stopAnnotate(restoreFocus: boolean): void {
  if (!annotateMode) return;
  commitTextEditor();
  discardAnnotationDraft();
  annotateMode = false;
  annotateToolbar.hidden = true;
  annotationLayer.hidden = true;
  annotateButton.setAttribute('aria-pressed', 'false');
  imageShell.classList.remove('is-annotating');
  if (restoreFocus) annotateButton.focus({ preventScroll: true });
}

function selectAnnotationTool(value: string | undefined): void {
  if (!isAnnotationTool(value)) return;
  commitTextEditor();
  annotationTool = value;
  updateAnnotationControls();
}

function selectAnnotationColor(color: string): void {
  annotationColor = color;
  annotateColorInput.value = color;
  updateAnnotationControls();
}

function updateAnnotationControls(): void {
  for (const button of annotateToolButtons) button.setAttribute('aria-pressed', String(button.dataset.annotateTool === annotationTool));
  const colorless = annotationTool === 'mosaic';
  for (const button of annotateColorButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.annotateColor === annotationColor));
    button.disabled = colorless;
  }
  annotateColorInput.disabled = colorless;
  annotateFillButton.disabled = !isFillableTool(annotationTool);
  annotateFillButton.setAttribute('aria-pressed', String(annotationFill));
  annotateSizeLabel.textContent = annotationTool === 'text' ? '크기' : '굵기';
  annotateUndoButton.disabled = annotationHistory.past.length === 0;
  annotateRedoButton.disabled = annotationHistory.future.length === 0;
  annotateClearButton.disabled = annotationHistory.present.length === 0;
}

function setAnnotationHistory(next: AnnotationHistory): void {
  if (next === annotationHistory) return;
  annotationHistory = next;
  redrawAnnotations();
  updateAnnotationControls();
}

function beginAnnotation(event: PointerEvent): void {
  if (!annotateMode || annotationDraft !== null || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  // A click outside an open text box finishes that text instead of starting something new.
  if (textEdit !== null) { commitTextEditor(); return; }
  const start = pointerToSourcePoint(event);
  const size = Number(annotateSizeInput.value);
  if (annotationTool === 'text') { openTextEditor(start, textFontSize(size, zoom)); return; }
  const annotation: Annotation = annotationTool === 'mosaic'
    ? { kind: 'mosaic', rect: rectFromPoints(start, start), block: mosaicBlockSize(size, zoom) }
    : annotationTool === 'pen' || annotationTool === 'marker'
      ? { kind: 'stroke', tool: annotationTool, points: [start], color: annotationColor, width: strokeWidthForTool(annotationTool, size, zoom) }
      : {
          kind: 'shape', tool: annotationTool, start, end: start, color: annotationColor,
          width: strokeWidthForTool(annotationTool, size, zoom), fill: annotationFill && isFillableTool(annotationTool),
        };
  annotationDraft = { pointerId: event.pointerId, start, annotation };
  annotationLayer.setPointerCapture(event.pointerId);
  schedulePreview();
}

function updateAnnotation(event: PointerEvent): void {
  if (annotationDraft === null || event.pointerId !== annotationDraft.pointerId) return;
  event.preventDefault();
  const point = pointerToSourcePoint(event);
  const draft = annotationDraft.annotation;
  const start = annotationDraft.start;
  annotationDraft.annotation = draft.kind === 'stroke'
    ? { ...draft, points: event.shiftKey ? [start, snapToAngle(start, point)] : appendStrokePoint(draft.points, point, 0.75 / Math.max(zoom, 0.01)) }
    : draft.kind === 'mosaic'
      ? { ...draft, rect: rectFromPoints(start, point) }
      : draft.kind === 'shape' ? { ...draft, end: point } : draft;
  schedulePreview();
}

function endAnnotation(event: PointerEvent): void {
  if (annotationDraft === null || event.pointerId !== annotationDraft.pointerId) return;
  event.preventDefault();
  updateAnnotation(event);
  const { annotation } = annotationDraft;
  discardAnnotationDraft();
  if (!isMeaningfulAnnotation(annotation, 2 / Math.max(zoom, 0.01))) return;
  annotationHistory = commitAnnotation(annotationHistory, annotation);
  drawCommittedAnnotation(annotation);
  updateAnnotationControls();
}

function cancelAnnotation(event: PointerEvent): void {
  if (annotationDraft === null || event.pointerId !== annotationDraft.pointerId) return;
  discardAnnotationDraft();
}

function discardAnnotationDraft(): void {
  if (annotationDraft !== null && annotationLayer.hasPointerCapture(annotationDraft.pointerId)) {
    annotationLayer.releasePointerCapture(annotationDraft.pointerId);
  }
  annotationDraft = null;
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  previewFrame = null;
  renderPreview(annotationPreview, null, cropOffset, imageBounds());
}

function schedulePreview(): void {
  if (previewFrame !== null) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    renderPreview(annotationPreview, annotationDraft?.annotation ?? null, cropOffset, imageBounds());
  });
}

function openTextEditor(point: CropPoint, fontSize: number): void {
  // Centre the first line on the click so the text appears where the pointer is.
  textEdit = { position: { x: point.x, y: point.y - fontSize * TEXT_LINE_HEIGHT / 2 }, fontSize, color: annotationColor };
  annotationTextInput.value = '';
  annotationTextInput.style.color = annotationColor;
  annotationTextInput.style.fontFamily = TEXT_FONT_FAMILY;
  annotationTextInput.style.fontWeight = String(TEXT_FONT_WEIGHT);
  annotationTextInput.style.lineHeight = String(TEXT_LINE_HEIGHT);
  annotationTextInput.hidden = false;
  layoutTextEditor();
  annotationTextInput.focus({ preventScroll: true });
}

/** Keeps the editor over the same image pixels and sized to its content at the current zoom. */
function layoutTextEditor(): void {
  if (textEdit === null || currentWidth === 0) return;
  const displayFontSize = textEdit.fontSize * zoom;
  annotationTextInput.style.left = `${String((textEdit.position.x - cropOffset.x) / currentWidth * 100)}%`;
  annotationTextInput.style.top = `${String((textEdit.position.y - cropOffset.y) / currentHeight * 100)}%`;
  annotationTextInput.style.fontSize = `${String(displayFontSize)}px`;
  const lines = textLines(annotationTextInput.value);
  let widest = displayFontSize;
  if (textMeasure !== null) {
    textMeasure.font = `${String(TEXT_FONT_WEIGHT)} ${String(displayFontSize)}px ${TEXT_FONT_FAMILY}`;
    for (const line of lines) widest = Math.max(widest, textMeasure.measureText(line).width);
  }
  annotationTextInput.style.width = `${String(Math.ceil(widest + displayFontSize * 0.6))}px`;
  annotationTextInput.style.height = `${String(Math.ceil(lines.length * displayFontSize * TEXT_LINE_HEIGHT))}px`;
}

function handleTextEditorKey(event: KeyboardEvent): void {
  // Enter while a Korean syllable is still composing belongs to the IME, not to us.
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeTextEditor();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    commitTextEditor();
  }
}

function commitTextEditor(): void {
  if (textEdit === null) return;
  const annotation: Annotation = { kind: 'text', position: textEdit.position, text: annotationTextInput.value.trimEnd(), color: textEdit.color, fontSize: textEdit.fontSize };
  closeTextEditor();
  if (!isMeaningfulAnnotation(annotation, 0)) return;
  annotationHistory = commitAnnotation(annotationHistory, annotation);
  drawCommittedAnnotation(annotation);
  updateAnnotationControls();
}

function closeTextEditor(): void {
  if (textEdit === null) return;
  // Cleared first so the blur fired by hiding the focused box does not commit it a second time.
  textEdit = null;
  annotationTextInput.hidden = true;
  annotationTextInput.value = '';
}

function pointerToSourcePoint(event: PointerEvent): CropPoint {
  const point = imagePointFromViewport({ x: event.clientX, y: event.clientY }, image.getBoundingClientRect(), imageBounds());
  return { x: point.x + cropOffset.x, y: point.y + cropOffset.y };
}

function annotationBase(): AnnotationBase {
  return { image, offset: cropOffset, size: imageBounds() };
}

/** Rebuilds the full-resolution drawing layer; only needed after undo, clear, or a crop change. */
function redrawAnnotations(): void {
  if (annotationHistory.present.length === 0) {
    annotationCanvas.width = 0;
    annotationCanvas.height = 0;
    annotationCanvas.hidden = true;
    return;
  }
  annotationCanvas.width = currentWidth;
  annotationCanvas.height = currentHeight;
  annotationCanvas.hidden = false;
  const context = annotationCanvas.getContext('2d');
  if (context === null) return;
  context.setTransform(1, 0, 0, 1, -cropOffset.x, -cropOffset.y);
  for (const annotation of annotationHistory.present) drawAnnotation(context, annotation, annotationBase());
}

/** New annotations only ever stack on top, so committing one never repaints the earlier ones. */
function drawCommittedAnnotation(annotation: Annotation): void {
  const context = annotationCanvas.getContext('2d');
  if (context === null || annotationCanvas.hidden || annotationCanvas.width !== currentWidth || annotationCanvas.height !== currentHeight) {
    redrawAnnotations();
    return;
  }
  context.setTransform(1, 0, 0, 1, -cropOffset.x, -cropOffset.y);
  drawAnnotation(context, annotation, annotationBase());
}

function handleKeydown(event: KeyboardEvent): void {
  if (handleShortcut(event) || handleAnnotateKey(event) || !cropMode) return;
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

/**
 * Ctrl/⌘+C copies and Ctrl/⌘+S saves the current image, mirroring the toolbar buttons (and their
 * disabled state during crop). `code` keeps the shortcuts working under a Korean IME, and native
 * copy wins while an input has focus or text is selected.
 */
function handleShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  if (event.code === 'KeyS') {
    event.preventDefault();
    commitTextEditor();
    if (!event.repeat && !downloadButton.disabled) void downloadCapture();
    return true;
  }
  if (event.code !== 'KeyC' || isTextField(event.target) || (getSelection()?.toString() ?? '') !== '') return false;
  event.preventDefault();
  if (!event.repeat && !copyButton.disabled) void copyCapture();
  return true;
}

/** Undo/redo and Escape while drawing; `code` keeps them working under a Korean IME. */
function handleAnnotateKey(event: KeyboardEvent): boolean {
  if (!annotateMode || isTextField(event.target)) return false;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (annotationDraft !== null) discardAnnotationDraft();
    else stopAnnotate(true);
    return true;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const redo = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey);
  if (!redo && event.code !== 'KeyZ') return false;
  event.preventDefault();
  if (annotationDraft === null) setAnnotationHistory(redo ? redoAnnotation(annotationHistory) : undoAnnotation(annotationHistory));
  return true;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function isArrowKey(value: string): value is 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' {
  return value === 'ArrowLeft' || value === 'ArrowRight' || value === 'ArrowUp' || value === 'ArrowDown';
}

function imageBounds(): { readonly width: number; readonly height: number } {
  return { width: currentWidth, height: currentHeight };
}

function captureFilename(captureTitle: string, isEdited: boolean, isAnnotated: boolean): string {
  const printableTitle = Array.from(captureTitle, (character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const safeTitle = printableTitle
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 170);
  return `${safeTitle || 'PixelScope-capture'}${isEdited ? '-cropped' : ''}${isAnnotated ? '-annotated' : ''}.png`;
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

function requiredSvg(id: string): SVGSVGElement {
  const element = document.getElementById(id);
  if (!(element instanceof SVGSVGElement)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}

function requiredElement<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`필수 요소를 찾을 수 없습니다: ${id}`);
  return element;
}
