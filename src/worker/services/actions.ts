import type { ActionStatus } from '../../shared/operating-model';

type Database = any;

const EDITABLE_STATUSES = new Set<ActionStatus>([
  'open',
  'planned',
  'in_progress',
  'awaiting_verification',
  'ignored',
  'not_applicable',
]);

export async function listWebsiteActions(db: Database, websiteId: string, status?: ActionStatus): Promise<any[]> {
  const statement = status
    ? db.prepare(`
        SELECT * FROM action_items WHERE website_id = ? AND status = ?
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, last_seen_at DESC
      `).bind(websiteId, status)
    : db.prepare(`
        SELECT * FROM action_items WHERE website_id = ?
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, last_seen_at DESC
      `).bind(websiteId);
  const result = await statement.all();
  return result.results || [];
}

export async function getAction(db: Database, actionId: string): Promise<any | null> {
  const action = await db.prepare('SELECT * FROM action_items WHERE id = ?').bind(actionId).first();
  if (!action) return null;
  const evidence = await db.prepare(`
    SELECT evidence.*
    FROM action_occurrences occurrence
    JOIN audit_finding_evidence evidence ON evidence.finding_id = occurrence.finding_id
    WHERE occurrence.action_id = ?
      AND occurrence.observed_at = (
        SELECT MAX(observed_at) FROM action_occurrences WHERE action_id = ?
      )
    ORDER BY evidence.page_url, evidence.element
  `).bind(actionId, actionId).all();
  return { ...action, evidence: evidence.results || [] };
}

export async function updateActionStatus(db: Database, actionId: string, status: ActionStatus, options: { ignoredReason?: string; ownerId?: string } = {}): Promise<any | null> {
  if (!EDITABLE_STATUSES.has(status)) throw new Error('Only a comparable verification run can mark an action as resolved.');
  if (status === 'ignored' && !options.ignoredReason?.trim()) throw new Error('Explain why this action is being ignored.');
  const existing = await getAction(db, actionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE action_items SET
      status = ?,
      owner_id = COALESCE(?, owner_id),
      ignored_reason = CASE WHEN ? = 'ignored' THEN ? ELSE NULL END,
      verified_at = CASE WHEN ? = 'awaiting_verification' THEN NULL ELSE verified_at END,
      last_seen_at = ?
    WHERE id = ?
  `).bind(status, options.ownerId || null, status, options.ignoredReason?.trim() || null, status, now, actionId).run();
  return getAction(db, actionId);
}
