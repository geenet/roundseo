/**
 * The intended-index inventory: pages RoundSEO knows about (from a crawl,
 * a sitemap, or a manually flagged priority page) and whether each is
 * meant to be indexed. Inspection is scheduled against this list, priority
 * pages first (spec: "Inspect priority URLs first, then rotate through the rest").
 */
import { nanoid } from 'nanoid';
import type { IndexingInventoryItem, InventorySource } from '../../shared/indexing';

type Database = any;

function normalize(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}${parsed.search}`;
}

export async function upsertInventoryUrl(db: Database, websiteId: string, url: string, source: InventorySource, options: { intendedIndexed?: boolean; isPriority?: boolean } = {}): Promise<string> {
  const normalized = normalize(url);
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT id, is_priority FROM indexing_inventory WHERE website_id = ? AND url_normalized = ?').bind(websiteId, normalized).first();
  if (existing) {
    await db.prepare(`
      UPDATE indexing_inventory SET last_seen_at = ?, is_priority = CASE WHEN ? THEN 1 ELSE is_priority END,
        intended_indexed = COALESCE(?, intended_indexed) WHERE id = ?
    `).bind(now, options.isPriority ? 1 : 0, options.intendedIndexed === undefined ? null : (options.intendedIndexed ? 1 : 0), existing.id).run();
    return String(existing.id);
  }
  const id = `invpage_${nanoid(16)}`;
  await db.prepare(`
    INSERT INTO indexing_inventory (id, website_id, url, url_normalized, intended_indexed, is_priority, source, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, url, normalized, options.intendedIndexed === false ? 0 : 1, options.isPriority ? 1 : 0, source, now, now).run();
  return id;
}

export async function bulkUpsertInventory(db: Database, websiteId: string, urls: string[], source: InventorySource): Promise<number> {
  let count = 0;
  for (const url of urls) {
    try { await upsertInventoryUrl(db, websiteId, url, source); count += 1; } catch { /* Skip an unparseable URL. */ }
  }
  return count;
}

export async function listInventory(db: Database, websiteId: string, options: { limit?: number; offset?: number; onlyIntended?: boolean } = {}): Promise<{ items: IndexingInventoryItem[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const condition = options.onlyIntended ? 'AND intended_indexed = 1' : '';
  const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM indexing_inventory WHERE website_id = ? ${condition}`).bind(websiteId).first();
  const rows = await db.prepare(`
    SELECT * FROM indexing_inventory WHERE website_id = ? ${condition} ORDER BY is_priority DESC, last_seen_at DESC LIMIT ? OFFSET ?
  `).bind(websiteId, limit, offset).all();
  const items: IndexingInventoryItem[] = [];
  for (const row of rows.results || []) {
    const latest = await db.prepare('SELECT * FROM index_observations WHERE inventory_id = ? ORDER BY checked_at DESC LIMIT 1').bind(row.id).first();
    items.push(mapInventoryRow(row, latest ? mapObservationRow(latest) : null));
  }
  return { items, total: Number(countRow?.count ?? 0) };
}

export async function getInventoryItem(db: Database, id: string): Promise<IndexingInventoryItem | null> {
  const row = await db.prepare('SELECT * FROM indexing_inventory WHERE id = ?').bind(id).first();
  if (!row) return null;
  const latest = await db.prepare('SELECT * FROM index_observations WHERE inventory_id = ? ORDER BY checked_at DESC LIMIT 1').bind(id).first();
  return mapInventoryRow(row, latest ? mapObservationRow(latest) : null);
}

function mapInventoryRow(row: any, latestObservation: IndexingInventoryItem['latestObservation']): IndexingInventoryItem {
  return {
    id: row.id, websiteId: row.website_id, url: row.url, intendedIndexed: Boolean(row.intended_indexed),
    isPriority: Boolean(row.is_priority), source: row.source, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
    latestObservation,
  };
}

function mapObservationRow(row: any): NonNullable<IndexingInventoryItem['latestObservation']> {
  return {
    id: row.id, inventoryId: row.inventory_id, evidenceMethod: row.evidence_method, verdict: row.verdict,
    coverageReason: row.coverage_reason, googleCrawlTime: row.google_crawl_time, declaredCanonical: row.declared_canonical,
    selectedCanonical: row.selected_canonical, sitemapRefs: safeArray(row.sitemap_refs_json),
    inspectionResultLink: row.inspection_result_link, checkedAt: row.checked_at,
  };
}

function safeArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
