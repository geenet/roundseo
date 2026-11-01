import { nanoid } from 'nanoid';

type Database = any;

export type IntelligenceRunStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'cancelled';

export interface IntelligenceRunRecord {
  id: string;
  websiteId: string;
  userId: string;
  capability: string;
  action: string;
  status: IntelligenceRunStatus;
  statusMessage: string;
  idempotencyKey: string | null;
  request: unknown;
  summary: unknown | null;
  /** Internal pointer to the fully staged evidence snapshot visible to readers. */
  evidenceVersion: string;
  source: unknown | null;
  coverage: unknown | null;
  unavailable: unknown[];
  progressCompleted: number;
  progressTotal: number | null;
  attempts: number;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  parentRunId: string | null;
  checkedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  error: { code: string | null; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceEvidenceRecord<T = unknown> {
  id: string;
  runId: string;
  websiteId: string;
  capability: string;
  kind: string;
  identityKey: string;
  payload: T;
  observedAt: string;
  createdAt: string;
}

export interface CreateIntelligenceRunInput {
  id?: string;
  websiteId: string;
  userId: string;
  capability: string;
  action: string;
  request: unknown;
  status?: IntelligenceRunStatus;
  statusMessage?: string;
  idempotencyKey?: string | null;
  parentRunId?: string | null;
  progressTotal?: number | null;
  startedAt?: string;
}

export interface UpdateIntelligenceRunInput {
  action?: string;
  status?: IntelligenceRunStatus;
  statusMessage?: string;
  summary?: unknown | null;
  source?: unknown | null;
  coverage?: unknown | null;
  unavailable?: unknown[];
  progressCompleted?: number;
  progressTotal?: number | null;
  attempts?: number;
  leaseExpiresAt?: string | null;
  cancelRequestedAt?: string | null;
  checkedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface IntelligenceEvidenceInput<T = unknown> {
  kind: string;
  identityKey: string;
  payload: T;
  observedAt?: string;
}

export const MAX_EVIDENCE_PER_RUN = 2_000;

export async function createIntelligenceRun(db: Database, input: CreateIntelligenceRunInput): Promise<IntelligenceRunRecord> {
  if (input.idempotencyKey) {
    const existing = await getIntelligenceRunByIdempotency(db, input.websiteId, input.idempotencyKey);
    if (existing) return existing;
  }

  const now = input.startedAt || new Date().toISOString();
  const id = input.id || `intelligence_run_${nanoid(16)}`;
  try {
    await db.prepare(`
      INSERT INTO intelligence_runs (
        id, website_id, user_id, capability, action, status, status_message,
        idempotency_key, request_json, progress_total, parent_run_id, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      input.websiteId,
      input.userId,
      requiredText(input.capability, 'Capability'),
      requiredText(input.action, 'Action'),
      input.status || 'queued',
      input.statusMessage || 'Queued for processing.',
      input.idempotencyKey || null,
      JSON.stringify(input.request ?? null),
      input.progressTotal ?? null,
      input.parentRunId ?? null,
      now,
      now,
      now,
    ).run();
  } catch (error) {
    if (input.idempotencyKey) {
      const existing = await getIntelligenceRunByIdempotency(db, input.websiteId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw error;
  }

  const created = await getIntelligenceRun(db, input.websiteId, id);
  if (!created) throw new Error('The intelligence run could not be persisted.');
  return created;
}

export async function updateIntelligenceRun(
  db: Database,
  websiteId: string,
  runId: string,
  update: UpdateIntelligenceRunInput,
): Promise<IntelligenceRunRecord | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => { assignments.push(`${column} = ?`); values.push(value); };

  if ('action' in update) set('action', update.action);
  if ('status' in update) set('status', update.status);
  if ('statusMessage' in update) set('status_message', update.statusMessage);
  if ('summary' in update) set('summary_json', update.summary === null ? null : JSON.stringify(update.summary));
  if ('source' in update) set('source_json', update.source === null ? null : JSON.stringify(update.source));
  if ('coverage' in update) set('coverage_json', update.coverage === null ? null : JSON.stringify(update.coverage));
  if ('unavailable' in update) set('unavailable_json', JSON.stringify(update.unavailable ?? []));
  if ('progressCompleted' in update) set('progress_completed', update.progressCompleted);
  if ('progressTotal' in update) set('progress_total', update.progressTotal);
  if ('attempts' in update) set('attempts', update.attempts);
  if ('leaseExpiresAt' in update) set('lease_expires_at', update.leaseExpiresAt);
  if ('cancelRequestedAt' in update) set('cancel_requested_at', update.cancelRequestedAt);
  if ('checkedAt' in update) set('checked_at', update.checkedAt);
  if ('startedAt' in update) set('started_at', update.startedAt);
  if ('completedAt' in update) set('completed_at', update.completedAt);
  if ('errorCode' in update) set('error_code', update.errorCode);
  if ('errorMessage' in update) set('error_message', update.errorMessage);
  const now = new Date().toISOString();
  set('updated_at', now);
  set('updated_progress_at', now);

  await db.prepare(`
    UPDATE intelligence_runs
    SET ${assignments.join(', ')}
    WHERE id = ? AND website_id = ?
  `).bind(...values, runId, websiteId).run();
  return getIntelligenceRun(db, websiteId, runId);
}

export async function getIntelligenceRun(db: Database, websiteId: string, runId: string): Promise<IntelligenceRunRecord | null> {
  const row = await db.prepare(`
    SELECT * FROM intelligence_runs
    WHERE id = ? AND website_id = ?
    LIMIT 1
  `).bind(runId, websiteId).first();
  return row ? mapRun(row) : null;
}

export async function getIntelligenceRunByIdempotency(db: Database, websiteId: string, idempotencyKey: string): Promise<IntelligenceRunRecord | null> {
  const row = await db.prepare(`
    SELECT * FROM intelligence_runs
    WHERE website_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(websiteId, idempotencyKey).first();
  return row ? mapRun(row) : null;
}

export async function listIntelligenceRuns(
  db: Database,
  websiteId: string,
  options: { capability?: string; status?: IntelligenceRunStatus; limit?: number; offset?: number } = {},
): Promise<IntelligenceRunRecord[]> {
  const where = ['website_id = ?'];
  const values: unknown[] = [websiteId];
  if (options.capability) { where.push('capability = ?'); values.push(options.capability); }
  if (options.status) { where.push('status = ?'); values.push(options.status); }
  const limit = boundedInteger(options.limit ?? 50, 1, 200);
  const offset = boundedInteger(options.offset ?? 0, 0, 100_000);
  const result = await db.prepare(`
    SELECT * FROM intelligence_runs
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).bind(...values, limit, offset).all();
  return resultRows(result).map(mapRun);
}

/**
 * Take the lease on a queued or running run. Only one worker holds a lease at a
 * time; an expired lease can be taken over, which is how crashed jobs resume.
 */
export async function claimIntelligenceRun(db: Database, runId: string, leaseSeconds: number, now = new Date()): Promise<IntelligenceRunRecord | null> {
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const result = await db.prepare(`
    UPDATE intelligence_runs
    SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, updated_at = ?,
        started_at = COALESCE(started_at, ?)
    WHERE id = ?
      AND status IN ('queued', 'running')
      AND (lease_expires_at IS NULL OR lease_expires_at < ?)
  `).bind(lease, nowIso, nowIso, runId, nowIso).run();
  if (Number(result?.meta?.changes ?? 0) !== 1) return null;
  const row = await db.prepare('SELECT * FROM intelligence_runs WHERE id = ? LIMIT 1').bind(runId).first();
  return row ? mapRun(row) : null;
}

/** Queued or running crawl runs whose lease has lapsed, for the scheduled recovery pass. */
export async function listStaleIntelligenceRuns(db: Database, now: string, limit = 25): Promise<Array<{ id: string; websiteId: string }>> {
  const result = await db.prepare(`
    SELECT id, website_id FROM intelligence_runs
    WHERE status IN ('queued', 'running')
      AND action IN ('site_crawl', 'site_crawl_refresh')
      AND (lease_expires_at IS NULL OR lease_expires_at < ?)
    ORDER BY updated_at ASC
    LIMIT ?
  `).bind(now, limit).all();
  return resultRows(result).map(row => ({ id: String(row.id), websiteId: String(row.website_id) }));
}

/**
 * Append evidence to the run's currently visible snapshot. Used by incremental
 * crawls, where a whole-snapshot replacement would rewrite every page each batch.
 */
export async function appendIntelligenceEvidence<T = unknown>(
  db: Database,
  websiteId: string,
  runId: string,
  evidence: IntelligenceEvidenceInput<T>[],
): Promise<void> {
  const run = await getIntelligenceRun(db, websiteId, runId);
  if (!run) throw new Error('The intelligence run does not belong to this website.');
  const existing = await countIntelligenceEvidence(db, websiteId, runId);
  if (existing + evidence.length > MAX_EVIDENCE_PER_RUN) throw new Error(`One intelligence run can persist at most ${MAX_EVIDENCE_PER_RUN} evidence records.`);
  const createdAt = new Date().toISOString();
  for (const [index, item] of evidence.entries()) {
    await db.prepare(`
      INSERT OR IGNORE INTO intelligence_evidence (
        id, run_id, website_id, capability, evidence_kind,
        identity_key, evidence_version, payload_json, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `intelligence_evidence_${nanoid(16)}`,
      runId,
      websiteId,
      run.capability,
      requiredText(item.kind, 'Evidence kind'),
      item.identityKey.trim() || `${item.kind}:${index}`,
      run.evidenceVersion,
      JSON.stringify(item.payload ?? null),
      item.observedAt || createdAt,
      createdAt,
    ).run();
  }
}

export async function countIntelligenceEvidence(db: Database, websiteId: string, runId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM intelligence_evidence evidence
    JOIN intelligence_runs run ON run.id = evidence.run_id AND run.website_id = evidence.website_id
    WHERE evidence.website_id = ? AND evidence.run_id = ? AND evidence.evidence_version = run.evidence_version
  `).bind(websiteId, runId).first();
  return Number(row?.total ?? 0);
}

export async function replaceIntelligenceEvidence<T = unknown>(
  db: Database,
  websiteId: string,
  runId: string,
  evidence: IntelligenceEvidenceInput<T>[],
): Promise<IntelligenceEvidenceRecord<T>[]> {
  const run = await getIntelligenceRun(db, websiteId, runId);
  if (!run) throw new Error('The intelligence run does not belong to this website.');
  if (evidence.length > MAX_EVIDENCE_PER_RUN) throw new Error(`One intelligence run can persist at most ${MAX_EVIDENCE_PER_RUN} evidence records.`);

  const createdAt = new Date().toISOString();
  const nextVersion = `evidence_version_${nanoid(16)}`;
  try {
    // Stage the complete next snapshot under an invisible version. Readers
    // continue to follow intelligence_runs.evidence_version until every row
    // has been written successfully.
    for (const [index, item] of evidence.entries()) {
      await db.prepare(`
        INSERT INTO intelligence_evidence (
          id, run_id, website_id, capability, evidence_kind,
          identity_key, evidence_version, payload_json, observed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `intelligence_evidence_${nanoid(16)}`,
        runId,
        websiteId,
        run.capability,
        requiredText(item.kind, 'Evidence kind'),
        item.identityKey.trim() || `${item.kind}:${index}`,
        nextVersion,
        JSON.stringify(item.payload ?? null),
        item.observedAt || run.completedAt || createdAt,
        createdAt,
      ).run();
    }
  } catch (error) {
    await discardEvidenceVersion(db, websiteId, runId, nextVersion);
    throw error;
  }

  const activated = await db.prepare(`
    UPDATE intelligence_runs
    SET evidence_version = ?, updated_at = ?
    WHERE id = ? AND website_id = ? AND evidence_version = ?
  `).bind(nextVersion, createdAt, runId, websiteId, run.evidenceVersion).run();
  if (activated?.success === false || Number(activated?.meta?.changes ?? 1) !== 1) {
    await discardEvidenceVersion(db, websiteId, runId, nextVersion);
    throw new Error('The intelligence evidence changed concurrently; retry the replacement.');
  }

  // Old snapshots are no longer visible after the pointer switch. Cleanup is
  // best-effort so a housekeeping failure cannot turn a committed snapshot
  // into a reported write failure.
  try {
    await db.prepare(`
      DELETE FROM intelligence_evidence
      WHERE run_id = ? AND website_id = ? AND evidence_version <> ?
    `).bind(runId, websiteId, nextVersion).run();
  } catch { /* A later replacement can clean obsolete versions. */ }

  if (!evidence.length) return [];
  return listIntelligenceEvidence<T>(db, websiteId, { runId, limit: evidence.length });
}

export async function listIntelligenceEvidence<T = unknown>(
  db: Database,
  websiteId: string,
  options: { runId?: string; capability?: string; kind?: string; limit?: number; offset?: number } = {},
): Promise<IntelligenceEvidenceRecord<T>[]> {
  const where = ['evidence.website_id = ?', 'evidence.evidence_version = run.evidence_version'];
  const values: unknown[] = [websiteId];
  if (options.runId) { where.push('evidence.run_id = ?'); values.push(options.runId); }
  if (options.capability) { where.push('evidence.capability = ?'); values.push(options.capability); }
  if (options.kind) { where.push('evidence.evidence_kind = ?'); values.push(options.kind); }
  const limit = boundedInteger(options.limit ?? 100, 1, 1_000);
  const offset = boundedInteger(options.offset ?? 0, 0, 100_000);
  const result = await db.prepare(`
    SELECT evidence.*
    FROM intelligence_evidence evidence
    JOIN intelligence_runs run
      ON run.id = evidence.run_id AND run.website_id = evidence.website_id
    WHERE ${where.join(' AND ')}
    ORDER BY evidence.observed_at DESC, evidence.created_at DESC, evidence.id DESC
    LIMIT ? OFFSET ?
  `).bind(...values, limit, offset).all();
  return resultRows(result).map(row => mapEvidence<T>(row));
}

/** Count live requests against the website's daily ceiling. Returns false when the ceiling would be exceeded. */
export async function consumeLiveRequests(db: Database, websiteId: string, units: number, limit: number, now = new Date()): Promise<boolean> {
  const bucket = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const result = await db.prepare(`
    INSERT INTO intelligence_request_windows (website_id, bucket, request_count, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(website_id, bucket) DO UPDATE SET
      request_count = intelligence_request_windows.request_count + excluded.request_count,
      updated_at = excluded.updated_at
    WHERE intelligence_request_windows.request_count + excluded.request_count <= ?
  `).bind(websiteId, bucket, units, nowIso, limit).run();
  return Number(result?.meta?.changes ?? 0) === 1;
}

export interface ObservationInput {
  runId: string;
  surface: string;
  countryCode: string;
  languageCode: string;
  device: string;
  query: string;
  position: number;
  feature: string;
  domain: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
  observedAt: string;
}

export async function insertIntelligenceObservations(db: Database, websiteId: string, rows: ObservationInput[]): Promise<void> {
  const createdAt = new Date().toISOString();
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO intelligence_observations (
        id, website_id, run_id, surface, country_code, language_code, device,
        query_key, query, position, feature, domain, url, title, description, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `intelligence_observation_${nanoid(16)}`,
      websiteId,
      row.runId,
      row.surface,
      row.countryCode,
      row.languageCode,
      row.device,
      row.query.trim().toLowerCase(),
      row.query,
      row.position,
      row.feature,
      row.domain,
      row.url,
      row.title,
      row.description,
      row.observedAt,
      createdAt,
    ).run();
  }
}

export interface ObservationRecord {
  query: string;
  queryKey: string;
  surface: string;
  countryCode: string;
  position: number;
  domain: string | null;
  url: string | null;
  observedAt: string;
}

/** Recent SERP observations in one market, newest first, bounded for analysis. */
export async function listIntelligenceObservations(db: Database, websiteId: string, countryCode: string, limit = 5_000): Promise<ObservationRecord[]> {
  const result = await db.prepare(`
    SELECT query, query_key, surface, country_code, position, domain, url, observed_at
    FROM intelligence_observations
    WHERE website_id = ? AND country_code = ? AND surface IN ('google', 'bing', 'youtube', 'google_ai', 'google_maps')
    ORDER BY observed_at DESC
    LIMIT ?
  `).bind(websiteId, countryCode, boundedInteger(limit, 1, 20_000)).all();
  return resultRows(result).map(row => ({
    query: String(row.query),
    queryKey: String(row.query_key),
    surface: String(row.surface),
    countryCode: String(row.country_code),
    position: Number(row.position),
    domain: row.domain ? String(row.domain) : null,
    url: row.url ? String(row.url) : null,
    observedAt: String(row.observed_at),
  }));
}

export interface KeywordMetricInput {
  keyword: string;
  searchVolume: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  competition: number | null;
  monthlySeries: Array<{ date: string; value: number | null }>;
  observedAt: string;
}

export async function insertKeywordMetrics(
  db: Database,
  websiteId: string,
  runId: string,
  source: string,
  countryCode: string,
  languageCode: string,
  rows: KeywordMetricInput[],
): Promise<void> {
  const createdAt = new Date().toISOString();
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO intelligence_keyword_metrics (
        id, website_id, run_id, metrics_source, keyword_key, keyword, country_code, language_code,
        search_volume, cpc_low, cpc_high, competition, monthly_series_json, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `intelligence_keyword_metric_${nanoid(16)}`,
      websiteId,
      runId,
      source,
      row.keyword.trim().toLowerCase(),
      row.keyword,
      countryCode,
      languageCode,
      row.searchVolume,
      row.cpcLow,
      row.cpcHigh,
      row.competition,
      JSON.stringify(row.monthlySeries),
      row.observedAt,
      createdAt,
    ).run();
  }
}

/** Newest recorded search volume per keyword in one market, for volume-based analysis. */
export async function latestKeywordVolumes(db: Database, websiteId: string, countryCode: string): Promise<Map<string, number | null>> {
  const result = await db.prepare(`
    SELECT keyword_key, search_volume, observed_at
    FROM intelligence_keyword_metrics
    WHERE website_id = ? AND country_code = ?
    ORDER BY observed_at DESC
    LIMIT 5000
  `).bind(websiteId, countryCode).all();
  const volumes = new Map<string, number | null>();
  for (const row of resultRows(result)) {
    const key = String(row.keyword_key);
    if (!volumes.has(key)) volumes.set(key, finiteNumber(row.search_volume));
  }
  return volumes;
}

export interface CrawlPageRecord {
  id: string;
  runId: string;
  url: string;
  depth: number;
  status: 'queued' | 'fetched' | 'failed' | 'skipped';
  statusCode: number | null;
  errorMessage: string | null;
}

export async function insertCrawlPages(db: Database, websiteId: string, runId: string, pages: Array<{ url: string; depth: number; discoveredFrom: string | null }>): Promise<number> {
  const createdAt = new Date().toISOString();
  let inserted = 0;
  for (const page of pages) {
    const result = await db.prepare(`
      INSERT OR IGNORE INTO intelligence_crawl_pages (id, run_id, website_id, url, depth, discovered_from, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
    `).bind(`intelligence_crawl_page_${nanoid(16)}`, runId, websiteId, page.url, page.depth, page.discoveredFrom, createdAt).run();
    inserted += Number(result?.meta?.changes ?? 0);
  }
  return inserted;
}

export async function nextQueuedCrawlPages(db: Database, runId: string, limit: number): Promise<CrawlPageRecord[]> {
  const result = await db.prepare(`
    SELECT id, run_id, url, depth, status, status_code, error_message
    FROM intelligence_crawl_pages
    WHERE run_id = ? AND status = 'queued'
    ORDER BY depth ASC, created_at ASC, id ASC
    LIMIT ?
  `).bind(runId, boundedInteger(limit, 1, 100)).all();
  return resultRows(result).map(mapCrawlPage);
}

export async function markCrawlPage(db: Database, pageId: string, update: { status: 'fetched' | 'failed' | 'skipped'; statusCode: number | null; errorMessage: string | null }): Promise<void> {
  await db.prepare(`
    UPDATE intelligence_crawl_pages
    SET status = ?, status_code = ?, error_message = ?, fetched_at = ?
    WHERE id = ?
  `).bind(update.status, update.statusCode, update.errorMessage, new Date().toISOString(), pageId).run();
}

export async function crawlPageCounts(db: Database, runId: string): Promise<{ total: number; queued: number; fetched: number; failed: number; skipped: number }> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'fetched' THEN 1 ELSE 0 END) AS fetched,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM intelligence_crawl_pages
    WHERE run_id = ?
  `).bind(runId).first();
  return {
    total: Number(row?.total ?? 0),
    queued: Number(row?.queued ?? 0),
    fetched: Number(row?.fetched ?? 0),
    failed: Number(row?.failed ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

export interface IntelligenceAssetRecord {
  id: string;
  runId: string;
  websiteId: string;
  pageUrl: string;
  storageKey: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
}

export async function insertIntelligenceAsset(db: Database, record: Omit<IntelligenceAssetRecord, 'createdAt'>): Promise<IntelligenceAssetRecord> {
  const createdAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO intelligence_assets (id, run_id, website_id, page_url, storage_key, content_type, byte_length, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(record.id, record.runId, record.websiteId, record.pageUrl, record.storageKey, record.contentType, record.byteLength, createdAt).run();
  return { ...record, createdAt };
}

export async function getIntelligenceAsset(db: Database, websiteId: string, assetId: string): Promise<IntelligenceAssetRecord | null> {
  const row = await db.prepare(`
    SELECT * FROM intelligence_assets WHERE id = ? AND website_id = ? LIMIT 1
  `).bind(assetId, websiteId).first();
  if (!row) return null;
  return {
    id: String(row.id),
    runId: String(row.run_id),
    websiteId: String(row.website_id),
    pageUrl: String(row.page_url),
    storageKey: String(row.storage_key),
    contentType: String(row.content_type),
    byteLength: Number(row.byte_length),
    createdAt: String(row.created_at),
  };
}

function mapRun(row: any): IntelligenceRunRecord {
  return {
    id: String(row.id),
    websiteId: String(row.website_id),
    userId: String(row.user_id),
    capability: String(row.capability),
    action: String(row.action),
    status: row.status as IntelligenceRunStatus,
    statusMessage: String(row.status_message || 'Status unavailable.'),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    request: parseJson(row.request_json, null),
    summary: row.summary_json === null || row.summary_json === undefined ? null : parseJson(row.summary_json, null),
    evidenceVersion: String(row.evidence_version || 'initial'),
    source: row.source_json ? parseJson(row.source_json, null) : null,
    coverage: row.coverage_json ? parseJson(row.coverage_json, null) : null,
    unavailable: Array.isArray(parseJson(row.unavailable_json, [])) ? parseJson<unknown[]>(row.unavailable_json, []) : [],
    progressCompleted: Number(row.progress_completed ?? 0),
    progressTotal: row.progress_total === null || row.progress_total === undefined ? null : Number(row.progress_total),
    attempts: Number(row.attempts ?? 0),
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
    cancelRequestedAt: row.cancel_requested_at ? String(row.cancel_requested_at) : null,
    parentRunId: row.parent_run_id ? String(row.parent_run_id) : null,
    checkedAt: row.checked_at ? String(row.checked_at) : null,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: row.error_message ? { code: row.error_code ? String(row.error_code) : null, message: String(row.error_message) } : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCrawlPage(row: any): CrawlPageRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    url: String(row.url),
    depth: Number(row.depth),
    status: row.status as CrawlPageRecord['status'],
    statusCode: row.status_code === null || row.status_code === undefined ? null : Number(row.status_code),
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

async function discardEvidenceVersion(db: Database, websiteId: string, runId: string, version: string): Promise<void> {
  try {
    await db.prepare(`
      DELETE FROM intelligence_evidence
      WHERE run_id = ? AND website_id = ? AND evidence_version = ?
    `).bind(runId, websiteId, version).run();
  } catch { /* Preserve the original staging error. Invisible rows are harmless. */ }
}

function mapEvidence<T>(row: any): IntelligenceEvidenceRecord<T> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    websiteId: String(row.website_id),
    capability: String(row.capability),
    kind: String(row.evidence_kind),
    identityKey: String(row.identity_key),
    payload: parseJson(row.payload_json, null) as T,
    observedAt: String(row.observed_at),
    createdAt: String(row.created_at),
  };
}

function resultRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  return value;
}
