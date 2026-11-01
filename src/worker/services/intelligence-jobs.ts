import { getWebsite } from './websites';
import { domainOf } from '../intelligence/html';
import { readIntelligenceConfig, type IntelligenceEnvironment } from '../intelligence/config';
import { runCrawlBatch, type CrawlBatchOutcome } from './intelligence-crawl';
import { listStaleIntelligenceRuns } from './intelligence-store';
import type { ExecutionScope } from './intelligence';

export const INTELLIGENCE_JOB_TYPE = 'intelligence';
const MAX_INLINE_BATCHES = 200;

export interface IntelligenceJobEnvironment extends IntelligenceEnvironment {
  DB: any;
  CRAWL_JOBS?: { send(message: unknown): Promise<void> };
}

export interface IntelligenceJobMessage {
  jobType: typeof INTELLIGENCE_JOB_TYPE;
  websiteId: string;
  intelligenceRunId: string;
}

export interface JobContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function isIntelligenceJobMessage(value: unknown): value is IntelligenceJobMessage {
  return typeof value === 'object' && value !== null
    && (value as { jobType?: unknown }).jobType === INTELLIGENCE_JOB_TYPE
    && typeof (value as { websiteId?: unknown }).websiteId === 'string'
    && typeof (value as { intelligenceRunId?: unknown }).intelligenceRunId === 'string';
}

/** Build the server-side scope for a website. Its domain bounds every analysis and crawl. */
export async function intelligenceScope(env: IntelligenceJobEnvironment, websiteId: string): Promise<ExecutionScope | null> {
  const website = await getWebsite(env.DB, websiteId);
  if (!website) return null;
  const websiteDomain = domainOf(website.url);
  if (!websiteDomain) return null;
  return {
    db: env.DB,
    websiteId,
    websiteDomain,
    config: readIntelligenceConfig(env),
  };
}

/** Hand a crawl run to the job queue, or drain it in-process when no queue is bound. */
export async function enqueueIntelligenceRun(env: IntelligenceJobEnvironment, ctx: JobContext | undefined, websiteId: string, runId: string): Promise<void> {
  const message: IntelligenceJobMessage = { jobType: INTELLIGENCE_JOB_TYPE, websiteId, intelligenceRunId: runId };
  if (env.CRAWL_JOBS?.send) {
    await env.CRAWL_JOBS.send(message);
    return;
  }
  const drain = drainIntelligenceRun(env, websiteId, runId);
  if (ctx) ctx.waitUntil(drain);
  else await drain;
}

/** One lease-protected batch. The queue consumer re-enqueues while the result is `continue`. */
export async function runIntelligenceJob(env: IntelligenceJobEnvironment, message: IntelligenceJobMessage): Promise<CrawlBatchOutcome> {
  const scope = await intelligenceScope(env, message.websiteId);
  if (!scope) return 'idle';
  return runCrawlBatch(scope, message.intelligenceRunId);
}

async function drainIntelligenceRun(env: IntelligenceJobEnvironment, websiteId: string, runId: string): Promise<void> {
  for (let batch = 0; batch < MAX_INLINE_BATCHES; batch += 1) {
    const outcome = await runIntelligenceJob(env, { jobType: INTELLIGENCE_JOB_TYPE, websiteId, intelligenceRunId: runId });
    if (outcome !== 'continue') return;
  }
}

/** Re-queue crawl runs whose lease lapsed, such as after a crashed batch. */
export async function recoverStaleIntelligenceRuns(env: IntelligenceJobEnvironment, ctx: JobContext | undefined, now: Date = new Date()): Promise<number> {
  const stale = await listStaleIntelligenceRuns(env.DB, now.toISOString());
  for (const run of stale) await enqueueIntelligenceRun(env, ctx, run.websiteId, run.id);
  return stale.length;
}
