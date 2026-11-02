/**
 * The backlink check pipeline: fetch the source page under the same SSRF and
 * robots protections as the site crawler, classify the attempt, extract
 * occurrences, and advance the monitor's state. An inconclusive attempt
 * (timeout, block, challenge, truncation) never overwrites a confirmed
 * state; a suspected loss needs a second independent confirmation (spec:
 * false positive protection; AC7, AC8, AC9, AC10, AC11, AC12).
 */
import { isPublicCrawlUrl, parseRobotsRules, robotsRulesAllow } from '../crawlers/base';
import { extractOccurrences, extractSourceDirectives, type RawOccurrence } from './parser';
import { matchesExpectedTarget, normalizeUrlForIdentity } from './url-identity';
import { advanceMonitorState, getBacklinkMonitor, mapMonitorRow, nextCheckAt } from './monitors';
import { newId } from './capacity';
import { recordTargetHealthFinding } from './destination-findings';
import type { BacklinkEventType, ConfirmationState, FetchOutcome, MonitorCadence, Presence, PresenceMethod } from '../../shared/backlinks';
import { readIntelligenceConfig, type IntelligenceEnvironment } from '../intelligence/config';

type Database = any;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const CONFIRMATION_WINDOW_HOURS = 6;
const INCONCLUSIVE_RETRY_HOURS = 6;
const USER_AGENT = 'RoundSEO-BacklinkMonitor/1.0 (+https://roundseo.com)';

export interface BacklinkCrawlEnv extends IntelligenceEnvironment {
  DB: Database;
}

export interface SourceFetchResult {
  outcome: FetchOutcome;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: string[];
  contentType: string | null;
  xRobotsTag: string | null;
  html: string | null;
  truncated: boolean;
  errorMessage: string | null;
}

const EMPTY_RESULT: Omit<SourceFetchResult, 'outcome' | 'errorMessage'> = { httpStatus: null, finalUrl: null, redirectChain: [], contentType: null, xRobotsTag: null, html: null, truncated: false };

export async function fetchSourcePage(sourceUrl: string): Promise<SourceFetchResult> {
  if (!isPublicCrawlUrl(sourceUrl)) return { outcome: 'blocked', ...EMPTY_RESULT, errorMessage: 'Not a public HTTP or HTTPS URL.' };

  let robotsAllowed = true;
  try {
    const robotsUrl = new URL('/robots.txt', sourceUrl).href;
    const robotsResponse = await fetchWithTimeout(robotsUrl);
    if (robotsResponse.ok) robotsAllowed = robotsRulesAllow(parseRobotsRules(await robotsResponse.text()), sourceUrl);
  } catch { /* A missing or unreachable robots.txt does not block the check. */ }
  if (!robotsAllowed) return { outcome: 'robots_disallowed', ...EMPTY_RESULT, errorMessage: 'Disallowed by robots.txt.' };

  const redirectChain: string[] = [];
  let currentUrl = sourceUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicCrawlUrl(currentUrl)) return { outcome: 'blocked', ...EMPTY_RESULT, finalUrl: currentUrl, redirectChain, errorMessage: 'A redirect left the public web.' };
    let response: Response;
    try {
      response = await fetchWithTimeout(currentUrl, { redirect: 'manual' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      return { outcome: /timeout|aborted/i.test(message) ? 'timeout' : 'http_error', ...EMPTY_RESULT, finalUrl: currentUrl, redirectChain, errorMessage: message };
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      let nextUrl: string;
      try { nextUrl = new URL(location, currentUrl).href; } catch { return { outcome: 'http_error', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, errorMessage: 'Invalid redirect location.' }; }
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      if (hop === MAX_REDIRECTS) return { outcome: 'too_many_redirects', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, errorMessage: null };
      continue;
    }
    const contentType = response.headers.get('content-type');
    const xRobotsTag = response.headers.get('x-robots-tag');
    if (response.status === 401 || response.status === 403) return { outcome: 'blocked', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, contentType, xRobotsTag, errorMessage: null };
    if (response.status === 429) return { outcome: 'blocked', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, contentType, xRobotsTag, errorMessage: 'Rate limited.' };
    if (response.status >= 200 && response.status < 300 && contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return { outcome: 'unsupported_content', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, contentType, xRobotsTag, errorMessage: null };
    }
    const bodyResult = await readBoundedBody(response, MAX_BODY_BYTES);
    if (response.status >= 500) return { outcome: 'http_error', ...EMPTY_RESULT, httpStatus: response.status, finalUrl: currentUrl, redirectChain, contentType, xRobotsTag, errorMessage: `Server error ${response.status}.` };
    return {
      outcome: bodyResult.truncated ? 'truncated' : 'success',
      httpStatus: response.status, finalUrl: currentUrl, redirectChain, contentType, xRobotsTag,
      html: bodyResult.truncated ? null : bodyResult.text, truncated: bodyResult.truncated, errorMessage: null,
    };
  }
  return { outcome: 'too_many_redirects', ...EMPTY_RESULT, finalUrl: currentUrl, redirectChain, errorMessage: null };
}

export interface TargetFetchResult { statusCode: number | null; finalUrl: string | null; redirectChain: string[] }

export async function fetchTargetHealth(targetUrl: string): Promise<TargetFetchResult> {
  if (!isPublicCrawlUrl(targetUrl)) return { statusCode: null, finalUrl: null, redirectChain: [] };
  const redirectChain: string[] = [];
  let currentUrl = targetUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicCrawlUrl(currentUrl)) return { statusCode: null, finalUrl: currentUrl, redirectChain };
    let response: Response;
    try { response = await fetchWithTimeout(currentUrl, { method: 'GET', redirect: 'manual' }); } catch { return { statusCode: null, finalUrl: currentUrl, redirectChain }; }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      try { currentUrl = new URL(location, currentUrl).href; } catch { return { statusCode: response.status, finalUrl: currentUrl, redirectChain }; }
      redirectChain.push(currentUrl);
      continue;
    }
    await response.body?.cancel().catch(() => undefined);
    return { statusCode: response.status, finalUrl: currentUrl, redirectChain };
  }
  return { statusCode: null, finalUrl: currentUrl, redirectChain };
}

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) { const text = await response.text(); return { text, truncated: new TextEncoder().encode(text).length > maxBytes }; }
  const decoder = new TextDecoder();
  let length = 0; let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) { await reader.cancel().catch(() => undefined); return { text: '', truncated: true }; }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

export interface CheckResult { observationId: string; events: BacklinkEventType[] }

/** Runs one check for a monitor and advances its state. `jobId` must belong to this monitor. */
export async function runBacklinkCheck(db: Database, env: BacklinkCrawlEnv, monitorId: string, jobId: string): Promise<CheckResult> {
  const monitor = await getBacklinkMonitor(db, monitorId);
  if (!monitor) return { observationId: '', events: [] };
  const attemptedAt = new Date().toISOString();
  const fetched = await fetchSourcePage(monitor.sourceUrl);

  let presence: Presence = 'unknown';
  let presenceMethod: PresenceMethod = 'html';
  let occurrences: RawOccurrence[] = [];
  let directives = { metaRobots: null as string | null, canonical: null as string | null };
  let targetHealth: TargetFetchResult = { statusCode: null, finalUrl: null, redirectChain: [] };
  let matched: RawOccurrence | null = null;

  if (fetched.outcome === 'success' && fetched.html !== null) {
    occurrences = extractOccurrences(fetched.html, fetched.finalUrl || monitor.sourceUrl);
    directives = extractSourceDirectives(fetched.html);
    const targetIdentity = normalizeUrlForIdentity(monitor.expectedTargetUrl);
    matched = occurrences.find(o => o.resolvedUrl && matchesExpectedTarget(o.resolvedUrl, targetIdentity.normalized, targetIdentity.hostname, monitor.matchMode)) || null;
    if (matched) {
      presence = 'present';
      targetHealth = await fetchTargetHealth(matched.resolvedUrl!);
    } else if (looksLikeClientRenderedShell(fetched.html, occurrences.length)) {
      const rendered = await tryRenderFallback(env, monitor.sourceUrl);
      if (rendered) {
        presenceMethod = 'rendered';
        occurrences = extractOccurrences(rendered.html, rendered.finalUrl);
        directives = extractSourceDirectives(rendered.html);
        const targetIdentity2 = normalizeUrlForIdentity(monitor.expectedTargetUrl);
        matched = occurrences.find(o => o.resolvedUrl && matchesExpectedTarget(o.resolvedUrl, targetIdentity2.normalized, targetIdentity2.hostname, monitor.matchMode)) || null;
        presence = matched ? 'present' : 'absent';
        if (matched) targetHealth = await fetchTargetHealth(matched.resolvedUrl!);
      } else {
        presence = 'unknown'; // Rendering was needed but is not available; never confirm a loss on this basis (AC10).
      }
    } else {
      presence = 'absent';
    }
  }

  const observationId = newId('obs');
  await db.prepare(`
    INSERT INTO backlink_observations (
      id, monitor_id, job_id, attempted_at, fetch_outcome, http_status, final_url, redirect_chain_json, content_type,
      presence, presence_method, confirmation_state, target_status_code, target_final_url, target_redirect_json,
      source_meta_robots, source_x_robots_tag, source_canonical, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    observationId, monitorId, jobId, attemptedAt, fetched.outcome, fetched.httpStatus, fetched.finalUrl,
    JSON.stringify(fetched.redirectChain), fetched.contentType, presence, presenceMethod,
    targetHealth.statusCode, targetHealth.finalUrl, JSON.stringify(targetHealth.redirectChain),
    directives.metaRobots, fetched.xRobotsTag, directives.canonical, fetched.errorMessage, attemptedAt,
  ).run();

  for (const occurrence of occurrences) {
    await db.prepare(`
      INSERT INTO backlink_occurrences (id, observation_id, monitor_id, original_href, resolved_url, anchor_text, image_alt, rel_tokens_json, element_kind, locator, context_fingerprint, matches_expected_target, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId('occ'), observationId, monitorId, occurrence.originalHref, occurrence.resolvedUrl || occurrence.originalHref,
      occurrence.anchorText, occurrence.imageAlt, JSON.stringify(occurrence.relTokens), occurrence.elementKind,
      String(occurrence.index), occurrence.contextFingerprint, occurrence === matched ? 1 : 0, attemptedAt,
    ).run();
  }

  const { events, confirmationState } = await resolveMonitorTransition(db, monitor, observationId, attemptedAt, fetched, presence, matched, directives, targetHealth);
  await db.prepare('UPDATE backlink_observations SET confirmation_state = ? WHERE id = ?').bind(confirmationState, observationId).run();

  if (matched) {
    const monitorCount = await countMonitorsForTarget(db, monitor.websiteId, monitor.expectedTargetUrl);
    await recordTargetHealthFinding(db, { websiteId: monitor.websiteId, targetUrl: monitor.expectedTargetUrl, targetStatusCode: targetHealth.statusCode, targetFinalUrl: targetHealth.finalUrl, monitorCount });
  }

  return { observationId, events };
}

function looksLikeClientRenderedShell(html: string, anchorCount: number): boolean {
  if (anchorCount > 2) return false;
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyText = bodyMatch ? bodyMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const hasAppShell = /id=["'](root|app|__next|___gatsby)["']/i.test(html) || /<script[^>]*type=["']module["']/i.test(html);
  return hasAppShell && bodyText.length < 400;
}

async function tryRenderFallback(env: BacklinkCrawlEnv, url: string): Promise<{ html: string; finalUrl: string } | null> {
  const config = readIntelligenceConfig(env);
  if (!config.runner) return null;
  try {
    const response = await fetch(`${config.runner.url}/render`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.runner.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url, device: 'desktop' }), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 2),
    });
    if (!response.ok) return null;
    const body = await response.json() as { html?: string; finalUrl?: string };
    if (typeof body.html !== 'string') return null;
    return { html: body.html, finalUrl: typeof body.finalUrl === 'string' ? body.finalUrl : url };
  } catch { return null; }
}

async function countMonitorsForTarget(db: Database, websiteId: string, targetUrl: string): Promise<number> {
  const identity = normalizeUrlForIdentity(targetUrl);
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM backlink_monitors WHERE website_id = ? AND expected_target_normalized = ? AND status = 'active'`).bind(websiteId, identity.normalized).first();
  return Number(row?.count ?? 1);
}

async function resolveMonitorTransition(
  db: Database, monitor: ReturnType<typeof mapMonitorRow>, observationId: string, attemptedAt: string,
  fetched: SourceFetchResult, presence: Presence, matched: RawOccurrence | null, directives: { metaRobots: string | null },
  targetHealth: TargetFetchResult,
): Promise<{ events: BacklinkEventType[]; confirmationState: ConfirmationState }> {
  const events: BacklinkEventType[] = [];
  const confirmationPending = Boolean(monitor.pendingConfirmationObservationId);
  const record = async (type: BacklinkEventType, priorObservationId: string | null, confirmationState: ConfirmationState, detail: Record<string, unknown> = {}) => {
    await recordEvent(db, monitor.id, type, priorObservationId, observationId, confirmationState, detail);
    events.push(type);
  };

  if (fetched.outcome !== 'success') {
    await advanceMonitorState(db, monitor.id, attemptedAt, { nextCheckAt: addHours(attemptedAt, INCONCLUSIVE_RETRY_HOURS) });
    return { events, confirmationState: 'unconfirmed' };
  }

  if (presence === 'unknown') {
    await advanceMonitorState(db, monitor.id, attemptedAt, { nextCheckAt: addHours(attemptedAt, INCONCLUSIVE_RETRY_HOURS) });
    await record('verification_pending', null, 'pending_confirmation');
    return { events, confirmationState: 'pending_confirmation' };
  }

  if (presence === 'present') {
    await advanceMonitorState(db, monitor.id, attemptedAt, { presence: 'present', confirmedAt: attemptedAt, nextCheckAt: nextCheckAt(monitor.cadence, attemptedAt), confirmationDueAt: null, pendingConfirmationObservationId: null });
    // Only a genuine recovery from a previously confirmed loss is an event; a
    // first-ever check establishes the baseline silently (no "recovery" from nothing).
    if (monitor.lastConfirmedPresence === 'absent') {
      await record('recovered', null, 'confirmed');
      return { events, confirmationState: 'confirmed' };
    }
    if (monitor.lastConfirmedPresence === 'unknown') return { events, confirmationState: 'confirmed' };
    const prior = await priorPresentObservation(db, monitor.id, observationId);
    if (prior && matched) {
      const priorOccurrence = await db.prepare(`SELECT * FROM backlink_occurrences WHERE observation_id = ? AND context_fingerprint = ? AND matches_expected_target = 1 LIMIT 1`).bind(prior.id, matched.contextFingerprint).first();
      // Fingerprint match is required; identical anchor text alone never establishes occurrence identity (AC25).
      if (priorOccurrence) {
        if (String(priorOccurrence.resolved_url) !== (matched.resolvedUrl || '')) await record('target_changed', String(prior.id), 'confirmed', { from: priorOccurrence.resolved_url, to: matched.resolvedUrl });
        if ((priorOccurrence.anchor_text || null) !== (matched.anchorText || null)) await record('anchor_changed', String(prior.id), 'confirmed', { from: priorOccurrence.anchor_text, to: matched.anchorText });
        const priorRel = safeParseArray(priorOccurrence.rel_tokens_json);
        if (JSON.stringify([...priorRel].sort()) !== JSON.stringify([...matched.relTokens].sort())) await record('rel_changed', String(prior.id), 'confirmed', { from: priorRel, to: matched.relTokens });
      }
    }
    if (prior) {
      const wasNoindex = isNoindex(prior.source_meta_robots, prior.source_x_robots_tag);
      const nowNoindex = isNoindex(directives.metaRobots, fetched.xRobotsTag);
      if (wasNoindex !== nowNoindex) await record('source_noindex_changed', String(prior.id), 'confirmed', { from: wasNoindex, to: nowNoindex });
      const wasRedirected = Boolean(safeParseArray(prior.redirect_chain_json).length);
      if (!wasRedirected && fetched.redirectChain.length) await record('source_redirected', String(prior.id), 'confirmed', { to: fetched.finalUrl });
      const wasBroken = isBrokenStatus(prior.target_status_code === null ? null : Number(prior.target_status_code));
      const nowBroken = isBrokenStatus(targetHealth.statusCode);
      if (!wasBroken && nowBroken) await record('target_broken', String(prior.id), 'confirmed', { statusCode: targetHealth.statusCode });
    }
    return { events, confirmationState: 'confirmed' };
  }

  // presence === 'absent'
  if (monitor.lastConfirmedPresence === 'present' && !confirmationPending) {
    await advanceMonitorState(db, monitor.id, attemptedAt, { nextCheckAt: addHours(attemptedAt, CONFIRMATION_WINDOW_HOURS), confirmationDueAt: addHours(attemptedAt, CONFIRMATION_WINDOW_HOURS), pendingConfirmationObservationId: observationId });
    return { events, confirmationState: 'pending_confirmation' };
  }
  await advanceMonitorState(db, monitor.id, attemptedAt, { presence: 'absent', confirmedAt: attemptedAt, nextCheckAt: nextCheckAt(monitor.cadence, attemptedAt), confirmationDueAt: null, pendingConfirmationObservationId: null });
  if (monitor.lastConfirmedPresence === 'present') await record('loss_confirmed', monitor.pendingConfirmationObservationId, 'confirmed');
  return { events, confirmationState: 'confirmed' };
}

function isNoindex(metaRobots: unknown, xRobotsTag: unknown): boolean {
  return /\bnoindex\b/i.test(String(metaRobots || '')) || /\bnoindex\b/i.test(String(xRobotsTag || ''));
}

function isBrokenStatus(status: number | null): boolean {
  return status !== null && (status === 404 || status === 410 || status >= 500);
}

async function priorPresentObservation(db: Database, monitorId: string, newObservationId: string): Promise<any | null> {
  return db.prepare(`
    SELECT id, source_meta_robots, source_x_robots_tag, redirect_chain_json, target_status_code
    FROM backlink_observations WHERE monitor_id = ? AND id != ? AND presence = 'present' ORDER BY attempted_at DESC LIMIT 1
  `).bind(monitorId, newObservationId).first();
}

function safeParseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

async function recordEvent(db: Database, monitorId: string, type: BacklinkEventType, priorObservationId: string | null, newObservationId: string, confirmationState: ConfirmationState, detail: Record<string, unknown>): Promise<void> {
  await db.prepare(`
    INSERT INTO backlink_events (id, monitor_id, event_type, prior_observation_id, new_observation_id, confirmation_state, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(monitor_id, event_type, new_observation_id) DO NOTHING
  `).bind(newId('event'), monitorId, type, priorObservationId, newObservationId, confirmationState, JSON.stringify(detail), new Date().toISOString()).run();
}

function addHours(iso: string, hours: number): string {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

export function cadenceRetryHours(_cadence: MonitorCadence): number {
  return INCONCLUSIVE_RETRY_HOURS;
}
