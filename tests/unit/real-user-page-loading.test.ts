import { describe, expect, it } from 'vitest';
import { selectRealUserPageLinks, summarizeDeliveryHosts } from '../../src/local/real-user-page-loading';

describe('real user page loading', () => {
  it('keeps only genuine same-site HTML links, favours main content, and removes duplicates', () => {
    const links = selectRealUserPageLinks('https://www.example.com/', [
      { href: 'https://example.com/pricing', text: ' Pricing ', placement: 'header' },
      { href: '/guide#section-one', text: 'Guide', placement: 'main' },
      { href: '/pricing#plans', text: 'Plans', placement: 'main' },
      { href: 'https://other.example/guide', text: 'Outside site', placement: 'main' },
      { href: '/assets/report.pdf', text: 'PDF', placement: 'main' },
      { href: 'mailto:hello@example.com', text: 'Email', placement: 'main' },
    ]);

    expect(links).toEqual([
      { url: 'https://www.example.com/guide', text: 'Guide', placement: 'main' },
      { url: 'https://www.example.com/pricing', text: 'Plans', placement: 'main' },
    ]);
  });

  it('never creates more than ten visitor-path pages even when the landing page has more links', () => {
    const links = selectRealUserPageLinks('https://example.com/', Array.from({ length: 14 }, (_, index) => ({
      href: `/page-${index + 1}`,
      text: `Page ${index + 1}`,
      placement: 'main' as const,
    })));

    expect(links).toHaveLength(10);
    expect(links[0]?.url).toBe('https://example.com/page-1');
    expect(links[9]?.url).toBe('https://example.com/page-10');
  });

  it('keeps response-header cache signals grouped by delivery host without naming an unverified CDN', () => {
    const hosts = summarizeDeliveryHosts([
      { url: 'https://example.com/', kind: 'Document', status: 200, transferredBytes: 12_000, hostname: 'example.com', cacheControl: 'no-cache' },
      { url: 'https://cdn.example.net/app.js', kind: 'Script', status: 200, transferredBytes: 42_000, hostname: 'cdn.example.net', cacheControl: 'public, max-age=31536000', cacheStatus: 'HIT', age: '122' },
      { url: 'https://cdn.example.net/chunk.js', kind: 'Script', status: 200, transferredBytes: 8_000, hostname: 'cdn.example.net', cacheControl: 'public, max-age=31536000', cacheStatus: 'HIT', age: '122' },
    ], 'www.example.com');

    expect(hosts).toEqual([
      expect.objectContaining({ hostname: 'cdn.example.net', firstParty: false, requests: 2, transferredBytes: 50_000, cacheControl: ['public, max-age=31536000'], cacheStatus: ['HIT'], age: ['122'] }),
      expect.objectContaining({ hostname: 'example.com', firstParty: true, requests: 1, transferredBytes: 12_000, cacheControl: ['no-cache'] }),
    ]);
  });
});
