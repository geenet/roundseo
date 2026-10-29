/**
 * Crawl Efficiency Metrics
 * Metrics: Crawl latency (publication to first crawl), Useful crawl %
 * (page requests vs infrastructure/asset requests), crawl budget utilization.
 *
 * Operates on a crawl log the caller supplies (e.g. from server access logs
 * filtered to verified Googlebot requests) — this module only computes
 * metrics, it doesn't fetch or verify crawler identity itself.
 */

import { pageInventory } from './inventory';
import type { PageInventory } from './types';

export interface CrawlLogEntry {
  url: string;
  crawled_at: string;
  resource_type: 'page' | 'asset' | 'other';
  http_status?: number;
}

/**
 * Days between a page's publication date and its first observed crawl.
 * Returns null if either date is missing/unparseable, or if no crawl of
 * this URL was found in the log — a missing entry means "not yet observed,"
 * not zero latency.
 */
export function calculateCrawlLatency(page: PageInventory, log: CrawlLogEntry[]): number | null {
  if (!page.publication_date) return null;

  const published = new Date(page.publication_date).getTime();
  if (isNaN(published)) return null;

  const crawlsOfPage = log
    .filter((e) => normalizePath(e.url) === normalizePath(page.url))
    .map((e) => new Date(e.crawled_at).getTime())
    .filter((t) => !isNaN(t));

  if (crawlsOfPage.length === 0) return null;

  const firstCrawl = Math.min(...crawlsOfPage);
  return Math.max(0, (firstCrawl - published) / (1000 * 60 * 60 * 24));
}

export interface CrawlErrorRate {
  total_requests: number;
  failing_requests: number;
  error_rate: number | null;
  /** True once error_rate crosses the 5% alert threshold Google's docs reference for crawl health */
  exceeds_alert_threshold: boolean;
}

const CRAWL_ERROR_ALERT_THRESHOLD = 0.05;

/**
 * TECH-004: monitor server health by tracking the share of crawl requests
 * that failed (5xx, 429, or an unresolved fetch). Alerts once failures
 * exceed 5% of requests in the log window — this is a server-health signal,
 * not a per-page eligibility check, so it's computed over the whole log
 * rather than per URL.
 */
export function calculateCrawlErrorRate(log: CrawlLogEntry[]): CrawlErrorRate {
  const total_requests = log.length;
  const failing_requests = log.filter(
    (e) => e.http_status !== undefined && (e.http_status >= 500 || e.http_status === 429 || e.http_status === 0)
  ).length;

  const error_rate = total_requests > 0 ? failing_requests / total_requests : null;

  return {
    total_requests,
    failing_requests,
    error_rate,
    exceeds_alert_threshold: error_rate !== null && error_rate > CRAWL_ERROR_ALERT_THRESHOLD,
  };
}

/**
 * Percentage of crawl requests that fetched an actual page, as opposed to
 * infrastructure/asset requests (CSS, JS, images, etc.). A low percentage
 * suggests crawl budget is being spent on supporting resources rather than
 * indexable content — informational, not a hard pass/fail threshold.
 */
export function calculateUsefulCrawlRatio(log: CrawlLogEntry[]): number | null {
  if (log.length === 0) return null;
  const pageRequests = log.filter((e) => e.resource_type === 'page').length;
  return pageRequests / log.length;
}

export interface CrawlEfficiencySummary {
  total_requests: number;
  page_requests: number;
  asset_requests: number;
  other_requests: number;
  useful_crawl_ratio: number | null;
  pages_with_latency_observed: number;
  average_latency_days: number | null;
  pages_never_crawled: string[];
}

/**
 * Summarize crawl efficiency across the whole inventory for a reporting
 * window.
 */
export function summarizeCrawlEfficiency(
  log: CrawlLogEntry[],
  inventory: PageInventory[] = pageInventory
): CrawlEfficiencySummary {
  const indexable = inventory.filter((p) => p.indexing_intent === 'index');
  const latencies: number[] = [];
  const neverCrawled: string[] = [];

  for (const page of indexable) {
    const latency = calculateCrawlLatency(page, log);
    if (latency === null) {
      const hasAnyCrawl = log.some((e) => normalizePath(e.url) === normalizePath(page.url));
      if (!hasAnyCrawl) neverCrawled.push(page.url);
    } else {
      latencies.push(latency);
    }
  }

  return {
    total_requests: log.length,
    page_requests: log.filter((e) => e.resource_type === 'page').length,
    asset_requests: log.filter((e) => e.resource_type === 'asset').length,
    other_requests: log.filter((e) => e.resource_type === 'other').length,
    useful_crawl_ratio: calculateUsefulCrawlRatio(log),
    pages_with_latency_observed: latencies.length,
    average_latency_days: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    pages_never_crawled: neverCrawled,
  };
}

function normalizePath(url: string): string {
  try {
    return new URL(url, 'https://placeholder.invalid').pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}
