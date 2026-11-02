/**
 * Revocable client sharing for a backlink list. The shared view returns only
 * the fields a client should see — never notes, provider identifiers, or
 * other lists/projects (AC24). A noindex tag on the list page is not what
 * makes a share private; revocation is.
 */
import { nanoid } from 'nanoid';
import type { BacklinkReportShare, SharedBacklinkRow } from '../../shared/backlinks';

type Database = any;

export async function createReportShare(db: Database, listId: string, userId: string, expiresAt?: string): Promise<BacklinkReportShare> {
  const id = `backshare_${nanoid(16)}`;
  const token = nanoid(32);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO backlink_report_shares (id, list_id, shared_token, permission_scope, expires_at, created_by, created_at, view_count)
    VALUES (?, ?, ?, 'view', ?, ?, ?, 0)
  `).bind(id, listId, token, expiresAt || null, userId, now).run();
  return (await getReportShare(db, id))!;
}

export async function getReportShare(db: Database, id: string): Promise<BacklinkReportShare | null> {
  const row = await db.prepare('SELECT * FROM backlink_report_shares WHERE id = ?').bind(id).first();
  return row ? mapShareRow(row) : null;
}

export async function revokeReportShare(db: Database, id: string): Promise<void> {
  await db.prepare('UPDATE backlink_report_shares SET revoked_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
}

export interface SharedListView { listName: string; rows: SharedBacklinkRow[] }

/** Resolves a token to its (non-private) list view, or null if revoked, expired, or unknown. */
export async function resolveSharedList(db: Database, token: string): Promise<SharedListView | null> {
  const share = await db.prepare('SELECT * FROM backlink_report_shares WHERE shared_token = ?').bind(token).first();
  if (!share || share.revoked_at) return null;
  if (share.expires_at && Date.parse(share.expires_at) <= Date.now()) return null;
  const list = await db.prepare('SELECT name FROM backlink_lists WHERE id = ?').bind(share.list_id).first();
  if (!list) return null;
  await db.prepare('UPDATE backlink_report_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?').bind(new Date().toISOString(), share.id).run();
  const rows = await db.prepare(`
    SELECT m.source_url, m.expected_target_url, m.match_mode, m.status, m.last_confirmed_presence, m.last_confirmed_at, m.last_successful_check_at
    FROM backlink_list_members lm JOIN backlink_monitors m ON m.id = lm.monitor_id
    WHERE lm.list_id = ? ORDER BY m.source_url ASC
  `).bind(share.list_id).all();
  return {
    listName: String(list.name),
    rows: (rows.results || []).map((row: any) => ({
      sourceUrl: row.source_url, targetUrl: row.expected_target_url, matchMode: row.match_mode, status: row.status,
      lastConfirmedPresence: row.last_confirmed_presence, lastConfirmedAt: row.last_confirmed_at, lastSuccessfulCheckAt: row.last_successful_check_at,
    })),
  };
}

function mapShareRow(row: any): BacklinkReportShare {
  return {
    id: row.id, listId: row.list_id, sharedToken: row.shared_token, permissionScope: 'view',
    expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, viewCount: Number(row.view_count ?? 0),
  };
}
