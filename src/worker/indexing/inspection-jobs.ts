/**
 * Bounded, queue-protected URL Inspection scheduling. Google documents a
 * 2,000/day per-site quota; `reserveInspectionQuota` enforces a matching
 * daily ceiling with the same atomic single-UPDATE pattern as backlink
 * capacity, so concurrent inspection requests can never together exceed it.
 * A quota or Google error leaves prior observations untouched and reports
 * incomplete coverage rather than inventing a result (AC18).
 */
import { nanoid } from 'nanoid';
import type { InspectionJob, InspectionJobReason } from '../../shared/indexing';
import { getValidAccessToken, type GoogleConnectionEnv } from './google-connection';
import { inspectUrl } from './search-console-client';
import { getGoogleConnection } from './google-connection';

type Database = any;
const DEFAULT_DAILY_QUOTA = 2_000;
const LEASE_MINUTES = 5;

function dayBucket(date: Date): string { return date.toISOString().slice(0, 10); }

export async function reserveInspectionQuota(db: Database, websiteId: string, dailyLimit = DEFAULT_DAILY_QUOTA, now: Date = new Date()): Promise<boolean> {
  const bucket = dayBucket(now);
  await db.prepare(`INSERT INTO inspection_quota_windows (website_id, bucket, request_count, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(website_id, bucket) DO NOTHING`)
    .bind(websiteId, bucket, now.toISOString()).run();
  const result = await db.prepare(`
    UPDATE inspection_quota_windows SET request_count = request_count + 1, updated_at = ? WHERE website_id = ? AND bucket = ? AND request_count + 1 <= ?
  `).bind(now.toISOString(), websiteId, bucket, dailyLimit).run();
  return Boolean(result?.meta?.changes);
}

export async function getQuotaUsage(db: Database, websiteId: string, dailyLimit = DEFAULT_DAILY_QUOTA, now: Date = new Date()): Promise<{ limit: number; used: number; resetAt: string }> {
  const bucket = dayBucket(now);
  const row = await db.prepare('SELECT request_count FROM inspection_quota_windows WHERE website_id = ? AND bucket = ?').bind(websiteId, bucket).first();
  const reset = new Date(now); reset.setUTCDate(reset.getUTCDate() + 1); reset.setUTCHours(0, 0, 0, 0);
  return { limit: dailyLimit, used: Number(row?.request_count ?? 0), resetAt: reset.toISOString() };
}

export async function queueInspection(db: Database, websiteId: string, inventoryId: string, reason: InspectionJobReason, requestedBy: string | null): Promise<string> {
  const idempotencyKey = `${reason}:${inventoryId}:${new Date().toISOString().slice(0, 10)}`;
  const id = `insjob_${nanoid(16)}`;
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO inspection_jobs (id, website_id, inventory_id, status, reason, idempotency_key, requested_by, requested_at, lease_expires_at)
    VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    ON CONFLICT(website_id, idempotency_key) DO NOTHING
  `).bind(id, websiteId, inventoryId, reason, idempotencyKey, requestedBy, now, leaseUntil(now)).run();
  return result?.meta?.changes ? id : (await db.prepare('SELECT id FROM inspection_jobs WHERE website_id = ? AND idempotency_key = ?').bind(websiteId, idempotencyKey).first())?.id;
}

/** Runs one inspection job: reserves quota, calls the URL Inspection API, and records the observation. */
export async function runInspectionJob(db: Database, env: GoogleConnectionEnv, jobId: string): Promise<void> {
  let claimed = false;
  try {
    const job = await db.prepare('SELECT * FROM inspection_jobs WHERE id = ?').bind(jobId).first();
    if (!job || job.status !== 'queued') return;
    const claim = await db.prepare(`UPDATE inspection_jobs SET status = 'running', attempt_count = attempt_count + 1 WHERE id = ? AND status = 'queued'`).bind(jobId).run();
    if (!claim?.meta?.changes) return;
    claimed = true;
    const websiteId = String(job.website_id);
    const connection = await getGoogleConnection(db, websiteId);
    if (!connection || !connection.selectedProperty) throw new Error('No Google Search Console property is connected for this website.');
    if (!(await reserveInspectionQuota(db, websiteId))) {
      await db.prepare(`UPDATE inspection_jobs SET status = 'failed', error_message = ? WHERE id = ?`).bind('Daily Google inspection quota reached for this website.', jobId).run();
      return;
    }
    const accessToken = await getValidAccessToken(db, env, websiteId);
    if (!accessToken) throw new Error('Google access needs to be reconnected for this website.');
    const inventory = await db.prepare('SELECT url FROM indexing_inventory WHERE id = ?').bind(job.inventory_id).first();
    if (!inventory) throw new Error('The inspected page is no longer in the inventory.');
    const result = await inspectUrl(accessToken, connection.selectedProperty, String(inventory.url));
    if (!result) throw new Error('Google URL Inspection did not return a result.');
    if ('quotaExceeded' in result) { await db.prepare(`UPDATE inspection_jobs SET status = 'failed', error_message = ? WHERE id = ?`).bind('Google reported its own quota was exceeded.', jobId).run(); return; }
    const observationId = `idxobs_${nanoid(16)}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO index_observations (id, website_id, inventory_id, evidence_method, verdict, coverage_reason, google_crawl_time, declared_canonical, selected_canonical, sitemap_refs_json, inspection_result_link, checked_at, created_at)
      VALUES (?, ?, ?, 'authorized_inspection', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(observationId, websiteId, job.inventory_id, result.verdict, result.coverageState, result.lastCrawlTime, result.declaredCanonical, result.selectedCanonical, JSON.stringify(result.sitemaps), result.inspectionResultLink, now, now).run();
    await db.prepare(`UPDATE inspection_jobs SET status = 'complete', completed_at = ?, result_observation_id = ? WHERE id = ?`).bind(now, observationId, jobId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inspection failed.';
    if (claimed) await db.prepare(`UPDATE inspection_jobs SET status = 'failed', error_message = ? WHERE id = ?`).bind(message, jobId).run();
    else console.error('Inspection job claim failed:', error);
  }
}

/** Selects queued/overdue inspection jobs in a bounded batch, priority reason first. */
export async function selectDueInspectionJobs(db: Database, limit = 20): Promise<InspectionJob[]> {
  const rows = await db.prepare(`
    SELECT * FROM inspection_jobs WHERE status = 'queued' ORDER BY (reason = 'priority') DESC, requested_at ASC LIMIT ?
  `).bind(limit).all();
  return (rows.results || []).map(mapJobRow);
}

export async function recoverStaleInspectionJobs(db: Database, now: Date = new Date()): Promise<InspectionJob[]> {
  const rows = await db.prepare(`SELECT * FROM inspection_jobs WHERE status = 'running' AND lease_expires_at <= ?`).bind(now.toISOString()).all();
  for (const row of rows.results || []) await db.prepare(`UPDATE inspection_jobs SET status = 'queued', lease_expires_at = ? WHERE id = ?`).bind(leaseUntil(now.toISOString()), row.id).run();
  return (rows.results || []).map(mapJobRow);
}

function leaseUntil(from: string): string { const date = new Date(from); date.setUTCMinutes(date.getUTCMinutes() + LEASE_MINUTES); return date.toISOString(); }

function mapJobRow(row: any): InspectionJob {
  return { id: row.id, websiteId: row.website_id, inventoryId: row.inventory_id, status: row.status, reason: row.reason, requestedAt: row.requested_at, completedAt: row.completed_at, resultObservationId: row.result_observation_id, errorMessage: row.error_message };
}
