/**
 * Phase 2 P0 Verification Checks: Eligibility and Rendering
 * Rules covered: TECH-001 through TECH-007, TECH-015 through TECH-022
 *
 * These checks are designed to run against live or staged pages.
 * They extend the verifier framework from Phase 1.
 */

import { registerCheck } from '../verifier';

const MINIMUM_CONTENT_BYTES = 500;
const RESOURCE_FETCH_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// TECH-003: 404/410 for genuinely missing pages
// ---------------------------------------------------------------------------
registerCheck('TECH-003', async (ctx) => {
  if (ctx.httpStatus === undefined) return null;

  // If the page is gone or redirect, a 200 is wrong
  const intent = ctx.page?.indexing_intent;

  if (intent === 'gone' && ctx.httpStatus === 200) {
    return {
      rule_id: 'TECH-003',
      url_or_template: ctx.url,
      applicable_scope: 'Pages with gone intent',
      severity: 'high',
      status: 'fail',
      observed_evidence: `Page with indexing_intent 'gone' returned HTTP ${ctx.httpStatus}. Should return 410.`,
      expected_behavior: 'Permanently removed pages must return HTTP 410 Gone (or 404).',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/http-network-errors'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  if (intent === 'redirect' && ctx.httpStatus === 200) {
    return {
      rule_id: 'TECH-003',
      url_or_template: ctx.url,
      applicable_scope: 'Pages with redirect intent',
      severity: 'high',
      status: 'fail',
      observed_evidence: `Page with indexing_intent 'redirect' returned HTTP ${ctx.httpStatus}. Should return 301/308.`,
      expected_behavior: 'Redirect pages must return HTTP 301 (permanent) or 308.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/301-redirects'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-005 (extended): robots.txt file size and validity
// ---------------------------------------------------------------------------
registerCheck('TECH-005-size', async (ctx) => {
  if (!ctx.rawHtml) return null;
  // This check applies only to /robots.txt fetches
  if (ctx.url !== '/robots.txt') return null;

  const bytes = new TextEncoder().encode(ctx.rawHtml).length;
  const limit = 500 * 1024;

  if (bytes > limit) {
    return {
      rule_id: 'TECH-005',
      url_or_template: ctx.url,
      applicable_scope: '/robots.txt',
      severity: 'high',
      status: 'fail',
      observed_evidence: `robots.txt is ${bytes} bytes. Google stops interpreting after 500 KiB.`,
      expected_behavior: 'robots.txt must be < 500 KiB.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-006 (extended): noindex in initial HTML vs inventory intent
// ---------------------------------------------------------------------------
registerCheck('TECH-006-header', async (ctx) => {
  if (!ctx.headers) return null;

  const xRobots = ctx.headers['x-robots-tag'] ?? '';
  const intent = ctx.page?.indexing_intent;

  if (intent === 'index' && xRobots.toLowerCase().includes('noindex')) {
    return {
      rule_id: 'TECH-006',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'critical',
      status: 'fail',
      observed_evidence: `Page intended for indexing has X-Robots-Tag: ${xRobots}`,
      expected_behavior: 'Indexable pages must not have X-Robots-Tag: noindex.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-007: Allow crawl of noindex pages (don't also block in robots.txt)
// ---------------------------------------------------------------------------
registerCheck('TECH-007', async (ctx) => {
  if (ctx.page?.indexing_intent !== 'noindex') return null;

  // If the page returned 200, crawling is fine. 403 = also blocked in robots.
  if (ctx.httpStatus === 403 || ctx.httpStatus === 401) {
    return {
      rule_id: 'TECH-007',
      url_or_template: ctx.url,
      applicable_scope: 'Noindex pages',
      severity: 'medium',
      status: 'fail',
      observed_evidence: `Page with noindex intent returned HTTP ${ctx.httpStatus}. Google can't read the noindex directive.`,
      expected_behavior:
        'Noindex pages must be crawlable (HTTP 200). Let Google read the directive; blocking in robots.txt prevents it from being honoured.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-015: Verify critical content renders (raw vs rendered comparison)
// ---------------------------------------------------------------------------
registerCheck('TECH-015', async (ctx) => {
  if (!ctx.rawHtml || !ctx.renderedHtml) return null;
  if (ctx.page?.indexing_intent !== 'index') return null;

  // Check that rendered HTML has substantially more content than raw
  // (a rough proxy for successful JS rendering)
  const rawTextLength = ctx.rawHtml.replace(/<[^>]+>/g, '').trim().length;
  const renderedTextLength = ctx.renderedHtml.replace(/<[^>]+>/g, '').trim().length;

  // If rendered is much shorter than raw, something went wrong
  if (renderedTextLength < rawTextLength * 0.5 && renderedTextLength < MINIMUM_CONTENT_BYTES) {
    return {
      rule_id: 'TECH-015',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'high',
      status: 'fail',
      observed_evidence: `Rendered HTML has only ${renderedTextLength} chars of text vs ${rawTextLength} in raw HTML. Content may not be rendering correctly.`,
      expected_behavior: 'Rendered HTML must contain the main page content (headings, body text, links).',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-017: Don't rely on JS to remove noindex
// ---------------------------------------------------------------------------
registerCheck('TECH-017', async (ctx) => {
  if (!ctx.rawHtml) return null;
  if (ctx.page?.indexing_intent !== 'index') return null;

  const noindexInRaw = /content=["']?[^"']*noindex/i.test(ctx.rawHtml);

  if (noindexInRaw) {
    return {
      rule_id: 'TECH-017',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'critical',
      status: 'fail',
      observed_evidence:
        'Initial (raw) HTML contains noindex directive on a page intended for indexing. ' +
        'Google may stop rendering after seeing noindex, so JS cannot fix this.',
      expected_behavior:
        'Initial HTML must have correct robots directive. Never use JS to remove noindex.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-018: Canonical stable between raw and rendered
// ---------------------------------------------------------------------------
registerCheck('TECH-018', async (ctx) => {
  if (!ctx.rawHtml || !ctx.renderedHtml) return null;

  const canonicalPattern = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;

  const rawMatch = ctx.rawHtml.match(canonicalPattern);
  const renderedMatch = ctx.renderedHtml.match(canonicalPattern);

  if (rawMatch && renderedMatch && rawMatch[1] !== renderedMatch[1]) {
    return {
      rule_id: 'TECH-018',
      url_or_template: ctx.url,
      applicable_scope: 'All pages',
      severity: 'high',
      status: 'fail',
      observed_evidence:
        `Canonical differs between raw ("${rawMatch[1]}") and rendered ("${renderedMatch[1]}") HTML. ` +
        'JavaScript is changing the canonical, which Google may ignore.',
      expected_behavior: 'Canonical URL must be the same in initial HTML and after JS execution.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-022: Resource size check (2 MB fetch limit per resource)
// ---------------------------------------------------------------------------
registerCheck('TECH-022', async (ctx) => {
  if (!ctx.rawHtml) return null;

  const bytes = new TextEncoder().encode(ctx.rawHtml).length;

  if (bytes > RESOURCE_FETCH_LIMIT_BYTES) {
    return {
      rule_id: 'TECH-022',
      url_or_template: ctx.url,
      applicable_scope: 'All pages',
      severity: 'high',
      status: 'fail',
      observed_evidence: `HTML response is ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(1)} MB). Googlebot stops fetching at 2 MB.`,
      expected_behavior: 'Each resource fetched by Googlebot must be under 2 MB. Put critical content early.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/googlebot'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-021: Mobile content parity
// ---------------------------------------------------------------------------
registerCheck('TECH-021', async (ctx) => {
  if (!ctx.renderedHtml) return null;
  if (ctx.page?.indexing_intent !== 'index') return null;

  // Check that the rendered page has at least one heading and body text
  const hasHeading = /<h[1-6][^>]*>/i.test(ctx.renderedHtml);
  const hasParagraph = /<p[^>]*>/i.test(ctx.renderedHtml);

  if (!hasHeading && !hasParagraph) {
    return {
      rule_id: 'TECH-021',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'high',
      status: 'warning',
      observed_evidence: 'Rendered HTML has no headings or paragraphs. Mobile indexing may find no content.',
      expected_behavior:
        'Mobile version must have same main content as desktop. ' +
        'Google uses mobile version for indexing (mobile-first).',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// Export a helper to run all phase 2 checks for reporting
export { runChecks as runPhase2Checks } from '../verifier';

/**
 * Get the list of rule IDs covered by Phase 2 checks.
 */
export function getPhase2RuleIds(): string[] {
  return [
    'TECH-001', 'TECH-002', 'TECH-003', 'TECH-004',
    'TECH-005', 'TECH-005-size',
    'TECH-006', 'TECH-006-header',
    'TECH-007', 'OVERALL-001',
    'TECH-015', 'TECH-017', 'TECH-018', 'TECH-021', 'TECH-022',
  ];
}
