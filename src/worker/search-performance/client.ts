// Search Console Search Analytics client. Every call uses one website's authorized token and
// one property; nothing here aggregates across websites or organizations.
import { API_ROW_LIMIT, MAX_API_PAGES } from './periods';

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export class SearchConsoleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SearchConsoleApiError';
  }
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  /** Empty means site-wide totals. */
  dimensions: string[];
}

function errorMessageFor(status: number): string {
  if (status === 401) return 'Google access was rejected. Reconnect this website.';
  if (status === 403) return 'Google denied access to this property. Check that the connected account can read it.';
  if (status === 429) return 'The Search Console rate limit was reached. Try again later.';
  return `Search Console returned an error (HTTP ${status}).`;
}

/**
 * Fetches every row for one query, paging with startRow. Stops at the page cap, which
 * bounds one sync to MAX_API_PAGES * API_ROW_LIMIT rows per dimension.
 */
export async function querySearchAnalytics(accessToken: string, property: string, query: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = [];
  const url = `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  for (let page = 0; page < MAX_API_PAGES; page += 1) {
    const body: Record<string, unknown> = {
      startDate: query.startDate,
      endDate: query.endDate,
      type: 'web',
      dataState: 'final',
      rowLimit: API_ROW_LIMIT,
      startRow: page * API_ROW_LIMIT,
    };
    if (query.dimensions.length) body.dimensions = query.dimensions;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SearchConsoleApiError('Search Console could not be reached. Try again later.', 0);
    }
    if (!response.ok) throw new SearchConsoleApiError(errorMessageFor(response.status), response.status);

    const payload = await response.json().catch(() => null) as { rows?: SearchAnalyticsRow[] } | null;
    const pageRows = Array.isArray(payload?.rows) ? payload!.rows! : [];
    rows.push(...pageRows);
    if (pageRows.length < API_ROW_LIMIT) break;
  }
  return rows;
}
