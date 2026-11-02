import type { BacklinkMonitor, MatchMode, MonitorCadence, MonitorStatus, Presence } from '../../shared/backlinks';
import { normalizeMonitorUrl } from './url-identity';
import { newId, reconcileBacklinkCapacity, releaseBacklinkCapacity, reserveBacklinkCapacitySlot } from './capacity';

type Database = any;

export interface CreateMonitorInput {
  sourceUrl: string;
  expectedTargetUrl: string;
  matchMode?: MatchMode;
  expectedAnchor?: string;
  expectedRel?: string[];
  notes?: string;
  cadence?: MonitorCadence;
  placementDate?: string;
  listId?: string;
}

export class BacklinkCapacityError extends Error {
  constructor() { super('This workspace has reached its active backlink monitor capacity. Pause or archive a monitor to free a slot.'); }
}

export async function createBacklinkMonitor(db: Database, websiteId: string, organizationId: string, userId: string, input: CreateMonitorInput): Promise<{ monitor: BacklinkMonitor; created: boolean }> {
  const source = normalizeMonitorUrl(input.sourceUrl, 'Source');
  const target = normalizeMonitorUrl(input.expectedTargetUrl, 'Expected target');
  const matchMode: MatchMode = input.matchMode === 'domain_wide' ? 'domain_wide' : 'exact_page';
  const now = new Date().toISOString();

  const existing = await db.prepare(`
    SELECT * FROM backlink_monitors WHERE website_id = ? AND source_url_normalized = ? AND expected_target_normalized = ? AND match_mode = ?
  `).bind(websiteId, source.normalized, target.normalized, matchMode).first();

  if (existing && existing.status === 'active') {
    if (input.listId) await addMonitorToList(db, input.listId, String(existing.id));
    return { monitor: mapMonitorRow(existing), created: false };
  }

  if (existing) {
    if (!(await reserveBacklinkCapacitySlot(db, organizationId))) throw new BacklinkCapacityError();
    // The status flip is guarded by `status != 'active'` so two concurrent reactivations of the
    // same monitor can't both win; the loser's already-reserved slot is handed back.
    const flipped = await db.prepare(`
      UPDATE backlink_monitors SET status = 'active', cadence = ?, next_check_at = ?, updated_at = ? WHERE id = ? AND status != 'active'
    `).bind(input.cadence || existing.cadence, nextCheckAt(input.cadence as MonitorCadence || existing.cadence, now), now, existing.id).run();
    if (!flipped?.meta?.changes) await releaseBacklinkCapacity(db, organizationId, 1);
    const reactivated = await getBacklinkMonitor(db, String(existing.id));
    if (input.listId && reactivated) await addMonitorToList(db, input.listId, reactivated.id);
    return { monitor: reactivated!, created: false };
  }

  if (!(await reserveBacklinkCapacitySlot(db, organizationId))) throw new BacklinkCapacityError();
  const id = newId('backlink');
  const cadence: MonitorCadence = input.cadence || 'weekly';
  await db.prepare(`
    INSERT INTO backlink_monitors (
      id, website_id, organization_id, source_url, source_url_normalized, expected_target_url, expected_target_normalized,
      match_mode, expected_anchor, expected_rel_json, notes, status, cadence, placement_date, next_check_at,
      last_confirmed_presence, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'unknown', ?, ?, ?)
  `).bind(
    id, websiteId, organizationId, input.sourceUrl.trim(), source.normalized, input.expectedTargetUrl.trim(), target.normalized,
    matchMode, input.expectedAnchor?.trim() || null, JSON.stringify(input.expectedRel || []), input.notes?.trim() || null,
    cadence, input.placementDate || null, nextCheckAt(cadence, now), userId, now, now,
  ).run();
  if (input.listId) await addMonitorToList(db, input.listId, id);
  return { monitor: (await getBacklinkMonitor(db, id))!, created: true };
}

export async function getBacklinkMonitor(db: Database, id: string): Promise<BacklinkMonitor | null> {
  const row = await db.prepare('SELECT * FROM backlink_monitors WHERE id = ?').bind(id).first();
  return row ? mapMonitorRow(row) : null;
}

export interface ListMonitorsFilter {
  status?: MonitorStatus;
  listId?: string;
  confirmedLoss?: boolean;
  limit?: number;
  offset?: number;
}

export async function listBacklinkMonitors(db: Database, websiteId: string, filter: ListMonitorsFilter = {}): Promise<{ monitors: BacklinkMonitor[]; total: number }> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const conditions = ['m.website_id = ?'];
  const params: unknown[] = [websiteId];
  let join = '';
  if (filter.listId) { join = 'JOIN backlink_list_members lm ON lm.monitor_id = m.id AND lm.list_id = ?'; params.unshift(filter.listId); }
  if (filter.status) { conditions.push('m.status = ?'); params.push(filter.status); }
  if (filter.confirmedLoss) conditions.push("m.last_confirmed_presence = 'absent'");
  const where = conditions.join(' AND ');
  const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM backlink_monitors m ${join} WHERE ${where}`).bind(...params).first();
  const rows = await db.prepare(`
    SELECT m.* FROM backlink_monitors m ${join} WHERE ${where} ORDER BY m.next_check_at ASC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();
  return { monitors: (rows.results || []).map(mapMonitorRow), total: Number(countRow?.count ?? 0) };
}

export interface PatchMonitorInput {
  expectedTargetUrl?: string;
  expectedAnchor?: string | null;
  expectedRel?: string[];
  notes?: string | null;
  cadence?: MonitorCadence;
  status?: MonitorStatus;
}

export async function patchBacklinkMonitor(db: Database, id: string, organizationId: string, input: PatchMonitorInput): Promise<BacklinkMonitor | null> {
  const existing = await getBacklinkMonitor(db, id);
  if (!existing) return null;
  const now = new Date().toISOString();
  let expectedTargetUrl = existing.expectedTargetUrl;
  let expectedTargetNormalized: string | undefined;
  if (input.expectedTargetUrl) {
    const target = normalizeMonitorUrl(input.expectedTargetUrl, 'Expected target');
    expectedTargetUrl = input.expectedTargetUrl.trim();
    expectedTargetNormalized = target.normalized;
  }
  const nextStatus = input.status || existing.status;
  const wasActive = existing.status === 'active';
  const willBeActive = nextStatus === 'active';
  if (!wasActive && willBeActive) {
    if (!(await reserveBacklinkCapacitySlot(db, organizationId))) throw new BacklinkCapacityError();
    // Guard the status flip itself against a concurrent activation of the same monitor; if we lost
    // that race, hand back the slot we just reserved instead of double-charging capacity for one row.
    const claimed = await db.prepare(`UPDATE backlink_monitors SET status = 'active' WHERE id = ? AND status != 'active'`).bind(id).run();
    if (!claimed?.meta?.changes) await releaseBacklinkCapacity(db, organizationId, 1);
  }
  await db.prepare(`
    UPDATE backlink_monitors SET
      expected_target_url = ?, expected_target_normalized = COALESCE(?, expected_target_normalized),
      expected_anchor = ?, expected_rel_json = ?, notes = ?, cadence = ?, status = ?,
      next_check_at = CASE WHEN ? = 'active' AND status != 'active' THEN ? ELSE next_check_at END,
      updated_at = ?
    WHERE id = ?
  `).bind(
    expectedTargetUrl, expectedTargetNormalized || null,
    input.expectedAnchor === undefined ? existing.expectedAnchor : input.expectedAnchor,
    JSON.stringify(input.expectedRel ?? existing.expectedRel),
    input.notes === undefined ? existing.notes : input.notes,
    input.cadence || existing.cadence,
    nextStatus,
    nextStatus, nextCheckAt(input.cadence || existing.cadence, now),
    now, id,
  ).run();
  if (wasActive && !willBeActive) await reconcileBacklinkCapacity(db, organizationId);
  return getBacklinkMonitor(db, id);
}

export async function addMonitorToList(db: Database, listId: string, monitorId: string): Promise<void> {
  await db.prepare(`
    INSERT INTO backlink_list_members (list_id, monitor_id, added_at) VALUES (?, ?, ?)
    ON CONFLICT(list_id, monitor_id) DO NOTHING
  `).bind(listId, monitorId, new Date().toISOString()).run();
}

/**
 * Advances a monitor's current-state columns only when `attemptedAt` is not
 * older than what is already recorded. An old delayed job can never
 * overwrite a newer observation (AC12).
 */
export interface MonitorStateUpdate {
  presence?: Presence; confirmedAt?: string; nextCheckAt?: string;
  /** Omit these two entirely to leave an in-progress confirmation window untouched (an inconclusive
   * retry must never clear it); pass `null` explicitly only to resolve/clear it. */
  confirmationDueAt?: string | null; pendingConfirmationObservationId?: string | null;
}

export async function advanceMonitorState(db: Database, monitorId: string, attemptedAt: string, update: MonitorStateUpdate): Promise<boolean> {
  // Built conditionally so an omitted confirmation field is left alone in SQL (not merely bound as
  // null) — the only way to distinguish "don't touch" from "clear" through a single UPDATE.
  const touchesConfirmationDueAt = 'confirmationDueAt' in update;
  const touchesPendingObservation = 'pendingConfirmationObservationId' in update;
  const params: unknown[] = [
    attemptedAt,
    update.confirmedAt || null, attemptedAt,
    update.presence || null,
    update.presence || null, update.confirmedAt || null, attemptedAt,
    update.nextCheckAt || null,
  ];
  if (touchesConfirmationDueAt) params.push(update.confirmationDueAt);
  if (touchesPendingObservation) params.push(update.pendingConfirmationObservationId);
  params.push(attemptedAt, monitorId, attemptedAt);

  const result = await db.prepare(`
    UPDATE backlink_monitors SET
      last_attempt_at = ?,
      last_successful_check_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_successful_check_at END,
      last_confirmed_presence = COALESCE(?, last_confirmed_presence),
      last_confirmed_at = CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN ? ELSE last_confirmed_at END,
      next_check_at = COALESCE(?, next_check_at),
      ${touchesConfirmationDueAt ? 'confirmation_due_at = ?,' : ''}
      ${touchesPendingObservation ? 'pending_confirmation_observation_id = ?,' : ''}
      updated_at = ?
    WHERE id = ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
  `).bind(...params).run();
  return Boolean(result?.meta?.changes);
}

export function nextCheckAt(cadence: MonitorCadence, from: string): string {
  const date = new Date(from);
  switch (cadence) {
    case 'daily': date.setUTCDate(date.getUTCDate() + 1); break;
    case 'monthly': {
      // setUTCMonth overflows past short months (Jan 31 -> Mar 3); clamp to the target month's last day instead.
      const targetMonth = date.getUTCMonth() + 1;
      const lastDayOfTargetMonth = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTargetMonth));
      date.setUTCMonth(targetMonth);
      break;
    }
    case 'manual': date.setUTCFullYear(date.getUTCFullYear() + 100); break;
    default: date.setUTCDate(date.getUTCDate() + 7);
  }
  return date.toISOString();
}

export function mapMonitorRow(row: any): BacklinkMonitor {
  return {
    id: row.id,
    websiteId: row.website_id,
    sourceUrl: row.source_url,
    expectedTargetUrl: row.expected_target_url,
    matchMode: row.match_mode,
    expectedAnchor: row.expected_anchor,
    expectedRel: safeJsonArray(row.expected_rel_json),
    notes: row.notes,
    status: row.status,
    cadence: row.cadence,
    placementDate: row.placement_date,
    nextCheckAt: row.next_check_at,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessfulCheckAt: row.last_successful_check_at,
    lastConfirmedPresence: row.last_confirmed_presence,
    lastConfirmedAt: row.last_confirmed_at,
    confirmationDueAt: row.confirmation_due_at,
    pendingConfirmationObservationId: row.pending_confirmation_observation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function safeJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
