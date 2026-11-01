/**
 * Analytics imports stay source-bound.
 *
 * These helpers accept exported page and cohort records, preserve unknown
 * values as null, and only calculate transparent aggregations from values the
 * import supplied. They never turn a crawl into traffic, engagement, or
 * retention data.
 */

export type AnalyticsPageRecord = {
  id: string;
  pageTitle: string | null;
  pagePath: string | null;
  views: number | null;
  activeUsers: number | null;
  viewsPerActiveUser: number | null;
  averageEngagementSeconds: number | null;
  eventCount: number | null;
  checkedAt: string | null;
  source: string | null;
};

export type RetentionCohortRecord = {
  id: string;
  cohort: string | null;
  day: number | null;
  retentionRate: number | null;
  averageEngagementSeconds: number | null;
  newUsers: number | null;
  returningUsers: number | null;
  checkedAt: string | null;
  source: string | null;
};

export type AnalyticsImportResult<T> = { items: T[]; errors: string[] };

export type AnalyticsTrendPoint = {
  date: string;
  views: number | null;
  activeUsers: number | null;
  eventCount: number | null;
};

export type PageAnalyticsSummary = {
  pages: AnalyticsPageRecord[];
  pageCount: number;
  totalViews: number | null;
  totalPageActiveUsers: number | null;
  totalEvents: number | null;
  derivedViewsPerActiveUser: number | null;
  averageEngagementSeconds: number | null;
  latestDate: string | null;
  trend: AnalyticsTrendPoint[];
};

export type RetentionCurvePoint = {
  day: number;
  retentionRate: number | null;
  averageEngagementSeconds: number | null;
  cohorts: number;
};

export type RetentionSummary = {
  records: RetentionCohortRecord[];
  cohortCount: number;
  latestDate: string | null;
  dayOneRetention: number | null;
  lastMeasuredDay: number | null;
  averageEngagementSeconds: number | null;
  curve: RetentionCurvePoint[];
};

type DelimitedTable = { headers: string[]; rows: string[][] };

const PAGE_HEADERS = {
  pageTitle: ['page_title', 'page_title_and_screen_class', 'title', 'screen_class'],
  pagePath: ['page_path', 'page_location', 'page', 'path', 'landing_page', 'url'],
  views: ['views', 'screen_page_views', 'pageviews', 'screen_views'],
  activeUsers: ['active_users', 'users', 'total_users'],
  viewsPerActiveUser: ['views_per_active_user', 'views_per_user', 'screen_page_views_per_user'],
  averageEngagementSeconds: ['average_engagement_time', 'average_engagement_time_per_active_user', 'average_engagement_seconds', 'avg_engagement_time', 'engagement_time'],
  eventCount: ['event_count', 'events', 'event_total'],
  checkedAt: ['checked_at', 'date', 'snapshot_date', 'report_date', 'updated_at'],
  source: ['source', 'provider', 'data_source'],
} as const;

const RETENTION_HEADERS = {
  cohort: ['cohort', 'cohort_name', 'cohort_date', 'first_visit_cohort'],
  day: ['day', 'day_index', 'days_since_first_visit', 'days_since_acquisition'],
  retentionRate: ['retention_rate', 'user_retention', 'retention', 'retained_users_percent'],
  averageEngagementSeconds: ['average_engagement_time', 'average_engagement_time_per_active_user', 'average_engagement_seconds', 'avg_engagement_time', 'engagement_time'],
  newUsers: ['new_users'],
  returningUsers: ['returning_users'],
  checkedAt: ['checked_at', 'date', 'snapshot_date', 'report_date', 'updated_at'],
  source: ['source', 'provider', 'data_source'],
} as const;

function normaliseHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function stableId(prefix: string, values: Array<string | number | null | undefined>): string {
  const source = values.map(value => String(value ?? '')).join('|');
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function countOutsideQuotes(value: string, character: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      if (quoted && value[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && current === character) count += 1;
  }
  return count;
}

function delimiterFor(value: string): string {
  const firstLine = value.split(/\r?\n/).find(line => line.trim()) || '';
  const candidates = [',', '\t', ';'];
  return candidates.sort((left, right) => countOutsideQuotes(firstLine, right) - countOutsideQuotes(firstLine, left))[0];
}

function parseRows(value: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      if (quoted && value[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (!quoted && current === delimiter) { row.push(field.trim()); field = ''; continue; }
    if (!quoted && (current === '\n' || current === '\r')) {
      if (current === '\r' && value[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += current;
  }
  row.push(field.trim());
  if (row.some(cell => cell.length > 0)) rows.push(row);
  return rows;
}

function parseDelimitedTable(value: string): DelimitedTable {
  const lines = value.split(/\r?\n/);
  while (lines.length && (!lines[0].trim() || lines[0].trimStart().startsWith('#'))) lines.shift();
  const content = lines.join('\n');
  const rows = parseRows(content, delimiterFor(content));
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

function headerIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex(header => aliases.includes(normaliseHeader(header)));
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] || '').trim() : '';
}

function toNumber(value: string): number | null {
  const source = value.trim().replace(/[$€£\s,]/g, '');
  if (!source) return null;
  const match = source.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'b' ? 1_000_000_000 : 1;
  const result = amount * multiplier;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function durationSeconds(value: string): number | null {
  const source = value.trim().toLowerCase();
  if (!source) return null;
  const colon = source.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const first = Number(colon[1]);
    const second = Number(colon[2]);
    const third = colon[3] === undefined ? null : Number(colon[3]);
    if (second >= 60 || (third !== null && third >= 60)) return null;
    return third === null ? first * 60 + second : first * 3600 + second * 60 + third;
  }
  const unitMatch = source.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds))?$/);
  if (unitMatch && unitMatch.slice(1).some(Boolean)) {
    return Number(unitMatch[1] || 0) * 3600 + Number(unitMatch[2] || 0) * 60 + Number(unitMatch[3] || 0);
  }
  return toNumber(source);
}

function retentionPercent(value: string): number | null {
  const source = value.trim();
  if (!source) return null;
  const number = toNumber(source.replace('%', ''));
  if (number === null || number < 0) return null;
  if (number > 100) return null;
  if (source.includes('%')) return number;
  return number <= 1 ? number * 100 : number;
}

function dateValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pagePathValue(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return `${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return candidate.startsWith('/') ? candidate : candidate;
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function latestRecords<T extends { checkedAt: string | null }>(records: T[], keyFor: (record: T) => string): T[] {
  const latest = new Map<string, T>();
  for (const record of records) {
    const key = keyFor(record);
    const existing = latest.get(key);
    if (!existing || (record.checkedAt || '') >= (existing.checkedAt || '')) latest.set(key, record);
  }
  return [...latest.values()];
}

export function parsePageAnalyticsRecords(value: string, options: { sourceLabel?: string } = {}): AnalyticsImportResult<AnalyticsPageRecord> {
  const table = parseDelimitedTable(value);
  const indices = Object.fromEntries(Object.entries(PAGE_HEADERS).map(([key, aliases]) => [key, headerIndex(table.headers, aliases)])) as Record<keyof typeof PAGE_HEADERS, number>;
  const errors: string[] = [];
  if (indices.pageTitle < 0 && indices.pagePath < 0) return { items: [], errors: ['Add a page title or page path column.'] };
  const items = table.rows.flatMap((row, rowIndex) => {
    const pageTitle = valueAt(row, indices.pageTitle) || null;
    const pagePath = pagePathValue(valueAt(row, indices.pagePath));
    const views = toNumber(valueAt(row, indices.views));
    const activeUsers = toNumber(valueAt(row, indices.activeUsers));
    const viewsPerActiveUser = toNumber(valueAt(row, indices.viewsPerActiveUser));
    const averageEngagementSeconds = durationSeconds(valueAt(row, indices.averageEngagementSeconds));
    const eventCount = toNumber(valueAt(row, indices.eventCount));
    const checkedAt = dateValue(valueAt(row, indices.checkedAt));
    const source = valueAt(row, indices.source) || options.sourceLabel || null;
    if (!pageTitle && !pagePath) { errors.push(`Row ${rowIndex + 2} needs a page title or page path.`); return []; }
    if ([views, activeUsers, viewsPerActiveUser, averageEngagementSeconds, eventCount].every(metric => metric === null)) { errors.push(`Row ${rowIndex + 2} has no usable page metric.`); return []; }
    return [{ id: stableId('analytics-page', [pagePath || pageTitle, checkedAt, source]), pageTitle, pagePath, views, activeUsers, viewsPerActiveUser, averageEngagementSeconds, eventCount, checkedAt, source }];
  });
  return { items, errors };
}

export function parseRetentionCohortRecords(value: string, options: { sourceLabel?: string } = {}): AnalyticsImportResult<RetentionCohortRecord> {
  const table = parseDelimitedTable(value);
  const indices = Object.fromEntries(Object.entries(RETENTION_HEADERS).map(([key, aliases]) => [key, headerIndex(table.headers, aliases)])) as Record<keyof typeof RETENTION_HEADERS, number>;
  const errors: string[] = [];
  if (indices.cohort < 0 && indices.day < 0) return { items: [], errors: ['Add a cohort or day column.'] };
  const items = table.rows.flatMap((row, rowIndex) => {
    const cohort = valueAt(row, indices.cohort) || null;
    const rawDay = toNumber(valueAt(row, indices.day));
    const day = rawDay !== null && Number.isInteger(rawDay) ? rawDay : null;
    const retentionRate = retentionPercent(valueAt(row, indices.retentionRate));
    const averageEngagementSeconds = durationSeconds(valueAt(row, indices.averageEngagementSeconds));
    const newUsers = toNumber(valueAt(row, indices.newUsers));
    const returningUsers = toNumber(valueAt(row, indices.returningUsers));
    const checkedAt = dateValue(valueAt(row, indices.checkedAt));
    const source = valueAt(row, indices.source) || options.sourceLabel || null;
    if (!cohort && day === null) { errors.push(`Row ${rowIndex + 2} needs a cohort or day.`); return []; }
    if ([retentionRate, averageEngagementSeconds, newUsers, returningUsers].every(metric => metric === null)) { errors.push(`Row ${rowIndex + 2} has no usable retention metric.`); return []; }
    return [{ id: stableId('analytics-retention', [cohort, day, checkedAt, source]), cohort, day, retentionRate, averageEngagementSeconds, newUsers, returningUsers, checkedAt, source }];
  });
  return { items, errors };
}

export function summarizePageAnalytics(records: AnalyticsPageRecord[]): PageAnalyticsSummary {
  const pages = latestRecords(records, record => record.pagePath || record.pageTitle || record.id).sort((left, right) => (right.views ?? -1) - (left.views ?? -1) || (right.activeUsers ?? -1) - (left.activeUsers ?? -1));
  const total = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  };
  const totalViews = total(pages.map(record => record.views));
  const totalPageActiveUsers = total(pages.map(record => record.activeUsers));
  const totalEvents = total(pages.map(record => record.eventCount));
  const derivedViewsPerActiveUser = totalViews !== null && totalPageActiveUsers && totalPageActiveUsers > 0 ? totalViews / totalPageActiveUsers : null;
  const weightedEngagement = pages.flatMap(record => record.averageEngagementSeconds === null ? [] : [{ value: record.averageEngagementSeconds, weight: record.activeUsers && record.activeUsers > 0 ? record.activeUsers : 1 }]);
  const averageEngagementSeconds = weightedEngagement.length ? weightedEngagement.reduce((sum, item) => sum + item.value * item.weight, 0) / weightedEngagement.reduce((sum, item) => sum + item.weight, 0) : null;
  const groups = new Map<string, AnalyticsPageRecord[]>();
  for (const record of latestRecords(records, record => `${record.pagePath || record.pageTitle || record.id}|${record.checkedAt?.slice(0, 10) || ''}`)) {
    if (!record.checkedAt) continue;
    const day = record.checkedAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) || []), record]);
  }
  const trend = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => ({ date, views: total(rows.map(row => row.views)), activeUsers: total(rows.map(row => row.activeUsers)), eventCount: total(rows.map(row => row.eventCount)) }));
  const latestDate = records.map(record => record.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  return { pages, pageCount: pages.length, totalViews, totalPageActiveUsers, totalEvents, derivedViewsPerActiveUser, averageEngagementSeconds, latestDate, trend };
}

export function summarizeRetentionCohorts(records: RetentionCohortRecord[]): RetentionSummary {
  const retained = latestRecords(records, record => `${record.cohort || 'all'}|${record.day ?? 'unknown'}`);
  const cohorts = new Set(retained.map(record => record.cohort).filter((value): value is string => Boolean(value)));
  const curveGroups = new Map<number, RetentionCohortRecord[]>();
  for (const record of retained) {
    if (record.day === null) continue;
    curveGroups.set(record.day, [...(curveGroups.get(record.day) || []), record]);
  }
  const curve = [...curveGroups.entries()].sort(([left], [right]) => left - right).map(([day, rows]) => ({
    day,
    retentionRate: mean(rows.map(row => row.retentionRate).filter((value): value is number => value !== null)),
    averageEngagementSeconds: mean(rows.map(row => row.averageEngagementSeconds).filter((value): value is number => value !== null)),
    cohorts: new Set(rows.map(row => row.cohort).filter((value): value is string => Boolean(value))).size,
  }));
  const dayOneRetention = curve.find(point => point.day === 1)?.retentionRate ?? null;
  const lastMeasuredDay = curve.length ? curve[curve.length - 1].day : null;
  const averageEngagementSeconds = mean(retained.map(record => record.averageEngagementSeconds).filter((value): value is number => value !== null));
  const latestDate = records.map(record => record.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  return { records: retained.sort((left, right) => (left.day ?? Number.MAX_SAFE_INTEGER) - (right.day ?? Number.MAX_SAFE_INTEGER)), cohortCount: cohorts.size, latestDate, dayOneRetention, lastMeasuredDay, averageEngagementSeconds, curve };
}
