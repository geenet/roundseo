/**
 * Supported indexing actions (spec table). `inspect` and `sitemap_submit`
 * are real Google API calls; `search_console_handoff` only returns the
 * authorized inspection link for the customer to open themselves (there is
 * no general "request indexing" endpoint). IndexNow and the Google Indexing
 * API are pluggable adapters, same pattern as backlink discovery: schema and
 * interface are ready, but neither is wired to a live call by default —
 * IndexNow because it needs a per-host key-verification flow this release
 * does not build a UI for, and the Google Indexing API because it only
 * covers JobPosting/BroadcastEvent content, which general pages are never
 * eligible for.
 */
import { nanoid } from 'nanoid';
import type { AdapterAvailability } from '../../shared/indexing';
import type { IndexingActionType, SubmissionState } from '../../shared/indexing';
import { getGoogleConnection, getValidAccessToken, hasWriteScope, type GoogleConnectionEnv } from './google-connection';
import { submitSitemap } from './search-console-client';

type Database = any;

export async function recordIndexingAction(db: Database, websiteId: string, actionType: IndexingActionType, input: { actorUserId?: string; targetUrl?: string; targetSitemap?: string; submissionState: SubmissionState; outcomeEvidence?: Record<string, unknown> }): Promise<void> {
  await db.prepare(`
    INSERT INTO indexing_actions (id, website_id, action_type, actor_user_id, target_url, target_sitemap, submission_state, outcome_evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(`idxaction_${nanoid(16)}`, websiteId, actionType, input.actorUserId || null, input.targetUrl || null, input.targetSitemap || null, input.submissionState, JSON.stringify(input.outcomeEvidence || {}), new Date().toISOString()).run();
}

export async function listIndexingActions(db: Database, websiteId: string, limit = 50): Promise<any[]> {
  const rows = await db.prepare('SELECT * FROM indexing_actions WHERE website_id = ? ORDER BY created_at DESC LIMIT ?').bind(websiteId, Math.min(Math.max(limit, 1), 200)).all();
  return (rows.results || []).map((row: any) => ({
    id: row.id, websiteId: row.website_id, actionType: row.action_type, targetUrl: row.target_url, targetSitemap: row.target_sitemap,
    submissionState: row.submission_state, outcomeEvidence: safeJson(row.outcome_evidence_json), createdAt: row.created_at,
  }));
}

/** Submitting a sitemap assists discovery; acceptance is never itself translated into an indexed verdict (AC20). */
export async function submitWebsiteSitemap(db: Database, env: GoogleConnectionEnv, websiteId: string, sitemapUrl: string, userId: string): Promise<{ submitted: boolean; reason: string | null }> {
  const connection = await getGoogleConnection(db, websiteId);
  if (!connection || !connection.selectedProperty) {
    await recordIndexingAction(db, websiteId, 'sitemap_submit', { actorUserId: userId, targetSitemap: sitemapUrl, submissionState: 'not_applicable' });
    return { submitted: false, reason: 'Connect a Google Search Console property for this website first.' };
  }
  if (!hasWriteScope(connection)) {
    await recordIndexingAction(db, websiteId, 'sitemap_submit', { actorUserId: userId, targetSitemap: sitemapUrl, submissionState: 'not_applicable' });
    return { submitted: false, reason: 'Enable sitemap submission to grant the additional Google scope first.' };
  }
  const accessToken = await getValidAccessToken(db, env, websiteId);
  if (!accessToken) {
    await recordIndexingAction(db, websiteId, 'sitemap_submit', { actorUserId: userId, targetSitemap: sitemapUrl, submissionState: 'failed' });
    return { submitted: false, reason: 'Google access needs to be reconnected.' };
  }
  const ok = await submitSitemap(accessToken, connection.selectedProperty, sitemapUrl);
  await recordIndexingAction(db, websiteId, 'sitemap_submit', { actorUserId: userId, targetSitemap: sitemapUrl, submissionState: ok ? 'submitted' : 'failed' });
  return { submitted: ok, reason: ok ? null : 'Google did not accept this sitemap submission.' };
}

/** There is no general "request indexing" API; this hands the customer Google's own inspection link to act on themselves. */
export async function buildSearchConsoleHandoff(db: Database, websiteId: string, inspectionResultLink: string | null, userId: string): Promise<string | null> {
  await recordIndexingAction(db, websiteId, 'search_console_handoff', { actorUserId: userId, submissionState: inspectionResultLink ? 'submitted' : 'not_applicable', outcomeEvidence: { inspectionResultLink } });
  return inspectionResultLink;
}

export interface IndexNowAdapter { availability(): AdapterAvailability }
export function resolveIndexNowAdapter(): IndexNowAdapter {
  return { availability: () => ({ available: false, reason: 'IndexNow is not enabled on this deployment. It needs a verified per-host key before any URL can be submitted.' }) };
}

export interface GoogleIndexingApiAdapter { availability(targetUrl: string): AdapterAvailability }
export function resolveGoogleIndexingApiAdapter(): GoogleIndexingApiAdapter {
  return {
    availability: () => ({ available: false, reason: "The Google Indexing API only covers JobPosting and BroadcastEvent-in-VideoObject pages, and no eligibility check is configured on this deployment." }),
  };
}

function safeJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try { const parsed = JSON.parse(value); return typeof parsed === 'object' && parsed ? parsed : {}; } catch { return {}; }
}
