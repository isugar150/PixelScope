import { describe, expect, it } from 'vitest';
import { diffCssSnapshots, formatCssChanges, type CssDeclarationSnapshot, type CssRuleSnapshot, type CssSnapshot } from '../src/content/css-changes/css-snapshot';

function snapshot(declarations: Record<string, string>): CssSnapshot {
  const values = new Map<string, CssDeclarationSnapshot>();
  for (const [name, value] of Object.entries(declarations)) values.set(name, { name, value, priority: '' });
  const rule: CssRuleSnapshot = { key: 'style\n.card\n#0', source: 'document style#theme', context: [], selector: '.card', declarations: values };
  return { rules: new Map([[rule.key, rule]]), unreadableStyleSheets: 0 };
}

describe('CSS snapshot diff', () => {
  it('reports a changed declaration with its previous and next values', () => {
    const changes = diffCssSnapshots(snapshot({ color: 'red', padding: '8px' }), snapshot({ color: 'blue', padding: '8px' }));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.properties).toEqual([
      { kind: 'changed', name: 'color', value: 'blue', priority: '', previousValue: 'red', previousPriority: '' },
    ]);
  });

  it('formats selectors and additions/deletions for copying', () => {
    const changes = diffCssSnapshots(snapshot({ color: 'red' }), snapshot({ display: 'grid' }));
    expect(formatCssChanges(changes)).toContain('.card {');
    expect(formatCssChanges(changes)).toContain('- color: red;');
    expect(formatCssChanges(changes)).toContain('+ display: grid;');
  });

  it('formats changed values as a direct before-to-after transition', () => {
    const changes = diffCssSnapshots(snapshot({ color: 'red' }), snapshot({ color: 'blue' }));
    expect(formatCssChanges(changes)).toContain('~ color: red -> blue;');
  });
});
