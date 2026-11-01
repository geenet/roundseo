import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendIntelligenceEvidence,
  claimIntelligenceRun,
  consumeLiveRequests,
  createIntelligenceRun,
  crawlPageCounts,
  getIntelligenceAsset,
  getIntelligenceRun,
  getIntelligenceRunByIdempotency,
  insertCrawlPages,
  insertIntelligenceAsset,
  insertIntelligenceObservations,
  insertKeywordMetrics,
  latestKeywordVolumes,
  listIntelligenceEvidence,
  listIntelligenceObservations,
  listIntelligenceRuns,
  listStaleIntelligenceRuns,
  markCrawlPage,
  nextQueuedCrawlPages,
  replaceIntelligenceEvidence,
  updateIntelligenceRun,
} from '../../src/worker/services/intelligence-store';
import { d1, ISO_NOW, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
});

afterEach(() => {
  database.close();
});

function newRun(overrides: Partial<Parameters<typeof createIntelligenceRun>[1]> = {}) {
  return createIntelligenceRun(db, {
    websiteId: 'site-1',
    userId: 'user-owner',
    capability: 'page_intelligence',
    action: 'page_inspection',
    request: { action: 'page_inspection', url: 'https://example.com/' },
    status: 'running',
    ...overrides,
  });
}

describe('intelligence run ledger', () => {
  it('replays a run for the same idempotency key instead of creating a second one', async () => {
    const first = await newRun({ idempotencyKey: 'key-abcdef12' });
    const replay = await newRun({ idempotencyKey: 'key-abcdef12' });
    expect(replay.id).toBe(first.id);
    expect(await getIntelligenceRunByIdempotency(db, 'site-1', 'key-abcdef12')).toMatchObject({ id: first.id });
    expect((await listIntelligenceRuns(db, 'site-1')).length).toBe(1);
  });

  it('lets one worker hold a lease at a time and lets another take over only after it expires', async () => {
    const run = await createIntelligenceRun(db, {
      websiteId: 'site-1', userId: 'user-owner', capability: 'page_intelligence', action: 'site_crawl',
      request: { action: 'site_crawl', domain: 'example.com', maximumPages: 10 }, status: 'queued',
    });
    const start = new Date(ISO_NOW);
    const claimed = await claimIntelligenceRun(db, run.id, 60, start);
    expect(claimed).toMatchObject({ status: 'running', attempts: 1 });
    expect(await claimIntelligenceRun(db, run.id, 60, new Date(start.getTime() + 30_000))).toBeNull();
    const taken = await claimIntelligenceRun(db, run.id, 60, new Date(start.getTime() + 61_000));
    expect(taken).toMatchObject({ attempts: 2 });
  });

  it('reports crawl runs with an expired lease for recovery, and leaves finished runs alone', async () => {
    const stale = await createIntelligenceRun(db, {
      websiteId: 'site-1', userId: 'user-owner', capability: 'page_intelligence', action: 'site_crawl',
      request: {}, status: 'running',
    });
    await updateIntelligenceRun(db, 'site-1', stale.id, { leaseExpiresAt: '2026-10-31T00:00:00.000Z' });
    const done = await createIntelligenceRun(db, {
      websiteId: 'site-1', userId: 'user-owner', capability: 'page_intelligence', action: 'site_crawl',
      request: {}, status: 'complete',
    });
    await updateIntelligenceRun(db, 'site-1', done.id, { leaseExpiresAt: '2026-10-31T00:00:00.000Z' });
    expect(await listStaleIntelligenceRuns(db, ISO_NOW)).toEqual([{ id: stale.id, websiteId: 'site-1' }]);
  });

  it('keeps readers on the last complete evidence snapshot until a replacement is fully written', async () => {
    const run = await newRun();
    await replaceIntelligenceEvidence(db, 'site-1', run.id, [{ kind: 'page', identityKey: 'first', payload: { id: 'first' } }]);
    const replaced = await replaceIntelligenceEvidence(db, 'site-1', run.id, [{ kind: 'page', identityKey: 'second', payload: { id: 'second' } }]);
    expect(replaced.map(item => item.payload)).toEqual([{ id: 'second' }]);
    const visible = await listIntelligenceEvidence(db, 'site-1', { runId: run.id });
    expect(visible.map(item => item.identityKey)).toEqual(['second']);
  });

  it('appends incremental evidence to the visible snapshot without rewriting earlier rows', async () => {
    const run = await newRun({ action: 'site_crawl', capability: 'page_intelligence' });
    await appendIntelligenceEvidence(db, 'site-1', run.id, [{ kind: 'page', identityKey: 'p1', payload: { id: 'p1' } }]);
    await appendIntelligenceEvidence(db, 'site-1', run.id, [{ kind: 'page', identityKey: 'p2', payload: { id: 'p2' } }]);
    const visible = await listIntelligenceEvidence(db, 'site-1', { runId: run.id });
    expect(visible.map(item => item.identityKey).sort()).toEqual(['p1', 'p2']);
  });

  it('enforces the daily live-request ceiling per website and resets on the next UTC day', async () => {
    const now = new Date('2026-11-01T23:00:00.000Z');
    expect(await consumeLiveRequests(db, 'site-1', 2, 3, now)).toBe(true);
    expect(await consumeLiveRequests(db, 'site-1', 2, 3, now)).toBe(false);
    expect(await consumeLiveRequests(db, 'site-2', 3, 3, now)).toBe(true);
    expect(await consumeLiveRequests(db, 'site-1', 1, 3, new Date('2026-11-02T00:10:00.000Z'))).toBe(true);
  });

  it('isolates runs, evidence, observations, and assets by website', async () => {
    const run = await newRun();
    await insertIntelligenceObservations(db, 'site-1', [{
      runId: run.id, surface: 'google', countryCode: 'US', languageCode: 'en', device: 'desktop', query: 'seo audit',
      position: 1, feature: 'organic', domain: 'example.com', url: 'https://example.com/a', title: 'A', description: null, observedAt: ISO_NOW,
    }]);
    await insertIntelligenceAsset(db, { id: 'asset-1', runId: run.id, websiteId: 'site-1', pageUrl: 'https://example.com/', storageKey: 'intelligence/site-1/asset-1.png', contentType: 'image/png', byteLength: 10 });
    expect(await getIntelligenceRun(db, 'site-2', run.id)).toBeNull();
    expect(await getIntelligenceAsset(db, 'site-2', 'asset-1')).toBeNull();
    expect(await getIntelligenceAsset(db, 'site-1', 'asset-1')).toMatchObject({ storageKey: 'intelligence/site-1/asset-1.png' });
    expect(await listIntelligenceObservations(db, 'site-2', 'US')).toEqual([]);
  });

  it('records source-reported keyword metrics and returns the newest volume per keyword', async () => {
    const run = await newRun();
    await insertKeywordMetrics(db, 'site-1', run.id, 'google_ads_keyword_plan', 'US', 'en', [
      { keyword: 'SEO Audit', searchVolume: 100, cpcLow: 1, cpcHigh: 2, competition: 30, monthlySeries: [], observedAt: '2026-10-01T00:00:00.000Z' },
      { keyword: 'seo audit', searchVolume: 900, cpcLow: 1, cpcHigh: 2, competition: 30, monthlySeries: [], observedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    const volumes = await latestKeywordVolumes(db, 'site-1', 'US');
    expect(volumes.get('seo audit')).toBe(900);
  });

  it('keeps one frontier row per URL, hands out the shallowest pending pages first, and counts outcomes', async () => {
    const run = await newRun({ action: 'site_crawl', capability: 'page_intelligence' });
    const inserted = await insertCrawlPages(db, 'site-1', run.id, [
      { url: 'https://example.com/', depth: 0, discoveredFrom: null },
      { url: 'https://example.com/about', depth: 1, discoveredFrom: 'https://example.com/' },
      { url: 'https://example.com/', depth: 0, discoveredFrom: null },
    ]);
    expect(inserted).toBe(2);
    const [first] = await nextQueuedCrawlPages(db, run.id, 1);
    expect(first.url).toBe('https://example.com/');
    await markCrawlPage(db, first.id, { status: 'fetched', statusCode: 200, errorMessage: null });
    expect(await crawlPageCounts(db, run.id)).toEqual({ total: 2, queued: 1, fetched: 1, failed: 0, skipped: 0 });
  });
});
