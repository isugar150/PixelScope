import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import type { ToolMode } from '../shared/tool-state';
import { ColorPickerController } from './color-picker/color-picker-controller';
import { MeasureController } from './measure-controller';
import { ToolController } from './tool-controller';

declare global {
  interface Window {
    __pixelScopeInstalled__?: true;
  }
}

if (window.__pixelScopeInstalled__ !== true) {
  window.__pixelScopeInstalled__ = true;
  const exit = (): void => {
    controller.deactivate();
    notifyState('idle');
  };
  const controller = new ToolController({
    measure: () => new MeasureController(exit),
    colorPicker: () => new ColorPickerController(exit),
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isContentMessage(message)) return false;
    if (message.type === 'GET_TOOL_STATE') {
      sendResponse({ ok: true, tool: controller.mode } satisfies ExtensionResponse);
      return false;
    }
    void (message.tool === 'idle' ? Promise.resolve(controller.deactivate()) : controller.activate(message.tool))
      .then(() => {
        notifyState(controller.mode);
        sendResponse({ ok: true, tool: controller.mode } satisfies ExtensionResponse);
      })
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ExtensionResponse));
    return true;
  });
}

function notifyState(tool: 'idle' | 'measure' | 'color-picker'): void {
  void chrome.runtime.sendMessage({ type: 'TOOL_STATE_CHANGED', tool } satisfies ExtensionMessage).catch(() => undefined);
}

function isContentMessage(value: unknown): value is { type: 'GET_TOOL_STATE' } | { type: 'TOOL_COMMAND'; tool: ToolMode } {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'GET_TOOL_STATE') return true;
  return value.type === 'TOOL_COMMAND' && 'tool' in value &&
    (value.tool === 'idle' || value.tool === 'measure' || value.tool === 'color-picker');
}
