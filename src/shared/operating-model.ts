/**
 * Stable vocabulary shared by collection, persistence and presentation.
 * Values that have not been observed deliberately remain null with an
 * availability state; callers must never coerce them to a zero.
 */
export const EVIDENCE_KINDS = ['provider_reported', 'observed', 'sampled', 'inferred'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const AVAILABILITY_STATES = [
  'measured',
  'not_connected',
  'not_measured',
  'insufficient',
  'partial',
  'stale',
  'failed',
  'unsupported',
  'not_applicable',
] as const;
export type Availability = (typeof AVAILABILITY_STATES)[number];

export const ACTION_STATUSES = [
  'open',
  'planned',
  'in_progress',
  'awaiting_verification',
  'verified_resolved',
  'recurring',
  'ignored',
  'not_applicable',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export type MetricObservation = {
  metricKey: string;
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
  unit: string;
  statistic?: string;
  dimensions: Record<string, string>;
  source: string;
  evidenceKind: EvidenceKind;
  availability: Availability;
  periodStart?: string;
  periodEnd?: string;
  sourceTimezone?: string;
  fetchedAt: string;
  sampleSize?: number | null;
  methodVersion: string;
  configurationHash?: string;
  rawEvidenceRef?: string;
};

export type CrawlCoverage = {
  availability: Availability;
  inspectedPages: number;
  discoveredUrls: number;
  failedUrls: number;
  renderingRequiredPages: number;
  limitReached: boolean;
  method: 'http' | 'browser';
  scopeNote: string;
  attemptedUrls?: number;
  remainingUrls?: number;
  robotsExcludedUrls?: number;
  pendingUrls?: string[];
  sitemapStatus?: 'not_checked' | 'available' | 'unavailable' | 'partial';
  sitemapFiles?: number;
  sitemapUrls?: number;
  discoveryWarnings?: string[];
};

export type TechnicalHealth = {
  value: number | null;
  passedChecks: number;
  evaluatedChecks: number;
  expectedChecks: number;
  unknownChecks: number;
  ruleSetVersion: string;
};

export type CrawlJobMessage = {
  jobId: string;
  auditId: string;
  websiteId: string;
  websiteUrl: string;
  source: 'user' | 'schedule' | 'verification';
  /**
   * Deliberately optional so deliveries queued before this schema addition
   * still execute as a normal site crawl.
   */
  jobType?: 'site_crawl' | 'verification_crawl' | 'pagespeed_audit';
};

export const PERFORMANCE_DEVICES = ['mobile', 'desktop'] as const;
export type PerformanceDevice = (typeof PERFORMANCE_DEVICES)[number];

export type PerformanceMetricRating = 'good' | 'needs_improvement' | 'poor' | 'unknown';

/**
 * Performance is kept separate from crawl health. Lab values describe a
 * controlled PageSpeed/Lighthouse run; field values are provider-reported
 * Chrome UX Report data when the provider has enough real-user samples.
 */
export type PerformanceMetric = {
  key: 'fcp' | 'lcp' | 'cls' | 'inp' | 'tbt' | 'speed_index' | 'ttfb';
  label: string;
  value: number | null;
  unit: 'ms' | 'ratio';
  displayValue?: string;
  rating: PerformanceMetricRating;
  source: 'lab' | 'field';
};

export type PerformanceOpportunity = {
  key: string;
  title: string;
  estimatedSavingsMs: number | null;
  estimatedSavingsBytes: number | null;
  evidence?: Array<{ url: string; observed: string; recommendation: string }>;
};

export type PerformanceResource = {
  url: string;
  kind: string;
  status: number;
  transferredBytes: number | null;
  durationMs?: number;
  /** Arrival order observed by the browser for this page load. */
  sequence?: number;
  /** Milliseconds after the first recorded request in the page load. */
  startedAtMs?: number;
  hostname?: string;
  initiator?: string;
  cacheControl?: string;
  cacheStatus?: string;
  age?: string;
  contentEncoding?: string;
  thirdParty?: boolean;
};

export type PerformanceDeviceResult = {
  device: PerformanceDevice;
  availability: Availability;
  labScore: number | null;
  labMetrics: PerformanceMetric[];
  fieldMetrics: PerformanceMetric[];
  fieldDataAvailability: Availability;
  fieldDataScope: 'url' | 'origin' | 'none';
  opportunities: PerformanceOpportunity[];
  fetchedAt: string;
  error?: string;
  resources?: PerformanceResource[];
  /** Earliest observed responses, kept in arrival order rather than by size. */
  loadSequence?: PerformanceResource[];
  requests?: number;
  transferredBytes?: number;
  profile?: string;
};

export type PerformanceAudit = {
  targetUrl: string;
  provider: 'google_pagespeed_insights' | 'local_browser';
  providerLabel: string;
  availability: Availability;
  fetchedAt: string;
  methodVersion: string;
  devices: PerformanceDeviceResult[];
  error?: string;
  sourceNote?: string;
};

/** A same-site link observed in the live landing-page DOM before it was loaded. */
export type RealUserPageLoadingLink = {
  url: string;
  text: string;
  placement: 'main' | 'header' | 'footer' | 'other';
};

/** Delivery and caching signals collected from response headers during one page replay. */
export type RealUserDeliveryHost = {
  hostname: string;
  firstParty: boolean;
  requests: number;
  transferredBytes: number;
  cacheControl: string[];
  cacheStatus: string[];
  age: string[];
};

/** Structural browser observations that explain what had to load before a page could render. */
export type RealUserLoadStructure = {
  potentialBlockingScripts: Array<{
    url: string;
    location: 'head' | 'body';
    type: string | null;
    thirdParty: boolean;
  }>;
  inlineHeadScriptCount: number;
  headStylesheets: Array<{
    url: string;
    media: string | null;
    thirdParty: boolean;
  }>;
  deliveryHosts: RealUserDeliveryHost[];
};

/**
 * A controlled, cold-browser replay of a landing page and real same-site links
 * found in that landing page. It intentionally stays separate from field/RUM.
 */
export type RealUserPageLoadingPage = {
  url: string;
  role: 'landing' | 'linked';
  discoveredFrom?: RealUserPageLoadingLink;
  availability: Availability;
  fetchedAt: string;
  devices: PerformanceDeviceResult[];
  loadStructure?: RealUserLoadStructure;
  loadStructureDevice?: PerformanceDevice;
  error?: string;
};

export type RealUserPageLoadingAudit = {
  targetUrl: string;
  landingUrl: string;
  availability: Availability;
  fetchedAt: string;
  methodVersion: string;
  requestedLinkedPages: number;
  eligibleLinkedPages: number;
  pages: RealUserPageLoadingPage[];
  error?: string;
  sourceNote: string;
};

export type MeasurementDefinition = {
  metricKey: string;
  displayLabel: string;
  unit: string;
  sourceFamily: string;
  aggregationRule: string;
  supportedDimensions?: string[];
};

export const DETERMINISTIC_MEASUREMENT_DEFINITIONS: readonly MeasurementDefinition[] = [
  {
    metricKey: 'crawl.pages.inspected',
    displayLabel: 'Pages inspected',
    unit: 'pages',
    sourceFamily: 'roundseo_crawler',
    aggregationRule: 'count of successfully inspected page snapshots',
  },
  {
    metricKey: 'crawl.coverage',
    displayLabel: 'Crawl coverage',
    unit: 'ratio',
    sourceFamily: 'roundseo_crawler',
    aggregationRule: 'inspected URLs divided by discovered URLs within the declared crawl scope',
  },
  {
    metricKey: 'technical.health',
    displayLabel: 'Technical health',
    unit: 'percent',
    sourceFamily: 'roundseo_rules',
    aggregationRule: 'passed applicable deterministic check weight divided by evaluated applicable check weight',
  },
  ...(['ttfb', 'fcp', 'lcp', 'cls', 'tbt'] as const).map(key => ({
    metricKey: `performance.browser.${key}`,
    displayLabel: key === 'tbt' ? 'Long-task blocking during the sample' : `Browser sample ${key.toUpperCase()}`,
    unit: key === 'cls' ? 'ratio' : 'ms',
    sourceFamily: 'roundseo_browser',
    aggregationRule: 'Single controlled browser loading sample for the declared device and URL; not real-user data or a Lighthouse score',
    supportedDimensions: ['device', 'scope', 'target_url'],
  })),
  {
    metricKey: 'performance.lighthouse.score',
    displayLabel: 'PageSpeed lab performance score',
    unit: 'score',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported Lighthouse performance score for the declared device and target URL; never combined with crawl health',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.fcp',
    displayLabel: 'First Contentful Paint',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.lcp',
    displayLabel: 'Largest Contentful Paint',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.cls',
    displayLabel: 'Cumulative Layout Shift',
    unit: 'ratio',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.inp',
    displayLabel: 'Interaction to Next Paint',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.tbt',
    displayLabel: 'Total Blocking Time',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.speed_index',
    displayLabel: 'Speed Index',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.lighthouse.ttfb',
    displayLabel: 'Server response time',
    unit: 'ms',
    sourceFamily: 'google_pagespeed_insights',
    aggregationRule: 'provider-reported controlled lab measurement for the declared device and target URL',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.field.lcp',
    displayLabel: 'Real-user Largest Contentful Paint',
    unit: 'ms',
    sourceFamily: 'chrome_ux_report',
    aggregationRule: 'provider-reported real-user percentile for the declared URL or origin and device',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.field.inp',
    displayLabel: 'Real-user Interaction to Next Paint',
    unit: 'ms',
    sourceFamily: 'chrome_ux_report',
    aggregationRule: 'provider-reported real-user percentile for the declared URL or origin and device',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
  {
    metricKey: 'performance.field.cls',
    displayLabel: 'Real-user Cumulative Layout Shift',
    unit: 'ratio',
    sourceFamily: 'chrome_ux_report',
    aggregationRule: 'provider-reported real-user percentile for the declared URL or origin and device',
    supportedDimensions: ['device', 'scope', 'target_url'],
  },
] as const;
