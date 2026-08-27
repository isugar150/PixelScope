import { describe, expect, it, vi } from 'vitest';
import { loadCssResourceBaseline } from '../src/css-baseline-loader';

describe('CSS baseline loader', () => {
  it('fetches each supported stylesheet once and skips failures', async () => {
    const fetchCss = vi.fn((url: string) => {
      if (url.endsWith('/missing.css')) return Promise.resolve({ ok: false, text: () => Promise.resolve('') });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(`/* ${url} */`) });
    });

    const resources = await loadCssResourceBaseline([
      'https://example.com/theme.css',
      'https://example.com/theme.css',
      'javascript:alert(1)',
      'https://example.com/missing.css',
      'data:text/css,.card%7Bcolor:red%7D',
    ], fetchCss);

    expect(fetchCss).toHaveBeenCalledTimes(3);
    expect(resources.map((resource) => resource.url)).toEqual([
      'https://example.com/theme.css',
      'data:text/css,.card%7Bcolor:red%7D',
    ]);
  });

  it('keeps the combined baseline within the character limit', async () => {
    const oversized = 'a'.repeat(650_001);
    const fetchCss = vi.fn((url: string) => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(url.endsWith('large.css') ? oversized : '.card{}'),
    }));

    const resources = await loadCssResourceBaseline([
      'https://example.com/large.css',
      'https://example.com/small.css',
    ], fetchCss);

    expect(resources).toEqual([{ url: 'https://example.com/small.css', content: '.card{}' }]);
  });

  it('stops reading a streamed response as soon as the baseline limit is exceeded', async () => {
    const oversized = new Response('a'.repeat(650_001));
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');

    const resources = await loadCssResourceBaseline(['https://example.com/large.css'], () => Promise.resolve(oversized));

    expect(resources).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
