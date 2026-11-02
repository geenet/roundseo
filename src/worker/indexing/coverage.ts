/**
 * Coverage identifies the inspected subset and the uninspected inventory
 * separately (AC19) — an indexed share is never computed against pages
 * that were never checked.
 */
import type { IndexingCoverage } from '../../shared/indexing';
import { getQuotaUsage } from './inspection-jobs';

type Database = any;

export async function getIndexingCoverage(db: Database, websiteId: string): Promise<IndexingCoverage> {
  const intendedRow = await db.prepare(`SELECT COUNT(*) AS count FROM indexing_inventory WHERE website_id = ? AND intended_indexed = 1`).bind(websiteId).first();
  const inspectedRow = await db.prepare(`
    SELECT COUNT(DISTINCT inventory_id) AS count FROM index_observations
    WHERE website_id = ? AND evidence_method = 'authorized_inspection'
  `).bind(websiteId).first();
  const indexedRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT inventory_id, verdict, ROW_NUMBER() OVER (PARTITION BY inventory_id ORDER BY checked_at DESC) AS rank
      FROM index_observations WHERE website_id = ? AND evidence_method = 'authorized_inspection'
    ) latest WHERE rank = 1 AND verdict = 'indexed'
  `).bind(websiteId).first();
  const notIndexedRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT inventory_id, verdict, ROW_NUMBER() OVER (PARTITION BY inventory_id ORDER BY checked_at DESC) AS rank
      FROM index_observations WHERE website_id = ? AND evidence_method = 'authorized_inspection'
    ) latest WHERE rank = 1 AND verdict = 'not_indexed'
  `).bind(websiteId).first();

  const intendedCount = Number(intendedRow?.count ?? 0);
  const inspectedCount = Number(inspectedRow?.count ?? 0);
  const indexedCount = Number(indexedRow?.count ?? 0);
  const notIndexedCount = Number(notIndexedRow?.count ?? 0);
  const quota = await getQuotaUsage(db, websiteId);

  return {
    intendedCount, inspectedCount, indexedCount, notIndexedCount,
    uninspectedCount: Math.max(intendedCount - inspectedCount, 0),
    indexedShareOfInspected: inspectedCount > 0 ? indexedCount / inspectedCount : null,
    quota,
  };
}
