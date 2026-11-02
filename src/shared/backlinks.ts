/**
 * Backlink monitoring contract shared by the worker and the UI.
 *
 * A monitor tracks one source page, one expected target, and a match mode.
 * Evidence is layered: fetching the source page is separate from whether a
 * matching link was found, which is separate from Google's own index
 * evidence (see src/shared/indexing.ts). A missing or inconclusive check
 * never silently becomes "removed" — see `FetchOutcome` and `Presence`.
 */

export const MATCH_MODES = ['exact_page', 'domain_wide'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MONITOR_STATUSES = ['active', 'paused', 'archived'] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

export const MONITOR_CADENCES = ['daily', 'weekly', 'monthly', 'manual'] as const;
export type MonitorCadence = (typeof MONITOR_CADENCES)[number];

/** Pending/unsuccessful/blocked are still active — only paused/archived release capacity. */
export const ACTIVE_MONITOR_STATUSES: MonitorStatus[] = ['active'];

export const FETCH_OUTCOMES = [
  'success', 'timeout', 'blocked', 'challenge', 'http_error', 'truncated', 'robots_disallowed', 'too_many_redirects', 'unsupported_content',
] as const;
export type FetchOutcome = (typeof FETCH_OUTCOMES)[number];

/** An outcome that cannot by itself prove a link was removed (spec: false-positive protection). */
export const INCONCLUSIVE_FETCH_OUTCOMES: FetchOutcome[] = ['timeout', 'blocked', 'challenge', 'http_error', 'truncated', 'robots_disallowed', 'too_many_redirects', 'unsupported_content'];

export const PRESENCE_STATES = ['present', 'absent', 'unknown'] as const;
export type Presence = (typeof PRESENCE_STATES)[number];

export const PRESENCE_METHODS = ['html', 'rendered'] as const;
export type PresenceMethod = (typeof PRESENCE_METHODS)[number];

/** confirmed: stands as the monitor's current state. pending_confirmation: a
 * suspected loss awaiting the second independent check. unconfirmed: an
 * inconclusive attempt that changed nothing. */
export const CONFIRMATION_STATES = ['confirmed', 'pending_confirmation', 'unconfirmed'] as const;
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

export const BACKLINK_EVENT_TYPES = [
  'loss_confirmed', 'recovered', 'anchor_changed', 'target_changed', 'rel_changed',
  'source_redirected', 'source_noindex_changed', 'target_broken', 'verification_pending',
] as const;
export type BacklinkEventType = (typeof BACKLINK_EVENT_TYPES)[number];

export interface BacklinkMonitor {
  id: string;
  websiteId: string;
  sourceUrl: string;
  expectedTargetUrl: string;
  matchMode: MatchMode;
  expectedAnchor: string | null;
  expectedRel: string[];
  notes: string | null;
  status: MonitorStatus;
  cadence: MonitorCadence;
  placementDate: string | null;
  nextCheckAt: string;
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastConfirmedPresence: Presence;
  lastConfirmedAt: string | null;
  confirmationDueAt: string | null;
  pendingConfirmationObservationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BacklinkOccurrence {
  id: string;
  observationId: string;
  originalHref: string;
  resolvedUrl: string;
  anchorText: string | null;
  imageAlt: string | null;
  relTokens: string[];
  elementKind: 'text' | 'image';
  matchesExpectedTarget: boolean;
  createdAt: string;
}

export interface BacklinkObservation {
  id: string;
  monitorId: string;
  attemptedAt: string;
  fetchOutcome: FetchOutcome;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: string[];
  contentType: string | null;
  presence: Presence;
  presenceMethod: PresenceMethod;
  confirmationState: ConfirmationState;
  targetStatusCode: number | null;
  targetFinalUrl: string | null;
  targetRedirectChain: string[];
  sourceMetaRobots: string | null;
  sourceXRobotsTag: string | null;
  sourceCanonical: string | null;
  errorMessage: string | null;
  occurrences: BacklinkOccurrence[];
  createdAt: string;
}

export interface BacklinkEvent {
  id: string;
  monitorId: string;
  eventType: BacklinkEventType;
  priorObservationId: string | null;
  newObservationId: string;
  confirmationState: ConfirmationState;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface BacklinkList {
  id: string;
  websiteId: string;
  name: string;
  description: string | null;
  enrollmentDefaults: { cadence?: MonitorCadence; matchMode?: MatchMode };
  monitorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BacklinkCapacity {
  limit: number;
  used: number;
  remaining: number;
}

export type ImportRowStatus = 'accepted' | 'duplicate' | 'invalid' | 'over_limit';

export interface BacklinkImportRowPreview {
  rowIndex: number;
  sourceUrl: string | null;
  targetUrl: string | null;
  expectedAnchor: string | null;
  expectedRel: string | null;
  notes: string | null;
  placementDate: string | null;
  status: ImportRowStatus;
  errorMessage: string | null;
}

export interface BacklinkImportPreview {
  importId: string;
  websiteId: string;
  status: 'previewed' | 'committed';
  acceptedCount: number;
  duplicateCount: number;
  invalidCount: number;
  overLimitCount: number;
  rows: BacklinkImportRowPreview[];
  createdAt: string;
  committedAt: string | null;
}

export type DiscoveryJobStatus = 'queued' | 'running' | 'complete' | 'unavailable' | 'failed';

export interface DiscoveryJobResult {
  id: string;
  websiteId: string;
  provider: string;
  status: DiscoveryJobStatus;
  budgetRequested: number;
  retrievedCount: number;
  uniqueCount: number;
  duplicateCount: number;
  reason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type CandidateEnrollmentStatus = 'pending' | 'enrolled' | 'dismissed';

export interface BacklinkCandidate {
  id: string;
  websiteId: string;
  sourceUrl: string;
  targetUrl: string | null;
  provider: string;
  providerLastSeenAt: string | null;
  importedAt: string;
  enrollmentStatus: CandidateEnrollmentStatus;
}

export interface BacklinkReportShare {
  id: string;
  listId: string;
  sharedToken: string;
  permissionScope: 'view';
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  viewCount: number;
}

/** A row the public, token-scoped share view may return. Private notes are never included. */
export interface SharedBacklinkRow {
  sourceUrl: string;
  targetUrl: string;
  matchMode: MatchMode;
  status: MonitorStatus;
  lastConfirmedPresence: Presence;
  lastConfirmedAt: string | null;
  lastSuccessfulCheckAt: string | null;
}
