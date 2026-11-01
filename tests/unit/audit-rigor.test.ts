import { describe, expect, it } from 'vitest';
import { parsePageMetrics } from '../../src/worker/crawlers/parser';
import { calculateSiteMetrics } from '../../src/worker/crawlers/metrics';

const url = 'https://example.com/landing';
describe('audit markup rigor', () => {
  it('honors restrictive directives across repeated robots and Googlebot tags', () => {
    const page = parsePageMetrics(url, '<meta name="robots" content="index"><meta name="robots" content="follow"><meta name="googlebot" content="noindex">');
    expect(page.isIndexable).toBe(false);
    expect(parsePageMetrics(url, '', { responseHeaders: { 'X-Robots-Tag': 'noindex' } }).isIndexable).toBe(false);
  });
  it('keeps other agents scoped out of Googlebot header rules', () => {
    expect(parsePageMetrics(url, '', { responseHeaders: { 'X-Robots-Tag': 'otherbot: noindex, nofollow' } }).isIndexable).toBe(true);
    expect(parsePageMetrics(url, '', { responseHeaders: { 'X-Robots-Tag': 'otherbot: follow, googlebot: noindex' } }).isIndexable).toBe(false);
  });
  it('does not treat commented markup or data attributes as live directives', () => {
    const page = parsePageMetrics(url, '<!-- <meta name="robots" content="noindex"> --><meta data-name="robots" content="noindex">');
    expect(page.isIndexable).toBe(true);
  });
  it('keeps crawling after a malformed canonical and emits actionable evidence', () => {
    const page = parsePageMetrics(url, '<link rel="canonical" href="http://[broken">');
    expect(page.markupDiagnostics?.map(item => item.code)).toContain('invalid_canonical');
    const report = calculateSiteMetrics([page]);
    expect(report.findings.find(item => item.ruleId === 'markup.invalid_canonical')?.evidence[0].url).toBe(url);
  });
  it('reports duplicate declarations, fragments and invalid structured data independently', () => {
    const page = parsePageMetrics(url, '<title>One</title><title>Two</title><meta name="description" content="A"><meta name="description" content="B"><link rel="canonical" href="/landing#fragment"><link rel="canonical" href="/other"><script type="application/ld+json">{broken}</script>');
    expect(page.markupDiagnostics?.map(item => item.code)).toEqual(expect.arrayContaining(['multiple_titles', 'multiple_descriptions', 'multiple_canonicals', 'canonical_fragment', 'invalid_jsonld']));
  });
  it('does not flag valid JSON-LD or an intentionally empty image alt', () => {
    const page = parsePageMetrics(url, '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script><img src="decorative.png" alt="">');
    expect(page.markupDiagnostics).toEqual([]);
    expect(page.imagesWithoutAlt).toBe(0);
  });
});
