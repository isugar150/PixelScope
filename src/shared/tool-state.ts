export type ToolMode = 'idle' | 'measure' | 'color-picker' | 'capture-element' | 'capture-page' | 'design-overlay' | 'css-changes';
export type ActiveTool = Exclude<ToolMode, 'idle'>;
export type CopyFormat = 'hex' | 'rgb' | 'hsl';
export type MeasurementUnit = 'px' | 'rem' | 'viewport';
export type ColorPickerScope = 'page' | 'screen';
export type DesignOverlayBlendMode = 'normal' | 'difference';

export interface UserSettings {
  readonly copyFormat: CopyFormat;
  readonly measurementUnit: MeasurementUnit;
  readonly showMeasurementCoordinates: boolean;
  readonly showBoxModel: boolean;
  readonly colorPickerScope: ColorPickerScope;
  readonly designOverlayOpacity: number;
  readonly designOverlayBlendMode: DesignOverlayBlendMode;
  readonly designOverlayScale: DesignOverlayScale;
}

export const DESIGN_OVERLAY_SCALE_OPTIONS = ['fit', '0.5', '1', '1.5', '2', '3'] as const;
export type DesignOverlayScale = typeof DESIGN_OVERLAY_SCALE_OPTIONS[number];

export const DEFAULT_SETTINGS: UserSettings = {
  copyFormat: 'hex', measurementUnit: 'px', showMeasurementCoordinates: false, showBoxModel: false, colorPickerScope: 'screen',
  designOverlayOpacity: 50, designOverlayBlendMode: 'normal', designOverlayScale: 'fit',
};

export function isToolMode(value: unknown): value is ToolMode {
  return value === 'idle' || value === 'measure' || value === 'color-picker' || value === 'capture-element'
    || value === 'capture-page' || value === 'design-overlay' || value === 'css-changes';
}

export function isActiveTool(value: unknown): value is ActiveTool {
  return value !== 'idle' && isToolMode(value);
}

export function isCopyFormat(value: unknown): value is CopyFormat {
  return value === 'hex' || value === 'rgb' || value === 'hsl';
}

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'px' || value === 'rem' || value === 'viewport';
}

export function isColorPickerScope(value: unknown): value is ColorPickerScope {
  return value === 'page' || value === 'screen';
}

export function isDesignOverlayBlendMode(value: unknown): value is DesignOverlayBlendMode {
  return value === 'normal' || value === 'difference';
}

export function isDesignOverlayScale(value: unknown): value is DesignOverlayScale {
  return typeof value === 'string' && DESIGN_OVERLAY_SCALE_OPTIONS.includes(value as DesignOverlayScale);
}
