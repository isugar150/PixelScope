export interface CssResourceBaseline {
  readonly url: string;
  readonly content: string;
}

export interface CssBaseline {
  readonly pageUrl: string;
  readonly capturedAt: number;
  readonly resources: readonly CssResourceBaseline[];
}
