export type ToolMode = 'idle' | 'measure' | 'color-picker';
export type ActiveTool = Exclude<ToolMode, 'idle'>;
export type CopyFormat = 'hex' | 'rgb' | 'hsl';

export interface UserSettings {
  readonly copyFormat: CopyFormat;
  readonly keepColorPickerActive: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = { copyFormat: 'hex', keepColorPickerActive: true };
