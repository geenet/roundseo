// Third-party API integrations
import { nanoid } from 'nanoid';
import type {
  Availability,
  PerformanceAudit,
  PerformanceDevice,
  PerformanceDeviceResult,
  PerformanceMetric,
  PerformanceMetricRating,
  PerformanceOpportunity,
} from '../../shared/operating-model';

export interface Integration {
  id: string;
  websiteId: string;
  type: 'google-search-console' | 'google-analytics' | 'google-pagespeed' | 'semrush' | 'ahrefs';
  status: 'active' | 'inactive' | 'error';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GSCData {
  property: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number }>;
}

export const PAGESPEED_METHOD_VERSION = 'pagespeed-insights-2026.10.1';

type PageSpeedFetchOptions = {
  devices?: PerformanceDevice[];
  /** Local preview may use the public endpoint without a configured key. */
  allowUnauthenticated?: boolean;
};

export async function addIntegration(
  db: any,
  websiteId: string,
  type: string,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: string
): Promise<Integration> {
  const id = `int_${nanoid(16)}`;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO integrations (
      id, website_id, type, status, access_token, refresh_token, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, type, 'active', accessToken, refreshToken, expiresAt, now, now).run();

  return {
    id,
    websiteId,
    type: type as any,
    status: 'active',
    accessToken,
    refreshToken,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getIntegration(db: any, websiteId: string, type: string): Promise<Integration | null> {
  const integration = await db.prepare(
    'SELECT * FROM integrations WHERE website_id = ? AND type = ?'
  ).bind(websiteId, type).first();

  return integration ? mapIntegrationRow(integration) : null;
}

export async function fetchGoogleSearchConsoleData(
  integration: Integration,
  _env: any,
  propertyUrl: string,
  days = 30
): Promise<GSCData | null> {
  try {
    if (!integration.accessToken) return null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // Fetch top queries
    const response = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(propertyUrl) + '/searchAnalytics/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${integration.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: since,
        endDate: today,
        dimensions: ['query'],
        rowLimit: 10,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const topQueries = data.rows?.map((row: any) => ({
      query: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    })) || [];

    // Calculate aggregates
    const totals = topQueries.reduce(
      (acc: any, q: any) => ({
        clicks: acc.clicks + q.clicks,
        impressions: acc.impressions + q.impressions,
      }),
      { clicks: 0, impressions: 0 }
    );

    return {
      property: propertyUrl,
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
      position: topQueries.length > 0 ? topQueries.reduce((sum: number, q: any) => sum + q.position, 0) / topQueries.length : 0,
      topQueries,
      topPages: [],
    };
  } catch (error) {
    console.error('Failed to fetch GSC data:', error);
    return null;
  }
}

/**
 * Fetch PageSpeed Insights separately for mobile and desktop. The prior
 * implementation made one request and copied the same result into both
 * device columns; that hid the most important difference for SEO triage.
 */
export async function fetchPageSpeedData(
  pageUrl: string,
  env: any,
  options: PageSpeedFetchOptions = {},
): Promise<PerformanceAudit> {
  const fetchedAt = new Date().toISOString();
  const devices: PerformanceDevice[] = options.devices?.length ? options.devices : ['mobile', 'desktop'];
  const apiKey = typeof env?.GOOGLE_PAGESPEED_API_KEY === 'string' && !env.GOOGLE_PAGESPEED_API_KEY.includes('YOUR_')
    ? env.GOOGLE_PAGESPEED_API_KEY
    : undefined;

  if (!apiKey && !options.allowUnauthenticated) {
    return unavailablePageSpeedAudit(pageUrl, fetchedAt, devices, 'PageSpeed Insights is not configured for this workspace.');
  }

  const results = await Promise.all(devices.map(async (device) => {
    const query = new URLSearchParams({
      url: pageUrl,
      strategy: device,
      category: 'PERFORMANCE',
    });
    if (apiKey) query.set('key', apiKey);
    try {
      const response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`, {
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const missingKey = !apiKey && (response.status === 400 || response.status === 403);
        return failedDeviceResult(device, fetchedAt, missingKey ? 'not_connected' : 'failed', pageSpeedErrorMessage(response.status, body));
      }
      return mapPageSpeedResponse(pageUrl, device, await response.json(), fetchedAt);
    } catch (error) {
      return failedDeviceResult(device, fetchedAt, 'failed', error instanceof Error ? error.message : 'PageSpeed Insights could not be reached.');
    }
  }));

  const availability = overallAvailability(results);
  return {
    targetUrl: pageUrl,
    provider: 'google_pagespeed_insights',
    providerLabel: 'Google PageSpeed Insights',
    availability,
    fetchedAt,
    methodVersion: PAGESPEED_METHOD_VERSION,
    devices: results,
    error: availability === 'failed' || availability === 'not_connected'
      ? Array.from(new Set(results.map(result => result.error).filter((error): error is string => Boolean(error)))).join(' ')
      : undefined,
  };
}

/** Pure mapper used by the worker and covered by unit tests. */
export function mapPageSpeedResponse(
  _targetUrl: string,
  device: PerformanceDevice,
  data: any,
  fetchedAt: string,
): PerformanceDeviceResult {
  const audits = data?.lighthouseResult?.audits || {};
  const rawScore = asNumber(data?.lighthouseResult?.categories?.performance?.score);
  const labScore = rawScore === null ? null : Math.round(rawScore * 100);
  const labMetrics = [
    labMetric('fcp', 'First Contentful Paint', audits['first-contentful-paint'], 'ms'),
    labMetric('lcp', 'Largest Contentful Paint', audits['largest-contentful-paint'], 'ms'),
    labMetric('cls', 'Cumulative Layout Shift', audits['cumulative-layout-shift'], 'ratio'),
    labMetric('inp', 'Interaction to Next Paint', audits['interaction-to-next-paint'], 'ms'),
    labMetric('tbt', 'Total Blocking Time', audits['total-blocking-time'], 'ms'),
    labMetric('speed_index', 'Speed Index', audits['speed-index'], 'ms'),
    labMetric('ttfb', 'Server response time', audits['server-response-time'], 'ms'),
  ].filter((metric): metric is PerformanceMetric => metric !== null);
  const field = data?.loadingExperience?.metrics && Object.keys(data.loadingExperience.metrics).length
    ? { metrics: data.loadingExperience.metrics, scope: 'url' as const }
    : data?.originLoadingExperience?.metrics && Object.keys(data.originLoadingExperience.metrics).length
      ? { metrics: data.originLoadingExperience.metrics, scope: 'origin' as const }
      : null;
  const fieldMetrics = field ? [
    fieldMetric('lcp', 'Largest Contentful Paint', field.metrics.LARGEST_CONTENTFUL_PAINT_MS, 'ms'),
    fieldMetric('inp', 'Interaction to Next Paint', field.metrics.INTERACTION_TO_NEXT_PAINT, 'ms'),
    fieldMetric('cls', 'Cumulative Layout Shift', field.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE, 'ratio'),
  ].filter((metric): metric is PerformanceMetric => metric !== null) : [];

  return {
    device,
    availability: labScore !== null || labMetrics.length ? 'measured' : 'not_measured',
    labScore,
    labMetrics,
    fieldMetrics,
    fieldDataAvailability: fieldMetrics.length ? 'measured' : 'not_measured',
    fieldDataScope: field?.scope || 'none',
    opportunities: mapOpportunities(audits),
    fetchedAt,
  };
}

function unavailablePageSpeedAudit(pageUrl: string, fetchedAt: string, devices: PerformanceDevice[], error: string): PerformanceAudit {
  return {
    targetUrl: pageUrl,
    provider: 'google_pagespeed_insights',
    providerLabel: 'Google PageSpeed Insights',
    availability: 'not_connected',
    fetchedAt,
    methodVersion: PAGESPEED_METHOD_VERSION,
    devices: devices.map(device => failedDeviceResult(device, fetchedAt, 'not_connected', error)),
    error,
  };
}

function failedDeviceResult(device: PerformanceDevice, fetchedAt: string, availability: Availability, error: string): PerformanceDeviceResult {
  return {
    device,
    availability,
    labScore: null,
    labMetrics: [],
    fieldMetrics: [],
    fieldDataAvailability: availability === 'failed' ? 'failed' : 'not_measured',
    fieldDataScope: 'none',
    opportunities: [],
    fetchedAt,
    error,
  };
}

function labMetric(key: PerformanceMetric['key'], label: string, audit: any, unit: PerformanceMetric['unit']): PerformanceMetric | null {
  const value = asNumber(audit?.numericValue);
  if (value === null) return null;
  return {
    key,
    label,
    value,
    unit,
    displayValue: typeof audit?.displayValue === 'string' ? audit.displayValue : undefined,
    rating: ratingForMetric(key, value),
    source: 'lab',
  };
}

function fieldMetric(key: PerformanceMetric['key'], label: string, metric: any, unit: PerformanceMetric['unit']): PerformanceMetric | null {
  const percentile = asNumber(metric?.percentile);
  if (percentile === null) return null;
  // PageSpeed's field CLS percentile is stored in hundredths; the other field
  // metrics are milliseconds. Keeping the canonical ratio avoids a fake 2.00
  // CLS value when the provider means 0.02.
  const value = key === 'cls' ? percentile / 100 : percentile;
  return {
    key,
    label,
    value,
    unit,
    rating: ratingForFieldCategory(metric?.category),
    source: 'field',
  };
}

function mapOpportunities(audits: Record<string, any>): PerformanceOpportunity[] {
  return Object.entries(audits)
    .filter(([, audit]) => audit?.details?.type === 'opportunity')
    .map(([key, audit]) => ({
      key,
      title: typeof audit?.title === 'string' ? audit.title : key.replace(/-/g, ' '),
      estimatedSavingsMs: asNumber(audit?.details?.overallSavingsMs) ?? asNumber(audit?.numericValue),
      estimatedSavingsBytes: asNumber(audit?.details?.overallSavingsBytes),
    }))
    .filter(opportunity => opportunity.estimatedSavingsMs !== null || opportunity.estimatedSavingsBytes !== null)
    .sort((a, b) => (b.estimatedSavingsMs || 0) - (a.estimatedSavingsMs || 0))
    .slice(0, 6);
}

function ratingForMetric(key: PerformanceMetric['key'], value: number): PerformanceMetricRating {
  const limits: Partial<Record<PerformanceMetric['key'], [number, number]>> = {
    fcp: [1800, 3000],
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    inp: [200, 500],
    tbt: [200, 600],
    speed_index: [3400, 5800],
    ttfb: [800, 1800],
  };
  const limit = limits[key];
  if (!limit) return 'unknown';
  return value <= limit[0] ? 'good' : value <= limit[1] ? 'needs_improvement' : 'poor';
}

function ratingForFieldCategory(category: unknown): PerformanceMetricRating {
  return category === 'FAST' ? 'good' : category === 'AVERAGE' ? 'needs_improvement' : category === 'SLOW' ? 'poor' : 'unknown';
}

function overallAvailability(results: PerformanceDeviceResult[]): Availability {
  if (results.some(result => result.availability === 'measured')) return results.every(result => result.availability === 'measured') ? 'measured' : 'partial';
  if (results.some(result => result.availability === 'not_connected')) return 'not_connected';
  if (results.some(result => result.availability === 'failed')) return 'failed';
  return 'not_measured';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pageSpeedErrorMessage(status: number, body: string): string {
  if (/quota exceeded/i.test(body)) {
    return 'PageSpeed Insights quota is unavailable right now. Add a configured API key or try again later.';
  }
  if (/api key|key.*required/i.test(body)) {
    return 'PageSpeed Insights needs a configured API key before it can measure this site.';
  }
  const providerMessage = body.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  return providerMessage || `PageSpeed Insights returned HTTP ${status}.`;
}

export async function syncGSCData(
  db: any,
  websiteId: string,
  integration: Integration,
  env: any,
  propertyUrl: string
): Promise<void> {
  try {
    const data = await fetchGoogleSearchConsoleData(integration, env, propertyUrl);
    if (!data) return;

    const now = new Date().toISOString();

    // Store GSC data snapshot
    await db.prepare(`
      INSERT INTO gsc_snapshots (
        id, website_id, property_url, clicks, impressions, ctr, avg_position, data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `gsc_${nanoid(16)}`,
      websiteId,
      propertyUrl,
      data.clicks,
      data.impressions,
      data.ctr,
      data.position,
      JSON.stringify(data),
      now
    ).run();

    // Update integration last sync
    await db.prepare('UPDATE integrations SET last_sync_at = ? WHERE id = ?')
      .bind(now, integration.id)
      .run();
  } catch (error) {
    console.error('Failed to sync GSC data:', error);
  }
}

function mapIntegrationRow(row: any): Integration {
  return {
    id: row.id,
    websiteId: row.website_id,
    type: row.type,
    status: row.status,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    lastSyncAt: row.last_sync_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
