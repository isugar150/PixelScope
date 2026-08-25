import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import type { ToolMode } from '../shared/tool-state';
import { ColorPickerController } from './color-picker/color-picker-controller';
import { CaptureController } from './capture/capture-controller';
import { MeasureController } from './measure-controller';
import { ToolController } from './tool-controller';

const DISPOSE_EVENT = 'pixelscope:dispose';

interface PixelScopeRuntime {
  dispose(): void;
}

declare global {
  interface Window {
    __pixelScopeRuntime__?: PixelScopeRuntime;
  }
}

document.dispatchEvent(new Event(DISPOSE_EVENT));
window.__pixelScopeRuntime__?.dispose();
removeStaleArtifacts();

const exit = (): void => {
  controller.deactivate();
  notifyState('idle');
};
const controller = new ToolController({
  measure: () => new MeasureController(exit),
  colorPicker: () => new ColorPickerController(exit),
  captureElement: () => {
    captureController = new CaptureController('element', exit);
    return captureController;
  },
  capturePage: () => {
    captureController = new CaptureController('page', exit);
    return captureController;
  },
});
let captureController: CaptureController | null = null;

const onMessage = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: ExtensionResponse) => void): boolean => {
  if (!isContentMessage(message)) return false;
  if (message.type === 'GET_TOOL_STATE') {
    sendResponse({ ok: true, tool: controller.mode, captureProgress: captureController?.progress });
    return false;
  }
  if (message.type === 'CAPTURE_SCROLL_TO') {
    void captureController?.prepareViewport(message.position, message.suppressViewportFixed)
      .then((position) => sendResponse({ ok: true, position }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === 'CAPTURE_PROGRESS') {
    captureController?.updateProgress(message.completed, message.total);
    sendResponse({ ok: true });
    return false;
  }
  void (message.tool === 'idle' ? Promise.resolve(controller.deactivate()) : controller.activate(message.tool))
    .then(() => {
      notifyState(controller.mode);
      sendResponse({ ok: true, tool: controller.mode });
    })
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
};

const runtime: PixelScopeRuntime = {
  dispose(): void {
    controller.deactivate();
    chrome.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener(DISPOSE_EVENT, onDispose);
    removeStaleArtifacts();
    if (window.__pixelScopeRuntime__ === runtime) delete window.__pixelScopeRuntime__;
  },
};
const onDispose = (): void => runtime.dispose();

window.__pixelScopeRuntime__ = runtime;
document.addEventListener(DISPOSE_EVENT, onDispose);
chrome.runtime.onMessage.addListener(onMessage);

function notifyState(tool: ToolMode): void {
  void chrome.runtime.sendMessage({ type: 'TOOL_STATE_CHANGED', tool } satisfies ExtensionMessage).catch(() => undefined);
}

function isContentMessage(value: unknown): value is
  | { type: 'GET_TOOL_STATE' }
  | { type: 'TOOL_COMMAND'; tool: ToolMode }
  | { type: 'CAPTURE_SCROLL_TO'; position: { x: number; y: number }; suppressViewportFixed: boolean }
  | { type: 'CAPTURE_PROGRESS'; completed: number; total: number } {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'GET_TOOL_STATE') return true;
  if (value.type === 'TOOL_COMMAND' && 'tool' in value) return isToolMode(value.tool);
  if (value.type === 'CAPTURE_SCROLL_TO' && 'position' in value && typeof value.position === 'object' && value.position !== null) {
    return 'x' in value.position && typeof value.position.x === 'number' && 'y' in value.position && typeof value.position.y === 'number'
      && 'suppressViewportFixed' in value && typeof value.suppressViewportFixed === 'boolean';
  }
  return value.type === 'CAPTURE_PROGRESS' && 'completed' in value && typeof value.completed === 'number' && 'total' in value && typeof value.total === 'number';
}

function isToolMode(value: unknown): value is ToolMode {
  return value === 'idle' || value === 'measure' || value === 'color-picker' || value === 'capture-element' || value === 'capture-page';
}

function removeStaleArtifacts(): void {
  for (const element of document.querySelectorAll('[data-pixelscope-overlay], [data-pixelscope-interaction], [data-pixelscope-capture-preparation]')) element.remove();
  document.documentElement.removeAttribute('data-pixelscope-touch-drag');
}
