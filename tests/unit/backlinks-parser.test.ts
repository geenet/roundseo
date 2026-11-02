import { describe, expect, it } from 'vitest';
import { extractOccurrences, extractSourceDirectives } from '../../src/worker/backlinks/parser';

describe('extractOccurrences', () => {
  it('resolves a relative link against the document URL and keeps its anchor and attributes (AC1)', () => {
    const html = '<html><body><a href="/pricing" rel="noopener">See pricing</a></body></html>';
    const [occurrence] = extractOccurrences(html, 'https://example.com/about');
    expect(occurrence.resolvedUrl).toBe('https://example.com/pricing');
    expect(occurrence.anchorText).toBe('See pricing');
    expect(occurrence.relTokens).toEqual(['noopener']);
    expect(occurrence.originalHref).toBe('/pricing');
  });

  it('resolves a relative link against a <base> tag when present', () => {
    const html = '<html><head><base href="https://cdn.example.com/docs/"></head><body><a href="guide">Guide</a></body></html>';
    const [occurrence] = extractOccurrences(html, 'https://example.com/page');
    expect(occurrence.resolvedUrl).toBe('https://cdn.example.com/docs/guide');
  });

  it('keeps two occurrences to the same destination with different rel attributes separate (AC6)', () => {
    const html = `
      <a href="https://partner.example/review">Our review</a>
      <a href="https://partner.example/review" rel="nofollow sponsored">Sponsored mention</a>
    `;
    const occurrences = extractOccurrences(html, 'https://news.example/post');
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].relTokens).toEqual([]);
    expect(occurrences[1].relTokens).toEqual(['nofollow', 'sponsored']);
  });

  it('records an image-linked occurrence using the alt text, not anchor text', () => {
    const html = '<a href="https://partner.example/"><img src="/logo.png" alt="Partner logo"></a>';
    const [occurrence] = extractOccurrences(html, 'https://news.example/post');
    expect(occurrence.elementKind).toBe('image');
    expect(occurrence.imageAlt).toBe('Partner logo');
    expect(occurrence.anchorText).toBeNull();
  });

  it('skips javascript:, mailto:, tel:, and fragment-only hrefs', () => {
    const html = '<a href="javascript:void(0)">x</a><a href="mailto:a@b.com">y</a><a href="tel:+1">z</a><a href="#top">top</a>';
    expect(extractOccurrences(html, 'https://example.com/')).toHaveLength(0);
  });

  it('produces a stable context fingerprint for the same surrounding text and a different one for different surroundings', () => {
    const htmlA = '<p>Read our in-depth</p><a href="https://partner.example/">review</a><p>of the product.</p>';
    const htmlB = '<p>Read our in-depth</p><a href="https://partner.example/">review</a><p>of the product.</p>';
    const htmlC = '<p>Completely different context</p><a href="https://partner.example/">review</a><p>unrelated text.</p>';
    expect(extractOccurrences(htmlA, 'https://news.example/')[0].contextFingerprint).toBe(extractOccurrences(htmlB, 'https://news.example/')[0].contextFingerprint);
    expect(extractOccurrences(htmlA, 'https://news.example/')[0].contextFingerprint).not.toBe(extractOccurrences(htmlC, 'https://news.example/')[0].contextFingerprint);
  });

  it('does not treat identical anchor text elsewhere on the page as the same occurrence (AC25 input)', () => {
    const html = `
      <p>First context block entirely about topic A</p><a href="https://partner.example/a">Learn more</a>
      <p>Second context block entirely about topic B</p><a href="https://partner.example/b">Learn more</a>
    `;
    const occurrences = extractOccurrences(html, 'https://news.example/');
    expect(occurrences[0].anchorText).toBe(occurrences[1].anchorText);
    expect(occurrences[0].contextFingerprint).not.toBe(occurrences[1].contextFingerprint);
  });
});

describe('extractSourceDirectives', () => {
  it('reads meta robots and canonical', () => {
    const html = '<html><head><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="https://example.com/canonical"></head></html>';
    const directives = extractSourceDirectives(html);
    expect(directives.metaRobots).toBe('noindex, nofollow');
    expect(directives.canonical).toBe('https://example.com/canonical');
  });

  it('returns nulls when absent', () => {
    const directives = extractSourceDirectives('<html><head></head></html>');
    expect(directives.metaRobots).toBeNull();
    expect(directives.canonical).toBeNull();
  });

  it('ignores directives inside an HTML comment', () => {
    const directives = extractSourceDirectives('<!-- <meta name="robots" content="noindex"> --><html><head></head></html>');
    expect(directives.metaRobots).toBeNull();
  });
});
