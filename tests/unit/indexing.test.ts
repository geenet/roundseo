import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bulkUpsertInventory, upsertInventoryUrl } from '../../src/worker/indexing/inventory';
import { getIndexingCoverage } from '../../src/worker/indexing/coverage';
import { getQuotaUsage, reserveInspectionQuota } from '../../src/worker/indexing/inspection-jobs';
import { resolveGoogleIndexingApiAdapter, resolveIndexNowAdapter, submitWebsiteSitemap } from '../../src/worker/indexing/adapters';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
});

afterEach(() => database.close());

describe('indexing coverage (AC19)', () => {
  it('separates the inspected subset from the uninspected inventory and returns no share-of-indexed when nothing was inspected', async () => {
    await bulkUpsertInventory(db, 'site-1', ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'], 'crawl');
    const coverage = await getIndexingCoverage(db, 'site-1');
    expect(coverage.intendedCount).toBe(3);
    expect(coverage.inspectedCount).toBe(0);
    expect(coverage.uninspectedCount).toBe(3);
    expect(coverage.indexedShareOfInspected).toBeNull(); // never a 0% rate on no evidence
  });

  it('computes the indexed share only over inspected pages', async () => {
    const idA = await upsertInventoryUrl(db, 'site-1', 'https://example.com/a', 'crawl');
    await upsertInventoryUrl(db, 'site-1', 'https://example.com/b', 'crawl');
    database.prepare(`
      INSERT INTO index_observations (id, website_id, inventory_id, evidence_method, verdict, checked_at, created_at)
      VALUES ('obs-1', 'site-1', ?, 'authorized_inspection', 'indexed', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    `).run(idA);
    const coverage = await getIndexingCoverage(db, 'site-1');
    expect(coverage.inspectedCount).toBe(1);
    expect(coverage.indexedCount).toBe(1);
    expect(coverage.uninspectedCount).toBe(1);
    expect(coverage.indexedShareOfInspected).toBe(1);
  });

  it('only counts the latest observation per page, not every historical one', async () => {
    const idA = await upsertInventoryUrl(db, 'site-1', 'https://example.com/a', 'crawl');
    database.prepare(`INSERT INTO index_observations (id, website_id, inventory_id, evidence_method, verdict, checked_at, created_at) VALUES ('obs-1', 'site-1', ?, 'authorized_inspection', 'not_indexed', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`).run(idA);
    database.prepare(`INSERT INTO index_observations (id, website_id, inventory_id, evidence_method, verdict, checked_at, created_at) VALUES ('obs-2', 'site-1', ?, 'authorized_inspection', 'indexed', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`).run(idA);
    const coverage = await getIndexingCoverage(db, 'site-1');
    expect(coverage.inspectedCount).toBe(1);
    expect(coverage.indexedCount).toBe(1);
    expect(coverage.notIndexedCount).toBe(0);
  });
});

describe('inspection quota (AC18)', () => {
  it('reserves atomically up to the daily limit and refuses once exhausted', async () => {
    for (let i = 0; i < 3; i += 1) expect(await reserveInspectionQuota(db, 'site-1', 3)).toBe(true);
    expect(await reserveInspectionQuota(db, 'site-1', 3)).toBe(false);
    const usage = await getQuotaUsage(db, 'site-1', 3);
    expect(usage.used).toBe(3);
  });

  it('keeps separate quota buckets per website', async () => {
    await reserveInspectionQuota(db, 'site-1', 1);
    expect(await getQuotaUsage(db, 'site-2', 1)).toMatchObject({ used: 0 });
  });
});

describe('pluggable adapters default to unavailable (no paid source wired in)', () => {
  it('IndexNow reports unavailable with a reason', () => {
    expect(resolveIndexNowAdapter().availability()).toEqual({ available: false, reason: expect.stringContaining('not enabled') });
  });

  it('the Google Indexing API reports unavailable with a reason', () => {
    expect(resolveGoogleIndexingApiAdapter().availability('https://example.com/job').available).toBe(false);
  });

  it('sitemap submission is refused until the write scope is granted', async () => {
    database.prepare(`
      INSERT INTO google_connections (id, website_id, organization_id, google_account_email, encrypted_refresh_token, granted_scopes_json, selected_property, property_type, status, created_by, created_at, updated_at)
      VALUES ('gconn-1', 'site-1', 'org-1', 'owner@example.test', 'enc', '["https://www.googleapis.com/auth/webmasters.readonly"]', 'sc-domain:example.com', 'domain', 'connected', 'user-owner', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    `).run();
    const result = await submitWebsiteSitemap(db, {}, 'site-1', 'https://example.com/sitemap.xml', 'user-owner');
    expect(result.submitted).toBe(false);
    expect(result.reason).toMatch(/sitemap submission/i);
    const action = database.prepare(`SELECT submission_state FROM indexing_actions WHERE website_id = 'site-1' AND action_type = 'sitemap_submit'`).get() as any;
    expect(action.submission_state).toBe('not_applicable');
  });
});
