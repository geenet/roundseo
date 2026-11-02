import type { BacklinkList, MonitorCadence, MatchMode } from '../../shared/backlinks';
import { newId } from './capacity';

type Database = any;

export async function createBacklinkList(db: Database, websiteId: string, userId: string, input: { name: string; description?: string; cadence?: MonitorCadence; matchMode?: MatchMode }): Promise<BacklinkList> {
  if (!input.name.trim()) throw new Error('List name is required.');
  const id = newId('backlist');
  const now = new Date().toISOString();
  const defaults = { cadence: input.cadence, matchMode: input.matchMode };
  await db.prepare(`
    INSERT INTO backlink_lists (id, website_id, name, description, enrollment_defaults_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, input.name.trim(), input.description?.trim() || null, JSON.stringify(defaults), userId, now, now).run();
  return (await getBacklinkList(db, id))!;
}

export async function getBacklinkList(db: Database, id: string): Promise<BacklinkList | null> {
  const row = await db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM backlink_list_members WHERE list_id = l.id) AS monitor_count
    FROM backlink_lists l WHERE l.id = ?
  `).bind(id).first();
  return row ? mapListRow(row) : null;
}

export async function listBacklinkLists(db: Database, websiteId: string): Promise<BacklinkList[]> {
  const rows = await db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM backlink_list_members WHERE list_id = l.id) AS monitor_count
    FROM backlink_lists l WHERE l.website_id = ? ORDER BY l.created_at DESC
  `).bind(websiteId).all();
  return (rows.results || []).map(mapListRow);
}

export async function addListMembers(db: Database, listId: string, monitorIds: string[]): Promise<number> {
  let added = 0;
  const now = new Date().toISOString();
  for (const monitorId of monitorIds) {
    const result = await db.prepare(`
      INSERT INTO backlink_list_members (list_id, monitor_id, added_at) VALUES (?, ?, ?)
      ON CONFLICT(list_id, monitor_id) DO NOTHING
    `).bind(listId, monitorId, now).run();
    if (result?.meta?.changes) added += 1;
  }
  return added;
}

function mapListRow(row: any): BacklinkList {
  let defaults: BacklinkList['enrollmentDefaults'] = {};
  try { defaults = JSON.parse(row.enrollment_defaults_json || '{}'); } catch { defaults = {}; }
  return {
    id: row.id,
    websiteId: row.website_id,
    name: row.name,
    description: row.description,
    enrollmentDefaults: defaults,
    monitorCount: Number(row.monitor_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
