import { nanoid } from 'nanoid';
import type { PerformanceAudit, PerformanceDeviceResult, PerformanceMetric } from '../../shared/operating-model';
import type { AuditFinding } from '../crawlers/metrics';
import { ensureMeasurementDefinitions, persistFindingsAndActions } from './audit-foundation';

type Database = any;

type PersistPerformanceInput = {
  auditId: string;
  websiteId: string;
  report: PerformanceAudit;
};

type PerformanceObservationContext = {
  auditId: string;
  websiteId: string;
  performanceAuditId: string;
  targetUrl: string;
  device: string;
  fetchedAt: string;
  methodVersion: string;
};

/**
 * Persists a PageSpeed run as its own evidence bundle. It deliberately does
 * not update crawl health or crawl findings: a synthetic lab run and a site
 * crawl answer different questions and carry different evidence labels.
 */
export async function persistPerformanceAudit(db: Database, input: PersistPerformanceInput): Promise<PerformanceAudit> {
  const { auditId, websiteId, report } = input;
  await ensureMeasurementDefinitions(db, report.fetchedAt);

  const existing = await db.prepare('SELECT id FROM performance_audits WHERE audit_id = ?').bind(auditId).first();
  const performanceAuditId = existing?.id ? String(existing.id) : `performance_audit_${nanoid(16)}`;
  await db.prepare(`
    INSERT INTO performance_audits (
      id, audit_id, website_id, target_url, provider, availability,
      method_version, fetched_at, error_message, source_evidence_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(audit_id) DO UPDATE SET
      target_url = excluded.target_url,
      provider = excluded.provider,
      availability = excluded.availability,
      method_version = excluded.method_version,
      fetched_at = excluded.fetched_at,
      error_message = excluded.error_message,
      source_evidence_json = excluded.source_evidence_json,
      updated_at = excluded.updated_at
  `).bind(
    performanceAuditId,
    auditId,
    websiteId,
    report.targetUrl,
    report.provider,
    report.availability,
    report.methodVersion,
    report.fetchedAt,
    report.error || null,
    JSON.stringify({ providerLabel: report.providerLabel, devices: report.devices.map(device => ({ device: device.device, availability: device.availability, fieldDataScope: device.fieldDataScope })) }),
    report.fetchedAt,
    report.fetchedAt,
  ).run();

  await db.prepare('DELETE FROM performance_device_results WHERE performance_audit_id = ?').bind(performanceAuditId).run();
  for (const device of report.devices) {
    await persistDeviceResult(db, performanceAuditId, device);
    await persistDeviceObservations(db, auditId, websiteId, performanceAuditId, report, device);
  }

  // Provider opportunities become normal actions only when they carry a
  // measurable saving. Each record retains the precise target URL and device
  // instead of becoming a vague, site-wide "speed" recommendation.
  await persistFindingsAndActions(
    db,
    auditId,
    websiteId,
    buildPageSpeedFindings(report),
    report.availability,
    'pagespeed_insights',
    report.fetchedAt,
  );

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
    'pagespeed_insights',
    'sampled',
    report.availability,
    report.methodVersion,
    JSON.stringify({ targetUrl: report.targetUrl, devices: report.devices.map(device => ({ device: device.device, availability: device.availability })) }),
    report.fetchedAt,
    report.fetchedAt,
  ).run();

  return report;
}

/**
 * Converts quantified PageSpeed opportunities into durable action evidence.
 * This is deliberately a pure mapper: no unquantified audit hint, unavailable
 * provider response, or zero-value opportunity can create a false action.
 */
export function buildPageSpeedFindings(report: PerformanceAudit): AuditFinding[] {
  const grouped = new Map<string, {
    title: string;
    largestSavingsMs: number;
    largestSavingsBytes: number;
    evidence: AuditFinding['evidence'];
  }>();

  for (const device of report.devices) {
    if (device.availability !== 'measured' && device.availability !== 'partial') continue;
    for (const opportunity of device.opportunities) {
      const savingsMs = opportunity.estimatedSavingsMs || 0;
      const savingsBytes = opportunity.estimatedSavingsBytes || 0;
      if (savingsMs <= 0 && savingsBytes <= 0) continue;
      const ruleId = `performance.pagespeed.${slug(opportunity.key)}`;
      const current = grouped.get(ruleId) || {
        title: opportunity.title,
        largestSavingsMs: 0,
        largestSavingsBytes: 0,
        evidence: [],
      };
      current.largestSavingsMs = Math.max(current.largestSavingsMs, savingsMs);
      current.largestSavingsBytes = Math.max(current.largestSavingsBytes, savingsBytes);
      current.evidence.push({
        url: report.targetUrl,
        element: `${presentDevice(device.device)} PageSpeed lab opportunity`,
        observed: pageSpeedSavingsSummary(savingsMs, savingsBytes),
        recommendation: `Review ${opportunity.title.toLowerCase()} for this exact URL on ${presentDevice(device.device).toLowerCase()}; make the smallest appropriate change, then rerun the comparable PageSpeed check.`,
      });
      grouped.set(ruleId, current);
    }
  }

  return [...grouped.entries()]
    .sort(([, left], [, right]) => right.largestSavingsMs - left.largestSavingsMs || right.largestSavingsBytes - left.largestSavingsBytes)
    .slice(0, 8)
    .map(([ruleId, finding]) => ({
      category: 'technical',
      priority: pageSpeedPriority(finding.largestSavingsMs, finding.largestSavingsBytes),
      ruleId,
      ruleVersion: report.methodVersion,
      evidenceKind: 'sampled',
      availability: report.availability,
      confidence: 'high',
      title: `PageSpeed: ${finding.title}`,
      description: `Google PageSpeed Insights identified a quantified lab opportunity on the declared target URL. It applies only to the device evidence shown below, not automatically to every page on the site.`,
      impact: `Reducing this avoidable work can improve the measured loading experience for visitors of ${report.targetUrl}.`,
      effort: pageSpeedEffort(ruleId),
      evidence: finding.evidence,
    }));
}

export async function getLatestPerformanceAudit(db: Database, websiteId: string): Promise<PerformanceAudit | null> {
  try {
    const row = await db.prepare(`
      SELECT * FROM performance_audits
      WHERE website_id = ?
      ORDER BY fetched_at DESC, created_at DESC
      LIMIT 1
    `).bind(websiteId).first();
    return row ? hydratePerformanceAudit(db, row) : null;
  } catch {
    // Additive migrations can land independently from the worker. The
    // overview should stay available while that rollout finishes.
    return null;
  }
}

export async function getPerformanceAuditForAudit(db: Database, auditId: string): Promise<PerformanceAudit | null> {
  try {
    const row = await db.prepare('SELECT * FROM performance_audits WHERE audit_id = ?').bind(auditId).first();
    return row ? hydratePerformanceAudit(db, row) : null;
  } catch {
    return null;
  }
}

async function hydratePerformanceAudit(db: Database, row: any): Promise<PerformanceAudit> {
  const devices = await db.prepare(`
    SELECT * FROM performance_device_results
    WHERE performance_audit_id = ?
    ORDER BY CASE device WHEN 'mobile' THEN 0 ELSE 1 END
  `).bind(row.id).all();
  const sourceEvidence = parseJson(row.source_evidence_json, {} as { providerLabel?: string });
  return {
    targetUrl: String(row.target_url),
    provider: 'google_pagespeed_insights',
    providerLabel: sourceEvidence.providerLabel || 'Google PageSpeed Insights',
    availability: row.availability,
    fetchedAt: String(row.fetched_at),
    methodVersion: String(row.method_version),
    devices: (devices.results || []).map(mapDeviceRow),
    error: row.error_message || undefined,
  };
}

async function persistDeviceResult(db: Database, performanceAuditId: string, device: PerformanceDeviceResult): Promise<void> {
  await db.prepare(`
    INSERT INTO performance_device_results (
      id, performance_audit_id, device, availability, lab_score,
      field_data_availability, field_data_scope, lab_metrics_json,
      field_metrics_json, opportunities_json, error_message, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `performance_device_${nanoid(16)}`,
    performanceAuditId,
    device.device,
    device.availability,
    device.labScore,
    device.fieldDataAvailability,
    device.fieldDataScope,
    JSON.stringify(device.labMetrics),
    JSON.stringify(device.fieldMetrics),
    JSON.stringify(device.opportunities),
    device.error || null,
    device.fetchedAt,
  ).run();
}

async function persistDeviceObservations(
  db: Database,
  auditId: string,
  websiteId: string,
  performanceAuditId: string,
  report: PerformanceAudit,
  device: PerformanceDeviceResult,
): Promise<void> {
  const common: PerformanceObservationContext = {
    auditId,
    websiteId,
    performanceAuditId,
    targetUrl: report.targetUrl,
    device: device.device,
    fetchedAt: device.fetchedAt,
    methodVersion: report.methodVersion,
  };
  if (device.labScore !== null) {
    await persistObservation(db, {
      ...common,
      metricKey: 'performance.lighthouse.score',
      value: device.labScore,
      unit: 'score',
      availability: device.availability,
      evidenceKind: 'sampled',
      statistic: 'lighthouse_lab',
      scope: 'lab',
    });
  }
  for (const metric of device.labMetrics) {
    await persistMetric(db, common, metric, device.availability, 'sampled', 'lighthouse_lab');
  }
  for (const metric of device.fieldMetrics) {
    await persistMetric(db, common, metric, device.fieldDataAvailability, 'provider_reported', 'crux_p75', device.fieldDataScope);
  }
}

async function persistMetric(
  db: Database,
  common: PerformanceObservationContext,
  metric: PerformanceMetric,
  availability: string,
  evidenceKind: 'sampled' | 'provider_reported',
  statistic: string,
  fieldScope?: string,
): Promise<void> {
  const metricKey = `performance.${metric.source === 'field' ? 'field' : 'lighthouse'}.${metric.key}`;
  await persistObservation(db, {
    ...common,
    metricKey,
    value: metric.value,
    unit: metric.unit,
    availability,
    evidenceKind,
    statistic,
    scope: fieldScope || metric.source,
  });
}

async function persistObservation(db: Database, observation: {
  auditId: string;
  websiteId: string;
  performanceAuditId: string;
  targetUrl: string;
  device: string;
  fetchedAt: string;
  methodVersion: string;
  metricKey: string;
  value: number | null;
  unit: string;
  availability: string;
  evidenceKind: string;
  statistic: string;
  scope: string;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO metric_observations (
      id, audit_id, website_id, entity_type, entity_id, metric_key, value,
      unit, statistic, dimensions_json, source, evidence_kind, availability,
      fetched_at, method_version, raw_evidence_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `metric_observation_${nanoid(16)}`,
    observation.auditId,
    observation.websiteId,
    'website',
    observation.websiteId,
    observation.metricKey,
    observation.value,
    observation.unit,
    observation.statistic,
    JSON.stringify({ device: observation.device, scope: observation.scope, target_url: observation.targetUrl }),
    'Google PageSpeed Insights',
    observation.evidenceKind,
    observation.availability,
    observation.fetchedAt,
    observation.methodVersion,
    observation.performanceAuditId,
  ).run();
}

function mapDeviceRow(row: any): PerformanceDeviceResult {
  return {
    device: row.device,
    availability: row.availability,
    labScore: row.lab_score === null || row.lab_score === undefined ? null : Number(row.lab_score),
    labMetrics: parseJson(row.lab_metrics_json, []),
    fieldMetrics: parseJson(row.field_metrics_json, []),
    fieldDataAvailability: row.field_data_availability,
    fieldDataScope: row.field_data_scope,
    opportunities: parseJson(row.opportunities_json, []),
    fetchedAt: String(row.fetched_at),
    error: row.error_message || undefined,
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function pageSpeedPriority(savingsMs: number, savingsBytes: number): AuditFinding['priority'] {
  if (savingsMs >= 1_500 || savingsBytes >= 500_000) return 'high';
  if (savingsMs >= 400 || savingsBytes >= 125_000) return 'medium';
  return 'low';
}

function pageSpeedEffort(ruleId: string): AuditFinding['effort'] {
  if (/render_blocking|redirect|unused_css|unused_javascript|text_compression/.test(ruleId)) return 'quick_win';
  if (/image|font|third_party|mainthread/.test(ruleId)) return 'medium';
  return 'complex';
}

function pageSpeedSavingsSummary(savingsMs: number, savingsBytes: number): string {
  const parts: string[] = [];
  if (savingsMs > 0) parts.push(`${Math.round(savingsMs)} ms estimated savings`);
  if (savingsBytes > 0) parts.push(`${Math.max(1, Math.round(savingsBytes / 1024))} KB estimated transfer savings`);
  return parts.join(' · ');
}

function presentDevice(device: 'mobile' | 'desktop'): string {
  return device === 'mobile' ? 'Mobile' : 'Desktop';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
