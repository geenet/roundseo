import type { BacklinkEvent, BacklinkObservation } from '../../shared/backlinks';

type Database = any;

export async function getMonitorHistory(db: Database, monitorId: string, limit = 50): Promise<{ observations: BacklinkObservation[]; events: BacklinkEvent[] }> {
  const bounded = Math.min(Math.max(limit, 1), 200);
  const observationRows = await db.prepare(`
    SELECT * FROM backlink_observations WHERE monitor_id = ? ORDER BY attempted_at DESC LIMIT ?
  `).bind(monitorId, bounded).all();
  const observations: BacklinkObservation[] = [];
  for (const row of observationRows.results || []) {
    const occurrenceRows = await db.prepare('SELECT * FROM backlink_occurrences WHERE observation_id = ? ORDER BY locator ASC').bind(row.id).all();
    observations.push(mapObservationRow(row, (occurrenceRows.results || []).map(mapOccurrenceRow)));
  }
  const eventRows = await db.prepare(`SELECT * FROM backlink_events WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?`).bind(monitorId, bounded).all();
  return { observations, events: (eventRows.results || []).map(mapEventRow) };
}

function mapObservationRow(row: any, occurrences: BacklinkObservation['occurrences']): BacklinkObservation {
  return {
    id: row.id, monitorId: row.monitor_id, attemptedAt: row.attempted_at, fetchOutcome: row.fetch_outcome,
    httpStatus: row.http_status, finalUrl: row.final_url, redirectChain: safeArray(row.redirect_chain_json),
    contentType: row.content_type, presence: row.presence, presenceMethod: row.presence_method,
    confirmationState: row.confirmation_state, targetStatusCode: row.target_status_code, targetFinalUrl: row.target_final_url,
    targetRedirectChain: safeArray(row.target_redirect_json), sourceMetaRobots: row.source_meta_robots,
    sourceXRobotsTag: row.source_x_robots_tag, sourceCanonical: row.source_canonical, errorMessage: row.error_message,
    occurrences, createdAt: row.created_at,
  };
}

function mapOccurrenceRow(row: any) {
  return {
    id: row.id, observationId: row.observation_id, originalHref: row.original_href, resolvedUrl: row.resolved_url,
    anchorText: row.anchor_text, imageAlt: row.image_alt, relTokens: safeArray(row.rel_tokens_json),
    elementKind: row.element_kind, matchesExpectedTarget: Boolean(row.matches_expected_target), createdAt: row.created_at,
  };
}

function mapEventRow(row: any): BacklinkEvent {
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(row.detail_json || '{}'); } catch { detail = {}; }
  return {
    id: row.id, monitorId: row.monitor_id, eventType: row.event_type, priorObservationId: row.prior_observation_id,
    newObservationId: row.new_observation_id, confirmationState: row.confirmation_state, detail, createdAt: row.created_at,
  };
}

function safeArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
