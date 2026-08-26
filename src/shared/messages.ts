import { isDesignOverlayBlendMode, isDesignOverlayScale, type ActiveTool, type DesignOverlayBlendMode, type DesignOverlayScale, type ToolMode } from './tool-state';
import type { CaptureProgressState, CaptureRect, CaptureScrollPosition, CaptureViewportSize } from './capture';

export type ExtensionMessage =
  | { readonly type: 'GET_TOOL_STATE'; readonly tabId?: number }
  | { readonly type: 'ACTIVATE_TOOL'; readonly tabId: number; readonly tool: ActiveTool }
  | { readonly type: 'DEACTIVATE_TOOL'; readonly tabId: number }
  | { readonly type: 'CAPTURE_VISIBLE_TAB' }
  | { readonly type: 'CAPTURE_DOCUMENT'; readonly rect: CaptureRect; readonly viewport: CaptureViewportSize; readonly screenshotViewport: CaptureViewportSize; readonly viewportOffset: CaptureScrollPosition; readonly title: string; readonly preferredPosition?: CaptureScrollPosition }
  | { readonly type: 'CAPTURE_REGION'; readonly rect: CaptureRect; readonly screenshotViewport: CaptureViewportSize; readonly title: string }
  | { readonly type: 'DESIGN_OVERLAY_UPDATE'; readonly tabId: number; readonly opacity: number; readonly blendMode: DesignOverlayBlendMode; readonly scale: DesignOverlayScale; readonly imageDataUrl?: string }
  | { readonly type: 'CAPTURE_SCROLL_TO'; readonly position: CaptureScrollPosition; readonly suppressViewportFixed: boolean }
  | { readonly type: 'CAPTURE_PROGRESS'; readonly completed: number; readonly total: number }
  | { readonly type: 'CAPTURE_CANCEL' }
  | { readonly type: 'TOOL_COMMAND'; readonly tool: ToolMode }
  | { readonly type: 'TOOL_STATE_CHANGED'; readonly tool: ToolMode };

export type ExtensionResponse =
  | { readonly ok: true; readonly tool?: ToolMode; readonly dataUrl?: string; readonly captureId?: string; readonly position?: CaptureScrollPosition; readonly captureProgress?: CaptureProgressState }
  | { readonly ok: false; readonly error: string; readonly code?: 'file-access-required' };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'GET_TOOL_STATE':
    case 'CAPTURE_VISIBLE_TAB':
    case 'CAPTURE_CANCEL': return true;
    case 'ACTIVATE_TOOL':
      return hasNumber(value, 'tabId') && 'tool' in value && isTool(value.tool, false);
    case 'DEACTIVATE_TOOL': return hasNumber(value, 'tabId');
    case 'TOOL_COMMAND':
    case 'TOOL_STATE_CHANGED':
      return 'tool' in value && isTool(value.tool, true);
    case 'CAPTURE_DOCUMENT':
      return hasCaptureRect(value, 'rect') && hasSize(value, 'viewport') && hasSize(value, 'screenshotViewport') && hasPoint(value, 'viewportOffset')
        && 'title' in value && typeof value.title === 'string'
        && (!('preferredPosition' in value) || hasPoint(value, 'preferredPosition'));
    case 'CAPTURE_REGION':
      return hasCaptureRect(value, 'rect') && hasSize(value, 'screenshotViewport') && 'title' in value && typeof value.title === 'string';
    case 'DESIGN_OVERLAY_UPDATE':
      return hasNumber(value, 'tabId') && hasNumber(value, 'opacity') && 'scale' in value && isDesignOverlayScale(value.scale)
        && 'blendMode' in value && isDesignOverlayBlendMode(value.blendMode)
        && (!('imageDataUrl' in value) || typeof value.imageDataUrl === 'string');
    case 'CAPTURE_SCROLL_TO': return hasPoint(value, 'position') && 'suppressViewportFixed' in value && typeof value.suppressViewportFixed === 'boolean';
    case 'CAPTURE_PROGRESS': return hasNumber(value, 'completed') && hasNumber(value, 'total');
    default: return false;
  }
}

function isTool(value: unknown, allowIdle: boolean): value is ToolMode {
  return (allowIdle && value === 'idle') || value === 'measure' || value === 'color-picker' || value === 'capture-element' || value === 'capture-page' || value === 'design-overlay';
}

function hasCaptureRect(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const rect = candidate;
  return hasNumber(rect, 'left') && hasNumber(rect, 'top') && hasNumber(rect, 'width') && hasNumber(rect, 'height');
}
function hasSize(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const size = candidate;
  return hasNumber(size, 'width') && hasNumber(size, 'height');
}
function hasPoint(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const point = candidate;
  return hasNumber(point, 'x') && hasNumber(point, 'y');
}

function hasNumber(value: object, key: string): boolean {
  return key in value && typeof value[key as keyof typeof value] === 'number';
}
