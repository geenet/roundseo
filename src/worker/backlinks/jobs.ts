/**
 * Durable job creation, queue-or-drain dispatch, and stale-job recovery for
 * backlink checks — the same shape as src/worker/services/intelligence-jobs.ts.
 * No Cloudflare Queue is provisioned for this deployment yet (none is in
 * wrangler.toml for the existing audit/intelligence jobs either), so BACKLINK_JOBS
 * is an optional binding; without it, a check runs inline via ctx.waitUntil.
 */
import { runBacklinkCheck, type BacklinkCrawlEnv } from './crawl';
import { newId } from './capacity';

type Database = any;
export const BACKLINK_JOB_TYPE = 'backlink_check';
const SCHEDULER_BATCH_SIZE = 50;
const JOB_LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 3;

export interface BacklinkJobEnvironment extends BacklinkCrawlEnv {
  BACKLINK_JOBS?: { send(message: unknown): Promise<void> };
}

export interface BacklinkJobMessage {
  jobType: typeof BACKLINK_JOB_TYPE;
  jobId: string;
  monitorId: string;
}

export function isBacklinkJobMessage(value: unknown): value is BacklinkJobMessage {
  return typeof value === 'object' && value !== null
    && (value as { jobType?: unknown }).jobType === BACKLINK_JOB_TYPE
    && typeof (value as { jobId?: unknown }).jobId === 'string'
    && typeof (value as { monitorId?: unknown }).monitorId === 'string';
}

export interface JobContext { waitUntil(promise: Promise<unknown>): void }

/**
 * Scheduler step: selects due active monitors in a bounded batch, creates a
 * durable job for each (idempotency key keyed to the due minute, so a
 * duplicate sweep in the same window cannot double-schedule), and dispatches.
 */
export async function scheduleDueBacklinkChecks(db: Database, env: BacklinkJobEnvironment, ctx: JobContext, now: Date = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const due = await db.prepare(`
    SELECT id, website_id FROM backlink_monitors WHERE status = 'active' AND next_check_at <= ? ORDER BY next_check_at ASC LIMIT ?
  `).bind(nowIso, SCHEDULER_BATCH_SIZE).all();
  let scheduled = 0;
  for (const row of due.results || []) {
    const monitorId = String(row.id);
    const idempotencyKey = `due:${nowIso.slice(0, 16)}`;
    const jobId = await createBacklinkJob(db, monitorId, String(row.website_id), 'scheduled_check', idempotencyKey);
    if (jobId) { await dispatchBacklinkJob(env, ctx, jobId, monitorId); scheduled += 1; }
  }
  return scheduled;
}

export async function createBacklinkJob(db: Database, monitorId: string, websiteId: string, jobType: string, idempotencyKey: string): Promise<string | null> {
  const id = newId('bjob');
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO backlink_jobs (id, monitor_id, website_id, job_type, status, idempotency_key, requested_at, lease_expires_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    ON CONFLICT(monitor_id, idempotency_key) DO NOTHING
  `).bind(id, monitorId, websiteId, jobType, idempotencyKey, now, leaseUntil(now)).run();
  return result?.meta?.changes ? id : null;
}

export async function dispatchBacklinkJob(env: BacklinkJobEnvironment, ctx: JobContext | undefined, jobId: string, monitorId: string): Promise<void> {
  const message: BacklinkJobMessage = { jobType: BACKLINK_JOB_TYPE, jobId, monitorId };
  if (env.BACKLINK_JOBS?.send) { await env.BACKLINK_JOBS.send(message); return; }
  const run = processBacklinkJob(env, message);
  if (ctx) ctx.waitUntil(run); else await run;
}

/** One lease-protected job execution. Safe to call twice for the same job (idempotent via the job's own status guard). */
export async function processBacklinkJob(env: BacklinkJobEnvironment, message: BacklinkJobMessage): Promise<void> {
  const db = env.DB;
  const claimed = await db.prepare(`
    UPDATE backlink_jobs SET status = 'running', started_at = ?, attempt_count = attempt_count + 1, lease_expires_at = ?
    WHERE id = ? AND status IN ('queued', 'retrying')
  `).bind(new Date().toISOString(), leaseUntil(new Date().toISOString()), message.jobId).run();
  if (!claimed?.meta?.changes) return; // Already running, completed, or redelivered after completion — never re-run (AC13).
  try {
    await runBacklinkCheck(db, env, message.monitorId, message.jobId);
    await db.prepare(`UPDATE backlink_jobs SET status = 'complete', completed_at = ? WHERE id = ?`).bind(new Date().toISOString(), message.jobId).run();
  } catch (error) {
    const job = await db.prepare('SELECT attempt_count, max_attempts FROM backlink_jobs WHERE id = ?').bind(message.jobId).first();
    const retrying = job && Number(job.attempt_count) < Number(job.max_attempts ?? MAX_ATTEMPTS);
    await db.prepare(`UPDATE backlink_jobs SET status = ?, error_message = ? WHERE id = ?`)
      .bind(retrying ? 'retrying' : 'failed', error instanceof Error ? error.message : 'Backlink check failed.', message.jobId).run();
  }
}

/** Re-dispatches jobs whose lease lapsed (a crashed or lost-delivery attempt), same recovery shape as crawl_jobs/intelligence_runs. */
export async function recoverStaleBacklinkJobs(db: Database, env: BacklinkJobEnvironment, ctx: JobContext | undefined, now: Date = new Date()): Promise<number> {
  const stale = await db.prepare(`
    SELECT id, monitor_id FROM backlink_jobs WHERE status IN ('queued', 'running', 'retrying') AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
  `).bind(now.toISOString()).all();
  for (const row of stale.results || []) {
    await db.prepare(`UPDATE backlink_jobs SET status = 'retrying', lease_expires_at = ? WHERE id = ?`).bind(leaseUntil(now.toISOString()), row.id).run();
    await dispatchBacklinkJob(env, ctx, String(row.id), String(row.monitor_id));
  }
  return stale.results?.length || 0;
}

const MANUAL_CHECKS_PER_HOUR = 5;

export class ManualCheckRateLimitError extends Error {
  constructor() { super('This monitor already has several manual rechecks queued in the last hour. Wait before requesting another.'); }
}

/** Queues a bounded, on-demand recheck (spec: "bounded manual rechecks"). */
export async function queueManualBacklinkCheck(db: Database, env: BacklinkJobEnvironment, ctx: JobContext | undefined, monitorId: string, websiteId: string): Promise<string> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(`
    SELECT COUNT(*) AS count FROM backlink_jobs WHERE monitor_id = ? AND job_type = 'manual_check' AND requested_at >= ?
  `).bind(monitorId, since).first();
  if (Number(recent?.count ?? 0) >= MANUAL_CHECKS_PER_HOUR) throw new ManualCheckRateLimitError();
  const idempotencyKey = `manual:${newId('key')}`;
  const jobId = await createBacklinkJob(db, monitorId, websiteId, 'manual_check', idempotencyKey);
  if (jobId) await dispatchBacklinkJob(env, ctx, jobId, monitorId);
  return jobId || '';
}

function leaseUntil(from: string): string {
  const date = new Date(from);
  date.setUTCMinutes(date.getUTCMinutes() + JOB_LEASE_MINUTES);
  return date.toISOString();
}
