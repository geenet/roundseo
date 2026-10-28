/**
 * Rules Management
 * Load and query Google SEO rules from the specification
 */

import { Rule, RuleCategory, RulePriority, EvidenceLevel } from './types';

/**
 * In-memory rules catalog (populated from google-seo-rules.json)
 * This would normally be loaded at startup
 */
let rulesCache: Map<string, Rule> | null = null;
let allRulesCache: Rule[] | null = null;

/**
 * Comprehensive rules extracted from google-seo-rules.json
 * Partial list - full list would be imported from the JSON file
 */
const rulesDefinition: Rule[] = [
  {
    id: 'OVERALL-001',
    category: 'overall',
    name: 'Declare the intended URL inventory',
    priority: 'P0',
    evidence: 'engineering_practice',
    impact: 'operations',
    automation: 'mixed',
    scope: 'All route families',
    rule: 'Declare which URLs should be indexed, excluded, private, redirected or gone. Resolve these states from business purpose and content ownership before applying SEO changes.',
    verification:
      'Join router/CMS records, sitemap URLs and crawl discoveries; reconcile disagreements into a versioned inventory. A crawler alone cannot reveal orphaned records.',
    metric: {
      name: 'Important routes with an explicit intended state',
      unit: 'percent',
      official_threshold: null,
      project_target: '100%',
    },
    caveats: [
      'This is a project control, not a Google ranking metric. Never expose private application data to satisfy an indexing check.',
    ],
    sources: ['https://developers.google.com/search/docs/essentials/technical'],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'TECH-001',
    category: 'technical',
    name: 'Public access for Googlebot',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'mixed',
    scope: 'Public landing pages intended for Google indexing',
    rule: 'Allow Googlebot to retrieve the page without login, authentication, WAF challenge, geographic denial, or other access restriction.',
    verification:
      'Inspect representative live URLs in Search Console; compare verified Googlebot server logs with ordinary HTTP requests.',
    metric: {
      name: 'Intended URLs inaccessible to verified Googlebot',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'A successful ordinary browser request does not establish Googlebot access.',
      'Private application routes should remain protected.',
    ],
    sources: [
      'https://developers.google.com/search/docs/essentials/technical',
      'https://developers.google.com/search/docs/crawling-indexing/googlebot',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'TECH-002',
    category: 'technical',
    name: 'Successful content response',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'Canonical content pages intended for indexing',
    rule: 'Serve real indexable content with HTTP 200 rather than a blank app shell that never renders, an error response, or an error page disguised as success.',
    verification: 'Fetch each intended URL and inspect status plus rendered main content.',
    metric: {
      name: 'Intended content URLs with successful content response',
      unit: 'percent',
      official_threshold: null,
      project_target: '100%',
    },
    caveats: [
      'HTTP 200 is necessary eligibility evidence, not a promise of indexing.',
      'A 204 response supplies no content.',
    ],
    sources: [
      'https://developers.google.com/search/docs/essentials/technical',
      'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'CONTENT-001',
    category: 'on_page',
    name: 'Match pages to user tasks',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'relevance',
    automation: 'mixed',
    scope: 'Intended search landing pages',
    rule: 'Define each page\'s audience, primary task, language and useful page type; make its content and functionality satisfy the task represented by its target queries.',
    verification:
      'Store intent metadata, then have a reviewer complete the target task using the published page; record unresolved gaps rather than inventing a quality score.',
    metric: {
      name: 'Reviewed task alignment',
      unit: 'percent',
      official_threshold: null,
      project_target: '100% of priority landing pages reviewed',
    },
    caveats: [
      'Metadata completion does not establish intent satisfaction.',
      'Ranking depends on the query and competition.',
    ],
    sources: [
      'https://www.google.com/search/howsearchworks/how-search-works/ranking-results/',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'LINK-001',
    category: 'linking',
    name: 'Crawlable navigation links',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Navigation and contextual links to public pages',
    rule: 'Render discoverable navigation and contextual links as anchor elements with valid href destinations, including links inserted by JavaScript. Ensure destinations resolve to actual crawlable URLs.',
    verification:
      'Inspect raw and rendered HTML; extract anchor href values; report important destinations reachable only through script events, buttons, or non-URL href values.',
    metric: {
      name: 'Important destinations without crawlable anchor links',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Client-rendered anchors can be crawlable when Google renders them; server-rendered HTML is an implementation choice.',
      'Other discovery mechanisms do not replace a usable site navigation structure.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
    ],
    last_verified_at: '2026-10-28',
  },
];

/**
 * Get all rules
 */
export function getAllRules(): Rule[] {
  if (!allRulesCache) {
    allRulesCache = rulesDefinition;
  }
  return allRulesCache;
}

/**
 * Get a rule by ID
 */
export function getRule(ruleId: string): Rule | undefined {
  if (!rulesCache) {
    rulesCache = new Map(rulesDefinition.map((r) => [r.id, r]));
  }
  return rulesCache.get(ruleId);
}

/**
 * Get rules by category
 */
export function getRulesByCategory(category: RuleCategory): Rule[] {
  return getAllRules().filter((r) => r.category === category);
}

/**
 * Get rules by priority
 */
export function getRulesByPriority(priority: RulePriority): Rule[] {
  return getAllRules().filter((r) => r.priority === priority);
}

/**
 * Get rules by evidence level
 */
export function getRulesByEvidence(evidence: EvidenceLevel): Rule[] {
  return getAllRules().filter((r) => r.evidence === evidence);
}

/**
 * Get P0 (critical) rules
 */
export function getCriticalRules(): Rule[] {
  return getRulesByPriority('P0');
}

/**
 * Get applicable rules for a URL type
 */
export function getRulesForUrl(pageType: string): Rule[] {
  // In a real implementation, would match based on page type
  return getAllRules();
}

/**
 * Rule statistics
 */
export function getRuleStatistics() {
  const rules = getAllRules();

  const byCategory = new Map<RuleCategory, number>();
  const byPriority = new Map<RulePriority, number>();
  const byEvidence = new Map<EvidenceLevel, number>();

  rules.forEach((rule) => {
    byCategory.set(rule.category, (byCategory.get(rule.category) || 0) + 1);
    byPriority.set(rule.priority, (byPriority.get(rule.priority) || 0) + 1);
    byEvidence.set(rule.evidence, (byEvidence.get(rule.evidence) || 0) + 1);
  });

  return {
    total: rules.length,
    byCategory: Object.fromEntries(byCategory),
    byPriority: Object.fromEntries(byPriority),
    byEvidence: Object.fromEntries(byEvidence),
  };
}
