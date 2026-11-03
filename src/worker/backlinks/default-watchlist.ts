/**
 * Default backlink watchlist for a website that has no monitors yet.
 *
 * With no backlink-index provider configured (see discovery.ts), the only native
 * source of inbound links is public web search. Each result is fetched, and it is
 * kept only when its HTML actually links to the target. A page that merely mentions
 * the domain is never tracked, so every monitor starts from evidence.
 *
 * The target is the root domain. Only when that finds no link, and the user has saved
 * key pages (the site profile's important pages), are those pages searched instead.
 */
import { collectSerp } from '../intelligence/serp';
import { readIntelligenceConfig, type IntelligenceConfig, type IntelligenceEnvironment } from '../intelligence/config';
import { DEFAULT_WATCHLIST_SIZE, rootHostOf, rootTargetUrlFor, type DefaultWatchlistResult, type MatchMode } from '../../shared/backlinks';
import { newId } from './capacity';
import { fetchSourcePage } from './crawl';
import { BacklinkCapacityError, createBacklinkMonitor } from './monitors';
import { extractOccurrences } from './parser';
import { matchesExpectedTarget, normalizeUrlForIdentity, type UrlIdentity } from './url-identity';

type Database = any;

export const WATCHLIST_IDEMPOTENCY_KEY = 'default-watchlist';
export const WATCHLIST_PROVIDER = 'public-web-search';
/** Most key pages a website can save. */
export const MAX_KEY_PAGES = 10;
/** The fallback searches this many saved key pages, in the order they were saved. */
const KEY_PAGES_SEARCHED = 3;
const WATCHLIST_NOTE = 'Found automatically: the page was fetched and its HTML links to the tracked target.';
const ROOT_PAGE_BUDGET = 16;
const KEY_PAGE_BUDGET = 8;
const FETCH_CONCURRENCY = 4;
const RESULTS_PER_QUERY = 20;
const STALE_RUN_MS = 10 * 60 * 1000;

export interface WatchTarget { url: string; matchMode: MatchMode }

export interface WatchlistSearchResult { urls: string[]; blockedReason: string | null }

/** Injected so the selection logic can be tested without the network. */
export interface WatchlistDeps {
  search(query: string): Promise<WatchlistSearchResult>;
  /** `html` is null when the page could not be fetched as usable HTML. */
  fetchPage(url: string): Promise<{ html: string | null; finalUrl: string | null }>;
}

export interface WatchlistFinding {
  target: WatchTarget;
  candidatesFound: number;
  candidatesChecked: number;
  verifiedSourceUrls: string[];
  /** Set only when every search failed to produce usable results and no candidate was found. */
  searchBlockedReason: string | null;
}

export interface WatchlistSource { sourceUrl: string; target: WatchTarget }

export interface WatchlistPlan {
  sources: WatchlistSource[];
  rootCandidatesFound: number;
  pagesChecked: number;
  keyPagesSearched: number;
  /** Set when the root-domain search could not be read. Key pages are not searched then. */
  searchBlockedReason: string | null;
}

export function watchlistQueries(rootHost: string, target: WatchTarget): string[] {
  if (target.matchMode === 'domain_wide') return [`"${rootHost}" -site:${rootHost}`, `${rootHost} -site:${rootHost}`];
  return [`"${target.url.replace(/^https?:\/\//, '')}" -site:${rootHost}`];
}

/**
 * Finds up to `size` public pages whose markup links to the target. The site's own pages
 * are excluded because they are not inbound links. At most `pageBudget` pages are fetched.
 */
export async function findLinkingPages(rootHost: string, target: WatchTarget, deps: WatchlistDeps, size: number, pageBudget: number): Promise<WatchlistFinding> {
  const identity = normalizeUrlForIdentity(target.url);
  const queries = watchlistQueries(rootHost, target);

  const candidates: string[] = [];
  const seen = new Set<string>();
  const blockedReasons: string[] = [];
  for (const query of queries) {
    const result = await deps.search(query);
    if (result.blockedReason) blockedReasons.push(result.blockedReason);
    for (const url of result.urls) {
      let candidate: UrlIdentity;
      try { candidate = normalizeUrlForIdentity(url); } catch { continue; }
      if (candidate.hostname === rootHost || candidate.hostname.endsWith(`.${rootHost}`)) continue;
      if (seen.has(candidate.normalized)) continue;
      seen.add(candidate.normalized);
      candidates.push(url);
    }
  }

  // Pages are fetched in small parallel batches, and a batch never exceeds what is still needed,
  // so the search stops at `size` verified links without fetching surplus pages.
  const pool = candidates.slice(0, pageBudget);
  const verifiedSourceUrls: string[] = [];
  let candidatesChecked = 0;
  while (candidatesChecked < pool.length && verifiedSourceUrls.length < size) {
    const batch = pool.slice(candidatesChecked, candidatesChecked + Math.min(FETCH_CONCURRENCY, size - verifiedSourceUrls.length));
    const pages = await Promise.all(batch.map(url => deps.fetchPage(url)));
    candidatesChecked += batch.length;
    batch.forEach((url, index) => {
      if (pageLinksTo(pages[index], url, identity, target.matchMode)) verifiedSourceUrls.push(url);
    });
  }

  const allSearchesBlocked = blockedReasons.length === queries.length;
  return {
    target,
    candidatesFound: candidates.length,
    candidatesChecked,
    verifiedSourceUrls,
    searchBlockedReason: candidates.length === 0 && allSearchesBlocked ? blockedReasons[0] : null,
  };
}

/** True when a fetched page's markup links to the target. A page that could not be read as HTML never qualifies. */
function pageLinksTo(page: { html: string | null; finalUrl: string | null }, url: string, target: UrlIdentity, matchMode: MatchMode): boolean {
  if (!page.html) return false;
  return extractOccurrences(page.html, page.finalUrl || url).some(occurrence =>
    occurrence.resolvedUrl !== null && matchesExpectedTarget(occurrence.resolvedUrl, target.normalized, target.hostname, matchMode));
}

/**
 * Chooses the monitors to create. The root domain is searched first. The key-page fallback runs
 * only when that search found no verified link and the user has saved key pages.
 */
export async function planWatchlist(rootHost: string, keyPages: string[], deps: WatchlistDeps): Promise<WatchlistPlan> {
  const root = await findLinkingPages(rootHost, { url: rootTargetUrlFor(rootHost), matchMode: 'domain_wide' }, deps, DEFAULT_WATCHLIST_SIZE, ROOT_PAGE_BUDGET);
  const sources: WatchlistSource[] = root.verifiedSourceUrls.map(sourceUrl => ({ sourceUrl, target: root.target }));
  let pagesChecked = root.candidatesChecked;
  let keyPagesSearched = 0;

  if (sources.length === 0 && !root.searchBlockedReason) {
    for (const url of keyPages.slice(0, KEY_PAGES_SEARCHED)) {
      const target: WatchTarget = { url, matchMode: 'exact_page' };
      const finding = await findLinkingPages(rootHost, target, deps, DEFAULT_WATCHLIST_SIZE - sources.length, KEY_PAGE_BUDGET);
      keyPagesSearched += 1;
      pagesChecked += finding.candidatesChecked;
      for (const sourceUrl of finding.verifiedSourceUrls) sources.push({ sourceUrl, target });
      if (sources.length >= DEFAULT_WATCHLIST_SIZE) break;
    }
  }

  return { sources, rootCandidatesFound: root.candidatesFound, pagesChecked, keyPagesSearched, searchBlockedReason: root.searchBlockedReason };
}

/**
 * Keeps only the site's own pages, as normalized absolute URLs. Relative paths resolve against the
 * root domain. The root itself, duplicates, and invalid or off-site entries are dropped.
 */
export function normalizeKeyPages(values: unknown, rootHost: string): string[] {
  if (!Array.isArray(values)) return [];
  const rootNormalized = normalizeUrlForIdentity(rootTargetUrlFor(rootHost)).normalized;
  const pages: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    let identity: UrlIdentity;
    try {
      identity = normalizeUrlForIdentity(new URL(value.trim(), rootTargetUrlFor(rootHost)).href);
    } catch { continue; }
    const ownHost = identity.hostname === rootHost || identity.hostname === `www.${rootHost}`;
    if (!ownHost || identity.normalized === rootNormalized || pages.includes(identity.normalized)) continue;
    pages.push(identity.normalized);
    if (pages.length === MAX_KEY_PAGES) break;
  }
  return pages;
}

export async function readKeyPages(db: Database, websiteId: string, rootHost: string): Promise<string[]> {
  const row = await db.prepare('SELECT important_pages_json FROM site_profiles WHERE website_id = ?').bind(websiteId).first();
  return normalizeKeyPages(parseJsonArray(row?.important_pages_json), rootHost);
}

/**
 * Saves the user's key pages. When no monitor exists yet, a finished run is cleared so the next
 * visit searches with the new pages. A run in progress is left alone.
 */
export async function saveKeyPages(db: Database, website: { id: string; domain: string }, values: unknown): Promise<string[]> {
  const pages = normalizeKeyPages(values, rootHostOf(website.domain));
  await db.prepare(`
    INSERT INTO site_profiles (website_id, important_pages_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(website_id) DO UPDATE SET important_pages_json = excluded.important_pages_json, updated_at = excluded.updated_at
  `).bind(website.id, JSON.stringify(pages), new Date().toISOString()).run();

  if (!(await hasMonitors(db, website.id))) {
    await db.prepare(`
      DELETE FROM discovery_jobs WHERE website_id = ? AND idempotency_key = ? AND status IN ('complete', 'unavailable', 'failed')
    `).bind(website.id, WATCHLIST_IDEMPOTENCY_KEY).run();
  }
  return pages;
}

function parseJsonArray(raw: unknown): unknown {
  try { return JSON.parse(typeof raw === 'string' ? raw : '[]'); } catch { return []; }
}

function publicWebDeps(config: IntelligenceConfig): WatchlistDeps {
  return {
    async search(query) {
      try {
        const collection = await collectSerp({ surface: 'bing', query, countryCode: 'us', languageCode: 'en', device: 'desktop', resultLimit: RESULTS_PER_QUERY }, config);
        const usable = collection.coverage.status === 'complete' || collection.coverage.status === 'partial';
        return {
          urls: collection.results.flatMap(record => record.url ? [record.url] : []),
          blockedReason: usable ? null : collection.coverage.reason || 'Public search returned no usable results.',
        };
      } catch (error) {
        return { urls: [], blockedReason: error instanceof Error ? error.message : 'Public search request failed.' };
      }
    },
    async fetchPage(url) {
      const page = await fetchSourcePage(url);
      return { html: page.outcome === 'success' ? page.html : null, finalUrl: page.finalUrl };
    },
  };
}

/**
 * Seeds the watchlist once per website. It does nothing when the website already has
 * monitors, and a run that is in progress or already complete is never repeated; only a
 * run that was unavailable or failed is retried. Monitors are created only for pages
 * whose HTML was verified to link to their target.
 */
export async function seedDefaultBacklinkWatchlist(
  db: Database,
  env: unknown,
  website: { id: string; domain: string; organizationId: string },
  userId: string,
): Promise<DefaultWatchlistResult> {
  const rootHost = rootHostOf(website.domain);
  const rootTargetUrl = rootTargetUrlFor(website.domain);

  if (await hasMonitors(db, website.id)) {
    return { status: 'complete', rootTargetUrl, candidatesChecked: 0, linksVerified: 0, monitorsAdded: 0, reason: 'This website already has monitored backlinks.' };
  }

  const claimed = await claimWatchlistRun(db, website.id, userId);
  if (!claimed) return readWatchlistRun(db, website.id, rootTargetUrl);

  let plan: WatchlistPlan;
  try {
    const keyPages = await readKeyPages(db, website.id, rootHost);
    plan = await planWatchlist(rootHost, keyPages, publicWebDeps(readIntelligenceConfig(env as IntelligenceEnvironment)));
  } catch (error) {
    const reason = `Public link search failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await finishWatchlistRun(db, website.id, 'failed', reason, 0, 0);
    return { status: 'failed', rootTargetUrl, candidatesChecked: 0, linksVerified: 0, monitorsAdded: 0, reason };
  }

  let monitorsAdded = 0;
  for (const { sourceUrl, target } of plan.sources) {
    const sourceNormalized = normalizeUrlForIdentity(sourceUrl).normalized;
    const targetNormalized = normalizeUrlForIdentity(target.url).normalized;
    // An existing monitor is left as the user set it: a paused one is not reactivated.
    const existing = await db.prepare(`
      SELECT 1 AS found FROM backlink_monitors WHERE website_id = ? AND source_url_normalized = ? AND expected_target_normalized = ? LIMIT 1
    `).bind(website.id, sourceNormalized, targetNormalized).first();
    if (existing) continue;
    try {
      const { created } = await createBacklinkMonitor(db, website.id, website.organizationId, userId, {
        sourceUrl, expectedTargetUrl: target.url, matchMode: target.matchMode, cadence: 'weekly', notes: WATCHLIST_NOTE,
      });
      if (created) monitorsAdded += 1;
    } catch (error) {
      if (error instanceof BacklinkCapacityError) break;
      // One unusable source is skipped; the rest of the watchlist is still tracked.
    }
  }

  const status: DefaultWatchlistResult['status'] = plan.searchBlockedReason ? 'unavailable' : 'complete';
  const reason = describePlan(plan, rootHost);
  await finishWatchlistRun(db, website.id, status, reason, plan.pagesChecked, plan.sources.length);
  return { status, rootTargetUrl, candidatesChecked: plan.pagesChecked, linksVerified: plan.sources.length, monitorsAdded, reason };
}

function describePlan(plan: WatchlistPlan, rootHost: string): string {
  if (plan.searchBlockedReason) return `Public web search could not be read: ${plan.searchBlockedReason}`;
  const count = plan.sources.length;
  if (count > 0 && plan.keyPagesSearched > 0) {
    return `No public page links to ${rootHost}. Found ${count} that link to its key pages.`;
  }
  if (count > 0) {
    return count === 1 ? `Found 1 public page that links to ${rootHost}.` : `Found ${count} public pages that link to ${rootHost}.`;
  }
  if (plan.keyPagesSearched > 0) {
    return `Checked ${plan.pagesChecked} public pages; none links to ${rootHost} or its ${plan.keyPagesSearched} key page${plan.keyPagesSearched === 1 ? '' : 's'}.`;
  }
  if (plan.rootCandidatesFound === 0) return `Public web search found no pages outside ${rootHost} to check.`;
  return `Checked ${plan.pagesChecked} public page${plan.pagesChecked === 1 ? '' : 's'}; none links to ${rootHost}.`;
}

async function hasMonitors(db: Database, websiteId: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 AS found FROM backlink_monitors WHERE website_id = ? LIMIT 1').bind(websiteId).first());
}

/** Inserts the run marker, or claims an unavailable/failed one for retry. Returns false when another run owns it. */
async function claimWatchlistRun(db: Database, websiteId: string, userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const inserted = await db.prepare(`
    INSERT INTO discovery_jobs (id, website_id, provider, status, budget_requested, retrieved_count, unique_count, duplicate_count, idempotency_key, error_message, requested_by, created_at)
    VALUES (?, ?, ?, 'running', ?, 0, 0, 0, ?, NULL, ?, ?)
    ON CONFLICT(website_id, idempotency_key) DO NOTHING
  `).bind(newId('discovery'), websiteId, WATCHLIST_PROVIDER, ROOT_PAGE_BUDGET, WATCHLIST_IDEMPOTENCY_KEY, userId, now).run();
  if (inserted?.meta?.changes) return true;

  // A run left "running" by a crashed Worker is reclaimed once it is clearly stale.
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const retried = await db.prepare(`
    UPDATE discovery_jobs SET status = 'running', error_message = NULL, completed_at = NULL, created_at = ?
    WHERE website_id = ? AND idempotency_key = ?
      AND (status IN ('unavailable', 'failed') OR (status = 'running' AND created_at < ?))
  `).bind(now, websiteId, WATCHLIST_IDEMPOTENCY_KEY, staleBefore).run();
  return Boolean(retried?.meta?.changes);
}

async function finishWatchlistRun(db: Database, websiteId: string, status: string, reason: string, checked: number, verified: number): Promise<void> {
  await db.prepare(`
    UPDATE discovery_jobs SET status = ?, error_message = ?, retrieved_count = ?, unique_count = ?, completed_at = ?
    WHERE website_id = ? AND idempotency_key = ?
  `).bind(status, reason, checked, verified, new Date().toISOString(), websiteId, WATCHLIST_IDEMPOTENCY_KEY).run();
}

async function readWatchlistRun(db: Database, websiteId: string, rootTargetUrl: string): Promise<DefaultWatchlistResult> {
  const row = await db.prepare('SELECT * FROM discovery_jobs WHERE website_id = ? AND idempotency_key = ?').bind(websiteId, WATCHLIST_IDEMPOTENCY_KEY).first();
  if (!row) return { status: 'running', rootTargetUrl, candidatesChecked: 0, linksVerified: 0, monitorsAdded: 0, reason: 'A public link search is already in progress.' };
  return {
    status: row.status,
    rootTargetUrl,
    candidatesChecked: Number(row.retrieved_count ?? 0),
    linksVerified: Number(row.unique_count ?? 0),
    monitorsAdded: 0,
    reason: row.status === 'running' ? 'A public link search is already in progress.' : row.error_message,
  };
}
