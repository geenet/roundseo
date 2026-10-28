/**
 * SEO Verification Framework
 * Run automated checks against rules
 */

import {
  AuditFinding,
  AuditReport,
  AuditStatus,
  Rule,
  PageInventory,
} from './types';
import { pageInventory } from './inventory';
import { getAllRules } from './rules';

export interface VerificationContext {
  url: string;
  page: PageInventory;
  httpStatus?: number;
  headers?: Record<string, string>;
  rawHtml?: string;
  renderedHtml?: string;
}

export type CheckFunction = (
  context: VerificationContext
) => Promise<AuditFinding | null>;

/**
 * Registry of automated checks
 */
const checks: Map<string, CheckFunction> = new Map();

/**
 * Register a check for a rule
 */
export function registerCheck(ruleId: string, check: CheckFunction): void {
  checks.set(ruleId, check);
}

/**
 * Run all applicable checks for a URL
 */
export async function runChecks(
  context: VerificationContext
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const rules = getAllRules();

  for (const rule of rules) {
    const check = checks.get(rule.id);
    if (check) {
      try {
        const finding = await check(context);
        if (finding) {
          findings.push(finding);
        }
      } catch (error) {
        findings.push({
          rule_id: rule.id,
          url_or_template: context.url,
          applicable_scope: rule.scope,
          severity: 'high',
          status: 'unknown',
          observed_evidence: `Check error: ${error instanceof Error ? error.message : String(error)}`,
          expected_behavior: rule.rule,
          source_urls: rule.sources,
          observed_at: new Date().toISOString(),
          verification_coverage: 'automated',
          remediation_owner: 'tech-lead',
        });
      }
    }
  }

  return findings;
}

/**
 * Generate a full audit report
 */
export async function generateAuditReport(
  siteUrl: string
): Promise<AuditReport> {
  const findings: AuditFinding[] = [];
  const urls = pageInventory.map((p) => p.url).slice(0, 5); // Limit for demo

  for (const url of urls) {
    const page = pageInventory.find((p) => p.url === url);
    if (!page) continue;

    const context: VerificationContext = {
      url,
      page,
      httpStatus: 200,
    };

    const pageFindings = await runChecks(context);
    findings.push(...pageFindings);
  }

  // Summarize findings
  const categoryCount: Record<string, number> = {};
  const statusCount: Record<AuditStatus, number> = {
    pass: 0,
    fail: 0,
    warning: 0,
    manual_review: 0,
    unknown: 0,
    not_applicable: 0,
  };
  const priorityCount = { P0: 0, P1: 0, P2: 0 };

  const rules = getAllRules();
  rules.forEach((rule) => {
    categoryCount[rule.category] =
      (categoryCount[rule.category] || 0) +
      findings.filter((f) => f.rule_id.startsWith(rule.category.toUpperCase()))
        .length;

    priorityCount[rule.priority] =
      (priorityCount[rule.priority] || 0) +
      findings.filter((f) => {
        const r = rules.find((rule) => rule.id === f.rule_id);
        return r && r.priority === rule.priority;
      }).length;
  });

  findings.forEach((f) => {
    statusCount[f.status]++;
  });

  return {
    report_date: new Date().toISOString(),
    site_url: siteUrl,
    inventory_coverage: (pageInventory.length / 20) * 100, // Placeholder
    findings,
    category_summary: categoryCount,
    priority_summary: priorityCount,
    status_summary: statusCount,
  };
}

// Register built-in checks
registerCheck('TECH-001', async (context) => {
  // Check if Googlebot has public access
  if (context.httpStatus === 403 || context.httpStatus === 401) {
    return {
      rule_id: 'TECH-001',
      url_or_template: context.url,
      applicable_scope: context.page.page_type,
      severity: 'critical',
      status: 'fail',
      observed_evidence: `HTTP ${context.httpStatus}: Access denied`,
      expected_behavior:
        'Public pages must be accessible to Googlebot without authentication',
      source_urls: [
        'https://developers.google.com/search/docs/essentials/technical',
      ],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'platform',
    };
  }
  return null;
});

registerCheck('TECH-002', async (context) => {
  // Check for successful HTTP 200 response with content
  if (context.httpStatus !== 200) {
    return {
      rule_id: 'TECH-002',
      url_or_template: context.url,
      applicable_scope: context.page.page_type,
      severity: 'critical',
      status: 'fail',
      observed_evidence: `HTTP ${context.httpStatus}`,
      expected_behavior:
        'Intended content pages should return HTTP 200 with real content',
      source_urls: [
        'https://developers.google.com/search/docs/essentials/technical',
      ],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'platform',
    };
  }

  if (!context.renderedHtml || context.renderedHtml.length < 500) {
    return {
      rule_id: 'TECH-002',
      url_or_template: context.url,
      applicable_scope: context.page.page_type,
      severity: 'high',
      status: 'warning',
      observed_evidence:
        'Page appears to have minimal or no rendered content',
      expected_behavior:
        'Content pages should contain substantial indexable content',
      source_urls: [
        'https://developers.google.com/search/docs/essentials/technical',
      ],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'content',
    };
  }

  return null;
});

registerCheck('OVERALL-001', async (context) => {
  // Check if page has explicit intended state
  if (!context.page.indexing_intent) {
    return {
      rule_id: 'OVERALL-001',
      url_or_template: context.url,
      applicable_scope: 'All URLs',
      severity: 'high',
      status: 'manual_review',
      observed_evidence: 'Page not found in inventory or missing indexing_intent',
      expected_behavior:
        'Every important URL should have an explicit intended indexing state',
      source_urls: [
        'https://developers.google.com/search/docs/essentials/technical',
      ],
      observed_at: new Date().toISOString(),
      verification_coverage: 'inventory-based',
      remediation_owner: 'product',
    };
  }
  return null;
});
