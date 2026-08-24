import { describe, expect, it, vi } from 'vitest';
import { ToolController, type ToolLifecycle } from '../src/content/tool-controller';

function tool(): ToolLifecycle & { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> } {
  return { active: false, enable: vi.fn(), disable: vi.fn() };
}

describe('ToolController', () => {
  it('cleans the old tool before switching and never keeps two active', async () => {
    const measure = tool(), picker = tool();
    const controller = new ToolController({ measure: () => measure, colorPicker: () => picker });
    await controller.activate('measure');
    await controller.activate('color-picker');
    expect(measure.disable.mock.calls).toHaveLength(1);
    expect(picker.enable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('color-picker');
  });
  it('ignores duplicate activation and deactivates cleanly', async () => {
    const measure = tool();
    const controller = new ToolController({ measure: () => measure, colorPicker: tool });
    await controller.activate('measure'); await controller.activate('measure'); controller.deactivate();
    expect(measure.enable.mock.calls).toHaveLength(1); expect(measure.disable.mock.calls).toHaveLength(1); expect(controller.mode).toBe('idle');
  });
});
