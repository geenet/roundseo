/**
 * Atomic active-monitor capacity for a workspace (organization).
 *
 * Reservation is one conditional UPDATE per slot: `used_count = used_count +
 * 1 WHERE used_count + 1 <= limit_count`. SQLite/D1 serializes writes to a
 * row, so the WHERE guard is re-checked against the row's true current state
 * at write time regardless of any earlier read — two concurrent imports can
 * never together reserve more than the limit (spec AC4).
 */
import { nanoid } from 'nanoid';

type Database = any;

const DEFAULT_CAPACITY_LIMIT = 2_000;

export async function ensureBacklinkCapacity(db: Database, organizationId: string, defaultLimit = DEFAULT_CAPACITY_LIMIT): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO backlink_capacity (organization_id, limit_count, used_count, updated_at)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(organization_id) DO NOTHING
  `).bind(organizationId, defaultLimit, now).run();
}

export async function getBacklinkCapacity(db: Database, organizationId: string): Promise<{ limit: number; used: number }> {
  await ensureBacklinkCapacity(db, organizationId);
  const row = await db.prepare('SELECT limit_count, used_count FROM backlink_capacity WHERE organization_id = ?').bind(organizationId).first();
  return { limit: Number(row?.limit_count ?? DEFAULT_CAPACITY_LIMIT), used: Number(row?.used_count ?? 0) };
}

/** Atomically reserves exactly one slot. Returns false (no state change) when the workspace is at capacity. */
export async function reserveBacklinkCapacitySlot(db: Database, organizationId: string): Promise<boolean> {
  await ensureBacklinkCapacity(db, organizationId);
  const result = await db.prepare(`
    UPDATE backlink_capacity
    SET used_count = used_count + 1, updated_at = ?
    WHERE organization_id = ? AND used_count + 1 <= limit_count
  `).bind(new Date().toISOString(), organizationId).run();
  return Boolean(result?.meta?.changes);
}

/** Reserves up to `requested` slots one at a time; stops as soon as capacity runs out. Returns the number actually granted. */
export async function reserveBacklinkCapacity(db: Database, organizationId: string, requested: number): Promise<number> {
  let granted = 0;
  while (granted < requested) {
    if (!(await reserveBacklinkCapacitySlot(db, organizationId))) break;
    granted += 1;
  }
  return granted;
}

/** Releases previously reserved slots that were not used (e.g. rows that turned out to be duplicates). */
export async function releaseBacklinkCapacity(db: Database, organizationId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await db.prepare(`
    UPDATE backlink_capacity SET used_count = MAX(used_count - ?, 0), updated_at = ? WHERE organization_id = ?
  `).bind(count, new Date().toISOString(), organizationId).run();
}

/** Recomputes the exact capacity ceiling against the true monitor count. Call after bulk status changes (pause/archive/delete). */
export async function reconcileBacklinkCapacity(db: Database, organizationId: string): Promise<void> {
  await db.prepare(`
    UPDATE backlink_capacity
    SET used_count = (
      SELECT COUNT(*) FROM backlink_monitors
      WHERE organization_id = backlink_capacity.organization_id AND status = 'active'
    ), updated_at = ?
    WHERE organization_id = ?
  `).bind(new Date().toISOString(), organizationId).run();
}

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(16)}`;
}
