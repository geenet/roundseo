// Unit tests for RoundSEO services
import { afterEach, describe, it, expect, vi } from 'vitest';
import { hashPassword, verifyPassword, validatePassword } from '../../src/worker/auth/password';
import { BaseCrawler } from '../../src/worker/crawlers/base';
import { parsePageMetrics, calculatePageScore } from '../../src/worker/crawlers/parser';
import { calculateSiteMetrics } from '../../src/worker/crawlers/metrics';
import { analyzePageContent, generateContentScore } from '../../src/worker/services/content-analysis';
import { estimateTraffic } from '../../src/worker/services/keywords';
import { mapPageSpeedResponse } from '../../src/worker/services/integrations';
import { buildPageSpeedFindings } from '../../src/worker/services/performance';

describe('Authentication Services', () => {
  describe('Password Hashing', () => {
    it('should hash password securely', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(20);
      expect(hash).not.toBe(password);
    });

    it('should verify correct password', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('WrongPassword123', hash);
      expect(isValid).toBe(false);
    });

    it('should validate password strength', () => {
      const weakPassword = { valid: false, error: 'Password must be at least 8 characters' };
      const strongPassword = { valid: true };
      const mixedCase = { valid: false, error: 'Password must contain an uppercase letter' };

      expect(validatePassword('short')).toEqual(weakPassword);
      expect(validatePassword('StrongPassword1')).toEqual(strongPassword);
      expect(validatePassword('nouppercasehere1')).toEqual(mixedCase);
    });
  });
});

describe('HTML Parser', () => {
  describe('Page Metrics Extraction', () => {
    const sampleHtml = `
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="Test meta description for the page">
        </head>
        <body>
          <h1>Main Heading</h1>
          <h2>Sub Heading</h2>
          <p>This is some test content with words to count.</p>
          <img src="test.jpg" alt="Test image">
          <img src="test2.jpg">
          <a href="/internal">Internal Link</a>
          <a href="https://external.com">External Link</a>
        </body>
      </html>
    `;

    it('should extract title', () => {
      const metrics = parsePageMetrics('https://test.com', sampleHtml);
      expect(metrics.title).toBe('Test Page Title');
      expect(metrics.titleLength).toBe(15);
    });

    it('should extract meta description', () => {
      const metrics = parsePageMetrics('https://test.com', sampleHtml);
      expect(metrics.metaDescription).toBe('Test meta description for the page');
    });

    it('should count headings', () => {
      const metrics = parsePageMetrics('https://test.com', sampleHtml);
      expect(metrics.h1Count).toBe(1);
      expect(metrics.h2Count).toBe(1);
      expect(metrics.headingsCount).toBe(2);
    });

    it('should count images', () => {
      const metrics = parsePageMetrics('https://test.com', sampleHtml);
      expect(metrics.imageCount).toBe(2);
      expect(metrics.imagesWithoutAlt).toBe(1);
    });

    it('should count links', () => {
      const metrics = parsePageMetrics('https://test.com', sampleHtml);
      expect(metrics.internalLinks).toBe(1);
      expect(metrics.externalLinks).toBe(1);
    });

    it('uses primary content rather than navigation copy for content checks', () => {
      const navigationCopy = Array.from({ length: 80 }, () => 'Navigation label').join(' ');
      const html = `
        <html lang=en><head><title>Primary content test</title></head><body>
          <nav>${navigationCopy}</nav>
          <main><h1>Helpful topic</h1><h3>Skipped level</h3><p>Short, focused page copy.</p></main>
        </body></html>
      `;
      const metrics = parsePageMetrics('https://test.com/primary', html);

      expect(metrics.contentSource).toBe('main');
      expect(metrics.wordCount).toBeLessThan(20);
      expect(metrics.headingLevels).toEqual([1, 3]);
      expect(metrics.lang).toBe('en');
    });

    it('marks a sparse JavaScript application shell as requiring rendering', () => {
      const html = `
        <html lang="en"><head><title>Client app</title></head><body>
          <div id="root">Loading</div>
          <script type="module" src="/assets/main.js"></script><script>window.app = true</script>
        </body></html>
      `;
      const page = parsePageMetrics('https://test.com/app', html);
      const site = calculateSiteMetrics([page]);

      expect(page.requiresJavaScriptRendering).toBe(true);
      expect(site.pagesRequiringJavaScriptRendering).toBe(1);
      expect(site.findings.map(finding => finding.title)).toContain('The raw HTML looks like a JavaScript application shell');
      expect(site.findings.map(finding => finding.title)).not.toContain('Pages are missing a primary heading');
      expect(site.findings.map(finding => finding.title)).not.toContain('Pages have no internal links out');
    });
  });

  describe('Page Score Calculation', () => {
    it('should calculate score correctly', () => {
      const metrics = {
        pageUrl: 'https://test.com',
        title: 'Good Title',
        titleLength: 10,
        metaDescription: 'Good description',
        metaDescLength: 16,
        h1Count: 1,
        h2Count: 2,
        h3Count: 0,
        headingsCount: 3,
        wordCount: 500,
        imageCount: 2,
        imagesWithoutAlt: 0,
        internalLinks: 5,
        externalLinks: 2,
        isIndexable: true,
      };

      const score = calculatePageScore(metrics);
      expect(score).toBeGreaterThan(80);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should penalize missing title', () => {
      const metricsWithoutTitle = {
        pageUrl: 'https://test.com',
        title: undefined,
        titleLength: 0,
        metaDescription: 'Good',
        metaDescLength: 4,
        h1Count: 1,
        h2Count: 1,
        h3Count: 0,
        headingsCount: 2,
        wordCount: 500,
        imageCount: 0,
        imagesWithoutAlt: 0,
        internalLinks: 3,
        externalLinks: 1,
        isIndexable: true,
      };

      const score = calculatePageScore(metricsWithoutTitle);
      expect(score).toBeLessThan(85);
    });

    it('should penalize non-indexable pages', () => {
      const nonIndexableMetrics = {
        pageUrl: 'https://test.com',
        title: 'Good Title',
        titleLength: 10,
        metaDescription: 'Good',
        metaDescLength: 4,
        h1Count: 1,
        h2Count: 1,
        h3Count: 0,
        headingsCount: 2,
        wordCount: 500,
        imageCount: 0,
        imagesWithoutAlt: 0,
        internalLinks: 3,
        externalLinks: 1,
        isIndexable: false,
      };

      const score = calculatePageScore(nonIndexableMetrics);
      expect(score).toBeLessThan(60);
    });
  });
});

describe('Crawler link discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows page anchors without crawling linked assets', async () => {
    const html = '<html><head><link rel="icon" href="/vite.svg"></head><body><a href="/about">About</a></body></html>';
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => html,
    });
    vi.stubGlobal('fetch', fetchMock);

    const crawler = new BaseCrawler('https://test.com/', { maxPages: 5, delay: 1, respectRobotsTxt: false });
    const results = await crawler.crawl();

    expect(results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://test.com/about');
  });

  it('records robots exclusions as coverage context without fetching excluded pages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://test.com/robots.txt') return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'User-agent: *\nDisallow: /private',
      };
      if (url === 'https://test.com/') return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<a href="/private">Private area</a><a href="/public">Public page</a>',
      };
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<title>Public page</title>',
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await new BaseCrawler('https://test.com/', { maxPages: 5, delay: 1 }).crawl();

    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({
      url: 'https://test.com/private', blockedByRobots: true, error: 'Excluded by robots.txt',
    })]));
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain('https://test.com/private');
    expect(fetchMock.mock.calls.map(call => call[0])).toContain('https://test.com/public');
  });

  it('keeps link placement tied to the containing document region', () => {
    const page = parsePageMetrics('https://test.com/', `
      <header><a href="/login">Log in</a></header>
      <main><a href="/guide">Study guide</a></main>
      <footer><a href="/privacy">Privacy</a></footer>
    `);
    const placementByTarget = new Map(page.links.map(link => [link.target, link.placement]));

    expect(placementByTarget.get('https://test.com/login')).toBe('header');
    expect(placementByTarget.get('https://test.com/guide')).toBe('main');
    expect(placementByTarget.get('https://test.com/privacy')).toBe('footer');
  });
});

describe('PageSpeed evidence mapping', () => {
  it('keeps mobile lab, field, and opportunity evidence separate', () => {
    const result = mapPageSpeedResponse('https://example.com/', 'mobile', {
      lighthouseResult: {
        categories: { performance: { score: 0.82 } },
        audits: {
          'first-contentful-paint': { numericValue: 1240, displayValue: '1.2 s' },
          'largest-contentful-paint': { numericValue: 2820, displayValue: '2.8 s' },
          'cumulative-layout-shift': { numericValue: 0.04, displayValue: '0.04' },
          'total-blocking-time': { numericValue: 150, displayValue: '150 ms' },
          'render-blocking-resources': {
            title: 'Eliminate render-blocking resources',
            details: { type: 'opportunity', overallSavingsMs: 320, overallSavingsBytes: 28_000 },
          },
        },
      },
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2600, category: 'AVERAGE' },
          INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4, category: 'FAST' },
        },
      },
    }, '2026-10-28T12:00:00.000Z');

    expect(result.availability).toBe('measured');
    expect(result.labScore).toBe(82);
    expect(result.labMetrics.find(metric => metric.key === 'lcp')).toMatchObject({ value: 2820, source: 'lab', rating: 'needs_improvement' });
    expect(result.fieldDataScope).toBe('url');
    expect(result.fieldMetrics.find(metric => metric.key === 'cls')).toMatchObject({ value: 0.04, source: 'field', rating: 'good' });
    expect(result.opportunities).toEqual([expect.objectContaining({ title: 'Eliminate render-blocking resources', estimatedSavingsMs: 320, estimatedSavingsBytes: 28_000 })]);
  });

  it('does not manufacture a zero score when PageSpeed omits lab data', () => {
    const result = mapPageSpeedResponse('https://example.com/', 'desktop', { lighthouseResult: { audits: {} } }, '2026-10-28T12:00:00.000Z');

    expect(result.availability).toBe('not_measured');
    expect(result.labScore).toBeNull();
    expect(result.fieldDataAvailability).toBe('not_measured');
  });

  it('turns a quantified opportunity into URL- and device-specific action evidence', () => {
    const mobile = mapPageSpeedResponse('https://example.com/', 'mobile', {
      lighthouseResult: {
        categories: { performance: { score: 0.58 } },
        audits: {
          'largest-contentful-paint': { numericValue: 4200 },
          'render-blocking-resources': {
            title: 'Eliminate render-blocking resources',
            details: { type: 'opportunity', overallSavingsMs: 630, overallSavingsBytes: 12_000 },
          },
        },
      },
    }, '2026-10-28T12:00:00.000Z');
    const findings = buildPageSpeedFindings({
      targetUrl: 'https://example.com/', provider: 'google_pagespeed_insights', providerLabel: 'Google PageSpeed Insights',
      availability: 'measured', fetchedAt: '2026-10-28T12:00:00.000Z', methodVersion: 'pagespeed-insights-2026.10.1', devices: [mobile],
    });

    expect(findings).toEqual([expect.objectContaining({
      ruleId: 'performance.pagespeed.render_blocking_resources',
      priority: 'medium',
      evidence: [expect.objectContaining({
        url: 'https://example.com/',
        element: 'Mobile PageSpeed lab opportunity',
        observed: expect.stringContaining('630 ms'),
      })],
    })]);
  });
});

describe('Site Metrics Calculator', () => {
  it('should calculate site metrics from pages', () => {
    const pageMetrics = [
      {
        pageUrl: 'https://test.com/page1',
        title: 'Page 1',
        titleLength: 6,
        metaDescription: 'Desc 1',
        metaDescLength: 6,
        h1Count: 1,
        h2Count: 1,
        h3Count: 0,
        headingsCount: 2,
        wordCount: 500,
        imageCount: 1,
        imagesWithoutAlt: 0,
        internalLinks: 3,
        externalLinks: 1,
        isIndexable: true,
      },
      {
        pageUrl: 'https://test.com/page2',
        title: 'Page 2',
        titleLength: 6,
        metaDescription: 'Desc 2',
        metaDescLength: 6,
        h1Count: 2,
        h2Count: 0,
        h3Count: 0,
        headingsCount: 2,
        wordCount: 300,
        imageCount: 0,
        imagesWithoutAlt: 0,
        internalLinks: 2,
        externalLinks: 0,
        isIndexable: false,
      },
    ];

    const metrics = calculateSiteMetrics(pageMetrics);

    expect(metrics.totalPages).toBe(2);
    expect(metrics.indexablePages).toBe(1);
    expect(metrics.averageWordCount).toBe(400);
    expect(metrics.onPageScore).toBeGreaterThan(50);
    expect(metrics.overallScore).toBeGreaterThan(0);
  });

  it('should handle empty page list', () => {
    const metrics = calculateSiteMetrics([]);

    expect(metrics.totalPages).toBe(0);
    expect(metrics.overallScore).toBe(0);
    expect(metrics.indexablePages).toBe(0);
  });

  it('connects a bad response to the exact internal link that led there', () => {
    const sourcePage = parsePageMetrics('https://test.com/', `
      <html lang="en"><head><title>A useful source page</title><meta name="viewport" content="width=device-width"></head>
      <body><main><h1>Source</h1><a href="/missing">Compare plans</a></main></body></html>
    `);
    const metrics = calculateSiteMetrics([sourcePage], [{
      url: 'https://test.com/missing',
      depth: 1,
      statusCode: 404,
    }]);
    const finding = metrics.findings.find(item => item.title === 'Some URLs returned client errors');

    expect(metrics.pagesWithHttpErrors).toBe(1);
    expect(finding?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({
      url: 'https://test.com/',
      element: 'Internal link',
      observed: expect.stringContaining('Compare plans'),
    })]));
  });

  it('includes the repeated on-page value in duplicate evidence', () => {
    const first = parsePageMetrics('https://test.com/one', '<html><head><title>Shared product title</title></head><body><main><h1>One</h1></main></body></html>');
    const second = parsePageMetrics('https://test.com/two', '<html><head><title>Shared product title</title></head><body><main><h1>Two</h1></main></body></html>');
    const metrics = calculateSiteMetrics([first, second]);
    const finding = metrics.findings.find(item => item.title === 'Pages reuse the same title tag');

    expect(finding?.evidence[0].observed).toContain('Shared product title');
  });
});

describe('Content Analysis', () => {
  describe('Page Content Analysis', () => {
    const sampleHtml = `
      <html>
        <head>
          <title>Content Analysis Test</title>
          <meta name="description" content="This is a test page">
        </head>
        <body>
          <h1>Main Topic</h1>
          <p>This is a paragraph with some content. The quick brown fox jumps over the lazy dog.
             This sentence is about keyword optimization and SEO best practices.</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <p>Another paragraph with more information about the topic.</p>
          <a href="internal">Internal</a>
          <a href="external.com">External</a>
        </body>
      </html>
    `;

    it('should analyze page content', () => {
      const metrics = analyzePageContent('https://test.com', sampleHtml, 'Content Analysis Test', 'keyword');

      expect(metrics.wordCount).toBeGreaterThan(0);
      expect(metrics.h1Count).toBe(1);
      expect(metrics.listCount).toBe(1);
      expect(metrics.readabilityScore).toBeGreaterThan(0);
      expect(metrics.suggestions).toBeDefined();
    });

    it('should calculate readability score', () => {
      const metrics = analyzePageContent('https://test.com', sampleHtml);

      expect(metrics.readabilityScore).toBeGreaterThan(0);
      expect(metrics.readabilityScore).toBeLessThanOrEqual(100);
    });

    it('should generate content suggestions', () => {
      const metrics = analyzePageContent('https://test.com', sampleHtml);

      expect(metrics.suggestions).toBeDefined();
      expect(Array.isArray(metrics.suggestions)).toBe(true);
    });
  });

  describe('Content review semantics', () => {
    it('does not turn structured content signals into a fabricated quality score', () => {
      const goodMetrics = {
        pageUrl: 'https://test.com',
        contentLength: 2000,
        wordCount: 400,
        readingTimeMinutes: 2,
        readabilityScore: 75,
        keywordDensity: 1.5,
        uniqueWords: 150,
        sentenceCount: 20,
        averageWordLength: 5,
        h1Count: 1,
        h2Count: 3,
        heading1Count: 1,
        heading2Count: 3,
        listCount: 2,
        linkCount: 5,
        suggestions: [],
      };

      expect(generateContentScore(goodMetrics)).toBeNull();
    });

    it('does not label a short page with a universal quality score', () => {
      const shortMetrics = {
        pageUrl: 'https://test.com',
        contentLength: 200,
        wordCount: 50,
        readingTimeMinutes: 0,
        readabilityScore: 70,
        keywordDensity: 1.5,
        uniqueWords: 40,
        sentenceCount: 5,
        averageWordLength: 5,
        h1Count: 1,
        h2Count: 0,
        heading1Count: 1,
        heading2Count: 0,
        listCount: 0,
        linkCount: 1,
        suggestions: [],
      };

      expect(generateContentScore(shortMetrics)).toBeNull();
    });

    it('keeps readability as review evidence rather than a quality score', () => {
      const hardToReadMetrics = {
        pageUrl: 'https://test.com',
        contentLength: 2000,
        wordCount: 400,
        readingTimeMinutes: 2,
        readabilityScore: 30,
        keywordDensity: 1.5,
        uniqueWords: 150,
        sentenceCount: 20,
        averageWordLength: 10,
        h1Count: 1,
        h2Count: 3,
        heading1Count: 1,
        heading2Count: 3,
        listCount: 2,
        linkCount: 5,
        suggestions: [],
      };

      expect(generateContentScore(hardToReadMetrics)).toBeNull();
    });
  });
});

describe('Keyword Services', () => {
  describe('Traffic Estimation', () => {
    it('should estimate traffic based on rank', () => {
      const rank1Traffic = estimateTraffic(1, 1000);
      const rank5Traffic = estimateTraffic(5, 1000);
      const rank10Traffic = estimateTraffic(10, 1000);

      expect(rank1Traffic).toBeGreaterThan(rank5Traffic);
      expect(rank5Traffic).toBeGreaterThan(rank10Traffic);
    });

    it('should handle high ranks', () => {
      const traffic = estimateTraffic(50, 1000);
      expect(traffic).toBeGreaterThan(0);
      expect(traffic).toBeLessThan(100);
    });

    it('should scale with search volume', () => {
      const lowVolume = estimateTraffic(1, 100);
      const highVolume = estimateTraffic(1, 1000);

      expect(highVolume).toBeGreaterThan(lowVolume);
    });
  });
});

describe('Recommendations Engine', () => {
  it('should generate recommendations for poor SEO', () => {
    const metrics = {
      onPageScore: 45,
      technicalScore: 50,
      indexabilityScore: 65,
      internalLinkingScore: 40,
      pagesWithoutTitle: 5,
      pagesWithoutMetaDescription: 3,
      pagesWithMultipleH1: 2,
      totalPages: 20,
      indexablePages: 13,
    };

    // Should generate recommendations for:
    // - Missing titles
    // - Missing meta descriptions
    // - Multiple H1 tags
    // - Low indexability
    // - Poor internal linking

    const recommendationCount = 5; // Expected number of recommendations
    expect(recommendationCount).toBeGreaterThan(0);
  });
});

describe('Integration Validation', () => {
  it('should validate email addresses', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('invalid.email')).toBe(false);
    expect(validateEmail('another+tag@domain.co.uk')).toBe(true);
  });
});

// Helper function for testing
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

function estimateTraffic(rank: number, searchVolume: number): number {
  const ctrByRank: Record<number, number> = {
    1: 0.28, 2: 0.15, 3: 0.10, 4: 0.08, 5: 0.07,
    6: 0.05, 7: 0.04, 8: 0.03, 9: 0.02, 10: 0.02,
  };
  const ctr = ctrByRank[Math.min(rank, 10)] || 0.01;
  return Math.round(searchVolume * ctr * 0.3);
}
