import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GSC_READONLY_SCOPE } from '../../src/shared/indexing';
import type { SearchPerformanceMetrics, SearchPerformanceWindow, SearchPerformanceItem } from '../../src/shared/search-performance';
import { buildInsights } from '../../src/worker/search-performance/insights';
import { querySearchAnalytics, SearchConsoleApiError, type SearchAnalyticsRow } from '../../src/worker/search-performance/client';
import { syncWindows } from '../../src/worker/search-performance/periods';
import { syncSearchPerformance, runDueSearchPerformanceSyncs } from '../../src/worker/search-performance/sync';
import { readSearchPerformance } from '../../src/worker/search-performance/read-model';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const metrics = (clicks: number, impressions: number, position: number): SearchPerformanceMetrics => ({
  clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
});
const item = (key: string, clicks: number, impressions: number, position: number): SearchPerformanceItem => ({ key, ...metrics(clicks, impressions, position) });
const windowOf = (partial: Partial<SearchPerformanceWindow> = {}): SearchPerformanceWindow => ({
  start: '2026-10-06', end: '2026-11-02', site: metrics(3, 693, 61.5), queries: [], pages: [], countries: [], devices: [], ...partial,
});

describe('search performance windows', () => {
  it('ends three days back and compares two consecutive 28-day windows', () => {
    const windows = syncWindows(new Date('2026-11-05T10:00:00.000Z'));
    expect(windows.end).toBe('2026-11-02');
    expect(windows.current).toEqual({ start: '2026-10-06', end: '2026-11-02' });
    expect(windows.previous).toEqual({ start: '2026-09-08', end: '2026-10-05' });
    expect(windows.daily.end).toBe('2026-11-02');
  });
});

describe('insight rules', () => {
  it('flags a page shown on pages one and two that nobody clicked, as a snippet problem', () => {
    const insights = buildInsights(windowOf({ pages: [item('https://dadaphone.com/call/new-zealand', 0, 149, 12.4)] }), null);
    const found = insights.find(i => i.rule === 'visible_not_clicked');
    expect(found).toMatchObject({ scope: 'page', item: 'https://dadaphone.com/call/new-zealand', severity: 'opportunity' });
    expect(found?.title).toBe('149 impressions, no clicks');
  });

  it('reports a page ranking past page two as a ranking problem, not a snippet problem', () => {
    const insights = buildInsights(windowOf({ pages: [item('https://dadaphone.com/call/south-africa', 0, 51, 61.2)] }), null);
    expect(insights.map(i => i.rule)).toEqual(['ranking_beyond_page_two']);
  });

  it('stays silent on samples too small to judge', () => {
    const insights = buildInsights(windowOf({ pages: [item('https://dadaphone.com/call/x', 0, 10, 12)], queries: [item('thin query', 0, 3, 8)] }), null);
    expect(insights).toEqual([]);
  });

  it('names a near-top query that could reach the top three', () => {
    const insights = buildInsights(windowOf({ queries: [item('dial code', 4, 60, 6.3)] }), null);
    expect(insights).toEqual([expect.objectContaining({ rule: 'near_first_page', item: 'dial code', severity: 'opportunity' })]);
  });

  it('reports a page whose clicks fell by half or more, quoting both windows', () => {
    const insights = buildInsights(
      windowOf({ pages: [item('https://dadaphone.com/call/micronesia', 2, 30, 8)] }),
      windowOf({ start: '2026-09-08', end: '2026-10-05', pages: [item('https://dadaphone.com/call/micronesia', 10, 40, 8)] }),
    );
    const found = insights.find(i => i.rule === 'clicks_down');
    expect(found).toMatchObject({ severity: 'warning', title: 'Clicks fell from 10 to 2', previous: expect.objectContaining({ clicks: 10 }) });
  });

  it('flags a page that dropped off page one', () => {
    const insights = buildInsights(
      windowOf({ queries: [item('dadaphone', 0, 40, 14.8)] }),
      windowOf({ start: '2026-09-08', end: '2026-10-05', queries: [item('dadaphone', 0, 35, 7.2)] }),
    );
    expect(insights.find(i => i.rule === 'dropped_off_first_page')).toMatchObject({ severity: 'warning', title: 'Dropped from position 7.2 to 14.8' });
  });

  it('reports a site-wide click drop as a warning with the percentage', () => {
    const insights = buildInsights(windowOf({ site: metrics(3, 693, 61.5) }), windowOf({ site: metrics(12, 900, 40) }));
    expect(insights[0]).toMatchObject({ rule: 'site_clicks_down', severity: 'warning', title: 'Clicks down 75% on the previous 28 days' });
  });

  it('says there were no impressions instead of inventing findings', () => {
    const insights = buildInsights(windowOf({ site: metrics(0, 0, 0), pages: [item('https://dadaphone.com/', 0, 0, 0)] }), null);
    expect(insights.map(i => i.rule)).toEqual(['no_recent_impressions']);
  });

  it('returns nothing when there is no current window yet', () => {
    expect(buildInsights(null, windowOf())).toEqual([]);
  });

  it('lists warnings before opportunities', () => {
    const insights = buildInsights(
      windowOf({ queries: [item('dial code', 4, 60, 6.3)] }),
      windowOf({ start: '2026-09-08', end: '2026-10-05', site: metrics(20, 900, 40) }),
    );
    expect(insights[0].severity).toBe('warning');
    expect(insights[insights.length - 1].severity).toBe('opportunity');
  });
});

// Google's responses for the current window (ending 2026-11-02) and the previous window.
type Fixture = Record<string, SearchAnalyticsRow[]>;
const CURRENT: Fixture = {
  site: [{ clicks: 3, impressions: 693, ctr: 0.0043, position: 61.5 }],
  date: [{ keys: ['2026-11-01'], clicks: 3, impressions: 693, ctr: 0.0043, position: 61.5 }],
  query: [
    { keys: ['singapore number'], clicks: 0, impressions: 6, ctr: 0, position: 58 },
    { keys: ['dial code'], clicks: 4, impressions: 60, ctr: 0.067, position: 6.3 },
  ],
  page: [
    { keys: ['https://dadaphone.com/call/new-zealand'], clicks: 0, impressions: 149, ctr: 0, position: 12.4 },
    { keys: ['https://dadaphone.com/call-home'], clicks: 1, impressions: 7, ctr: 0.14, position: 5.5 },
  ],
  country: [{ keys: ['nzl'], clicks: 0, impressions: 149, ctr: 0, position: 12.4 }],
  device: [{ keys: ['MOBILE'], clicks: 2, impressions: 500, ctr: 0.004, position: 30 }],
};
const PREVIOUS: Fixture = {
  site: [{ clicks: 12, impressions: 900, ctr: 0.0133, position: 40 }],
  date: [{ keys: ['2026-10-05'], clicks: 2, impressions: 100, ctr: 0.02, position: 40 }],
  query: [],
  page: [{ keys: ['https://dadaphone.com/call/new-zealand'], clicks: 0, impressions: 120, ctr: 0, position: 9 }],
  country: [],
  device: [],
};

function mockGoogle(options: { failDimension?: string; current?: Fixture; previous?: Fixture } = {}) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { startDate: string; endDate: string; dimensions?: string[]; startRow?: number };
    const dimension = body.dimensions?.[0] ?? 'site';
    if (options.failDimension === dimension) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
    const source = body.endDate >= '2026-11-02' ? (options.current ?? CURRENT) : (options.previous ?? PREVIOUS);
    return new Response(JSON.stringify({ rows: source[dimension] ?? [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const NOW = new Date('2026-11-05T10:00:00.000Z');
const LATER = new Date('2026-11-06T10:00:00.000Z');

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  // A connected property for site-1 only. The access token is far from expiry, so no refresh call is made.
  database.prepare(`
    INSERT INTO google_connections (id, website_id, organization_id, google_account_email, encrypted_refresh_token, access_token, access_token_expires_at,
      granted_scopes_json, selected_property, property_type, status, created_by, created_at, updated_at)
    VALUES ('gconn-1', 'site-1', 'org-1', 'owner@example.test', 'encrypted', 'access-token', '2099-01-01T00:00:00.000Z',
      ?, 'sc-domain:example.com', 'domain', 'connected', 'user-owner', ?, ?)
  `).run(JSON.stringify([GSC_READONLY_SCOPE]), '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
});

afterEach(() => {
  database.close();
  vi.unstubAllGlobals();
});

function countWindowRows(websiteId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM search_performance_windows WHERE website_id = ?').get(websiteId) as { n: number }).n;
}

describe('syncing Search Console performance', () => {
  it('stores what Google reports and reads it back with insights', async () => {
    const fetchMock = mockGoogle();
    const outcome = await syncSearchPerformance(db, {}, 'site-1', NOW);
    expect(outcome).toMatchObject({ status: 'succeeded', windowEnd: '2026-11-02' });
    expect(fetchMock).toHaveBeenCalledTimes(11); // daily, plus totals, query, page, country and device for each of two windows

    const model = await readSearchPerformance(db, 'site-1');
    expect(model).toMatchObject({ connected: true, property: 'sc-domain:example.com', hasData: true });
    expect(model.current?.site).toEqual({ clicks: 3, impressions: 693, ctr: 0.0043, position: 61.5 });
    expect(model.current?.pages[0].key).toBe('https://dadaphone.com/call/new-zealand');
    expect(model.days).toEqual([{ day: '2026-11-01', clicks: 3, impressions: 693, ctr: 0.0043, position: 61.5 }]);
    expect(model.lastSync).toMatchObject({ status: 'succeeded', windowEnd: '2026-11-02', error: null });
    expect(model.insights.map(i => i.rule)).toEqual(expect.arrayContaining(['visible_not_clicked', 'dropped_off_first_page', 'site_clicks_down', 'near_first_page']));
  });

  it('keeps one website\'s data out of another website\'s read', async () => {
    mockGoogle();
    await syncSearchPerformance(db, {}, 'site-1', NOW);
    const other = await readSearchPerformance(db, 'site-2');
    expect(other).toMatchObject({ connected: false, property: null, hasData: false, days: [], lastSync: null });
  });

  it('skips a website that has no connection and records nothing', async () => {
    mockGoogle();
    expect(await syncSearchPerformance(db, {}, 'site-2', NOW)).toEqual({ status: 'skipped', reason: 'Connect Google Search Console first.' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM search_performance_syncs').get()).toEqual({ n: 0 });
  });

  it('records a failure, keeps the last good figures, and never writes part of a sync', async () => {
    mockGoogle();
    await syncSearchPerformance(db, {}, 'site-1', NOW);
    mockGoogle({ failDimension: 'page' });
    const outcome = await syncSearchPerformance(db, {}, 'site-1', LATER);
    expect(outcome).toEqual({ status: 'failed', error: 'Search Console returned an error (HTTP 500).' });

    const model = await readSearchPerformance(db, 'site-1');
    expect(model.lastSync).toMatchObject({ status: 'failed', error: 'Search Console returned an error (HTTP 500).' });
    expect(model.lastSucceededAt).toBe(NOW.toISOString());
    expect(model.current?.site?.clicks).toBe(3);
    expect(model.current?.pages.map(p => p.key)).toContain('https://dadaphone.com/call/new-zealand');
  });

  it('replaces figures on a repeat sync and removes pages Google no longer returns', async () => {
    mockGoogle();
    await syncSearchPerformance(db, {}, 'site-1', NOW);
    const fewerPages: Fixture = { ...CURRENT, page: [{ keys: ['https://dadaphone.com/call-home'], clicks: 1, impressions: 7, ctr: 0.14, position: 5.5 }] };
    mockGoogle({ current: fewerPages });
    await syncSearchPerformance(db, {}, 'site-1', LATER);
    const rowsAfterFirstLater = countWindowRows('site-1');

    const model = await readSearchPerformance(db, 'site-1');
    expect(model.current?.pages.map(p => p.key)).toEqual(['https://dadaphone.com/call-home']);
    expect(model.days).toHaveLength(1);

    await syncSearchPerformance(db, {}, 'site-1', LATER);
    expect(countWindowRows('site-1')).toBe(rowsAfterFirstLater);
  });

  it('runs scheduled syncs only for connected websites not synced in the last day', async () => {
    mockGoogle();
    expect(await runDueSearchPerformanceSyncs(db, {}, NOW, 10)).toBe(1);
    expect(await runDueSearchPerformanceSyncs(db, {}, new Date(NOW.getTime() + 60 * 60 * 1000), 10)).toBe(0);
    expect(await runDueSearchPerformanceSyncs(db, {}, new Date(NOW.getTime() + 24 * 60 * 60 * 1000), 10)).toBe(1);
  });
});

describe('Search Console client', () => {
  it('maps a permission error to a message the customer can act on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    const failure = querySearchAnalytics('token', 'sc-domain:example.com', { startDate: '2026-10-06', endDate: '2026-11-02', dimensions: [] });
    await expect(failure).rejects.toBeInstanceOf(SearchConsoleApiError);
    await expect(failure).rejects.toMatchObject({ status: 403, message: expect.stringContaining('denied access') });
  });

  it('pages through rows until Google returns a short page', async () => {
    const full = Array.from({ length: 25_000 }, (_, index) => ({ keys: [`https://dadaphone.com/p/${index}`], clicks: 0, impressions: 1, ctr: 0, position: 10 }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { startRow: number };
      const rows = body.startRow === 0 ? full : [{ keys: ['last'], clicks: 0, impressions: 1, ctr: 0, position: 10 }];
      return new Response(JSON.stringify({ rows }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await querySearchAnalytics('token', 'sc-domain:example.com', { startDate: '2026-10-06', endDate: '2026-11-02', dimensions: ['page'] });
    expect(rows).toHaveLength(25_001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
