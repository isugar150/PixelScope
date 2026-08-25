// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { calculateColorPanelPosition, ColorPickerOverlay, formatColorValues } from '../src/content/color-picker/color-picker-overlay';
import { colorPickerCursorHotspot, colorPickerInteractionStyles } from '../src/content/styles';

describe('color picker result panel', () => {
  it('formats a selected color in every displayed unit', () => {
    expect(formatColorValues({ r: 17, g: 34, b: 51 })).toEqual([
      { label: 'HEX', value: '#112233' },
      { label: 'RGB', value: 'rgb(17, 34, 51)' },
      { label: 'HSL', value: 'hsl(210, 50%, 13.3%)' },
      { label: 'HSV', value: 'hsv(210, 66.7%, 20%)' },
      { label: 'CMYK', value: 'cmyk(66.7%, 33.3%, 0%, 80%)' },
    ]);
  });

  it('moves away from the pointer with hysteresis at both viewport edges', () => {
    expect(calculateColorPanelPosition('top', 35, { top: 8, bottom: 72 }, 800)).toBe('bottom');
    expect(calculateColorPanelPosition('bottom', 400, { top: 720, bottom: 792 }, 800)).toBe('bottom');
    expect(calculateColorPanelPosition('bottom', 710, { top: 720, bottom: 792 }, 800)).toBe('top');
  });

  it('resets the floating panel to the top when its lifecycle ends', () => {
    const overlay = new ColorPickerOverlay(() => undefined);
    overlay.host.shadowRoot?.querySelector<HTMLElement>('.panel')?.removeAttribute('hidden');
    overlay.movePanelAwayFrom({ x: 10, y: 0 });
    expect(overlay.host.dataset.pixelscopePanelPosition).toBe('bottom');
    overlay.resetPanelPosition();
    expect(overlay.host.dataset.pixelscopePanelPosition).toBe('top');
    overlay.destroy();
  });

  it('uses the visible pipette tip as the browser cursor hotspot', () => {
    expect(colorPickerCursorHotspot).toEqual({ x: 2, y: 30 });
    expect(colorPickerInteractionStyles).toContain("%3Ccircle cx='2' cy='30'");
    expect(colorPickerInteractionStyles).toContain('") 2 30, crosshair');
  });
});
