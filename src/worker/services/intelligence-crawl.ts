import type { EvidenceSource, IntelligenceRunRequest, IntelligenceRunStatus, PageEvidence, UnavailableMetric } from '../../shared/intelligence';
import { isPublicCrawlUrl, parseRobotsRules, robotsRulesAllow } from '../crawlers/base';
import { IntelligenceError } from '../intelligence/errors';
import { normalizeHost } from '../intelligence/html';
import { fetchPublicPage, type IntelligenceFetch } from '../intelligence/http';
import { extractPageContent, inspectPage, pageSource } from '../intelligence/pages';
import {
  appendIntelligenceEvidence,
  claimIntelligenceRun,
  consumeLiveRequests,
  countIntelligenceEvidence,
  crawlPageCounts,
  insertCrawlPages,
  markCrawlPage,
  nextQueuedCrawlPages,
  updateIntelligenceRun,
  type CrawlPageRecord,
  type IntelligenceRunRecord,
} from './intelligence-store';
import { isCrawlLinkCandidate, toEvidenceInput, type ExecutionScope } from './intelligence';

export const CRAWL_BATCH_SIZE = 5;
export const CRAWL_LEASE_SECONDS = 180;
const MAX_CRAWL_DEPTH = 20;
const ROBOTS_MAX_BYTES = 512 * 1024;

type CrawlRequest = Extract<IntelligenceRunRequest, { action: 'site_crawl' }>;
type CrawlCounts = { total: number; queued: number; fetched: number; failed: number; skipped: number };
export type CrawlBatchOutcome = 'continue' | 'finished' | 'idle';

/** Seed a durable crawl with its start URL. Nothing is fetched until a batch runs. */
export async function startSiteCrawl(scope: ExecutionScope, runId: string, request: CrawlRequest): Promise<void> {
  const start = request.startUrl || `https://${request.domain}/`;
  await insertCrawlPages(scope.db, scope.websiteId, runId, [{ url: start, depth: 0, discoveredFrom: null }]);
}

/**
 * Process one batch of a durable crawl under a lease. The caller re-enqueues
 * the run while the outcome is `continue`. An expired lease lets a crashed
 * batch be picked up again, and completed pages are never fetched twice.
 */
export async function runCrawlBatch(scope: ExecutionScope, runId: string): Promise<CrawlBatchOutcome> {
  const record = await claimIntelligenceRun(scope.db, runId, CRAWL_LEASE_SECONDS, clock(scope));
  if (!record) return 'idle';
  if (record.cancelRequestedAt) {
    await skipQueuedPages(scope, runId, 'Crawl cancelled before this page was fetched.');
    await finishCrawl(scope, record, 'cancelled', [], await crawlPageCounts(scope.db, runId));
    return 'finished';
  }

  const request = record.request as CrawlRequest;
  const maximumPages = Math.min(request.maximumPages, scope.config.maximumSiteCrawlPages);
  const fetcher = scope.fetcher;
  const robots = await readRobots(request.domain, fetcher);
  let dailyLimitReached = false;
  const evidence: PageEvidence[] = [];

  for (const page of await nextQueuedCrawlPages(scope.db, runId, CRAWL_BATCH_SIZE)) {
    if (!isCrawlLinkCandidate(page.url) || !isPublicCrawlUrl(page.url)) {
      await markCrawlPage(scope.db, page.id, { status: 'skipped', statusCode: null, errorMessage: 'Not a public HTML page.' });
      continue;
    }
    if (!robotsRulesAllow(robots.rules, page.url)) {
      await markCrawlPage(scope.db, page.id, { status: 'skipped', statusCode: null, errorMessage: 'Excluded by robots.txt.' });
      continue;
    }
    if (!(await consumeLiveRequests(scope.db, scope.websiteId, 1, scope.config.dailyRequestLimit, clock(scope)))) {
      dailyLimitReached = true;
      break;
    }
    try {
      const observedAt = clock(scope).toISOString();
      const analysis = request.extractContent
        ? await extractPageContent(page.url, { renderJavascript: false, config: scope.config, fetcher, observedAt })
        : await inspectPage(page.url, { renderJavascript: false, config: scope.config, fetcher, observedAt });
      await markCrawlPage(scope.db, page.id, { status: 'fetched', statusCode: analysis.page.statusCode, errorMessage: null });
      evidence.push(analysis.page);
      await enqueueDiscoveredLinks(scope, runId, request.domain, page, analysis.metrics?.links ?? [], maximumPages);
    } catch (error) {
      const message = error instanceof IntelligenceError ? error.message : 'The page could not be read.';
      await markCrawlPage(scope.db, page.id, { status: 'failed', statusCode: null, errorMessage: message });
    }
  }
  if (evidence.length) {
    await appendIntelligenceEvidence(scope.db, scope.websiteId, runId, evidence.map(toEvidenceInput));
  }

  const counts = await crawlPageCounts(scope.db, runId);
  const pageLimitReached = counts.fetched >= maximumPages;
  const finished = counts.queued === 0 || pageLimitReached || dailyLimitReached;
  if (!finished) {
    await updateIntelligenceRun(scope.db, scope.websiteId, runId, {
      status: 'queued',
      statusMessage: `RoundSEO crawled ${counts.fetched} page${counts.fetched === 1 ? '' : 's'} so far. ${counts.queued} waiting.`,
      progressCompleted: counts.fetched + counts.failed + counts.skipped,
      progressTotal: counts.total,
      leaseExpiresAt: null,
      unavailable: crawlGaps(robots.readable, counts, dailyLimitReached, maximumPages, pageLimitReached),
    });
    return 'continue';
  }

  if (counts.queued > 0) {
    await skipQueuedPages(scope, runId, pageLimitReached ? `The crawl stopped at its ${maximumPages}-page limit.` : 'The daily live-request limit was reached.');
  }
  const finalCounts = await crawlPageCounts(scope.db, runId);
  const status: IntelligenceRunStatus = finalCounts.total === 0 || (finalCounts.fetched === 0 && finalCounts.failed > 0)
    ? 'failed'
    : finalCounts.failed > 0 || finalCounts.skipped > 0 || dailyLimitReached || pageLimitReached
      ? 'partial'
      : 'complete';
  await finishCrawl(scope, record, status, crawlGaps(robots.readable, finalCounts, dailyLimitReached, maximumPages, pageLimitReached), finalCounts);
  return 'finished';
}

async function finishCrawl(scope: ExecutionScope, record: IntelligenceRunRecord, status: IntelligenceRunStatus, gaps: UnavailableMetric[], counts: CrawlCounts): Promise<void> {
  const evidenceCount = await countIntelligenceEvidence(scope.db, scope.websiteId, record.id);
  const checkedAt = clock(scope).toISOString();
  const source: EvidenceSource = pageSource(checkedAt, [
    'HTML responses only. Content added by JavaScript is not included.',
    'Coverage is the set of pages reachable from the start URL within robots rules and the page limit.',
  ]);
  await updateIntelligenceRun(scope.db, scope.websiteId, record.id, {
    status,
    statusMessage: finishMessage(status, counts),
    summary: {
      evidenceCount,
      keywordCount: 0,
      resultCount: 0,
      citationCount: 0,
      pagesCrawled: counts.fetched,
      pagesQueued: counts.queued,
      unavailableMetricCount: gaps.length,
    },
    source,
    unavailable: gaps,
    progressCompleted: counts.fetched + counts.failed + counts.skipped,
    progressTotal: counts.total,
    checkedAt,
    completedAt: checkedAt,
    leaseExpiresAt: null,
    errorCode: status === 'failed' ? 'SITE_CRAWL_FAILED' : null,
    errorMessage: status === 'failed' ? (counts.total === 0 ? 'The crawl had no start page to fetch.' : 'No pages in this crawl could be fetched.') : null,
  });
}

function finishMessage(status: IntelligenceRunStatus, counts: CrawlCounts): string {
  const pages = `${counts.fetched} page${counts.fetched === 1 ? '' : 's'}`;
  if (status === 'cancelled') return `Crawl cancelled after ${pages}. Collected pages remain saved.`;
  if (status === 'failed') return 'RoundSEO could not fetch any page in this crawl.';
  if (status === 'partial') return `RoundSEO crawled ${pages} with gaps. Review the coverage notes.`;
  return `RoundSEO crawled ${pages}.`;
}

/** Coverage gaps from cumulative counts, so a crawl finished in a later batch still reports earlier skips. */
function crawlGaps(
  robotsReadable: boolean,
  counts: CrawlCounts,
  dailyLimitReached: boolean,
  maximumPages: number,
  pageLimitReached: boolean,
): UnavailableMetric[] {
  const gaps: UnavailableMetric[] = [];
  if (!robotsReadable) gaps.push({ metric: 'robots.txt rules', reason: 'robots.txt could not be read, so its crawl rules were not applied to this crawl.' });
  if (counts.failed) gaps.push({ metric: 'some pages', reason: `${counts.failed} page${counts.failed === 1 ? '' : 's'} could not be fetched.` });
  if (counts.skipped) gaps.push({ metric: 'some pages', reason: `${counts.skipped} page${counts.skipped === 1 ? '' : 's'} were skipped, either excluded by robots.txt or not HTML pages.` });
  if (dailyLimitReached) gaps.push({ metric: 'remaining pages', reason: 'The daily live-request limit for this website was reached before the crawl finished.' });
  if (pageLimitReached) gaps.push({ metric: 'remaining pages', reason: `The crawl stopped at its ${maximumPages}-page limit, so the site may have more pages that were not inspected.` });
  return gaps;
}

async function skipQueuedPages(scope: ExecutionScope, runId: string, reason: string): Promise<void> {
  let batch: CrawlPageRecord[];
  do {
    batch = await nextQueuedCrawlPages(scope.db, runId, 100);
    for (const page of batch) await markCrawlPage(scope.db, page.id, { status: 'skipped', statusCode: null, errorMessage: reason });
  } while (batch.length === 100);
}

async function enqueueDiscoveredLinks(
  scope: ExecutionScope,
  runId: string,
  domain: string,
  page: CrawlPageRecord,
  links: Array<{ href: string; isInternal: boolean }>,
  maximumPages: number,
): Promise<void> {
  if (page.depth >= MAX_CRAWL_DEPTH) return;
  const host = normalizeHost(domain);
  const candidates: Array<{ url: string; depth: number; discoveredFrom: string | null }> = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!link.isInternal) continue;
    let resolved: URL;
    try { resolved = new URL(link.href, page.url); } catch { continue; }
    resolved.hash = '';
    if (normalizeHost(resolved.hostname) !== host) continue;
    const href = resolved.href;
    if (seen.has(href) || !isCrawlLinkCandidate(href) || !isPublicCrawlUrl(href)) continue;
    seen.add(href);
    candidates.push({ url: href, depth: page.depth + 1, discoveredFrom: page.url });
  }
  if (!candidates.length) return;
  const existing = await crawlPageCounts(scope.db, runId);
  const room = Math.max(0, maximumPages - existing.total);
  if (room === 0) return;
  await insertCrawlPages(scope.db, scope.websiteId, runId, candidates.slice(0, room));
}

async function readRobots(domain: string, fetcher?: IntelligenceFetch): Promise<{ rules: Array<{ path: string; allow: boolean }>; readable: boolean }> {
  try {
    const page = await fetchPublicPage(`https://${domain}/robots.txt`, { fetcher, maxBytes: ROBOTS_MAX_BYTES });
    if (page.status === 404 || page.status === 410) return { rules: [], readable: true };
    if (page.status !== 200) return { rules: [], readable: false };
    return { rules: parseRobotsRules(page.html), readable: true };
  } catch {
    return { rules: [], readable: false };
  }
}

function clock(scope: { now?: () => Date }): Date {
  return scope.now ? scope.now() : new Date();
}
