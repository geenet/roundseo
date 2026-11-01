import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSiteCrawl } from '../../src/worker/services/intelligence-crawl';
import { readIntelligenceConfig } from '../../src/worker/intelligence/config';
import { enqueueIntelligenceRun, isIntelligenceJobMessage, recoverStaleIntelligenceRuns, runIntelligenceJob } from '../../src/worker/services/intelligence-jobs';
import { createIntelligenceRun, getIntelligenceRun, updateIntelligenceRun } from '../../src/worker/services/intelligence-store';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SITE = '<html lang="en"><head><title>A home page title that is long enough to pass</title></head><body><h1>Home</h1><p>' + 'words '.repeat(320) + '</p><a href="/next">Next page</a></body></html>';
const NEXT = '<html lang="en"><head><title>A next page title that is long enough to pass</title></head><body><h1>Next</h1><p>' + 'words '.repeat(320) + '</p></body></html>';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url === 'https://example.com/') return new Response(SITE, { status: 200, headers: { 'content-type': 'text/html' } });
    if (url === 'https://example.com/next') return new Response(NEXT, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  database.close();
});

async function queuedCrawl(key: string, { seed = true } = {}) {
  const request = { action: 'site_crawl' as const, domain: 'example.com', maximumPages: 10 };
  const run = await createIntelligenceRun(db, {
    websiteId: 'site-1', userId: 'user-owner', capability: 'page_intelligence', action: 'site_crawl',
    request, status: 'queued', idempotencyKey: key,
  });
  if (seed) await startSiteCrawl({ db, websiteId: 'site-1', websiteDomain: 'example.com', config: readIntelligenceConfig({}) }, run.id, request);
  return run;
}

describe('intelligence job messages', () => {
  it('recognizes only intelligence job messages, so audit messages keep their own path', () => {
    expect(isIntelligenceJobMessage({ jobType: 'intelligence', websiteId: 'site-1', intelligenceRunId: 'run-1' })).toBe(true);
    expect(isIntelligenceJobMessage({ jobType: 'site_crawl', jobId: 'job-1', auditId: 'audit-1', websiteUrl: 'https://example.com' })).toBe(false);
    expect(isIntelligenceJobMessage(null)).toBe(false);
  });

  it('hands a crawl to the job queue when a queue is bound', async () => {
    const send = vi.fn(async () => undefined);
    const run = await queuedCrawl('key-queue-00001');
    await enqueueIntelligenceRun({ DB: db, CRAWL_JOBS: { send } } as never, undefined, 'site-1', run.id);
    expect(send).toHaveBeenCalledWith({ jobType: 'intelligence', websiteId: 'site-1', intelligenceRunId: run.id });
    expect((await getIntelligenceRun(db, 'site-1', run.id))?.status).toBe('queued');
  });

  it('drains a crawl in-process through the request context when no queue is bound', async () => {
    const run = await queuedCrawl('key-drain-00001');
    const pending: Promise<unknown>[] = [];
    await enqueueIntelligenceRun({ DB: db } as never, { waitUntil: promise => { pending.push(promise); } }, 'site-1', run.id);
    await Promise.all(pending);
    const finished = await getIntelligenceRun(db, 'site-1', run.id);
    expect(finished?.status).toBe('complete');
    expect(finished?.summary).toMatchObject({ pagesCrawled: 2 });
  });

  it('runs one batch at a time, reporting continue while discovered pages wait, then finished, then idle', async () => {
    const run = await queuedCrawl('key-batch-00001');
    const message = { jobType: 'intelligence' as const, websiteId: 'site-1', intelligenceRunId: run.id };
    expect(await runIntelligenceJob({ DB: db } as never, message)).toBe('continue');
    expect((await getIntelligenceRun(db, 'site-1', run.id))?.status).toBe('queued');
    expect(await runIntelligenceJob({ DB: db } as never, message)).toBe('finished');
    const finished = await getIntelligenceRun(db, 'site-1', run.id);
    expect(finished).toMatchObject({ status: 'complete', summary: { pagesCrawled: 2, pagesQueued: 0 } });
    expect(await runIntelligenceJob({ DB: db } as never, message)).toBe('idle');
  });

  it('reports a crawl with no start page as failed rather than complete with zero pages', async () => {
    const empty = await queuedCrawl('key-empty-00001', { seed: false });
    await runIntelligenceJob({ DB: db } as never, { jobType: 'intelligence', websiteId: 'site-1', intelligenceRunId: empty.id });
    const finished = await getIntelligenceRun(db, 'site-1', empty.id);
    expect(finished).toMatchObject({ status: 'failed', error: { code: 'SITE_CRAWL_FAILED', message: 'The crawl had no start page to fetch.' } });
  });

  it('recovers crawls whose lease lapsed by sending them back to the queue', async () => {
    const stale = await queuedCrawl('key-recover-0001');
    await updateIntelligenceRun(db, 'site-1', stale.id, { status: 'running', leaseExpiresAt: '2026-10-31T00:00:00.000Z' });
    const send = vi.fn(async () => undefined);
    const recovered = await recoverStaleIntelligenceRuns({ DB: db, CRAWL_JOBS: { send } } as never, undefined, new Date('2026-11-01T12:00:00.000Z'));
    expect(recovered).toBe(1);
    expect(send).toHaveBeenCalledWith({ jobType: 'intelligence', websiteId: 'site-1', intelligenceRunId: stale.id });
  });
});
