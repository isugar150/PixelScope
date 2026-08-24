import type { ActiveTool, ToolMode } from '../shared/tool-state';

export interface ToolLifecycle {
  readonly active: boolean;
  enable(): void | Promise<void>;
  disable(): void;
}

export interface ToolFactories {
  readonly measure: () => ToolLifecycle;
  readonly colorPicker: () => ToolLifecycle;
}

export class ToolController {
  readonly #factories: ToolFactories;
  #current: ToolLifecycle | null = null;
  #mode: ToolMode = 'idle';

  public constructor(factories: ToolFactories) { this.#factories = factories; }
  public get mode(): ToolMode { return this.#mode; }

  public async activate(tool: ActiveTool): Promise<void> {
    if (this.#mode === tool) return;
    this.deactivate();
    const instance = tool === 'measure' ? this.#factories.measure() : this.#factories.colorPicker();
    this.#current = instance;
    this.#mode = tool;
    try { await instance.enable(); }
    catch (error: unknown) { this.deactivate(); throw error; }
  }

  public deactivate(): void {
    this.#current?.disable();
    this.#current = null;
    this.#mode = 'idle';
  }
}
