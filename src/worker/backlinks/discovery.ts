/**
 * Backlink discovery provider adapter.
 *
 * Deliberately NOT wired to any paid data source by default. The spec notes
 * DataForSEO's backlinks endpoint as "one workable option," but the explicit
 * product decision for this deployment is to ship the pluggable interface
 * with no provider configured — the same `unavailable` + reason pattern the
 * Intelligence platform already uses for unconfigured sources (see
 * src/worker/intelligence/config.ts). Wiring a real provider later means
 * implementing `DiscoveryProvider` and returning it from
 * `resolveDiscoveryProvider`; nothing else in the Backlinks module changes.
 */
import type { AdapterAvailability } from '../../shared/indexing';
import type { DiscoveryJobResult } from '../../shared/backlinks';
import { newId } from './capacity';
import { normalizeUrlForIdentity } from './url-identity';

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // bounds a single job to at most MAX_PAGES * PAGE_SIZE retrieved rows

type Database = any;

export interface DiscoveredRecord {
  sourceUrl: string;
  targetUrl: string | null;
  providerRecordId: string | null;
  lastSeenAt: string | null;
}

export interface DiscoveryProvider {
  name: string;
  availability(): AdapterAvailability;
  /** Retrieves one bounded page of records for a website's domain, honoring any resumable cursor. */
  fetchPage(domain: string, cursor: string | null, pageSize: number): Promise<{ records: DiscoveredRecord[]; nextCursor: string | null }>;
}

class UnavailableDiscoveryProvider implements DiscoveryProvider {
  name = 'none';
  availability(): AdapterAvailability {
    return { available: false, reason: 'No backlink discovery provider is configured on this deployment. Import known backlinks or add them manually.' };
  }
  async fetchPage(): Promise<{ records: DiscoveredRecord[]; nextCursor: string | null }> {
    throw new Error('No backlink discovery provider is configured.');
  }
}

/** Swap this for a real adapter (e.g. a DataForSEO or other licensed backlinks-index client) when one is approved and configured. */
export function resolveDiscoveryProvider(_env: unknown): DiscoveryProvider {
  return new UnavailableDiscoveryProvider();
}

/**
 * Runs to completion synchronously (the budgets above keep one call bounded): reserves the
 * idempotency key first, then — only when a real provider is configured — pages through
 * `fetchPage`, merging each record into `backlink_candidates` with conservative URL
 * normalization and counting retrieved/unique/duplicate rows (AC14). With no provider
 * configured (the default), it records `unavailable` with the provider's reason and touches
 * no candidate rows, exactly as before.
 */
export async function startDiscoveryJob(db: Database, env: unknown, websiteId: string, domain: string, budgetRequested: number, idempotencyKey: string, requestedBy: string): Promise<DiscoveryJobResult> {
  const existing = await db.prepare('SELECT * FROM discovery_jobs WHERE website_id = ? AND idempotency_key = ?').bind(websiteId, idempotencyKey).first();
  if (existing) return mapDiscoveryJobRow(existing);

  const provider = resolveDiscoveryProvider(env);
  const availability = provider.availability();
  const id = newId('discovery');
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO discovery_jobs (id, website_id, provider, status, budget_requested, retrieved_count, unique_count, duplicate_count, idempotency_key, error_message, requested_by, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)
  `).bind(id, websiteId, provider.name, availability.available ? 'running' : 'unavailable', budgetRequested, idempotencyKey, availability.reason, requestedBy, startedAt).run();

  if (!availability.available) return (await getDiscoveryJob(db, id))!;

  let retrieved = 0; let unique = 0; let duplicate = 0; let cursor: string | null = null; let failure: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES && retrieved < budgetRequested; page += 1) {
      const { records, nextCursor } = await provider.fetchPage(domain, cursor, Math.min(PAGE_SIZE, budgetRequested - retrieved));
      for (const record of records) {
        retrieved += 1;
        const sourceIdentity = safeIdentity(record.sourceUrl);
        if (!sourceIdentity) { duplicate += 1; continue; } // an unparseable source can never be enrolled; counted, not stored
        const targetNormalized = record.targetUrl ? safeIdentity(record.targetUrl)?.normalized ?? null : null;
        const insert = await db.prepare(`
          INSERT INTO backlink_candidates (id, website_id, discovery_job_id, source_url, target_url, provider, provider_record_id, provider_last_seen_at, imported_at, enrollment_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
          ON CONFLICT DO NOTHING
        `).bind(newId('candidate'), websiteId, id, sourceIdentity.normalized, targetNormalized, provider.name, record.providerRecordId, record.lastSeenAt, new Date().toISOString()).run();
        if (insert?.meta?.changes) unique += 1; else duplicate += 1;
      }
      cursor = nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'The discovery provider request failed.';
  }

  await db.prepare(`
    UPDATE discovery_jobs SET status = ?, retrieved_count = ?, unique_count = ?, duplicate_count = ?, cursor = ?, error_message = ?, completed_at = ? WHERE id = ?
  `).bind(failure ? 'failed' : 'complete', retrieved, unique, duplicate, cursor, failure, new Date().toISOString(), id).run();
  return (await getDiscoveryJob(db, id))!;
}

function safeIdentity(url: string): ReturnType<typeof normalizeUrlForIdentity> | null {
  try { return normalizeUrlForIdentity(url); } catch { return null; }
}

export async function getDiscoveryJob(db: Database, id: string): Promise<DiscoveryJobResult | null> {
  const row = await db.prepare('SELECT * FROM discovery_jobs WHERE id = ?').bind(id).first();
  return row ? mapDiscoveryJobRow(row) : null;
}

function mapDiscoveryJobRow(row: any): DiscoveryJobResult {
  return {
    id: row.id, websiteId: row.website_id, provider: row.provider, status: row.status,
    budgetRequested: Number(row.budget_requested ?? 0), retrievedCount: Number(row.retrieved_count ?? 0),
    uniqueCount: Number(row.unique_count ?? 0), duplicateCount: Number(row.duplicate_count ?? 0),
    reason: row.error_message, createdAt: row.created_at, completedAt: row.completed_at,
  };
}
