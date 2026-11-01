import type { Availability } from '../../shared/operating-model';
import { listWebsiteActions } from './actions';
import { getLatestPerformanceAudit } from './performance';

type Database = any;

export async function getWebsiteOperatingOverview(db: Database, websiteId: string): Promise<any> {
  const audit = await db.prepare(`
    SELECT * FROM audits WHERE website_id = ? AND status = 'completed' AND type <> 'performance'
    ORDER BY completed_at DESC LIMIT 1
  `).bind(websiteId).first();
  const actions = await listWebsiteActions(db, websiteId);
  const performance = await getLatestPerformanceAudit(db, websiteId);
  const connectors = await db.prepare(`
    SELECT provider, selected_property, availability, last_successful_sync_at,
      next_scheduled_run_at, supported_metrics_json, quota_state
    FROM connector_accounts WHERE website_id = ? ORDER BY provider
  `).bind(websiteId).all();

  if (!audit) {
    return {
      latestAudit: null,
      actions,
      performance,
      dataSources: sourceStatuses(connectors.results || [], performance),
      message: 'Run a baseline crawl to establish page evidence and action history.',
    };
  }
  const metadata = await db.prepare('SELECT * FROM audit_metadata WHERE audit_id = ?').bind(audit.id).first();
  const metrics = await db.prepare(`
    SELECT metric_key, value, numerator, denominator, unit, availability, fetched_at, method_version
    FROM metric_observations WHERE audit_id = ? ORDER BY metric_key
  `).bind(audit.id).all();
  const changes = await db.prepare('SELECT * FROM page_changes WHERE audit_id = ? ORDER BY detected_at DESC LIMIT 20').bind(audit.id).all();
  return {
    latestAudit: audit,
    auditMetadata: metadata,
    assurance: readAssurance(metadata?.crawl_scope_json),
    measurements: metrics.results || [],
    actions,
    changes: changes.results || [],
    performance,
    dataSources: sourceStatuses(connectors.results || [], performance),
  };
}

export async function getAuditPageInventory(db: Database, auditId: string): Promise<any[]> {
  const result = await db.prepare(`
    SELECT snapshot.id, snapshot.page_identity_id, identity.normalized_url, snapshot.requested_url,
      snapshot.final_url, snapshot.status_code, snapshot.title, snapshot.canonical_url,
      snapshot.robots_directive, snapshot.rendered, snapshot.observation_method,
      snapshot.evidence_kind, snapshot.availability, snapshot.observed_at,
      COALESCE((SELECT COUNT(*) FROM link_edges edge WHERE edge.audit_id = snapshot.audit_id
        AND edge.source_page_identity_id = snapshot.page_identity_id AND edge.is_internal = TRUE), 0) AS outgoing_internal_links
    FROM page_snapshots snapshot
    JOIN page_identities identity ON identity.id = snapshot.page_identity_id
    WHERE snapshot.audit_id = ?
    ORDER BY snapshot.final_url, snapshot.requested_url
  `).bind(auditId).all();
  return result.results || [];
}

function sourceStatuses(connectors: any[], performance: any): Array<{ key: string; label: string; availability: Availability; detail: string; lastSyncedAt?: string }> {
  const byProvider = new Map(connectors.map(connector => [String(connector.provider).toLowerCase(), connector]));
  return [
    sourceStatus(byProvider.get('google_search_console'), 'google_search_console', 'Google Search', 'Connect Google Search Console to report clicks, impressions, queries, and index inspection evidence.'),
    sourceStatus(byProvider.get('analytics'), 'analytics', 'Conversions', 'Connect one analytics source to report agreed outcomes separately from search clicks.'),
    performance
      ? {
        key: 'performance',
        label: 'Visitor performance',
        availability: performance.availability as Availability,
        detail: performance.availability === 'measured' || performance.availability === 'partial'
          ? `${performance.providerLabel || 'RoundSEO browser test'} measured ${performance.devices?.map((device: any) => device.device).join(' and ') || 'the requested'} device view${performance.devices?.length === 1 ? '' : 's'} for ${performance.targetUrl}. Browser samples and real-user data remain separate.`
          : performance.error || 'The latest browser performance audit did not return usable evidence.',
        lastSyncedAt: performance.fetchedAt,
      }
      : sourceStatus(undefined, 'performance', 'Visitor performance', 'Run a RoundSEO browser audit for mobile and desktop loading measurements.'),
  ];
}

function sourceStatus(connector: any, key: string, label: string, fallback: string) {
  if (!connector) return { key, label, availability: 'not_connected' as const, detail: fallback };
  return {
    key,
    label,
    availability: (connector.availability || 'not_connected') as Availability,
    detail: connector.selected_property ? `Connected to ${connector.selected_property}` : fallback,
    lastSyncedAt: connector.last_successful_sync_at || undefined,
  };
}

function readAssurance(scopeJson?: string): unknown {
  if (!scopeJson) return null;
  try { return JSON.parse(scopeJson).assurance || null; } catch { return null; }
}
