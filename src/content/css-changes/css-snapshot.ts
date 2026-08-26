export interface CssDeclarationSnapshot {
  readonly name: string;
  readonly value: string;
  readonly priority: string;
}

export interface CssRuleSnapshot {
  readonly key: string;
  readonly source: string;
  readonly context: readonly string[];
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, CssDeclarationSnapshot>;
}

export interface CssSnapshot {
  readonly rules: ReadonlyMap<string, CssRuleSnapshot>;
  readonly editableStyles?: ReadonlyMap<string, CSSStyleDeclaration>;
  readonly unreadableStyleSheets: number;
}

export type CssPropertyChange =
  | (CssDeclarationSnapshot & { readonly kind: 'added' | 'removed' })
  | (CssDeclarationSnapshot & { readonly kind: 'changed'; readonly previousValue: string; readonly previousPriority: string });

export interface CssRuleChange {
  readonly key: string;
  readonly source: string;
  readonly context: readonly string[];
  readonly selector: string;
  readonly properties: readonly CssPropertyChange[];
}

interface SnapshotAccumulator {
  readonly rules: Map<string, CssRuleSnapshot>;
  readonly editableStyles: Map<string, CSSStyleDeclaration>;
  readonly duplicateCounts: Map<string, number>;
  readonly visitedSheets: WeakSet<CSSStyleSheet>;
  unreadableStyleSheets: number;
}

export function collectCssSnapshot(root: Document = document): CssSnapshot {
  const accumulator: SnapshotAccumulator = {
    rules: new Map(), editableStyles: new Map(), duplicateCounts: new Map(), visitedSheets: new WeakSet(), unreadableStyleSheets: 0,
  };
  collectRoot(root, accumulator, 'document');
  return { rules: accumulator.rules, editableStyles: accumulator.editableStyles, unreadableStyleSheets: accumulator.unreadableStyleSheets };
}

export function mergeCssResourceBaseline(current: CssSnapshot, resources: readonly { readonly url: string; readonly content: string }[]): CssSnapshot {
  const originalByUrl = new Map(resources.map((resource) => [normalizeUrl(resource.url), resource.content]));
  const rules = new Map(current.rules);
  const sources = new Set(Array.from(current.rules.values(), (rule) => rule.source));
  for (const source of sources) {
    const original = originalByUrl.get(normalizeUrl(source));
    if (original === undefined) continue;
    const sheet = new CSSStyleSheet();
    try { sheet.replaceSync(original); }
    catch { continue; }
    const accumulator: SnapshotAccumulator = {
      rules: new Map(), editableStyles: new Map(), duplicateCounts: new Map(), visitedSheets: new WeakSet(), unreadableStyleSheets: 0,
    };
    collectRules(sheet.cssRules, accumulator, source, []);
    for (const [key, rule] of rules) if (rule.source === source) rules.delete(key);
    for (const [key, rule] of accumulator.rules) rules.set(key, rule);
  }
  return { rules, editableStyles: current.editableStyles, unreadableStyleSheets: current.unreadableStyleSheets };
}

export function revertCssRuleChange(change: CssRuleChange, baseline: CssSnapshot, current: CssSnapshot): boolean {
  const target = current.editableStyles?.get(change.key);
  if (target === undefined) return false;
  const baselineDeclarations = baseline.rules.get(change.key)?.declarations;
  const names = new Set(change.properties.map((property) => property.name));
  for (const name of names) {
    const original = baselineDeclarations?.get(name);
    if (original === undefined) target.removeProperty(name);
    else target.setProperty(name, original.value, original.priority);
  }
  return true;
}

export function diffCssSnapshots(baseline: CssSnapshot, current: CssSnapshot): CssRuleChange[] {
  const keys = new Set([...baseline.rules.keys(), ...current.rules.keys()]);
  const changes: CssRuleChange[] = [];
  for (const key of keys) {
    const before = baseline.rules.get(key);
    const after = current.rules.get(key);
    const reference = after ?? before;
    if (reference === undefined) continue;
    const properties = diffDeclarations(before?.declarations, after?.declarations);
    if (properties.length > 0) changes.push({
      key, source: reference.source, context: reference.context, selector: reference.selector, properties,
    });
  }
  return changes.sort((left, right) => `${left.source}\n${left.selector}`.localeCompare(`${right.source}\n${right.selector}`));
}

export function formatCssChanges(changes: readonly CssRuleChange[]): string {
  if (changes.length === 0) return 'CSS 변경사항이 없습니다.';
  return changes.map((change) => {
    const context = change.context.length === 0 ? '' : `${change.context.join(' > ')}\n`;
    const declarations = change.properties.map(formatPropertyChange).join('\n');
    return `/* ${change.source} */\n${context}${change.selector} {\n${declarations}\n}`;
  }).join('\n\n');
}

function collectRoot(root: Document | ShadowRoot, accumulator: SnapshotAccumulator, scope: string): void {
  if (root instanceof Document) {
    for (const sheet of root.styleSheets) collectStyleSheet(sheet, accumulator, getStyleSheetSource(sheet, scope));
    for (const [index, sheet] of Array.from(root.adoptedStyleSheets).entries()) collectStyleSheet(sheet, accumulator, `${scope} adoptedStyleSheet ${String(index + 1)}`);
  } else {
    const styleNodes = root.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel~="stylesheet"]');
    for (const [index, node] of Array.from(styleNodes).entries()) {
      if (node.sheet !== null) collectStyleSheet(node.sheet, accumulator, `${scope} ${node.localName} ${String(index + 1)}`);
    }
    for (const [index, sheet] of Array.from(root.adoptedStyleSheets).entries()) collectStyleSheet(sheet, accumulator, `${scope} adoptedStyleSheet ${String(index + 1)}`);
  }

  for (const element of root.querySelectorAll('[style]')) {
    if (isPixelScopeElement(element)) continue;
    const style = getInlineStyle(element);
    if (style === null) continue;
    const selector = describeElement(element);
    addRule(accumulator, `inline style`, [], selector, style);
  }

  for (const element of root.querySelectorAll('*')) {
    if (isPixelScopeElement(element) || element.shadowRoot === null) continue;
    collectRoot(element.shadowRoot, accumulator, `${scope} > ${describeElement(element)} shadow`);
  }
}

function collectStyleSheet(sheet: CSSStyleSheet, accumulator: SnapshotAccumulator, source: string): void {
  if (accumulator.visitedSheets.has(sheet)) return;
  accumulator.visitedSheets.add(sheet);
  let rules: CSSRuleList;
  try { rules = sheet.cssRules; }
  catch { accumulator.unreadableStyleSheets += 1; return; }
  collectRules(rules, accumulator, source, []);
}

function collectRules(rules: CSSRuleList, accumulator: SnapshotAccumulator, source: string, context: readonly string[]): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      addRule(accumulator, source, context, rule.selectorText, rule.style);
      continue;
    }
    const nested = getNestedRules(rule);
    if (nested === null) continue;
    const headerEnd = rule.cssText.indexOf('{');
    const header = (headerEnd < 0 ? rule.cssText : rule.cssText.slice(0, headerEnd)).trim();
    collectRules(nested, accumulator, source, header === '' ? context : [...context, header]);
  }
}

function addRule(accumulator: SnapshotAccumulator, source: string, context: readonly string[], selector: string, style: CSSStyleDeclaration): void {
  const basis = `${source}\n${context.join('\n')}\n${selector}`;
  const duplicate = accumulator.duplicateCounts.get(basis) ?? 0;
  accumulator.duplicateCounts.set(basis, duplicate + 1);
  const key = `${basis}\n#${String(duplicate)}`;
  const declarations = new Map<string, CssDeclarationSnapshot>();
  for (const name of style) declarations.set(name, { name, value: style.getPropertyValue(name).trim(), priority: style.getPropertyPriority(name) });
  accumulator.rules.set(key, { key, source, context, selector, declarations });
  accumulator.editableStyles.set(key, style);
}

function diffDeclarations(
  before: ReadonlyMap<string, CssDeclarationSnapshot> | undefined,
  after: ReadonlyMap<string, CssDeclarationSnapshot> | undefined,
): CssPropertyChange[] {
  const names = new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])]);
  const changes: CssPropertyChange[] = [];
  for (const name of [...names].sort()) {
    const oldValue = before?.get(name);
    const newValue = after?.get(name);
    if (sameDeclaration(oldValue, newValue)) continue;
    if (oldValue !== undefined && newValue !== undefined) {
      changes.push({ ...newValue, kind: 'changed', previousValue: oldValue.value, previousPriority: oldValue.priority });
    } else if (oldValue !== undefined) changes.push({ ...oldValue, kind: 'removed' });
    else if (newValue !== undefined) changes.push({ ...newValue, kind: 'added' });
  }
  return changes;
}

function formatPropertyChange(property: CssPropertyChange): string {
  const value = `${property.value}${formatPriority(property.priority)}`;
  if (property.kind === 'changed') {
    const previous = `${property.previousValue}${formatPriority(property.previousPriority)}`;
    return `  ~ ${property.name}: ${previous} -> ${value};`;
  }
  return `  ${property.kind === 'added' ? '+' : '-'} ${property.name}: ${value};`;
}

function formatPriority(priority: string): string { return priority === '' ? '' : ` !${priority}`; }

function sameDeclaration(left: CssDeclarationSnapshot | undefined, right: CssDeclarationSnapshot | undefined): boolean {
  return left?.value === right?.value && left?.priority === right?.priority;
}

function getNestedRules(rule: CSSRule): CSSRuleList | null {
  const value: unknown = Reflect.get(rule, 'cssRules');
  return value !== null && typeof value === 'object' && Symbol.iterator in value ? value as CSSRuleList : null;
}

function getStyleSheetSource(sheet: CSSStyleSheet, scope: string): string {
  if (sheet.href !== null) return sheet.href;
  const owner: unknown = Reflect.get(sheet, 'ownerNode');
  return owner instanceof Element ? `${scope} ${describeElement(owner)}` : `${scope} stylesheet`;
}

function getInlineStyle(element: Element): CSSStyleDeclaration | null {
  return element instanceof HTMLElement || element instanceof SVGElement ? element.style : null;
}

function isPixelScopeElement(element: Element): boolean {
  return element.matches('[data-pixelscope-overlay], [data-pixelscope-overlay] *');
}

function describeElement(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current !== null && segments.length < 5) {
    let segment = current.localName;
    if (current.id !== '') {
      segment += `#${escapeSelector(current.id)}`;
      segments.unshift(segment);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent !== null) {
      const localName = current.localName;
      const siblings: Element[] = Array.from(parent.children).filter((sibling: Element) => sibling.localName === localName);
      if (siblings.length > 1) segment += `:nth-of-type(${String(siblings.indexOf(current) + 1)})`;
    }
    segments.unshift(segment);
    current = parent;
  }
  return segments.join(' > ');
}

function escapeSelector(value: string): string {
  return typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function normalizeUrl(url: string): string {
  try { return new URL(url).href; }
  catch { return url; }
}
