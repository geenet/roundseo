/**
 * Core Web Vitals Evaluation
 * Metric: Core Web Vitals — p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 (official thresholds).
 *
 * Google rates each metric on a three-tier scale (good / needs improvement /
 * poor), not a binary pass/fail — this mirrors that rating system rather
 * than collapsing it to a single number. Field data (CrUX, real users) is
 * the authoritative signal; lab data (Lighthouse) is diagnostic only.
 *
 * https://web.dev/articles/vitals
 */

export type VitalRating = 'good' | 'needs_improvement' | 'poor' | 'unknown';

export interface CoreWebVitalsSample {
  /** Largest Contentful Paint, in milliseconds */
  lcp_ms?: number;
  /** Interaction to Next Paint, in milliseconds */
  inp_ms?: number;
  /** Cumulative Layout Shift, unitless */
  cls?: number;
  /** 'field' = real-user CrUX data (authoritative); 'lab' = synthetic (diagnostic only) */
  scope: 'field' | 'lab';
  /** Percentile represented, e.g. 75 for CrUX p75 */
  percentile?: number;
  measured_at?: string;
}

const THRESHOLDS = {
  lcp_ms: { good: 2_500, needsImprovement: 4_000 },
  inp_ms: { good: 200, needsImprovement: 500 },
  cls: { good: 0.1, needsImprovement: 0.25 },
};

function rate(value: number | undefined, thresholds: { good: number; needsImprovement: number }): VitalRating {
  if (value === undefined) return 'unknown';
  if (value <= thresholds.good) return 'good';
  if (value <= thresholds.needsImprovement) return 'needs_improvement';
  return 'poor';
}

export interface CoreWebVitalsRating {
  lcp: VitalRating;
  inp: VitalRating;
  cls: VitalRating;
}

/**
 * Rate each metric independently against Google's published thresholds.
 */
export function evaluateCoreWebVitals(sample: CoreWebVitalsSample): CoreWebVitalsRating {
  return {
    lcp: rate(sample.lcp_ms, THRESHOLDS.lcp_ms),
    inp: rate(sample.inp_ms, THRESHOLDS.inp_ms),
    cls: rate(sample.cls, THRESHOLDS.cls),
  };
}

/**
 * A page "passes" Core Web Vitals only when all three metrics rate 'good' —
 * this is Google's own bar for the CWV assessment, not a project invention.
 * Returns false if any metric is unrated ('unknown') rather than assuming pass.
 */
export function isCoreWebVitalsPassing(sample: CoreWebVitalsSample): boolean {
  const rating = evaluateCoreWebVitals(sample);
  return rating.lcp === 'good' && rating.inp === 'good' && rating.cls === 'good';
}

/**
 * Build a human-readable summary of which metrics are driving a failing
 * assessment, for use in findings/reports.
 */
export function describeFailingVitals(sample: CoreWebVitalsSample): string[] {
  const rating = evaluateCoreWebVitals(sample);
  const failing: string[] = [];

  if (rating.lcp === 'poor' || rating.lcp === 'needs_improvement') {
    failing.push(`LCP is ${formatMs(sample.lcp_ms)} (threshold: ≤2.5s good).`);
  }
  if (rating.inp === 'poor' || rating.inp === 'needs_improvement') {
    failing.push(`INP is ${formatMsAsMs(sample.inp_ms)} (threshold: ≤200ms good).`);
  }
  if (rating.cls === 'poor' || rating.cls === 'needs_improvement') {
    failing.push(`CLS is ${sample.cls} (threshold: ≤0.1 good).`);
  }

  return failing;
}

function formatMs(value: number | undefined): string {
  if (value === undefined) return 'unmeasured';
  return `${(value / 1000).toFixed(2)}s`;
}

function formatMsAsMs(value: number | undefined): string {
  if (value === undefined) return 'unmeasured';
  return `${Math.round(value)}ms`;
}

/**
 * Field data should always be preferred over lab data for eligibility
 * decisions. Lab data without a corresponding field sample is a diagnostic
 * signal only (e.g. CrUX requires 28+ days of sufficient traffic).
 */
export function isAuthoritative(sample: CoreWebVitalsSample): boolean {
  return sample.scope === 'field';
}
