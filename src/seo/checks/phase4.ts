/**
 * Phase 4 Verification Checks: Page Content and Presentation
 * Rules covered: CONTENT-001, CONTENT-003 through CONTENT-006, CONTENT-009
 * through CONTENT-013, CONTENT-015, CONTENT-020, CONTENT-021.
 */

import { registerCheck } from '../verifier';
import { validateTitle, validateMetaDescription, validateHeadingHierarchy, validateLanguageConsistency } from '../content';
import { validateAuthorship, validateDateHonesty, checkFreshness, validateAiContentReview } from '../eeat';
import { generateStructuredData, validateAllStructuredData } from '../structured-data';

function findingFrom(ruleId: string, ctx: { url: string }, issues: string[], severity: 'critical' | 'high' | 'medium' | 'low', sourceUrl: string, expected: string) {
  if (issues.length === 0) return null;
  return {
    rule_id: ruleId,
    url_or_template: ctx.url,
    applicable_scope: 'Indexable pages',
    severity,
    status: 'fail' as const,
    observed_evidence: issues.join(' '),
    expected_behavior: expected,
    source_urls: [sourceUrl],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated' as const,
    remediation_owner: 'content',
  };
}

// ---------------------------------------------------------------------------
// CONTENT-003 / CONTENT-005: Title and meta description quality
// ---------------------------------------------------------------------------
registerCheck('CONTENT-003', async (ctx) => {
  const issues = validateTitle(ctx.page);
  return findingFrom(
    'CONTENT-003', ctx, issues, 'high',
    'https://developers.google.com/search/docs/appearance/title-link',
    'Titles must be present, specific to the page, and distinct from other indexable pages.'
  );
});

registerCheck('CONTENT-005', async (ctx) => {
  const issues = validateMetaDescription(ctx.page);
  return findingFrom(
    'CONTENT-005', ctx, issues, 'medium',
    'https://developers.google.com/search/docs/appearance/snippet',
    'Meta descriptions should be present, substantive, and distinct per page.'
  );
});

// ---------------------------------------------------------------------------
// CONTENT-004: Clear main heading
// ---------------------------------------------------------------------------
registerCheck('CONTENT-004', async (ctx) => {
  if (!ctx.renderedHtml || ctx.page.indexing_intent !== 'index') return null;
  const issues = validateHeadingHierarchy(ctx.url, ctx.renderedHtml);
  return findingFrom(
    'CONTENT-004', ctx, issues, 'medium',
    'https://developers.google.com/search/docs/appearance/structured-data',
    'Every indexable page should have exactly one clear <h1> main heading.'
  );
});

// ---------------------------------------------------------------------------
// CONTENT-006: Language consistency
// ---------------------------------------------------------------------------
registerCheck('CONTENT-006', async (ctx) => {
  if (!ctx.rawHtml) return null;
  const langMatch = ctx.rawHtml.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const issues = validateLanguageConsistency(ctx.page, langMatch?.[1] ?? null);
  return findingFrom(
    'CONTENT-006', ctx, issues, 'low',
    'https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites',
    'The declared document language must match the page\'s intended locale.'
  );
});

// ---------------------------------------------------------------------------
// CONTENT-001: Match pages to user tasks
// "mixed" automation (per rules.ts): the metadata-completeness half is
// automatable; actual task-satisfaction always needs a human reviewer
// completing the target task on the published page, so it surfaces as
// manual_review rather than pass/fail.
// ---------------------------------------------------------------------------
registerCheck('CONTENT-001', async (ctx) => {
  if (ctx.page.indexing_intent !== 'index') return null;

  if (!ctx.page.audience_task?.trim() || !ctx.page.page_type?.trim()) {
    return {
      rule_id: 'CONTENT-001',
      url_or_template: ctx.url,
      applicable_scope: 'Indexable pages',
      severity: 'medium',
      status: 'fail',
      observed_evidence: 'Page is missing an intended audience_task or page_type in the inventory.',
      expected_behavior: "Define each page's audience, primary task, and page type before evaluating task alignment.",
      source_urls: ['https://www.google.com/search/howsearchworks/how-search-works/ranking-results/'],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'product',
    };
  }

  return {
    rule_id: 'CONTENT-001',
    url_or_template: ctx.url,
    applicable_scope: 'Indexable pages',
    severity: 'low',
    status: 'manual_review',
    observed_evidence: `Intent metadata is recorded (audience_task: "${ctx.page.audience_task}"); whether the page actually satisfies that task requires a reviewer completing it on the published page.`,
    expected_behavior: "Have a reviewer complete the page's target task using the published page; record unresolved gaps rather than inventing a quality score.",
    source_urls: ['https://www.google.com/search/howsearchworks/how-search-works/ranking-results/'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'manual',
    remediation_owner: 'content',
  };
});

// ---------------------------------------------------------------------------
// CONTENT-009 / CONTENT-010: Original value and factual substantiation
// Cannot be automated from page content alone — editorial judgment calls.
// Always surfaces as manual_review so it stays on the audit, not silently
// marked "pass".
// ---------------------------------------------------------------------------
registerCheck('CONTENT-009', async (ctx) => {
  if (ctx.page.indexing_intent !== 'index' || ctx.page.priority === 'low') return null;

  return {
    rule_id: 'CONTENT-009',
    url_or_template: ctx.url,
    applicable_scope: 'Priority indexable pages',
    severity: 'low',
    status: 'manual_review',
    observed_evidence: 'Originality and value require editorial judgment; cannot be scored from page content alone.',
    expected_behavior: 'Confirm this page offers original value beyond what competitors or syndicated sources already provide.',
    source_urls: ['https://developers.google.com/search/docs/fundamentals/creating-helpful-content'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'manual',
    remediation_owner: 'content',
  };
});

registerCheck('CONTENT-010', async (ctx) => {
  const isArticle = ctx.page.applicable_features.some((f) => f === 'Article' || f === 'NewsArticle');
  if (!isArticle) return null;

  return {
    rule_id: 'CONTENT-010',
    url_or_template: ctx.url,
    applicable_scope: 'Article content',
    severity: 'low',
    status: 'manual_review',
    observed_evidence: 'Factual substantiation requires editorial fact-checking; cannot be verified automatically.',
    expected_behavior: 'Confirm factual claims are substantiated with citations or verifiable evidence.',
    source_urls: ['https://developers.google.com/search/docs/fundamentals/creating-helpful-content'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'manual',
    remediation_owner: 'content',
  };
});

// ---------------------------------------------------------------------------
// CONTENT-011 / CONTENT-012 / CONTENT-013 / CONTENT-015: E-E-A-T signals
// ---------------------------------------------------------------------------
registerCheck('CONTENT-011', async (ctx) => {
  const issues = validateAuthorship(ctx.page);
  return findingFrom(
    'CONTENT-011', ctx, issues, 'medium',
    'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    'Article content should carry an accountable author with a name and a profile URL or credential.'
  );
});

registerCheck('CONTENT-012', async (ctx) => {
  const issues = checkFreshness(ctx.page);
  if (issues.length === 0) return null;

  return {
    rule_id: 'CONTENT-012',
    url_or_template: ctx.url,
    applicable_scope: 'High-priority indexable pages',
    severity: 'low',
    status: 'warning',
    observed_evidence: issues.join(' '),
    expected_behavior: 'Review high-priority content periodically and update it when the underlying topic changes.',
    source_urls: ['https://developers.google.com/search/docs/fundamentals/creating-helpful-content'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'content',
  };
});

registerCheck('CONTENT-013', async (ctx) => {
  const issues = validateDateHonesty(ctx.page);
  return findingFrom(
    'CONTENT-013', ctx, issues, 'medium',
    'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    'Publication and update dates must be internally coherent and not set in the future.'
  );
});

registerCheck('CONTENT-015', async (ctx) => {
  const issues = validateAiContentReview(ctx.page);
  return findingFrom(
    'CONTENT-015', ctx, issues, 'high',
    'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    'AI-assisted content must have a recorded human review before publication.'
  );
});

// ---------------------------------------------------------------------------
// CONTENT-020 / CONTENT-021: Structured data generation and validation
// ---------------------------------------------------------------------------
registerCheck('CONTENT-020', async (ctx) => {
  if (ctx.page.applicable_features.length === 0) return null;

  const generated = generateStructuredData(ctx.page);
  const missing = ctx.page.applicable_features.filter(
    (f) => !['Article', 'NewsArticle', 'Organization', 'ContactPage'].includes(f)
  );

  if (missing.length === 0) return null;

  return {
    rule_id: 'CONTENT-020',
    url_or_template: ctx.url,
    applicable_scope: 'Pages declaring structured data features',
    severity: 'low',
    status: 'manual_review',
    observed_evidence: `No generator implemented yet for feature(s): ${missing.join(', ')}. Generated ${generated.length} object(s) for the remaining features.`,
    expected_behavior: 'Every declared applicable_feature should have a markup generator so structured data stays derived from shared page data (CONTENT-020), not hand-authored.',
    source_urls: ['https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data'],
    observed_at: new Date().toISOString(),
    verification_coverage: 'automated',
    remediation_owner: 'engineering',
  };
});

registerCheck('CONTENT-021', async (ctx) => {
  if (ctx.page.applicable_features.length === 0) return null;

  const generated = generateStructuredData(ctx.page);
  if (generated.length === 0) return null;

  const issues = validateAllStructuredData(generated);
  return findingFrom(
    'CONTENT-021', ctx, issues, 'medium',
    'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
    'Generated structured data must include every field required by its @type before publishing.'
  );
});

export { runChecks as runPhase4Checks } from '../verifier';

/**
 * Get the list of rule IDs covered by Phase 4 checks.
 */
export function getPhase4RuleIds(): string[] {
  return [
    'CONTENT-001', // catalog entry from Phase 1; check implemented here
    'CONTENT-003', 'CONTENT-004', 'CONTENT-005', 'CONTENT-006',
    'CONTENT-009', 'CONTENT-010',
    'CONTENT-011', 'CONTENT-012', 'CONTENT-013', 'CONTENT-015',
    'CONTENT-020', 'CONTENT-021',
  ];
}
