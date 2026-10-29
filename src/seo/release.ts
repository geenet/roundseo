/**
 * Phase 6: Release Evidence and Rollout
 *
 * Deliverables: before/after audit comparison, coverage by rule category,
 * remaining P1/P2 backlog, ownership assignments for ongoing maintenance,
 * and a documented rollback procedure.
 *
 * This module only reports on state already produced by Phases 1-5 — it
 * introduces no new Google SEO rules, only release-management plumbing.
 */

import { getAllRules } from './rules';
import { getRegisteredCheckIds, generateAuditReport } from './verifier';
import { pageInventory, validateInventory } from './inventory';
import { getPhase2RuleIds } from './checks/phase2';
import { getPhase3RuleIds } from './checks/phase3';
import { getPhase4RuleIds } from './checks/phase4';
import { getPhase5RuleIds } from './checks/phase5';
import type { AuditReport, AuditFinding } from './types';

// Phase 1 built-ins (registered directly in verifier.ts) must be checked
// before the later phase lists: phase2.ts's rule-ID list includes
// TECH-001/TECH-002/OVERALL-001 as "relevant to Phase 2 verification," but
// their checks were actually implemented in Phase 1.
const PHASE_1_BUILTIN_RULE_IDS = ['OVERALL-001', 'TECH-001', 'TECH-002'];

const PHASE_RULE_IDS: Record<number, string[]> = {
  1: PHASE_1_BUILTIN_RULE_IDS,
  2: getPhase2RuleIds(),
  3: getPhase3RuleIds(),
  4: getPhase4RuleIds(),
  5: getPhase5RuleIds(),
};

export interface RuleCoverage {
  rule_id: string;
  category: string;
  priority: string;
  has_check: boolean;
  /** Which implementation phase registered this rule's check, if known */
  implemented_in_phase: number | null;
}

/**
 * Cross-reference the rules catalog against registered checks. Surfaces
 * exactly which cataloged rules still have no automated verification —
 * including ones the catalog has carried since Phase 1 (e.g. CONTENT-001),
 * not just ones introduced later.
 */
export function generateCoverageReport(): RuleCoverage[] {
  const registered = new Set(getRegisteredCheckIds());

  return getAllRules().map((rule) => {
    const hasCheck = registered.has(rule.id);
    const phaseEntry = Object.entries(PHASE_RULE_IDS).find(([, ids]) => ids.includes(rule.id));
    const implemented_in_phase = phaseEntry
      ? Number(phaseEntry[0])
      : hasCheck
        ? 1 // registered as a Phase 1 built-in (TECH-001, TECH-002, OVERALL-001)
        : null;

    return {
      rule_id: rule.id,
      category: rule.category,
      priority: rule.priority,
      has_check: hasCheck,
      implemented_in_phase,
    };
  });
}

export interface BacklogItem {
  priority: string;
  rule_id: string;
  name: string;
  category: string;
}

/**
 * Rules in the catalog with no registered check, grouped implicitly by
 * priority order (P0 first). This is the "remaining P1/P2 work" deliverable
 * — P0 entries here would also block release, so review those first.
 */
export function buildRemainingWorkBacklog(): BacklogItem[] {
  const covered = generateCoverageReport();
  const rules = getAllRules();

  return covered
    .filter((c) => !c.has_check)
    .map((c) => {
      const rule = rules.find((r) => r.id === c.rule_id)!;
      return { priority: rule.priority, rule_id: rule.id, name: rule.name, category: rule.category };
    })
    .sort((a, b) => a.priority.localeCompare(b.priority));
}

export interface AuditComparison {
  new_failures: AuditFinding[];
  resolved_since_before: AuditFinding[];
  still_failing: AuditFinding[];
  before_fail_count: number;
  after_fail_count: number;
}

/**
 * Diff two audit reports (e.g. pre-release baseline vs. post-release) to
 * see what changed. A finding is identified by rule_id + URL, so a fix on
 * one page doesn't hide a regression on another.
 */
export function compareAuditReports(before: AuditReport, after: AuditReport): AuditComparison {
  const findingKey = (f: AuditFinding) => `${f.rule_id}::${f.url_or_template}`;

  const beforeFailures = before.findings.filter((f) => f.status === 'fail');
  const afterFailures = after.findings.filter((f) => f.status === 'fail');
  const beforeKeys = new Set(beforeFailures.map(findingKey));
  const afterKeys = new Set(afterFailures.map(findingKey));

  return {
    new_failures: afterFailures.filter((f) => !beforeKeys.has(findingKey(f))),
    resolved_since_before: beforeFailures.filter((f) => !afterKeys.has(findingKey(f))),
    still_failing: afterFailures.filter((f) => beforeKeys.has(findingKey(f))),
    before_fail_count: beforeFailures.length,
    after_fail_count: afterFailures.length,
  };
}

export interface OwnershipSummary {
  count: number;
  urls: string[];
}

/**
 * Ownership assignments for ongoing maintenance, derived directly from the
 * inventory's existing `owner` field rather than a separate record that
 * could drift out of sync with it.
 */
export function summarizeOwnership(): Record<string, OwnershipSummary> {
  const byOwner: Record<string, OwnershipSummary> = {};

  for (const page of pageInventory) {
    if (!byOwner[page.owner]) byOwner[page.owner] = { count: 0, urls: [] };
    byOwner[page.owner].count++;
    byOwner[page.owner].urls.push(page.url);
  }

  return byOwner;
}

export interface RollbackStep {
  step: number;
  action: string;
}

/**
 * Standing rollback procedure. This is a project operating convention, not
 * a Google requirement — document and rehearse it before relying on it.
 */
export const ROLLBACK_PROCEDURE: RollbackStep[] = [
  { step: 1, action: 'Revert the redirect map (src/seo/redirects.ts) to its pre-release contents and redeploy.' },
  { step: 2, action: 'Confirm GET /robots.txt and GET /sitemap.xml serve the previous, known-good content.' },
  { step: 3, action: 'Re-run validateInventory() and the registered P0 check suite against the restored deployment.' },
  { step: 4, action: 'Generate a fresh audit with generateAuditReport() and diff it against the pre-release baseline using compareAuditReports().' },
  { step: 5, action: 'Notify the page owners from summarizeOwnership() of the rollback and any findings that reappeared.' },
];

export interface ReleaseSummary {
  generated_at: string;
  inventory_valid: boolean;
  inventory_errors: string[];
  rule_coverage: RuleCoverage[];
  remaining_backlog: BacklogItem[];
  ownership: Record<string, OwnershipSummary>;
  rollback_procedure: RollbackStep[];
  audit: AuditReport;
}

/**
 * Consolidate everything Phases 1-5 produced into one release snapshot:
 * inventory validity, rule coverage, remaining backlog, ownership, the
 * rollback procedure, and a current audit report. Pass this snapshot's
 * `audit` field as the "before" argument to compareAuditReports() on the
 * next release to measure before/after.
 */
export async function generateReleaseSummary(siteUrl: string): Promise<ReleaseSummary> {
  const { valid, errors } = validateInventory();
  const audit = await generateAuditReport(siteUrl);

  return {
    generated_at: new Date().toISOString(),
    inventory_valid: valid,
    inventory_errors: errors,
    rule_coverage: generateCoverageReport(),
    remaining_backlog: buildRemainingWorkBacklog(),
    ownership: summarizeOwnership(),
    rollback_procedure: ROLLBACK_PROCEDURE,
    audit,
  };
}
