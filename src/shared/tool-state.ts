export type ToolMode = 'idle' | 'measure' | 'color-picker' | 'capture-element' | 'capture-page';
export type ActiveTool = Exclude<ToolMode, 'idle'>;
export type CopyFormat = 'hex' | 'rgb' | 'hsl';
export type MeasurementUnit = 'px' | 'rem' | 'viewport';

export interface UserSettings {
  readonly copyFormat: CopyFormat;
  readonly measurementUnit: MeasurementUnit;
}

export const DEFAULT_SETTINGS: UserSettings = { copyFormat: 'hex', measurementUnit: 'px' };

export function isCopyFormat(value: unknown): value is CopyFormat {
  return value === 'hex' || value === 'rgb' || value === 'hsl';
}

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === 'px' || value === 'rem' || value === 'viewport';
}
