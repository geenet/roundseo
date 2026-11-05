// Third-party API integrations
import type {
  PerformanceDevice,
  PerformanceDeviceResult,
  PerformanceMetric,
  PerformanceMetricRating,
  PerformanceOpportunity,
} from '../../shared/operating-model';

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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
