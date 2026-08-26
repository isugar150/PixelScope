export interface CssResourceBaseline {
  readonly url: string;
  readonly content: string;
}

export interface DevtoolsCssBaseline {
  readonly pageUrl: string;
  readonly capturedAt: number;
  readonly resources: readonly CssResourceBaseline[];
}

export function cssBaselineStorageKey(tabId: number): string { return `pixelscope:css-baseline:${String(tabId)}`; }

export function isDevtoolsCssBaseline(value: unknown): value is DevtoolsCssBaseline {
  if (typeof value !== 'object' || value === null) return false;
  const pageUrl: unknown = Reflect.get(value, 'pageUrl');
  const capturedAt: unknown = Reflect.get(value, 'capturedAt');
  const resources: unknown = Reflect.get(value, 'resources');
  return typeof pageUrl === 'string' && typeof capturedAt === 'number' && Array.isArray(resources)
    && resources.every((resource: unknown) => typeof resource === 'object' && resource !== null
      && typeof Reflect.get(resource, 'url') === 'string' && typeof Reflect.get(resource, 'content') === 'string');
}
