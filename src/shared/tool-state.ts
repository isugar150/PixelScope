export type ToolMode = 'idle' | 'measure' | 'color-picker' | 'capture-element' | 'capture-page';
export type ActiveTool = Exclude<ToolMode, 'idle'>;
export type CopyFormat = 'hex' | 'rgb' | 'hsl';
export type MeasurementUnit = 'px' | 'rem' | 'viewport';
export type ColorPickerScope = 'page' | 'screen';

export interface UserSettings {
  readonly copyFormat: CopyFormat;
  readonly measurementUnit: MeasurementUnit;
  readonly colorPickerScope: ColorPickerScope;
}

export const DEFAULT_SETTINGS: UserSettings = { copyFormat: 'hex', measurementUnit: 'px', colorPickerScope: 'screen' };

export function isCopyFormat(value: unknown): value is CopyFormat {
  return value === 'hex' || value === 'rgb' || value === 'hsl';
}

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'px' || value === 'rem' || value === 'viewport';
}

export function isColorPickerScope(value: unknown): value is ColorPickerScope {
  return value === 'page' || value === 'screen';
}
