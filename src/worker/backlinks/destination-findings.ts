/**
 * Joins confirmed backlink target evidence to the existing action workflow.
 * Only a genuinely broken destination, or a redirect away from a page that
 * is not itself a known, intended page, becomes an action (spec AC22: an
 * intentional noindex or approved redirect must not automatically become an
 * error). Writes directly to action_items; there is no audit/finding row to
 * attach occurrences to, so action_occurrences is intentionally left empty.
 */
import { nanoid } from 'nanoid';

type Database = any;

export interface TargetHealthInput {
  websiteId: string;
  targetUrl: string;
  targetStatusCode: number | null;
  targetFinalUrl: string | null;
  monitorCount: number;
}

export async function recordTargetHealthFinding(db: Database, input: TargetHealthInput): Promise<void> {
  const problem = await classifyTargetProblem(db, input);
  const actionKey = `backlink_target:${input.websiteId}:${hashKey(input.targetUrl)}`;
  if (!problem) {
    // The destination recovered or was never a problem; resolve any open action for it.
    await db.prepare(`UPDATE action_items SET status = 'verified_resolved', verified_at = ? WHERE action_key = ? AND status NOT IN ('verified_resolved', 'ignored', 'not_applicable')`)
      .bind(new Date().toISOString(), actionKey).run();
    return;
  }
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT id, status FROM action_items WHERE action_key = ?').bind(actionKey).first();
  if (existing) {
    await db.prepare(`
      UPDATE action_items SET
        title = ?, severity = ?, business_impact = ?, affected_page_count = ?, last_seen_at = ?,
        status = CASE WHEN status IN ('verified_resolved', 'ignored', 'not_applicable') THEN 'open' ELSE status END
      WHERE id = ?
    `).bind(problem.title, problem.severity, problem.impact, input.monitorCount, now, existing.id).run();
    return;
  }
  const id = `action_${nanoid(16)}`;
  await db.prepare(`
    INSERT INTO action_items (
      id, website_id, action_key, rule_id, rule_version, title, status, severity, confidence,
      business_impact, effort_band, proposed_fix, verification_method, affected_page_count, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, '2026.11.0', ?, 'open', ?, 'high', ?, 'quick', ?, ?, ?, ?, ?)
  `).bind(
    id, input.websiteId, actionKey, problem.ruleId, problem.title, problem.severity,
    problem.impact, problem.proposedFix, 'Recheck the monitored backlinks pointing at this page; the next successful crawl resolves this action automatically.',
    input.monitorCount, now, now,
  ).run();
}

interface TargetProblem { ruleId: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; impact: string; proposedFix: string }

async function classifyTargetProblem(db: Database, input: TargetHealthInput): Promise<TargetProblem | null> {
  const status = input.targetStatusCode;
  if (status !== null && (status === 404 || status === 410 || status >= 500)) {
    return {
      ruleId: 'backlink_target_broken',
      title: `A linked page now returns ${status}`,
      severity: 'high',
      impact: `${input.monitorCount} monitored backlink${input.monitorCount === 1 ? '' : 's'} point to a page that is no longer reachable.`,
      proposedFix: 'Restore the page at its original URL, or add a redirect to a suitable replacement.',
    };
  }
  if (input.targetFinalUrl && input.targetFinalUrl !== input.targetUrl) {
    const destination = await db.prepare('SELECT intended_indexed FROM indexing_inventory WHERE website_id = ? AND url_normalized = ?')
      .bind(input.websiteId, normalizedOrRaw(input.targetFinalUrl)).first();
    // A redirect to a page RoundSEO already knows is an intended, indexed page reads as an approved redirect, not an issue.
    if (destination && Number(destination.intended_indexed) === 1) return null;
    return {
      ruleId: 'backlink_target_redirected',
      title: 'A linked page now redirects to an unreviewed destination',
      severity: 'medium',
      impact: `${input.monitorCount} monitored backlink${input.monitorCount === 1 ? '' : 's'} point to a page that now redirects elsewhere.`,
      proposedFix: 'Confirm the redirect destination is the right replacement, or mark it as an intended page.',
    };
  }
  return null;
}

function normalizedOrRaw(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${url.port ? ':' + url.port : ''}${url.pathname}${url.search}`;
  } catch { return value; }
}

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
