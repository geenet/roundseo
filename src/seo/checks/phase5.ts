/**
 * Phase 5 Verification Checks: Experience and Measurement
 *
 * Rule coverage note: the rules catalog in rules.ts is an intentionally
 * partial sample (5 of 118 rules — see its own comment). LINK-001 is the
 * only "linking" or "experience" category rule with full text loaded, so
 * it's the only one registered here with a concrete rule_id. Core Web
 * Vitals, search performance, and crawl efficiency are implemented as full
 * utility modules (web-vitals.ts, search-performance.ts,
 * crawl-efficiency.ts) that a completed rules catalog (UX-001..008,
 * OFFPAGE-001..008) would wire up the same way once that text is available.
 */

import { registerCheck } from '../verifier';
import { validateInternalLinks } from '../links';

// ---------------------------------------------------------------------------
// LINK-001: Crawlable navigation links
// Runs once per audit pass (keyed on the homepage) since it evaluates the
// whole site's link graph, not a single page.
// ---------------------------------------------------------------------------
registerCheck('LINK-001', async (ctx) => {
  if (ctx.page.page_id !== 'home') return null;
  if (!ctx.internalLinkEdges) {
    return {
      rule_id: 'LINK-001',
      url_or_template: 'internal-link-graph',
      applicable_scope: 'All navigation and contextual links',
      severity: 'medium',
      status: 'unknown',
      observed_evidence: 'No internal link graph was supplied to the verifier (VerificationContext.internalLinkEdges is unset).',
      expected_behavior: 'Render discoverable navigation and contextual links as anchor elements with valid, crawlable href destinations.',
      source_urls: ['https://developers.google.com/search/docs/crawling-indexing/links-crawlable'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'engineering',
    };
  }

  const issues = validateInternalLinks(ctx.internalLinkEdges);
  if (issues.length === 0) return null;

  return {
    rule_id: 'LINK-001',
    url_or_template: 'internal-link-graph',
    applicable_scope: 'All navigation and contextual links',
    severity: 'medium',
    status: 'fail',
    observed_evidence: issues.join(' '),
    expected_behavior: 'Render discoverable navigation and contextual links as anchor elements with valid, crawlable href destinations; every indexable page should receive at least one internal link.',
    source_urls: ['https://developers.google.com/search/docs/crawling-indexing/links-crawlable'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

export { runChecks as runPhase5Checks } from '../verifier';

/**
 * Get the list of rule IDs covered by Phase 5 checks.
 */
export function getPhase5RuleIds(): string[] {
  return ['LINK-001'];
}
