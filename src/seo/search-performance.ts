/**
 * Search Performance Tracking
 * Metrics: Search Visibility (impressions/clicks by segment), CTR by
 * position, Average position.
 *
 * This is observation plumbing for Search Console data, not a replacement
 * for it: Search Console coverage is partial, and missing rows mean
 * "unknown," never "not indexed" or "failing." There is deliberately no
 * universal CTR or position target here — click-through rate depends on
 * query, position, and SERP features together.
 */

export interface SearchPerformanceRow {
  url: string;
  /** ISO date range label, e.g. '2026-10-01..2026-10-28' */
  date_range: string;
  impressions: number;
  clicks: number;
  /** Average position for this URL/date range, 1-indexed */
  average_position: number;
}

export interface PageSearchSummary {
  url: string;
  total_impressions: number;
  total_clicks: number;
  ctr: number | null;
  average_position: number | null;
  rows_observed: number;
}

/**
 * CTR is undefined (not zero) when there were no impressions — a page with
 * zero impressions has not been observed, which is different from a page
 * that was shown but never clicked.
 */
export function calculateCtr(row: SearchPerformanceRow): number | null {
  if (row.impressions <= 0) return null;
  return row.clicks / row.impressions;
}

/**
 * Aggregate raw Search Console rows into one summary per URL.
 */
export function summarizeByPage(rows: SearchPerformanceRow[]): PageSearchSummary[] {
  const byUrl = new Map<string, SearchPerformanceRow[]>();
  for (const row of rows) {
    if (!byUrl.has(row.url)) byUrl.set(row.url, []);
    byUrl.get(row.url)!.push(row);
  }

  return Array.from(byUrl.entries()).map(([url, urlRows]) => {
    const total_impressions = urlRows.reduce((sum, r) => sum + r.impressions, 0);
    const total_clicks = urlRows.reduce((sum, r) => sum + r.clicks, 0);
    const weightedPosition = urlRows.reduce((sum, r) => sum + r.average_position * r.impressions, 0);

    return {
      url,
      total_impressions,
      total_clicks,
      ctr: total_impressions > 0 ? total_clicks / total_impressions : null,
      average_position: total_impressions > 0 ? weightedPosition / total_impressions : null,
      rows_observed: urlRows.length,
    };
  });
}

/**
 * Pages with no Search Console rows at all. This means "unobserved," not
 * "not indexed" — Search Console coverage is partial even for indexed URLs
 * with low query volume.
 */
export function findUnobservedUrls(rows: SearchPerformanceRow[], knownUrls: string[]): string[] {
  const observed = new Set(rows.map((r) => r.url));
  return knownUrls.filter((url) => !observed.has(url));
}

/**
 * Surface pages ranking well (low average position = higher in results) but
 * converting few impressions into clicks. This is a prompt to review title/
 * description appeal, not an assertion of a defect — there is no official
 * CTR target because CTR depends heavily on query intent and SERP features
 * (featured snippets, ads, etc.) outside the page's control.
 */
export function flagLowCtrAtGoodPosition(
  summaries: PageSearchSummary[],
  positionThreshold = 10,
  ctrFloor = 0.01
): PageSearchSummary[] {
  return summaries.filter(
    (s) =>
      s.average_position !== null &&
      s.ctr !== null &&
      s.average_position <= positionThreshold &&
      s.ctr < ctrFloor
  );
}
