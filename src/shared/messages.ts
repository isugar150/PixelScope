import type { ActiveTool, ToolMode } from './tool-state';
import type { CaptureRect, CaptureScrollPosition, CaptureViewportSize } from './capture';

export type ExtensionMessage =
  | { readonly type: 'GET_TOOL_STATE'; readonly tabId?: number }
  | { readonly type: 'ACTIVATE_TOOL'; readonly tabId: number; readonly tool: ActiveTool }
  | { readonly type: 'DEACTIVATE_TOOL'; readonly tabId: number }
  | { readonly type: 'CAPTURE_VISIBLE_TAB' }
  | { readonly type: 'CAPTURE_DOCUMENT'; readonly rect: CaptureRect; readonly viewport: CaptureViewportSize; readonly title: string; readonly preferredPosition?: CaptureScrollPosition }
  | { readonly type: 'CAPTURE_SCROLL_TO'; readonly position: CaptureScrollPosition }
  | { readonly type: 'CAPTURE_PROGRESS'; readonly completed: number; readonly total: number }
  | { readonly type: 'CAPTURE_CANCEL' }
  | { readonly type: 'TOOL_COMMAND'; readonly tool: ToolMode }
  | { readonly type: 'TOOL_STATE_CHANGED'; readonly tool: ToolMode };

export type ExtensionResponse =
  | { readonly ok: true; readonly tool?: ToolMode; readonly dataUrl?: string; readonly captureId?: string; readonly position?: CaptureScrollPosition }
  | { readonly ok: false; readonly error: string };

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
      return hasCaptureRect(value, 'rect') && hasSize(value, 'viewport') && 'title' in value && typeof value.title === 'string'
        && (!('preferredPosition' in value) || hasPoint(value, 'preferredPosition'));
    case 'CAPTURE_SCROLL_TO': return hasPoint(value, 'position');
    case 'CAPTURE_PROGRESS': return hasNumber(value, 'completed') && hasNumber(value, 'total');
    default: return false;
  }
}

function isTool(value: unknown, allowIdle: boolean): value is ToolMode {
  return (allowIdle && value === 'idle') || value === 'measure' || value === 'color-picker' || value === 'capture-element' || value === 'capture-page';
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
