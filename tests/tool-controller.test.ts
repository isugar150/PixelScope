import { describe, expect, it, vi } from 'vitest';
import { ToolController, type ToolLifecycle } from '../src/content/tool-controller';

function tool(): ToolLifecycle & { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> } {
  return { active: false, enable: vi.fn(), disable: vi.fn() };
}

describe('ToolController', () => {
  it('cleans the old tool before switching and never keeps two active', async () => {
    const measure = tool(), picker = tool();
    const controller = new ToolController({ measure: () => measure, colorPicker: () => picker, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: tool });
    await controller.activate('measure');
    await controller.activate('color-picker');
    expect(measure.disable.mock.calls).toHaveLength(1);
    expect(picker.enable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('color-picker');
  });
  it('ignores duplicate activation and deactivates cleanly', async () => {
    const measure = tool();
    const controller = new ToolController({ measure: () => measure, colorPicker: tool, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: tool });
    await controller.activate('measure'); await controller.activate('measure'); controller.deactivate();
    expect(measure.enable.mock.calls).toHaveLength(1); expect(measure.disable.mock.calls).toHaveLength(1); expect(controller.mode).toBe('idle');
  });
  it('activates the requested capture tool', async () => {
    const capture = tool();
    const controller = new ToolController({ measure: tool, colorPicker: tool, captureElement: () => capture, capturePage: tool, designOverlay: tool, cssChanges: tool });
    await controller.activate('capture-element');
    expect(capture.enable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('capture-element');
  });
  it('activates the CSS changes tool', async () => {
    const cssChanges = tool();
    const controller = new ToolController({ measure: tool, colorPicker: tool, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: () => cssChanges });
    await controller.activate('css-changes');
    expect(cssChanges.enable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('css-changes');
  });

  it('keeps the newer tool active when an older async activation fails late', async () => {
    let rejectMeasure: ((reason?: unknown) => void) | undefined;
    const measure = tool(), picker = tool();
    measure.enable.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectMeasure = reject; }));
    const controller = new ToolController({ measure: () => measure, colorPicker: () => picker, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: tool });

    const pendingMeasure = controller.activate('measure');
    await controller.activate('color-picker');
    rejectMeasure?.(new Error('capture failed'));

    await expect(pendingMeasure).rejects.toThrow('capture failed');
    expect(controller.mode).toBe('color-picker');
    expect(picker.disable.mock.calls).toHaveLength(0);
  });

  it('shares a pending activation result with duplicate requests', async () => {
    let rejectMeasure: ((reason?: unknown) => void) | undefined;
    const measure = tool();
    measure.enable.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectMeasure = reject; }));
    const controller = new ToolController({ measure: () => measure, colorPicker: tool, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: tool });

    const first = controller.activate('measure');
    const duplicate = controller.activate('measure');
    await Promise.resolve();
    rejectMeasure?.(new Error('activation failed'));

    await expect(first).rejects.toThrow('activation failed');
    await expect(duplicate).rejects.toThrow('activation failed');
    expect(measure.enable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('idle');
  });

  it('cleans up when enable throws synchronously', async () => {
    const measure = tool();
    measure.enable.mockImplementation(() => { throw new Error('sync failure'); });
    const controller = new ToolController({ measure: () => measure, colorPicker: tool, captureElement: tool, capturePage: tool, designOverlay: tool, cssChanges: tool });

    await expect(controller.activate('measure')).rejects.toThrow('sync failure');
    expect(measure.disable.mock.calls).toHaveLength(1);
    expect(controller.mode).toBe('idle');
  });
});
