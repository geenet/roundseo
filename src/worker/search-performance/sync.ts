// Pulls one website's Search Console performance and stores it. Every read from Google happens
// before the first write, so a failed sync never leaves a half-fetched set of figures behind.
// Writes are idempotent (upserts, then removal of rows this sync did not return), so a retried
// sync converges on the same data.
import { nanoid } from 'nanoid';
import { GSC_READONLY_SCOPE, GSC_WRITE_SCOPE } from '../../shared/indexing';
import type {
  SearchPerformanceItem,
  SearchPerformanceMetrics,
  SearchPerformanceSyncOutcome,
} from '../../shared/search-performance';
import { getGoogleConnection, getValidAccessToken, type GoogleConnectionEnv } from '../indexing/google-connection';
import { querySearchAnalytics, SearchConsoleApiError, type SearchAnalyticsRow } from './client';
import { BREAKDOWN_ROW_LIMIT, syncWindows, type DayRange, type SyncWindows } from './periods';

type Database = any;

const BREAKDOWN_DIMENSIONS = ['query', 'page', 'country', 'device'] as const;
type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
const PERIODS = ['current', 'previous'] as const;
type Period = (typeof PERIODS)[number];

/** Statements per D1 batch. Keeps each batch small, and each batch is safe to retry. */
const STATEMENTS_PER_BATCH = 100;
/** A website is synced at most once in this window by the scheduler. */
const SCHEDULED_INTERVAL_MS = 23 * 60 * 60 * 1000;

interface DailyRow extends SearchPerformanceMetrics { day: string }
interface PeriodRows { site: SearchAnalyticsRow[]; query: SearchAnalyticsRow[]; page: SearchAnalyticsRow[]; country: SearchAnalyticsRow[]; device: SearchAnalyticsRow[] }
interface PeriodData { site: SearchPerformanceMetrics; items: Record<BreakdownDimension, SearchPerformanceItem[]> }
interface FetchedPerformance { daily: DailyRow[]; periods: Record<Period, PeriodData> }

function metricsOf(row: SearchAnalyticsRow | undefined): SearchPerformanceMetrics {
  return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row?.ctr ?? 0, position: row?.position ?? 0 };
}

function itemsOf(rows: SearchAnalyticsRow[]): SearchPerformanceItem[] {
  return rows
    .map(row => ({ key: row.keys?.[0] ?? '', ...metricsOf(row) }))
    .filter(item => item.key !== '')
    .sort((a, b) => b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, BREAKDOWN_ROW_LIMIT);
}

async function fetchPeriodRows(accessToken: string, property: string, range: DayRange): Promise<PeriodRows> {
  const [site, query, page, country, device] = await Promise.all([
    querySearchAnalytics(accessToken, property, { startDate: range.start, endDate: range.end, dimensions: [] }),
    querySearchAnalytics(accessToken, property, { startDate: range.start, endDate: range.end, dimensions: ['query'] }),
    querySearchAnalytics(accessToken, property, { startDate: range.start, endDate: range.end, dimensions: ['page'] }),
    querySearchAnalytics(accessToken, property, { startDate: range.start, endDate: range.end, dimensions: ['country'] }),
    querySearchAnalytics(accessToken, property, { startDate: range.start, endDate: range.end, dimensions: ['device'] }),
  ]);
  return { site, query, page, country, device };
}

async function fetchPerformance(accessToken: string, property: string, windows: SyncWindows): Promise<FetchedPerformance> {
  const [dailyRows, current, previous] = await Promise.all([
    querySearchAnalytics(accessToken, property, { startDate: windows.daily.start, endDate: windows.daily.end, dimensions: ['date'] }),
    fetchPeriodRows(accessToken, property, windows.current),
    fetchPeriodRows(accessToken, property, windows.previous),
  ]);
  const toPeriod = (rows: PeriodRows): PeriodData => ({
    site: metricsOf(rows.site[0]),
    items: { query: itemsOf(rows.query), page: itemsOf(rows.page), country: itemsOf(rows.country), device: itemsOf(rows.device) },
  });
  const daily = dailyRows
    .map(row => ({ day: row.keys?.[0] ?? '', ...metricsOf(row) }))
    .filter(row => row.day !== '');
  return { daily, periods: { current: toPeriod(current), previous: toPeriod(previous) } };
}

/** Runs statements in small batches. Every write is an upsert or a removal, so a retry is safe. */
async function runStatements(db: Database, statements: any[]): Promise<void> {
  for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(start, start + STATEMENTS_PER_BATCH);
    if (typeof db.batch === 'function') await db.batch(chunk);
    else for (const statement of chunk) await statement.run();
  }
}

function windowRowStatement(db: Database, websiteId: string, period: Period, range: DayRange, dimension: string, item: SearchPerformanceMetrics & { key: string }, syncedAt: string): any {
  return db.prepare(`
    INSERT INTO search_performance_windows (website_id, period, window_start, window_end, dimension, item_key, clicks, impressions, ctr, position, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(website_id, period, dimension, item_key) DO UPDATE SET
      window_start = excluded.window_start, window_end = excluded.window_end, clicks = excluded.clicks,
      impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position, synced_at = excluded.synced_at
  `).bind(websiteId, period, range.start, range.end, dimension, item.key, item.clicks, item.impressions, item.ctr, item.position, syncedAt);
}

async function persist(db: Database, websiteId: string, syncId: string, property: string, windows: SyncWindows, data: FetchedPerformance, startedAt: string, syncedAt: string): Promise<number> {
  const statements: any[] = [];
  let rowsStored = 0;

  for (const day of data.daily) {
    statements.push(db.prepare(`
      INSERT INTO search_performance_days (website_id, day, clicks, impressions, ctr, position, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(website_id, day) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions,
        ctr = excluded.ctr, position = excluded.position, synced_at = excluded.synced_at
    `).bind(websiteId, day.day, day.clicks, day.impressions, day.ctr, day.position, syncedAt));
    rowsStored += 1;
  }

  for (const period of PERIODS) {
    const range = windows[period];
    const periodData = data.periods[period];
    statements.push(windowRowStatement(db, websiteId, period, range, 'site', { key: '', ...periodData.site }, syncedAt));
    rowsStored += 1;
    for (const dimension of BREAKDOWN_DIMENSIONS) {
      for (const item of periodData.items[dimension]) {
        statements.push(windowRowStatement(db, websiteId, period, range, dimension, item, syncedAt));
        rowsStored += 1;
      }
    }
    // Rows from an earlier sync that this one did not return are removed last.
    statements.push(db.prepare(`DELETE FROM search_performance_windows WHERE website_id = ? AND period = ? AND synced_at < ?`)
      .bind(websiteId, period, syncedAt));
  }

  await runStatements(db, statements);

  // The success record is written last, so a sync that failed part-way never reads as succeeded.
  await db.prepare(`
    INSERT INTO search_performance_syncs (id, website_id, status, property, window_end, error_message, started_at, finished_at)
    VALUES (?, ?, 'succeeded', ?, ?, NULL, ?, ?)
  `).bind(syncId, websiteId, property, windows.end, startedAt, syncedAt).run();
  return rowsStored;
}

async function recordFailure(db: Database, websiteId: string, property: string, windowEnd: string | null, message: string, startedAt: string): Promise<SearchPerformanceSyncOutcome> {
  await db.prepare(`
    INSERT INTO search_performance_syncs (id, website_id, status, property, window_end, error_message, started_at, finished_at)
    VALUES (?, ?, 'failed', ?, ?, ?, ?, ?)
  `).bind(`spsync_${nanoid(16)}`, websiteId, property, windowEnd, message, startedAt, new Date().toISOString()).run();
  return { status: 'failed', error: message };
}

/** Syncs one website's Search Console performance. Never throws; failures are recorded and returned. */
export async function syncSearchPerformance(db: Database, env: GoogleConnectionEnv, websiteId: string, now: Date = new Date()): Promise<SearchPerformanceSyncOutcome> {
  const connection = await getGoogleConnection(db, websiteId);
  if (!connection) return { status: 'skipped', reason: 'Connect Google Search Console first.' };
  if (!connection.selectedProperty) return { status: 'skipped', reason: 'Choose a Search Console property first.' };
  const property = connection.selectedProperty;
  const startedAt = now.toISOString();
  const windows = syncWindows(now);

  const hasReadAccess = connection.grantedScopes.includes(GSC_READONLY_SCOPE) || connection.grantedScopes.includes(GSC_WRITE_SCOPE);
  if (!hasReadAccess) return recordFailure(db, websiteId, property, windows.end, 'Reconnect Google to grant Search Console read access.', startedAt);

  try {
    const accessToken = await getValidAccessToken(db, env, websiteId);
    if (!accessToken) return await recordFailure(db, websiteId, property, windows.end, 'Reconnect Google access for this website.', startedAt);
    const data = await fetchPerformance(accessToken, property, windows);
    const rowsStored = await persist(db, websiteId, `spsync_${nanoid(16)}`, property, windows, data, startedAt, now.toISOString());
    return { status: 'succeeded', windowEnd: windows.end, rowsStored };
  } catch (error) {
    const message = error instanceof SearchConsoleApiError ? error.message : 'The Search Console sync could not be completed. Try again later.';
    if (!(error instanceof SearchConsoleApiError)) console.error('Search performance sync failed:', error);
    return recordFailure(db, websiteId, property, windows.end, message, startedAt);
  }
}

/** Scheduled entry point: syncs connected websites not synced in the last day, oldest first. */
export async function runDueSearchPerformanceSyncs(db: Database, env: GoogleConnectionEnv, now: Date = new Date(), limit = 10): Promise<number> {
  const cutoff = new Date(now.getTime() - SCHEDULED_INTERVAL_MS).toISOString();
  const lastStarted = `COALESCE((SELECT MAX(s.started_at) FROM search_performance_syncs s WHERE s.website_id = gc.website_id), '')`;
  const due = await db.prepare(`
    SELECT gc.website_id FROM google_connections gc
    WHERE gc.status = 'connected' AND gc.selected_property IS NOT NULL AND ${lastStarted} < ?
    ORDER BY ${lastStarted} ASC
    LIMIT ?
  `).bind(cutoff, limit).all();

  let attempted = 0;
  for (const row of due.results ?? []) {
    await syncSearchPerformance(db, env, String(row.website_id), now);
    attempted += 1;
  }
  return attempted;
}
