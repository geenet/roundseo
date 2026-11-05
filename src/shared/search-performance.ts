// Search Console performance shared by the API and the dashboard. Figures are Google's own
// clicks, impressions, CTR and position; nothing here re-estimates them.

export const SEARCH_PERFORMANCE_DIMENSIONS = ['site', 'query', 'page', 'country', 'device'] as const;
export type SearchPerformanceDimension = (typeof SEARCH_PERFORMANCE_DIMENSIONS)[number];

export const SEARCH_PERFORMANCE_PERIODS = ['current', 'previous'] as const;
export type SearchPerformancePeriod = (typeof SEARCH_PERFORMANCE_PERIODS)[number];

export interface SearchPerformanceMetrics {
  clicks: number;
  impressions: number;
  /** A ratio from 0 to 1, as Search Console reports it. */
  ctr: number;
  /** Google's impression-weighted average position. 0 when there were no impressions. */
  position: number;
}

export interface SearchPerformanceItem extends SearchPerformanceMetrics {
  /** The query, page URL, ISO country code or device name. */
  key: string;
}

export interface SearchPerformanceDay extends SearchPerformanceMetrics {
  /** YYYY-MM-DD, the reporting day in Search Console. */
  day: string;
}

export interface SearchPerformanceWindow {
  start: string;
  end: string;
  site: SearchPerformanceMetrics | null;
  queries: SearchPerformanceItem[];
  pages: SearchPerformanceItem[];
  countries: SearchPerformanceItem[];
  devices: SearchPerformanceItem[];
}

export const INSIGHT_RULES = [
  'no_recent_impressions',
  'site_clicks_down',
  'visible_not_clicked',
  'ranking_beyond_page_two',
  'near_first_page',
  'clicks_down',
  'dropped_off_first_page',
] as const;
export type InsightRule = (typeof INSIGHT_RULES)[number];

export type InsightSeverity = 'warning' | 'opportunity' | 'info';

export interface SearchPerformanceInsight {
  id: string;
  rule: InsightRule;
  severity: InsightSeverity;
  scope: 'site' | 'page' | 'query';
  item: string | null;
  title: string;
  detail: string;
  metrics: SearchPerformanceMetrics;
  previous: SearchPerformanceMetrics | null;
}

export interface SearchPerformanceSyncStatus {
  status: 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  windowEnd: string | null;
  error: string | null;
}

export interface SearchPerformanceReadModel {
  connected: boolean;
  property: string | null;
  lastSync: SearchPerformanceSyncStatus | null;
  /** When data was last written successfully. Null until the first successful sync. */
  lastSucceededAt: string | null;
  hasData: boolean;
  days: SearchPerformanceDay[];
  current: SearchPerformanceWindow | null;
  previous: SearchPerformanceWindow | null;
  insights: SearchPerformanceInsight[];
  notes: string[];
}

export type SearchPerformanceSyncOutcome =
  | { status: 'succeeded'; windowEnd: string; rowsStored: number }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };
