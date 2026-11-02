/**
 * Indexing contract shared by the worker and the UI.
 *
 * Four separate facts, never merged into one status: (1) a source page
 * contains a link, (2) the page's current technical configuration looks
 * indexable, (3) Google reports it indexed (authorized inspection), and
 * (4) RoundSEO asked a search engine to look (a submission or notification).
 * Accepting a submission is never translated into an indexed verdict.
 */

export const GOOGLE_CONNECTION_STATUSES = ['connected', 'needs_reauth', 'error'] as const;
export type GoogleConnectionStatus = (typeof GOOGLE_CONNECTION_STATUSES)[number];

export const PROPERTY_TYPES = ['domain', 'url_prefix'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Read-only Search Console access. Sitemap submission needs the incremental write scope below. */
export const GSC_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GSC_WRITE_SCOPE = 'https://www.googleapis.com/auth/webmasters';

export interface GoogleConnection {
  id: string;
  websiteId: string;
  googleAccountEmail: string;
  grantedScopes: string[];
  selectedProperty: string | null;
  propertyType: PropertyType | null;
  status: GoogleConnectionStatus;
  lastError: string | null;
  canSubmitSitemaps: boolean;
  createdAt: string;
  updatedAt: string;
}

export const INVENTORY_SOURCES = ['crawl', 'sitemap', 'priority', 'manual'] as const;
export type InventorySource = (typeof INVENTORY_SOURCES)[number];

export interface IndexingInventoryItem {
  id: string;
  websiteId: string;
  url: string;
  intendedIndexed: boolean;
  isPriority: boolean;
  source: InventorySource;
  firstSeenAt: string;
  lastSeenAt: string;
  latestObservation: IndexObservation | null;
}

export const EVIDENCE_METHODS = ['authorized_inspection', 'external_search', 'crawl_directives', 'unavailable'] as const;
export type IndexEvidenceMethod = (typeof EVIDENCE_METHODS)[number];

export const INDEX_VERDICTS = ['indexed', 'not_indexed', 'unknown'] as const;
export type IndexVerdict = (typeof INDEX_VERDICTS)[number];

export interface IndexObservation {
  id: string;
  inventoryId: string;
  evidenceMethod: IndexEvidenceMethod;
  verdict: IndexVerdict;
  /** Google's own coverage reason string (e.g. "Crawled - currently not indexed"), when reported. */
  coverageReason: string | null;
  /** Google's last crawl time for this URL. Distinct from checkedAt, which is when RoundSEO called the API. */
  googleCrawlTime: string | null;
  declaredCanonical: string | null;
  selectedCanonical: string | null;
  sitemapRefs: string[];
  inspectionResultLink: string | null;
  checkedAt: string;
}

export const INSPECTION_JOB_REASONS = ['priority', 'rotation', 'manual'] as const;
export type InspectionJobReason = (typeof INSPECTION_JOB_REASONS)[number];

export interface InspectionJob {
  id: string;
  websiteId: string;
  inventoryId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  reason: InspectionJobReason;
  requestedAt: string;
  completedAt: string | null;
  resultObservationId: string | null;
  errorMessage: string | null;
}

export interface IndexingCoverage {
  /** Pages RoundSEO intends to be indexed (excludes intentional noindex/redirect/canonicalized-away pages). */
  intendedCount: number;
  inspectedCount: number;
  indexedCount: number;
  notIndexedCount: number;
  uninspectedCount: number;
  /** Null, not 0, when inspectedCount is 0 — a 0% rate on no evidence is misleading. */
  indexedShareOfInspected: number | null;
  quota: { limit: number; used: number; resetAt: string };
}

export const INDEXING_ACTION_TYPES = [
  'inspect', 'sitemap_submit', 'search_console_handoff', 'indexnow_notify', 'google_indexing_api_notify', 'publisher_follow_up',
] as const;
export type IndexingActionType = (typeof INDEXING_ACTION_TYPES)[number];

export const SUBMISSION_STATES = ['submitted', 'accepted', 'failed', 'not_applicable'] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export interface IndexingAction {
  id: string;
  websiteId: string;
  actionType: IndexingActionType;
  targetUrl: string | null;
  targetSitemap: string | null;
  submissionState: SubmissionState;
  outcomeEvidence: Record<string, unknown>;
  createdAt: string;
}

/** A provider adapter's availability, in the same shape the Intelligence platform already uses for unconfigured sources. */
export interface AdapterAvailability {
  available: boolean;
  reason: string | null;
}
