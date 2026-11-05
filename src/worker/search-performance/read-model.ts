// Read side for the dashboard: stored figures plus the insights computed from them.
import type {
  SearchPerformanceDay,
  SearchPerformanceItem,
  SearchPerformanceMetrics,
  SearchPerformanceReadModel,
  SearchPerformanceSyncStatus,
  SearchPerformanceWindow,
} from '../../shared/search-performance';
import { getGoogleConnection } from '../indexing/google-connection';
import { buildInsights } from './insights';

type Database = any;

/** Days of the daily series returned to the dashboard. The full history stays stored. */
const DISPLAY_DAYS = 120;
/** Rows per dimension returned to the dashboard. Insights use every stored row. */
const DISPLAY_ITEMS = 25;

export const SEARCH_PERFORMANCE_NOTES = [
  'Search Console reports data about 2 to 3 days late, so figures cover complete days only.',
  'Google hides some queries for privacy. Query rows can therefore total less than the site figure.',
  'Positions are Google\'s impression-weighted averages, not a live rank check.',
];

function metricsFromRow(row: any): SearchPerformanceMetrics {
  return { clicks: Number(row.clicks), impressions: Number(row.impressions), ctr: Number(row.ctr), position: Number(row.position) };
}

function itemFromRow(row: any): SearchPerformanceItem {
  return { key: String(row.item_key), ...metricsFromRow(row) };
}

function buildWindow(rows: any[]): SearchPerformanceWindow | null {
  if (!rows.length) return null;
  const result: SearchPerformanceWindow = { start: String(rows[0].window_start), end: String(rows[0].window_end), site: null, queries: [], pages: [], countries: [], devices: [] };
  for (const row of rows) {
    const dimension = String(row.dimension);
    if (dimension === 'site') result.site = metricsFromRow(row);
    else if (dimension === 'query') result.queries.push(itemFromRow(row));
    else if (dimension === 'page') result.pages.push(itemFromRow(row));
    else if (dimension === 'country') result.countries.push(itemFromRow(row));
    else if (dimension === 'device') result.devices.push(itemFromRow(row));
  }
  return result;
}

function displayWindow(full: SearchPerformanceWindow): SearchPerformanceWindow {
  return {
    ...full,
    queries: full.queries.slice(0, DISPLAY_ITEMS),
    pages: full.pages.slice(0, DISPLAY_ITEMS),
    countries: full.countries.slice(0, DISPLAY_ITEMS),
    devices: full.devices.slice(0, DISPLAY_ITEMS),
  };
}

function syncStatusFromRow(row: any): SearchPerformanceSyncStatus {
  return {
    status: row.status === 'succeeded' ? 'succeeded' : 'failed',
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    windowEnd: row.window_end ? String(row.window_end) : null,
    error: row.error_message ? String(row.error_message) : null,
  };
}

export async function readSearchPerformance(db: Database, websiteId: string): Promise<SearchPerformanceReadModel> {
  const connection = await getGoogleConnection(db, websiteId);
  const lastSyncRow = await db.prepare(`
    SELECT status, window_end, error_message, started_at, finished_at FROM search_performance_syncs
    WHERE website_id = ? ORDER BY started_at DESC LIMIT 1
  `).bind(websiteId).first();
  const lastSucceededRow = await db.prepare(`
    SELECT finished_at FROM search_performance_syncs WHERE website_id = ? AND status = 'succeeded'
    ORDER BY started_at DESC LIMIT 1
  `).bind(websiteId).first();
  const dayRows = await db.prepare(`
    SELECT day, clicks, impressions, ctr, position FROM search_performance_days
    WHERE website_id = ? ORDER BY day DESC LIMIT ?
  `).bind(websiteId, DISPLAY_DAYS).all();
  const windowRows = await db.prepare(`
    SELECT period, window_start, window_end, dimension, item_key, clicks, impressions, ctr, position
    FROM search_performance_windows WHERE website_id = ? ORDER BY impressions DESC, item_key ASC
  `).bind(websiteId).all();

  const rowsFor = (period: string) => (windowRows.results ?? []).filter((row: any) => row.period === period);
  const currentFull = buildWindow(rowsFor('current'));
  const previousFull = buildWindow(rowsFor('previous'));

  const days: SearchPerformanceDay[] = (dayRows.results ?? []).map((row: any) => ({ day: String(row.day), ...metricsFromRow(row) })).reverse();

  return {
    connected: Boolean(connection?.selectedProperty),
    property: connection?.selectedProperty ?? null,
    lastSync: lastSyncRow ? syncStatusFromRow(lastSyncRow) : null,
    lastSucceededAt: lastSucceededRow?.finished_at ? String(lastSucceededRow.finished_at) : null,
    hasData: currentFull !== null,
    days,
    current: currentFull ? displayWindow(currentFull) : null,
    previous: previousFull ? displayWindow(previousFull) : null,
    insights: buildInsights(currentFull, previousFull),
    notes: SEARCH_PERFORMANCE_NOTES,
  };
}
