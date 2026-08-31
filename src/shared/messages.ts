import { isActiveTool, isDesignOverlayBlendMode, isDesignOverlayScale, isToolMode, type ActiveTool, type DesignOverlayBlendMode, type DesignOverlayScale, type ToolMode } from './tool-state';
import type { CaptureProgressState, CaptureRect, CaptureScrollPosition, CaptureViewportSize } from './capture';

export type ExtensionMessage =
  | { readonly type: 'GET_TOOL_STATE'; readonly tabId?: number }
  | { readonly type: 'TOGGLE_PAGE_INTERACTION_UNLOCK'; readonly tabId?: number }
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
  | { readonly ok: true; readonly tool?: ToolMode; readonly dataUrl?: string; readonly captureId?: string; readonly position?: CaptureScrollPosition; readonly captureProgress?: CaptureProgressState; readonly interactionsUnlocked?: boolean }
  | { readonly ok: false; readonly error: string; readonly code?: 'file-access-required' };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'GET_TOOL_STATE': return !('tabId' in value) || hasTabId(value, 'tabId');
    case 'CAPTURE_VISIBLE_TAB':
    case 'CAPTURE_CANCEL': return true;
    case 'TOGGLE_PAGE_INTERACTION_UNLOCK': return !('tabId' in value) || hasTabId(value, 'tabId');
    case 'ACTIVATE_TOOL':
      return hasTabId(value, 'tabId') && 'tool' in value && isActiveTool(value.tool);
    case 'DEACTIVATE_TOOL': return hasTabId(value, 'tabId');
    case 'TOOL_COMMAND':
    case 'TOOL_STATE_CHANGED':
      return 'tool' in value && isToolMode(value.tool);
    case 'CAPTURE_DOCUMENT':
      return hasCaptureRect(value, 'rect') && hasSize(value, 'viewport') && hasSize(value, 'screenshotViewport') && hasPoint(value, 'viewportOffset')
        && 'title' in value && typeof value.title === 'string'
        && (!('preferredPosition' in value) || hasPoint(value, 'preferredPosition'));
    case 'CAPTURE_REGION':
      return hasCaptureRect(value, 'rect') && hasSize(value, 'screenshotViewport') && 'title' in value && typeof value.title === 'string';
    case 'DESIGN_OVERLAY_UPDATE':
      return hasTabId(value, 'tabId') && hasNumberInRange(value, 'opacity', 0, 100) && 'scale' in value && isDesignOverlayScale(value.scale)
        && 'blendMode' in value && isDesignOverlayBlendMode(value.blendMode)
        && (!('imageDataUrl' in value) || typeof value.imageDataUrl === 'string');
    case 'CAPTURE_SCROLL_TO': return hasPoint(value, 'position') && 'suppressViewportFixed' in value && typeof value.suppressViewportFixed === 'boolean';
    case 'CAPTURE_PROGRESS': {
      const completed: unknown = Reflect.get(value, 'completed');
      const total: unknown = Reflect.get(value, 'total');
      return typeof completed === 'number' && Number.isInteger(completed) && completed >= 0
        && typeof total === 'number' && Number.isInteger(total) && total > 0
        && completed <= total;
    }
    default: return false;
  }
}

function hasCaptureRect(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const rect = candidate;
  return hasFiniteNumber(rect, 'left') && hasFiniteNumber(rect, 'top') && hasPositiveNumber(rect, 'width') && hasPositiveNumber(rect, 'height');
}
function hasSize(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const size = candidate;
  return hasPositiveNumber(size, 'width') && hasPositiveNumber(size, 'height');
}
function hasPoint(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  if (typeof candidate !== 'object' || candidate === null) return false;
  const point = candidate;
  return hasFiniteNumber(point, 'x') && hasFiniteNumber(point, 'y');
}

function hasFiniteNumber(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === 'number' && Number.isFinite(candidate);
}

function hasPositiveNumber(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0;
}

function hasNonNegativeInteger(value: object, key: string): boolean {
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}

function hasTabId(value: object, key: string): boolean {
  return hasNonNegativeInteger(value, key);
}

function hasNumberInRange(value: object, key: string, minimum: number, maximum: number): boolean {
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum;
}
