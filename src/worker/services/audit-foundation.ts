import { nanoid } from 'nanoid';
import type { CrawlResult } from '../crawlers/base';
import type { AuditFinding, SiteMetrics } from '../crawlers/metrics';
import type { PageMetrics } from '../crawlers/parser';
import { DETERMINISTIC_MEASUREMENT_DEFINITIONS, type Availability, type CrawlCoverage } from '../../shared/operating-model';

type Database = any;

export type AuditFoundationInput = {
  auditId: string;
  websiteId: string;
  collectionMethod: 'http' | 'browser';
  pages: PageMetrics[];
  results: CrawlResult[];
  metrics: SiteMetrics;
  startedAt: string;
  completedAt: string;
};

/**
 * Writes the durable evidence model after a crawl has completed. The existing
 * audit/recommendation tables remain as a compatibility read model; this is
 * the source of truth for page history, action state and measurement context.
 */
export async function persistAuditFoundation(db: Database, input: AuditFoundationInput): Promise<void> {
  const { auditId, websiteId, collectionMethod, pages, results, metrics, startedAt, completedAt } = input;
  await persistAuditMetadata(db, auditId, collectionMethod, metrics.crawlCoverage, startedAt, completedAt);
  await ensureMeasurementDefinitions(db, completedAt);

  const resultByResolvedUrl = new Map(results.map(result => [normalizeUrl(result.finalUrl || result.url), result]));
  const pageIdentityByUrl = new Map<string, string>();

  for (const page of pages) {
    const normalizedUrl = normalizeUrl(page.url);
    const identityId = await ensurePageIdentity(db, websiteId, normalizedUrl, completedAt);
    pageIdentityByUrl.set(normalizedUrl, identityId);
    const request = resultByResolvedUrl.get(normalizedUrl);
    const previous = await db.prepare(`
      SELECT * FROM page_snapshots
      WHERE page_identity_id = ? AND audit_id <> ?
      ORDER BY observed_at DESC LIMIT 1
    `).bind(identityId, auditId).first();
    const snapshotId = `snapshot_${nanoid(16)}`;

    await db.prepare(`
      INSERT INTO page_snapshots (
        id, audit_id, page_identity_id, requested_url, final_url, status_code,
        response_headers_json, title, meta_description, h1_json, canonical_url,
        robots_directive, main_content_excerpt, content_fingerprint, rendered,
        observation_method, evidence_kind, availability, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId,
      auditId,
      identityId,
      request?.url || page.url,
      request?.finalUrl || page.url,
      page.statusCode || request?.statusCode || null,
      JSON.stringify(request?.responseHeaders || {}),
      page.title || null,
      page.metaDescription || null,
      JSON.stringify(page.h1Text),
      page.canonicalTag || null,
      page.robotsMeta || null,
      page.mainContentExcerpt || null,
      page.contentFingerprint || null,
      collectionMethod === 'browser',
      collectionMethod,
      'observed',
      page.requiresJavaScriptRendering && collectionMethod !== 'browser' ? 'partial' : 'measured',
      completedAt,
    ).run();

    if (previous) await recordSnapshotChanges(db, websiteId, identityId, auditId, previous, page, completedAt);
  }

  for (const page of pages) {
    const identityId = pageIdentityByUrl.get(normalizeUrl(page.url));
    if (!identityId) continue;
    for (const link of page.links) {
      if (!link.target) continue;
      await db.prepare(`
        INSERT OR IGNORE INTO link_edges (
          id, audit_id, website_id, source_page_identity_id, source_url, target_url,
          final_target_url, anchor_text, placement, rel_attributes, is_internal,
          observation_method, first_observed_at, last_observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `edge_${nanoid(16)}`,
        auditId,
        websiteId,
        identityId,
        page.url,
        link.target,
        null,
        link.anchorText || '',
        link.placement,
        link.relAttributes || null,
        link.isInternal,
        collectionMethod,
        completedAt,
        completedAt,
      ).run();
    }
  }

  await persistMetricObservations(db, auditId, websiteId, metrics, completedAt);
  await persistFindingsAndActions(db, auditId, websiteId, metrics.findings, metrics.crawlCoverage.availability, collectionMethod, completedAt);
}

export async function getAuditFoundation(db: Database, auditId: string): Promise<{
  metadata: any;
  pages: any[];
  findings: any[];
  actions: any[];
  changes: any[];
} | null> {
  const metadata = await db.prepare('SELECT * FROM audit_metadata WHERE audit_id = ?').bind(auditId).first();
  if (!metadata) return null;
  const pages = await db.prepare(`
    SELECT snapshot.*, identity.normalized_url
    FROM page_snapshots snapshot
    JOIN page_identities identity ON identity.id = snapshot.page_identity_id
    WHERE snapshot.audit_id = ?
    ORDER BY snapshot.final_url, snapshot.requested_url
  `).bind(auditId).all();
  const findings = await db.prepare('SELECT * FROM audit_findings WHERE audit_id = ? ORDER BY CASE severity WHEN "critical" THEN 0 WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END, title').bind(auditId).all();
  const evidence = await db.prepare(`
    SELECT * FROM audit_finding_evidence WHERE audit_id = ?
    ORDER BY page_url, element, id
  `).bind(auditId).all();
  const actions = await db.prepare(`
    SELECT action.* FROM action_items action
    JOIN action_occurrences occurrence ON occurrence.action_id = action.id
    WHERE occurrence.audit_id = ?
    ORDER BY CASE action.severity WHEN "critical" THEN 0 WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END, action.last_seen_at DESC
  `).bind(auditId).all();
  const changes = await db.prepare('SELECT * FROM page_changes WHERE audit_id = ? ORDER BY detected_at DESC').bind(auditId).all();
  const evidenceByFinding = new Map<string, any[]>();
  for (const item of evidence.results || []) {
    const rows = evidenceByFinding.get(String(item.finding_id)) || [];
    rows.push(item);
    evidenceByFinding.set(String(item.finding_id), rows);
  }
  const findingsWithEvidence = (findings.results || []).map((finding: any) => ({
    ...finding,
    evidence: evidenceByFinding.get(String(finding.id)) || [],
  }));
  return { metadata, pages: pages.results || [], findings: findingsWithEvidence, actions: actions.results || [], changes: changes.results || [] };
}

export async function getPageSnapshotDetail(db: Database, pageIdentityId: string): Promise<any | null> {
  const page = await db.prepare(`
    SELECT snapshot.*, identity.normalized_url, identity.website_id
    FROM page_snapshots snapshot
    JOIN page_identities identity ON identity.id = snapshot.page_identity_id
    WHERE snapshot.page_identity_id = ?
    ORDER BY snapshot.observed_at DESC LIMIT 1
  `).bind(pageIdentityId).first();
  if (!page) return null;
  const links = await db.prepare(`
    SELECT * FROM link_edges WHERE source_page_identity_id = ? AND audit_id = ?
    ORDER BY is_internal DESC, placement, anchor_text LIMIT 250
  `).bind(pageIdentityId, page.audit_id).all();
  const changes = await db.prepare('SELECT * FROM page_changes WHERE page_identity_id = ? ORDER BY detected_at DESC LIMIT 100').bind(pageIdentityId).all();
  return { ...page, links: links.results || [], changes: changes.results || [] };
}

async function persistAuditMetadata(db: Database, auditId: string, collectionMethod: 'http' | 'browser', coverage: CrawlCoverage, startedAt: string, completedAt: string): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_metadata (
      audit_id, collection_method, evidence_kind, availability, method_version,
      crawl_scope_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(audit_id) DO UPDATE SET
      collection_method = excluded.collection_method,
      evidence_kind = excluded.evidence_kind,
      availability = excluded.availability,
      method_version = excluded.method_version,
      crawl_scope_json = excluded.crawl_scope_json,
      completed_at = excluded.completed_at
  `).bind(
    auditId,
    collectionMethod,
    'observed',
    coverage.availability,
    'crawl-rules-2026.10.0',
    JSON.stringify(coverage),
    startedAt,
    completedAt,
  ).run();
}

export async function ensureMeasurementDefinitions(db: Database, timestamp: string): Promise<void> {
  for (const definition of DETERMINISTIC_MEASUREMENT_DEFINITIONS) {
    await db.prepare(`
      INSERT INTO measurement_definitions (
        metric_key, display_label, unit, source_family, supported_dimensions_json,
        aggregation_rule, version, availability_requirements_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(metric_key) DO UPDATE SET
        display_label = excluded.display_label,
        unit = excluded.unit,
        source_family = excluded.source_family,
        supported_dimensions_json = excluded.supported_dimensions_json,
        aggregation_rule = excluded.aggregation_rule,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).bind(
      definition.metricKey,
      definition.displayLabel,
      definition.unit,
      definition.sourceFamily,
      JSON.stringify(definition.supportedDimensions || []),
      definition.aggregationRule,
      '2026.10.0',
      '["measured", "partial"]',
      timestamp,
      timestamp,
    ).run();
  }
}

async function ensurePageIdentity(db: Database, websiteId: string, normalizedUrl: string, timestamp: string): Promise<string> {
  const existing = await db.prepare('SELECT id FROM page_identities WHERE website_id = ? AND normalized_url = ?').bind(websiteId, normalizedUrl).first();
  if (existing?.id) {
    await db.prepare('UPDATE page_identities SET last_seen_at = ? WHERE id = ?').bind(timestamp, existing.id).run();
    return String(existing.id);
  }
  const id = `page_identity_${nanoid(16)}`;
  await db.prepare(`
    INSERT INTO page_identities (id, website_id, normalized_url, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, websiteId, normalizedUrl, timestamp, timestamp).run();
  return id;
}

async function recordSnapshotChanges(db: Database, websiteId: string, pageIdentityId: string, auditId: string, previous: any, current: PageMetrics, timestamp: string): Promise<void> {
  const comparison: Array<[string, string | null, string | null]> = [
    ['title', previous.title || null, current.title || null],
    ['meta_description', previous.meta_description || null, current.metaDescription || null],
    ['canonical', previous.canonical_url || null, current.canonicalTag || null],
    ['robots', previous.robots_directive || null, current.robotsMeta || null],
    ['main_content', previous.content_fingerprint || null, current.contentFingerprint || null],
  ];
  for (const [changeType, before, after] of comparison) {
    if (before === after) continue;
    await db.prepare(`
      INSERT INTO page_changes (
        id, website_id, page_identity_id, audit_id, change_type, before_value, after_value, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`change_${nanoid(16)}`, websiteId, pageIdentityId, auditId, changeType, before, after, timestamp).run();
  }
}

async function persistMetricObservations(db: Database, auditId: string, websiteId: string, metrics: SiteMetrics, timestamp: string): Promise<void> {
  const coverage = metrics.crawlCoverage;
  const observations = [
    {
      key: 'crawl.pages.inspected', value: coverage.inspectedPages, numerator: null, denominator: null, unit: 'pages', availability: coverage.availability,
    },
    {
      key: 'crawl.coverage', value: coverage.discoveredUrls ? coverage.inspectedPages / coverage.discoveredUrls : null, numerator: coverage.inspectedPages, denominator: coverage.discoveredUrls || null, unit: 'ratio', availability: coverage.availability,
    },
    {
      key: 'technical.health', value: metrics.technicalHealth.value, numerator: metrics.technicalHealth.passedChecks, denominator: metrics.technicalHealth.evaluatedChecks || null, unit: 'percent', availability: metrics.technicalHealth.value === null ? 'not_measured' : coverage.availability,
    },
  ];
  for (const observation of observations) {
    await db.prepare(`
      INSERT INTO metric_observations (
        id, audit_id, website_id, entity_type, entity_id, metric_key, value, numerator,
        denominator, unit, dimensions_json, source, evidence_kind, availability,
        fetched_at, sample_size, method_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `metric_observation_${nanoid(16)}`,
      auditId,
      websiteId,
      'site',
      websiteId,
      observation.key,
      observation.value,
      observation.numerator,
      observation.denominator,
      observation.unit,
      JSON.stringify({ method: coverage.method }),
      'RoundSEO crawler',
      'observed',
      observation.availability,
      timestamp,
      coverage.inspectedPages,
      'crawl-rules-2026.10.0',
    ).run();
  }
}

/**
 * Persists a source-specific finding into the shared action workflow. A
 * PageSpeed lab run can therefore produce the same inspectable URL-level
 * evidence and verification lifecycle as a crawler rule, without pretending
 * that the two collection methods are interchangeable.
 */
export async function persistFindingsAndActions(
  db: Database,
  auditId: string,
  websiteId: string,
  findings: AuditFinding[],
  coverage: Availability,
  collectionMethod: 'http' | 'browser' | 'pagespeed_insights',
  timestamp: string,
): Promise<void> {
  const observedActionIds = new Set<string>();
  for (const finding of findings) {
    const ruleId = finding.ruleId || `${finding.category}.${slug(finding.title)}`;
    const findingId = `finding_${nanoid(16)}`;
    const affectedPageCount = new Set(finding.evidence.map(item => item.url)).size;
    await db.prepare(`
      INSERT INTO audit_findings (
        id, audit_id, website_id, rule_id, rule_version, category, severity,
        confidence, evidence_kind, availability, title, description, impact,
        proposed_fix, effort_band, affected_page_count, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      findingId,
      auditId,
      websiteId,
      ruleId,
      finding.ruleVersion || '2026.10.0',
      finding.category,
      finding.priority,
      finding.confidence || 'medium',
      finding.evidenceKind || 'observed',
      finding.availability || coverage,
      finding.title,
      finding.description,
      finding.impact,
      finding.evidence[0]?.recommendation || null,
      finding.effort,
      affectedPageCount,
      timestamp,
      timestamp,
    ).run();

    await persistFindingEvidence(db, {
      findingId,
      auditId,
      websiteId,
      evidence: finding.evidence,
      evidenceKind: finding.evidenceKind || 'observed',
      availability: finding.availability || coverage,
      confidence: finding.confidence || 'medium',
      timestamp,
    });

    const actionKey = `${websiteId}:${ruleId}`;
    const existing = await db.prepare('SELECT id FROM action_items WHERE action_key = ?').bind(actionKey).first();
    const actionId = existing?.id ? String(existing.id) : `action_${nanoid(16)}`;
    if (existing?.id) {
      await db.prepare(`
        UPDATE action_items SET
          title = ?, severity = ?, confidence = ?, business_impact = ?, effort_band = ?,
          proposed_fix = ?, affected_page_count = ?, last_seen_at = ?,
          status = CASE
            WHEN status = 'verified_resolved' THEN 'recurring'
            WHEN status = 'awaiting_verification' THEN 'open'
            ELSE status
          END
        WHERE id = ?
      `).bind(finding.title, finding.priority, finding.confidence || 'medium', finding.impact, finding.effort, finding.evidence[0]?.recommendation || null, affectedPageCount, timestamp, actionId).run();
    } else {
      await db.prepare(`
        INSERT INTO action_items (
          id, website_id, action_key, rule_id, rule_version, title, status, severity,
          confidence, business_impact, effort_band, proposed_fix, verification_method,
          affected_page_count, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        actionId, websiteId, actionKey, ruleId, finding.ruleVersion || '2026.10.0', finding.title,
        'open', finding.priority, finding.confidence || 'medium', finding.impact, finding.effort,
        finding.evidence[0]?.recommendation || null,
        'Run a comparable crawl and confirm this condition no longer appears in the recorded evidence.',
        affectedPageCount, timestamp, timestamp,
      ).run();
    }
    await db.prepare(`
      INSERT OR IGNORE INTO action_occurrences (id, action_id, audit_id, finding_id, observed_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`action_occurrence_${nanoid(16)}`, actionId, auditId, findingId, timestamp).run();
    observedActionIds.add(actionId);
  }

  // Owner completion is not resolution. We resolve only actions awaiting
  // verification after a complete crawl collected by the same method as the
  // evidence that originally opened the action.
  if (coverage === 'measured') {
    const awaiting = await db.prepare(`
      SELECT id FROM action_items WHERE website_id = ? AND status = 'awaiting_verification'
    `).bind(websiteId).all();
    for (const action of awaiting.results || []) {
      if (observedActionIds.has(String(action.id))) continue;
      const priorEvidence = await db.prepare(`
        SELECT metadata.collection_method
        FROM action_occurrences occurrence
        JOIN audit_metadata metadata ON metadata.audit_id = occurrence.audit_id
        WHERE occurrence.action_id = ?
        ORDER BY occurrence.observed_at DESC
        LIMIT 1
      `).bind(action.id).first();
      if (priorEvidence?.collection_method !== collectionMethod) continue;
      await db.prepare(`
        UPDATE action_items SET status = 'verified_resolved', verified_at = ?, last_seen_at = ? WHERE id = ?
      `).bind(timestamp, timestamp, action.id).run();
    }
  }
}

async function persistFindingEvidence(db: Database, input: {
  findingId: string;
  auditId: string;
  websiteId: string;
  evidence: AuditFinding['evidence'];
  evidenceKind: string;
  availability: Availability;
  confidence: string;
  timestamp: string;
}): Promise<void> {
  for (const item of input.evidence) {
    let pageIdentityId: string | null = null;
    try {
      const identity = await db.prepare(`
        SELECT id FROM page_identities WHERE website_id = ? AND normalized_url = ?
      `).bind(input.websiteId, normalizeUrl(item.url)).first();
      pageIdentityId = identity?.id ? String(identity.id) : null;
    } catch {
      // A broken URL can have valid crawl evidence without ever yielding a
      // page snapshot and therefore without a durable page identity.
    }
    await db.prepare(`
      INSERT INTO audit_finding_evidence (
        id, finding_id, audit_id, website_id, page_identity_id, page_url,
        element, observed, recommendation, evidence_kind, availability,
        confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `finding_evidence_${nanoid(16)}`,
      input.findingId,
      input.auditId,
      input.websiteId,
      pageIdentityId,
      item.url,
      item.element,
      item.observed,
      item.recommendation,
      input.evidenceKind,
      input.availability,
      input.confidence,
      input.timestamp,
    ).run();
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
