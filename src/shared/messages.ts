import type { ActiveTool, ToolMode } from './tool-state';

export type ExtensionMessage =
  | { readonly type: 'GET_TOOL_STATE'; readonly tabId?: number }
  | { readonly type: 'ACTIVATE_TOOL'; readonly tabId: number; readonly tool: ActiveTool }
  | { readonly type: 'DEACTIVATE_TOOL'; readonly tabId: number }
  | { readonly type: 'CAPTURE_VISIBLE_TAB' }
  | { readonly type: 'TOOL_COMMAND'; readonly tool: ToolMode }
  | { readonly type: 'TOOL_STATE_CHANGED'; readonly tool: ToolMode };

export type ExtensionResponse =
  | { readonly ok: true; readonly tool?: ToolMode; readonly dataUrl?: string }
  | { readonly ok: false; readonly error: string };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'GET_TOOL_STATE':
    case 'CAPTURE_VISIBLE_TAB': return true;
    case 'ACTIVATE_TOOL':
      return hasNumber(value, 'tabId') && 'tool' in value && (value.tool === 'measure' || value.tool === 'color-picker');
    case 'DEACTIVATE_TOOL': return hasNumber(value, 'tabId');
    case 'TOOL_COMMAND':
    case 'TOOL_STATE_CHANGED':
      return 'tool' in value && (value.tool === 'idle' || value.tool === 'measure' || value.tool === 'color-picker');
    default: return false;
  }
}

function hasNumber(value: object, key: string): boolean {
  return key in value && typeof value[key as keyof typeof value] === 'number';
}
