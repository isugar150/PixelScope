import type { CssResourceBaseline } from './shared/css-baseline';

const MAX_BASELINE_CHARACTERS = 650_000;
const FETCH_TIMEOUT_MS = 5_000;
const FETCHABLE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'file:']);

interface CssFetchResponse {
  readonly ok: boolean;
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

type CssFetcher = (url: string) => Promise<CssFetchResponse>;

export async function loadCssResourceBaseline(
  styleSheetUrls: readonly string[],
  fetchCss: CssFetcher = fetchStyleSheet,
): Promise<CssResourceBaseline[]> {
  const resources: CssResourceBaseline[] = [];
  const visited = new Set<string>();
  let characterCount = 0;
  for (const candidate of styleSheetUrls) {
    const url = normalizeFetchableUrl(candidate);
    if (url === null || visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await fetchCss(url);
      if (!response.ok) continue;
      const content = await readLimitedText(response, MAX_BASELINE_CHARACTERS - characterCount);
      if (content === null || content.length === 0) continue;
      resources.push({ url, content });
      characterCount += content.length;
    } catch { /* A stylesheet may disappear or reject extension-origin requests. */ }
  }
  return resources;
}

async function fetchStyleSheet(url: string): Promise<Response> {
  return fetch(url, { cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function readLimitedText(response: CssFetchResponse, maximumCharacters: number): Promise<string | null> {
  if (response.body === undefined || response.body === null) {
    const content = await response.text();
    return content.length <= maximumCharacters ? content : null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let characterCount = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const chunk = decoder.decode(value, { stream: !done });
      characterCount += chunk.length;
      if (characterCount > maximumCharacters) {
        await reader.cancel();
        return null;
      }
      if (chunk.length > 0) chunks.push(chunk);
      if (done) return chunks.join('');
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeFetchableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return FETCHABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
