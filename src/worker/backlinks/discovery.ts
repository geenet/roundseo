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

export async function startDiscoveryJob(db: Database, env: unknown, websiteId: string, domain: string, budgetRequested: number, idempotencyKey: string, requestedBy: string): Promise<DiscoveryJobResult> {
  const existing = await db.prepare('SELECT * FROM discovery_jobs WHERE website_id = ? AND idempotency_key = ?').bind(websiteId, idempotencyKey).first();
  if (existing) return mapDiscoveryJobRow(existing);

  const provider = resolveDiscoveryProvider(env);
  const availability = provider.availability();
  const id = newId('discovery');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO discovery_jobs (id, website_id, provider, status, budget_requested, retrieved_count, unique_count, duplicate_count, idempotency_key, error_message, requested_by, created_at, completed_at)
    VALUES (?, ?, ?, 'unavailable', ?, 0, 0, 0, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, provider.name, budgetRequested, idempotencyKey, availability.reason, requestedBy, now, now).run();
  void domain;
  return (await getDiscoveryJob(db, id))!;
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
