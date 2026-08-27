import { describe, expect, it } from 'vitest';
import { isExtensionMessage } from '../src/shared/messages';

describe('extension message validation', () => {
  it('accepts valid tool and capture messages', () => {
    expect(isExtensionMessage({ type: 'ACTIVATE_TOOL', tabId: 1, tool: 'measure' })).toBe(true);
    expect(isExtensionMessage({ type: 'CAPTURE_REGION', rect: { left: 0, top: 0, width: 10, height: 20 }, screenshotViewport: { width: 390, height: 844 }, title: 'capture' })).toBe(true);
  });

  it('rejects non-finite geometry, invalid tab ids, and impossible progress', () => {
    expect(isExtensionMessage({ type: 'GET_TOOL_STATE', tabId: Number.NaN })).toBe(false);
    expect(isExtensionMessage({ type: 'ACTIVATE_TOOL', tabId: -1, tool: 'measure' })).toBe(false);
    expect(isExtensionMessage({ type: 'CAPTURE_REGION', rect: { left: 0, top: 0, width: Infinity, height: 20 }, screenshotViewport: { width: 390, height: 844 }, title: 'capture' })).toBe(false);
    expect(isExtensionMessage({ type: 'CAPTURE_PROGRESS', completed: 3, total: 2 })).toBe(false);
  });

  it('rejects CSS baseline requests whose URL payload exceeds the accepted baseline size', () => {
    expect(isExtensionMessage({ type: 'GET_CSS_BASELINE', styleSheetUrls: ['a'.repeat(700_001)] })).toBe(false);
  });
});
