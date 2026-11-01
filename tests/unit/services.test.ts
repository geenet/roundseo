// Unit tests for RoundSEO services
import { afterEach, describe, it, expect, vi } from 'vitest';
import { hashPassword, verifyPassword, validatePassword } from '../../src/worker/auth/password';
import { BaseCrawler } from '../../src/worker/crawlers/base';
import { parsePageMetrics, calculatePageScore } from '../../src/worker/crawlers/parser';
import { calculateSiteMetrics } from '../../src/worker/crawlers/metrics';
import { analyzePageContent, generateContentScore } from '../../src/worker/services/content-analysis';
import { getKeywordTrends } from '../../src/worker/services/keywords';
import { validateEmail } from '../../src/worker/auth/middleware';
import { generateSmartRecommendations } from '../../src/worker/services/recommendations-engine';
import { mapPageSpeedResponse } from '../../src/worker/services/integrations';
import { buildPageSpeedFindings } from '../../src/worker/services/performance';
import { buildLocalOpportunities } from '../../src/local/browser-performance';

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
      expect(metrics.h3Text).toEqual(['Skipped level']);
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

    it('reports substantially similar content without requiring exact duplicates', () => {
      const shared = Array.from({ length: 35 }, (_, index) => `helpful phrase ${index} explains the same customer question clearly`).join(' ');
      const first = parsePageMetrics('https://test.com/alpha', `<html lang="en"><head><title>Alpha service</title></head><body><main><h1>Alpha</h1><p>${shared} Alpha-specific ending.</p></main></body></html>`);
      const second = parsePageMetrics('https://test.com/beta', `<html lang="en"><head><title>Beta service</title></head><body><main><h1>Beta</h1><p>${shared} Beta-specific ending.</p></main></body></html>`);
      const site = calculateSiteMetrics([first, second]);

      expect(first.contentFingerprint).not.toBe(second.contentFingerprint);
      const finding = site.findings.find(item => item.title === 'Review pages with similar content excerpts');
      expect(finding).toMatchObject({ matchCount: 1, affectedUrlCount: 2, evidenceTruncated: false });
      expect(finding?.evidence[0].relatedUrls).toEqual(['https://test.com/beta']);
    });

    it('counts all similar pairs and labels the retained examples as a sample', () => {
      const shared = Array.from({ length: 35 }, (_, index) => `helpful phrase ${index} explains the same customer question clearly`).join(' ');
      const pages = Array.from({ length: 22 }, (_, index) => parsePageMetrics(`https://test.com/${index}`, `<main><h1>Page ${index}</h1><p>${shared} Unique ending ${index}.</p></main>`));
      const finding = calculateSiteMetrics(pages).findings.find(item => item.title === 'Review pages with similar content excerpts');
      expect(finding).toMatchObject({ matchCount: 231, affectedUrlCount: 22, evidenceTruncated: true });
      expect(finding?.evidence).toHaveLength(200);
      expect(new Set(finding?.evidence.map(item => item.url)).size).toBeGreaterThan(5);
    });
  });

  describe('Page Score Calculation', () => {
    it('should calculate score correctly', () => {
      const metrics = {
        ...parsePageMetrics('https://test.com', '<html lang="en"><head><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://test.com"></head><body><h1>Test</h1></body></html>'),
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
        ...parsePageMetrics('https://test.com', '<html><body><h1>Test</h1></body></html>'),
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
        ...parsePageMetrics('https://test.com', '<html><body><h1>Test</h1></body></html>'),
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

  it('crawls through depth 50 and retains deeper discoveries as pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const level = new URL(url).pathname === '/' ? 0 : Number(new URL(url).pathname.slice(1));
      return new Response(`<a href="/${level + 1}">Next</a>`, { headers: { 'content-type': 'text/html' } });
    }));
    const crawler = new BaseCrawler('https://test.com/', { maxPages: 60, delay: 1, respectRobotsTxt: false });
    const result = await crawler.crawl();
    expect(result).toHaveLength(51);
    expect(result.at(-1)?.depth).toBe(50);
    expect(crawler.getCoverageSnapshot()).toMatchObject({ remainingUrls: 1, limitReached: true });
  });

  it('follows page anchors without crawling linked assets', async () => {
    const html = '<html><head><link rel="icon" href="/vite.svg"></head><body><a href="/about">About</a><a href="/cdn-cgi/l/email-protection#123">Email</a></body></html>';
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

  it('retains discovered URL coverage when the crawl page cap is reached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>',
    });
    vi.stubGlobal('fetch', fetchMock);

    const crawler = new BaseCrawler('https://test.com/', { maxPages: 1, delay: 1, respectRobotsTxt: false });
    const results = await crawler.crawl();
    const coverage = crawler.getCoverageSnapshot();
    const metrics = calculateSiteMetrics(results.map(result => parsePageMetrics(result.url, result.html)), results, { maxPages: 1, discoveredUrls: coverage.discoveredUrls, limitReached: coverage.limitReached });

    expect(results).toHaveLength(1);
    expect(coverage).toMatchObject({ discoveredUrls: 4, remainingUrls: 3, limitReached: true });
    expect(metrics.crawlCoverage).toMatchObject({ availability: 'partial', inspectedPages: 1, discoveredUrls: 4, limitReached: true });
  });

  it('discovers pages from a sitemap index even when no page links to them', async () => {
    const responses: Record<string, string> = {
      'https://test.com/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://test.com/index.xml',
      'https://test.com/index.xml': '<sitemapindex><sitemap><loc>https://test.com/pages.xml</loc></sitemap></sitemapindex>',
      'https://test.com/pages.xml': '<urlset><url><loc>https://test.com/orphan?one=1&amp;two=2</loc></url></urlset>',
      'https://test.com/': '<html><title>Home</title></html>',
      'https://test.com/orphan?one=1&two=2': '<html><title>Orphan</title></html>',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(responses[url] || '', { status: url in responses ? 200 : 404, headers: { 'content-type': 'text/html' } })));
    const crawler = new BaseCrawler('https://test.com/', { maxPages: 5, delay: 1, discoverSitemaps: true });
    const results = await crawler.crawl();

    expect(results.map(result => result.url)).toContain('https://test.com/orphan?one=1&two=2');
    expect(crawler.getCoverageSnapshot()).toMatchObject({ discoveredUrls: 2, sitemapUrls: 1, sitemapFiles: 2, sitemapStatus: 'available', remainingUrls: 0 });
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
  it('uses measured browser resources without inventing savings or treating expected authentication as a broken page', () => {
    const findings = buildLocalOpportunities('https://test.com/', [
      { url: 'https://test.com/bundle.js', kind: 'Script', status: 200, transferredBytes: 250 * 1024 },
      { url: 'https://test.com/api/me', kind: 'Fetch', status: 401, transferredBytes: 100 },
    ], { ttfb: 100, fcp: 500, lcp: 1000, lcpElement: 'h1', lcpUrl: '', cls: 0, blocking: 0, stylesheets: [] });
    expect(findings.find(item => item.key === 'large_scripts')).toMatchObject({ estimatedSavingsMs: null, evidence: [{ url: 'https://test.com/bundle.js' }] });
    expect(findings.find(item => item.key === 'failed_resources')?.evidence?.[0].recommendation).toContain('expected for a signed-out visitor');
  });
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
  it('does not flag an intentionally noindex page with its own canonical as a target conflict', () => {
    const page = parsePageMetrics('https://test.com/account', '<meta name="robots" content="noindex"><link rel="canonical" href="/account"><main>Account</main>');
    expect(calculateSiteMetrics([page]).findings.some(item => item.title === 'Canonical targets are unavailable or marked noindex')).toBe(false);
  });

  it('does not treat a robots-excluded canonical destination as an observed request failure', () => {
    const source = parsePageMetrics('https://test.com/', '<link rel="canonical" href="/excluded"><main>Home</main>');
    const findings = calculateSiteMetrics([source], [{ url: 'https://test.com/excluded', depth: 1, statusCode: 0, blockedByRobots: true }]).findings;
    expect(findings.some(item => item.title === 'Canonical targets are unavailable or marked noindex')).toBe(false);
  });

  it('shows source, destination and anchor context for links to noindex pages', () => {
    const source = parsePageMetrics('https://test.com/', '<main><a href="/private">Account settings</a></main>');
    const target = parsePageMetrics('https://test.com/private', '<meta name="robots" content="noindex"><main>Account</main>');
    const unlinked = parsePageMetrics('https://test.com/sitemap-only', '<main><a href="/sitemap-only">Self link</a></main>');
    const findings = calculateSiteMetrics([source, target, unlinked]).findings;
    expect(findings.find(item => item.title === 'Review internal links to noindex pages')?.evidence).toEqual([
      expect.objectContaining({ url: source.url, relatedUrls: [target.url], observed: expect.stringContaining('Account settings') }),
    ]);
    expect(findings.find(item => item.title === 'Pages have no incoming links from inspected pages')?.evidence.map(item => item.url)).toEqual([unlinked.url]);
  });

  it('reports observed canonical conflicts and loops with exact target URLs', () => {
    const first = parsePageMetrics('https://test.com/a', '<main><h1>A</h1></main><link rel="canonical" href="/b">');
    const second = parsePageMetrics('https://test.com/b', '<meta name="robots" content="noindex"><link rel="canonical" href="/a"><main><h1>B</h1></main>');
    const metrics = calculateSiteMetrics([first, second]);
    expect(metrics.findings.find(item => item.title === 'Canonical targets are unavailable or marked noindex')?.evidence[0].relatedUrls).toEqual(['https://test.com/b']);
    expect(metrics.findings.find(item => item.title === 'Canonical declarations form a two-page loop')?.evidence).toHaveLength(2);
  });

  it('does not classify pages as similar solely because their opening excerpt matches', () => {
    const shared = Array.from({ length: 100 }, () => 'shared introduction').join(' ');
    const pages = ['alpha', 'beta'].map(topic => parsePageMetrics(`https://test.com/${topic}`, `<main><p>${shared} ${Array.from({ length: 350 }, (_, index) => `${topic} unique${index} ${topic}${index}`).join(' ')}</p></main>`));
    expect(pages[0].mainContentExcerpt).toBe(pages[1].mainContentExcerpt);
    expect(calculateSiteMetrics(pages).findings.some(item => item.matchCount !== undefined)).toBe(false);
  });
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

  it('treats noindex as an intent-dependent review, rather than a proven critical error', () => {
    const page = parsePageMetrics('https://test.com/account', '<html><head><meta name="robots" content="noindex"></head><body><main>Account</main></body></html>');
    const finding = calculateSiteMetrics([page]).findings.find(item => item.title === 'Pages have a noindex instruction to review');
    expect(finding?.priority).toBe('medium');
    expect(finding?.description).toContain('may be intentional');
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
  it('uses recorded rank movement and leaves unsupplied traffic unknown', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ keyword: 'seo audit', current_rank: 8, previous_rank: 14, search_volume: 1200 }] }) }) }) };
    expect(await getKeywordTrends(db, 'site-1')).toEqual([{ keyword: 'seo audit', currentRank: 8, previousRank: 14, change: 6, trend: 'up', searchVolume: 1200, traffic: null }]);
  });
  it('does not turn a missing ranking into position zero or an unchanged trend', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ keyword: 'new keyword', current_rank: null, previous_rank: null, search_volume: 0 }] }) }) }) };
    expect(await getKeywordTrends(db, 'site-1')).toEqual([expect.objectContaining({ currentRank: null, previousRank: null, change: null, trend: 'unknown', traffic: null })]);
  });
});

describe('Recommendations Engine', () => {
  it('should generate recommendations for poor SEO', async () => {
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

    const run = vi.fn().mockResolvedValue({ success: true });
    const db = { prepare: () => ({ bind: () => ({ run }) }) };
    const recommendations = await generateSmartRecommendations(db, 'audit-1', 'site-1', metrics);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(run).toHaveBeenCalledTimes(recommendations.length);
  });
});

describe('Integration Validation', () => {
  it('should validate email addresses', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('invalid.email')).toBe(false);
    expect(validateEmail('another+tag@domain.co.uk')).toBe(true);
  });
});
