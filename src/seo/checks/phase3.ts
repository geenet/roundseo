/**
 * Phase 3 P0/P1 Verification Checks: Canonicalization and Architecture
 * Rules covered: TECH-008 through TECH-013, TECH-025, TECH-028 through TECH-032
 */

import { registerCheck } from '../verifier';
import { validateRobotsTxt, generateRobotsTxt } from '../robots';
import { validateCanonical } from '../metadata';
import { detectRedirectChains, detectRedirectLoops, validateRedirects } from '../redirects';
import { validateAllHreflang } from '../hreflang';

// ---------------------------------------------------------------------------
// TECH-008: Valid robots.txt (parseable, no fatal structural issues)
// ---------------------------------------------------------------------------
registerCheck('TECH-008', async (ctx) => {
  if (ctx.url !== '/robots.txt') return null;

  const content = ctx.rawHtml ?? generateRobotsTxt();
  const issues = validateRobotsTxt(content);

  if (issues.length > 0) {
    return {
      rule_id: 'TECH-008',
      url_or_template: ctx.url,
      applicable_scope: '/robots.txt',
      severity: 'high',
      status: 'fail',
      observed_evidence: issues.join(' '),
      expected_behavior: 'robots.txt must be valid UTF-8 text with correct directive syntax.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-009 / TECH-010: Canonical signal alignment and self-reference
// ---------------------------------------------------------------------------
registerCheck('TECH-009', async (ctx) => {
  if (!ctx.rawHtml) return null;

  const canonicalPattern = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
  const match = ctx.rawHtml.match(canonicalPattern);
  if (!match) return null;

  const baseUrl = ctx.page.intended_canonical.replace(ctx.page.url, '') || 'https://example.com';
  const issues = validateCanonical(ctx.url, match[1], baseUrl);

  if (issues.length > 0) {
    return {
      rule_id: 'TECH-009',
      url_or_template: ctx.url,
      applicable_scope: 'All pages',
      severity: 'high',
      status: 'fail',
      observed_evidence: issues.join(' '),
      expected_behavior: 'Canonical tag, sitemap entry, and internal links must agree on one URL per page.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

registerCheck('TECH-010', async (ctx) => {
  if (!ctx.rawHtml) return null;
  if (ctx.page.indexing_intent !== 'index') return null;

  const canonicalPattern = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
  const match = ctx.rawHtml.match(canonicalPattern);
  if (!match) {
    return {
      rule_id: 'TECH-010',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'medium',
      status: 'warning',
      observed_evidence: 'No <link rel="canonical"> tag found.',
      expected_behavior: 'Every indexable page should carry a self-referential canonical tag.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  const isSelfReferential = match[1] === ctx.page.intended_canonical;
  if (!isSelfReferential) {
    return {
      rule_id: 'TECH-010',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'medium',
      status: 'warning',
      observed_evidence: `Canonical points to "${match[1]}" instead of this page's own URL "${ctx.page.intended_canonical}".`,
      expected_behavior: 'Indexable pages should self-canonicalize unless intentionally deduplicating into another URL.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-011: Inspect Google's chosen canonical
// Requires Search Console URL Inspection API access — cannot be automated
// from page content alone. Always surfaces as manual_review.
// ---------------------------------------------------------------------------
registerCheck('TECH-011', async (ctx) => {
  if (ctx.page.indexing_intent !== 'index' || ctx.page.priority !== 'high') return null;

  return {
    rule_id: 'TECH-011',
    url_or_template: ctx.url,
    applicable_scope: 'High-priority indexable pages',
    severity: 'low',
    status: 'manual_review',
    observed_evidence: 'Google-selected canonical can only be inspected via Search Console URL Inspection.',
    expected_behavior: "Periodically confirm Google's selected canonical matches the intended canonical for high-priority pages.",
    source_urls: ['https://support.google.com/webmasters/answer/9012289'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'manual',
    remediation_owner: 'seo-team',
  };
});

// ---------------------------------------------------------------------------
// TECH-012 / TECH-013: Sitemap focus and limits
// ---------------------------------------------------------------------------
registerCheck('TECH-012', async (ctx) => {
  if (ctx.url !== '/sitemap.xml' || !ctx.rawHtml) return null;

  const nonIndexableInSitemap = ctx.rawHtml.includes('noindex');
  if (nonIndexableInSitemap) {
    return {
      rule_id: 'TECH-012',
      url_or_template: ctx.url,
      applicable_scope: '/sitemap.xml',
      severity: 'medium',
      status: 'fail',
      observed_evidence: 'Sitemap content references noindex pages.',
      expected_behavior: 'Sitemaps should only list canonical, indexable URLs.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

registerCheck('TECH-013', async (ctx) => {
  if (ctx.url !== '/sitemap.xml' || !ctx.rawHtml) return null;

  const urlCount = (ctx.rawHtml.match(/<url>/g) ?? []).length;
  const bytes = new TextEncoder().encode(ctx.rawHtml).length;

  if (urlCount > 50_000 || bytes > 50 * 1024 * 1024) {
    return {
      rule_id: 'TECH-013',
      url_or_template: ctx.url,
      applicable_scope: '/sitemap.xml',
      severity: 'high',
      status: 'fail',
      observed_evidence: `Sitemap has ${urlCount} URLs / ${bytes} bytes, exceeding the 50,000 URL or 50 MB limit.`,
      expected_behavior: 'Split into multiple sitemaps referenced by a sitemap index.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  return null;
});

// ---------------------------------------------------------------------------
// TECH-025: Crawlable pagination
// Pagination checks run per-series via validatePaginationLinks(); this
// registration only reports manual-review status since it needs a rendered
// page, not a generic VerificationContext.
// ---------------------------------------------------------------------------
registerCheck('TECH-025', async (ctx) => {
  if (ctx.page.page_type !== 'listing') return null;

  return {
    rule_id: 'TECH-025',
    url_or_template: ctx.url,
    applicable_scope: 'Paginated listing pages',
    severity: 'medium',
    status: 'manual_review',
    observed_evidence: 'Pagination link crawlability must be checked with validatePaginationLinks() against rendered HTML.',
    expected_behavior: 'Each paginated page must expose real <a href> links to adjacent pages.',
    source_urls: ['https://developers.google.com/search/blog/2019/03/pagination-doesnt-use-relnext'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

// ---------------------------------------------------------------------------
// TECH-028 / TECH-029 / TECH-030: Redirect quality
// These check the global redirect map, not an individual page, so they fire
// once (keyed off OVERALL scope) rather than per-URL.
// ---------------------------------------------------------------------------
registerCheck('TECH-028', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null; // run once per audit pass

  const issues = validateRedirects().filter((i) => i.includes('TECH-028'));
  if (issues.length === 0) return null;

  return {
    rule_id: 'TECH-028',
    url_or_template: 'redirect-map',
    applicable_scope: 'All redirects',
    severity: 'medium',
    status: 'fail',
    observed_evidence: issues.join(' '),
    expected_behavior: 'Redirects should point to the most relevant replacement page, not a generic fallback.',
    source_urls: ['https://developers.google.com/search/docs/crawling-indexing/301-redirects'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

registerCheck('TECH-029', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null;

  const chains = detectRedirectChains();
  if (chains.length === 0) return null;

  return {
    rule_id: 'TECH-029',
    url_or_template: 'redirect-map',
    applicable_scope: 'All redirects',
    severity: 'medium',
    status: 'fail',
    observed_evidence: chains.map((c) => `${c.from} requires ${c.hops} hops`).join('; '),
    expected_behavior: 'Each redirect should resolve to its final destination in a single hop.',
    source_urls: ['https://developers.google.com/search/docs/crawling-indexing/301-redirects'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

registerCheck('TECH-030', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null;

  const issues = validateRedirects().filter(
    (i) => i.includes('TECH-030') || i.includes('passed its retain_until')
  );
  if (issues.length === 0) return null;

  return {
    rule_id: 'TECH-030',
    url_or_template: 'redirect-map',
    applicable_scope: 'Migration redirects',
    severity: 'low',
    status: 'warning',
    observed_evidence: issues.join(' '),
    expected_behavior: 'Retain migration redirects for at least one year before considering removal.',
    source_urls: ['https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

// Second, independent check under TECH-029: loop detection. registerCheck()
// allows more than one check per rule ID, so this runs alongside the
// chain-length check above rather than replacing it.
registerCheck('TECH-029', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null;

  const loops = detectRedirectLoops();
  if (loops.length === 0) return null;

  return {
    rule_id: 'TECH-029',
    url_or_template: 'redirect-map',
    applicable_scope: 'All redirects',
    severity: 'critical',
    status: 'fail',
    observed_evidence: `Redirect loop(s) detected starting at: ${loops.join(', ')}`,
    expected_behavior: 'Redirects must terminate; loops make affected URLs permanently unreachable.',
    source_urls: ['https://developers.google.com/search/docs/crawling-indexing/301-redirects'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

// ---------------------------------------------------------------------------
// TECH-031 / TECH-032: Hreflang correctness
// ---------------------------------------------------------------------------
registerCheck('TECH-031', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null; // run once per audit pass

  const issues = validateAllHreflang().filter((i) => i.includes('TECH-031'));
  if (issues.length === 0) return null;

  return {
    rule_id: 'TECH-031',
    url_or_template: 'hreflang-groups',
    applicable_scope: 'Localized content',
    severity: 'high',
    status: 'fail',
    observed_evidence: issues.join(' '),
    expected_behavior: 'Each language/region variant must live at its own distinct URL.',
    source_urls: ['https://developers.google.com/search/docs/specialty/international/localized-versions'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

registerCheck('TECH-032', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null;

  const issues = validateAllHreflang().filter((i) => i.includes('TECH-032'));
  if (issues.length === 0) return null;

  return {
    rule_id: 'TECH-032',
    url_or_template: 'hreflang-groups',
    applicable_scope: 'Localized content',
    severity: 'medium',
    status: 'fail',
    observed_evidence: issues.join(' '),
    expected_behavior: 'hreflang values must be valid language codes, reciprocal, and include a self-reference.',
    source_urls: ['https://developers.google.com/search/docs/specialty/international/localized-versions'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

export { runChecks as runPhase3Checks } from '../verifier';

/**
 * Get the list of rule IDs covered by Phase 3 checks.
 */
export function getPhase3RuleIds(): string[] {
  return [
    'TECH-008', 'TECH-009', 'TECH-010', 'TECH-011',
    'TECH-012', 'TECH-013', 'TECH-025',
    'TECH-028', 'TECH-029', 'TECH-030',
    'TECH-031', 'TECH-032',
  ];
}
