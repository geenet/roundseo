// Audit service for managing crawls
import { nanoid } from 'nanoid';
import { BaseCrawler, type CrawlResult } from '../crawlers/base';
import { parsePageMetrics } from '../crawlers/parser';
import { calculateSiteMetrics } from '../crawlers/metrics';
import { getAuditFoundation, persistAuditFoundation } from './audit-foundation';
import { persistPerformanceAudit } from './performance';
import type { CrawlJobMessage, PerformanceAudit } from '../../shared/operating-model';

export interface Audit {
  id: string;
  websiteId: string;
  type: 'full' | 'quick' | 'keyword' | 'scheduled' | 'verification' | 'performance';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  pagesCrawled: number;
  pagesFound: number;
  createdAt: string;
  jobId?: string;
}

export type AuditSource = 'user' | 'schedule' | 'verification';

export async function createAudit(db: any, websiteId: string, type: Audit['type'] = 'full', options: { source?: AuditSource; idempotencyKey?: string; costBudget?: Record<string, number> } = {}): Promise<Audit> {
  const id = `audit_${nanoid(16)}`;
  const now = new Date().toISOString();
  const requestedKey = options.idempotencyKey;
  if (requestedKey) {
    const existing = await db.prepare(`
      SELECT audit.*, job.id AS job_id
      FROM crawl_jobs job
      JOIN audits audit ON audit.id = job.audit_id
      WHERE job.website_id = ? AND job.idempotency_key = ?
      LIMIT 1
    `).bind(websiteId, requestedKey).first();
    if (existing) return { ...mapAuditRow(existing), jobId: String(existing.job_id) };
  }
  const website = await db.prepare('SELECT organization_id FROM websites WHERE id = ?').bind(websiteId).first();
  if (!website?.organization_id) throw new Error('Website could not be found');

  await db.prepare(`
    INSERT INTO audits (id, website_id, type, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, type, 'pending', now, now).run();

  const jobId = `crawl_job_${nanoid(16)}`;
  await db.prepare(`
    INSERT INTO crawl_jobs (
      id, organization_id, website_id, audit_id, job_type, source, idempotency_key,
      status, cost_budget_json, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    jobId,
    website.organization_id,
    websiteId,
    id,
    type === 'performance' ? 'pagespeed_audit' : type === 'verification' ? 'verification_crawl' : 'site_crawl',
    options.source || 'user',
    requestedKey || `${options.source || 'user'}:${websiteId}:${id}`,
    'queued',
    JSON.stringify(options.costBudget || (type === 'performance'
      ? { maxPageSpeedDevices: 2, timeoutMs: 90_000 }
      : { maxPages: 500, maxDepth: 50, timeoutMs: 30_000 })),
    now,
  ).run();

  return {
    id,
    websiteId,
    type,
    status: 'pending',
    startedAt: now,
    pagesCrawled: 0,
    pagesFound: 0,
    createdAt: now,
    jobId,
  };
}

/** Queue a PageSpeed audit independently from a crawl. */
export async function createPerformanceAudit(
  db: any,
  websiteId: string,
  options: { idempotencyKey?: string } = {},
): Promise<Audit> {
  return createAudit(db, websiteId, 'performance', {
    source: 'user',
    idempotencyKey: options.idempotencyKey,
    costBudget: { maxPageSpeedDevices: 2, timeoutMs: 90_000 },
  });
}

export async function getAudit(db: any, id: string): Promise<Audit | null> {
  const audit = await db.prepare('SELECT * FROM audits WHERE id = ?').bind(id).first();
  return audit ? mapAuditRow(audit) : null;
}

export async function startAudit(db: any, auditId: string, websiteUrl: string, jobId?: string): Promise<void> {
  const now = new Date().toISOString();

  if (jobId && !(await claimCrawlJob(db, jobId))) return;

  // Update status to running
  await db.prepare('UPDATE audits SET status = ? WHERE id = ?')
    .bind('running', auditId)
    .run();

  try {
    // Queue payloads are only a routing hint. Re-read the website origin from
    // the tenant-owned database record before making an outbound request.
    const auditRow = await db.prepare(`
      SELECT audit.website_id, website.url, website.crawl_delay
      FROM audits audit
      JOIN websites website ON website.id = audit.website_id
      WHERE audit.id = ?
    `).bind(auditId).first();
    if (!auditRow?.website_id || !auditRow?.url) throw new Error('Audit website could not be found');
    const websiteId = String(auditRow.website_id);
    const crawlScope = await loadCrawlScope(db, websiteId);
    const budget = await loadCrawlBudget(db, jobId);
    const delay = Math.max(250, Math.min(10_000, Number(auditRow.crawl_delay || 1) * 1000));

    // Run crawler
    const crawler = new BaseCrawler(String(auditRow.url || websiteUrl), {
      maxPages: budget.maxPages,
      maxDepth: budget.maxDepth,
      timeout: budget.timeoutMs,
      delay,
      excludedPaths: crawlScope.excludedPaths,
      discoverSitemaps: true,
    });

    const results = await crawler.crawl();
    const discovery = crawler.getCoverageSnapshot();

    // Parse each successful HTML document once. Redirect aliases can resolve to
    // the same final page, so storing both would falsely create duplicates.
    const pageMetricsByUrl = new Map<string, ReturnType<typeof parsePageMetrics>>();
    for (const result of results.filter(isInspectableHtml)) {
      const resolvedUrl = result.finalUrl || result.url;
      const metric = {
        ...parsePageMetrics(resolvedUrl, result.html, { responseHeaders: result.responseHeaders }),
        statusCode: result.statusCode,
        crawlDepth: result.depth,
      };
      const existing = pageMetricsByUrl.get(metric.url);
      if (!existing || (metric.crawlDepth || 0) < (existing.crawlDepth || 0)) pageMetricsByUrl.set(metric.url, metric);
    }
    const pageMetricsArray = Array.from(pageMetricsByUrl.values());

    // Keep failed responses in the audit. They cannot be parsed as pages, but
    // they are still actionable crawl evidence and can reveal broken links.
    const crawlObservations = results.map(result => ({
      url: result.url,
      finalUrl: result.finalUrl,
      depth: result.depth,
      statusCode: result.statusCode,
      error: result.error,
      redirected: result.redirected,
      blockedByRobots: result.blockedByRobots,
    }));
    const siteMetrics = calculateSiteMetrics(pageMetricsArray, crawlObservations, {
      maxPages: budget.maxPages,
      maxDepth: budget.maxDepth,
      rendered: false,
      limitReached: discovery.limitReached,
      discovery,
    });

    for (const result of results.filter(result => (result.statusCode === 0 && !result.blockedByRobots) || result.statusCode >= 400)) {
      await db.prepare(`
        INSERT INTO crawl_errors (
          id, audit_id, website_id, url, error_code, error_message, error_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `crawl_error_${nanoid(16)}`,
        auditId,
        websiteId,
        result.url,
        result.statusCode ? `HTTP_${result.statusCode}` : 'REQUEST_FAILED',
        result.error || `HTTP ${result.statusCode}`,
        crawlErrorType(result),
        now
      ).run();
    }

    // Store pages in database
    for (const pageMetric of pageMetricsArray) {
      const pageId = `page_${nanoid(16)}`;

      await db.prepare(`
        INSERT INTO pages (
          id, audit_id, website_id, url, status_code, title, meta_description,
          h1_count, h2_count, word_count, images_count, internal_links_count,
          external_links_count, mobile_score, crawled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        pageId,
        auditId,
        websiteId,
        pageMetric.url,
        pageMetric.statusCode || 200,
        pageMetric.title,
        pageMetric.metaDescription,
        pageMetric.h1Count,
        pageMetric.h2Count,
        pageMetric.wordCount,
        pageMetric.imageCount,
        pageMetric.internalLinks,
        pageMetric.externalLinks,
        null,
        now
      ).run();

      // Store page metrics
      await db.prepare(`
        INSERT INTO page_metrics (
          id, page_id, audit_id, title_length, meta_desc_length, h1_present,
          keyword_in_title, keyword_in_meta, canonical_tag, robots_meta, is_indexable, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `pm_${nanoid(16)}`,
        pageId,
        auditId,
        pageMetric.titleLength,
        pageMetric.metaDescLength,
        pageMetric.h1Count > 0,
        false, // TODO: keyword tracking
        false, // TODO: keyword tracking
        pageMetric.canonicalTag,
        pageMetric.robotsMeta,
        pageMetric.isIndexable,
        now
      ).run();
    }

    // Legacy score columns are intentionally kept null. The versioned
    // measurement model below records only scoped, deterministic metrics.
    const metricsId = `metrics_${nanoid(16)}`;
    await db.prepare(`
      INSERT INTO seo_metrics (
        id, audit_id, website_id, overall_score, indexability_score, onpage_score, technical_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      metricsId,
      auditId,
      websiteId,
      null,
      null,
      null,
      null
    ).run();

    // Generate recommendations
    await generateRecommendations(db, auditId, siteMetrics);
    const completedAt = new Date().toISOString();
    await persistAuditFoundation(db, {
      auditId,
      websiteId,
      collectionMethod: 'http',
      pages: pageMetricsArray,
      results,
      metrics: siteMetrics,
      startedAt: now,
      completedAt,
    });

    // Update audit with completion
    await db.prepare(`
      UPDATE audits SET status = ?, completed_at = ?, pages_crawled = ?, pages_found = ? WHERE id = ?
    `).bind('completed', completedAt, pageMetricsArray.length, results.length, auditId).run();
    if (jobId) await completeCrawlJob(db, jobId, completedAt);

    // Update website last crawled time
    const audit = await getAudit(db, auditId);
    if (audit) {
      await db.prepare('UPDATE websites SET last_crawled_at = ? WHERE id = ?')
        .bind(completedAt, audit.websiteId)
        .run();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const failedAt = new Date().toISOString();
    await db.prepare('UPDATE audits SET status = ?, error_message = ?, completed_at = ? WHERE id = ?')
      .bind('failed', errorMsg, failedAt, auditId)
      .run();
    if (jobId) await failCrawlJob(db, jobId, errorMsg, failedAt);
  }
}

/** Execute our browser runner; do not fall back to an external PageSpeed API. */
export async function startPerformanceAudit(db: any, env: any, auditId: string, websiteUrl: string, jobId?: string): Promise<void> {
  if (jobId && !(await claimCrawlJob(db, jobId))) return;
  await db.prepare('UPDATE audits SET status = ? WHERE id = ?').bind('running', auditId).run();

  try {
    // As with crawl jobs, never trust a queue payload as the authority for the
    // URL. The tenant-owned website record is the only source of the target.
    const auditRow = await db.prepare(`
      SELECT audit.website_id, website.url
      FROM audits audit
      JOIN websites website ON website.id = audit.website_id
      WHERE audit.id = ?
    `).bind(auditId).first();
    if (!auditRow?.website_id || !auditRow?.url) throw new Error('Performance audit website could not be found');
    const targetUrl = String(auditRow.url || websiteUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const request = { method: 'POST', headers, body: JSON.stringify({ url: targetUrl }), signal: AbortSignal.timeout(120_000) };
    let response: Response;
    if (env?.PERFORMANCE_RUNNER?.fetch) {
      response = await env.PERFORMANCE_RUNNER.fetch('https://roundseo-performance.internal/audit', request);
    } else if (typeof env?.ROUNDSEO_PERFORMANCE_RUNNER_URL === 'string' && typeof env?.ROUNDSEO_RUNNER_TOKEN === 'string' && env.ROUNDSEO_RUNNER_TOKEN.length >= 24) {
      const runnerUrl = new URL(env.ROUNDSEO_PERFORMANCE_RUNNER_URL);
      if (runnerUrl.protocol !== 'https:' || runnerUrl.username || runnerUrl.password) throw new Error('The performance runner endpoint must use HTTPS without URL credentials.');
      headers.Authorization = `Bearer ${env.ROUNDSEO_RUNNER_TOKEN}`;
      response = await fetch(runnerUrl.href, request);
    } else throw new Error('The RoundSEO browser performance runner is not configured for this server.');
    if (!response.ok) throw new Error(`RoundSEO browser performance runner returned HTTP ${response.status}.`);
    const report = await response.json() as PerformanceAudit;
    if (report.provider !== 'local_browser' || report.targetUrl !== targetUrl || !Array.isArray(report.devices)) throw new Error('RoundSEO browser performance runner returned an invalid report.');
    await persistPerformanceAudit(db, {
      auditId,
      websiteId: String(auditRow.website_id),
      report,
    });
    const completedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE audits SET status = ?, completed_at = ?, pages_crawled = ?, pages_found = ? WHERE id = ?
    `).bind('completed', completedAt, 0, 0, auditId).run();
    if (jobId) await completeCrawlJob(db, jobId, completedAt);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Browser performance audit could not be completed';
    const failedAt = new Date().toISOString();
    await db.prepare('UPDATE audits SET status = ?, error_message = ?, completed_at = ? WHERE id = ?')
      .bind('failed', errorMsg, failedAt, auditId)
      .run();
    if (jobId) await failCrawlJob(db, jobId, errorMsg, failedAt);
  }
}

/** Routes generic queue messages without treating a provider check as a crawl. */
export async function runAuditJob(db: any, env: any, message: CrawlJobMessage): Promise<void> {
  if (message.jobType === 'pagespeed_audit') {
    return startPerformanceAudit(db, env, message.auditId, message.websiteUrl, message.jobId);
  }
  return startAudit(db, message.auditId, message.websiteUrl, message.jobId);
}

export async function buildAuditJobMessage(db: any, audit: Audit): Promise<CrawlJobMessage> {
  const website = await db.prepare('SELECT url FROM websites WHERE id = ?').bind(audit.websiteId).first();
  if (!website?.url || !audit.jobId) throw new Error('Audit job could not be prepared');
  const job = await db.prepare('SELECT source, job_type FROM crawl_jobs WHERE id = ?').bind(audit.jobId).first();
  return {
    jobId: audit.jobId,
    auditId: audit.id,
    websiteId: audit.websiteId,
    websiteUrl: String(website.url),
    source: (job?.source || 'user') as CrawlJobMessage['source'],
    jobType: (job?.job_type || 'site_crawl') as CrawlJobMessage['jobType'],
  };
}

export async function getCrawlJob(db: any, jobId: string): Promise<any | null> {
  return db.prepare('SELECT * FROM crawl_jobs WHERE id = ?').bind(jobId).first();
}

/** Reclaims abandoned at-least-once deliveries when their execution lease expires. */
export async function recoverExpiredCrawlJobs(db: any): Promise<CrawlJobMessage[]> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    SELECT job.*, website.url AS website_url
    FROM crawl_jobs job
    JOIN websites website ON website.id = job.website_id
    WHERE job.status = 'running' AND job.lease_expires_at IS NOT NULL AND job.lease_expires_at <= ?
  `).bind(now).all();
  const messages: CrawlJobMessage[] = [];
  for (const job of result.results || []) {
    const status = Number(job.attempt_count) < Number(job.max_attempts) ? 'retrying' : 'failed';
    const update = await db.prepare(`
      UPDATE crawl_jobs SET status = ?, error_message = ?, lease_expires_at = NULL,
        completed_at = CASE WHEN ? = 'failed' THEN ? ELSE completed_at END
      WHERE id = ? AND status = 'running' AND lease_expires_at <= ?
    `).bind(status, 'The crawl worker lease expired before completion.', status, now, job.id, now).run();
    if (status !== 'retrying' || Number(update.meta?.changes || 0) !== 1) continue;
    messages.push({
      jobId: String(job.id),
      auditId: String(job.audit_id),
      websiteId: String(job.website_id),
      websiteUrl: String(job.website_url),
      source: (job.source || 'user') as CrawlJobMessage['source'],
      jobType: (job.job_type || 'site_crawl') as CrawlJobMessage['jobType'],
    });
  }
  return messages;
}

async function claimCrawlJob(db: any, jobId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const update = await db.prepare(`
    UPDATE crawl_jobs SET status = 'running', attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, ?), lease_expires_at = ?
    WHERE id = ? AND status IN ('queued', 'retrying')
  `).bind(now, new Date(Date.now() + 15 * 60_000).toISOString(), jobId).run();
  return Number(update.meta?.changes || 0) === 1;
}

async function completeCrawlJob(db: any, jobId: string, completedAt: string): Promise<void> {
  await db.prepare(`
    UPDATE crawl_jobs SET status = 'completed', completed_at = ?, lease_expires_at = NULL WHERE id = ?
  `).bind(completedAt, jobId).run();
}

async function failCrawlJob(db: any, jobId: string, errorMessage: string, completedAt: string): Promise<void> {
  const job = await getCrawlJob(db, jobId);
  const status = job && Number(job.attempt_count) < Number(job.max_attempts) ? 'retrying' : 'failed';
  await db.prepare(`
    UPDATE crawl_jobs SET status = ?, error_message = ?, completed_at = ?, lease_expires_at = NULL WHERE id = ?
  `).bind(status, errorMessage, completedAt, jobId).run();
}

function isInspectableHtml(result: CrawlResult): boolean {
  if (result.statusCode < 200 || result.statusCode >= 300 || !result.html) return false;
  const contentType = result.contentType?.toLowerCase();
  return !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
}

function crawlErrorType(result: CrawlResult): string {
  if (result.statusCode === 0) return result.error?.toLowerCase().includes('timeout') ? 'timeout' : 'request';
  if (result.statusCode >= 500) return 'server';
  return 'http';
}

async function loadCrawlScope(db: any, websiteId: string): Promise<{ excludedPaths: string[] }> {
  try {
    const profile = await db.prepare(`
      SELECT excluded_paths_json, private_paths_json
      FROM site_profiles WHERE website_id = ?
    `).bind(websiteId).first();
    return {
      excludedPaths: [
        ...parseStringArray(profile?.excluded_paths_json),
        ...parseStringArray(profile?.private_paths_json),
      ],
    };
  } catch {
    // Older deployments can still run a crawl while the additive migration is
    // being rolled out. They simply have no owner-configured exclusions yet.
    return { excludedPaths: [] };
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function loadCrawlBudget(db: any, jobId?: string): Promise<{ maxPages: number; maxDepth: number; timeoutMs: number }> {
  const defaults = { maxPages: 500, maxDepth: 50, timeoutMs: 30_000 };
  if (!jobId) return defaults;
  const job = await getCrawlJob(db, jobId);
  if (!job?.cost_budget_json) return defaults;
  try {
    const raw = JSON.parse(String(job.cost_budget_json)) as Record<string, unknown>;
    return {
      maxPages: boundedInteger(raw.maxPages, defaults.maxPages, 1, 500),
      maxDepth: boundedInteger(raw.maxDepth, defaults.maxDepth, 0, 50),
      timeoutMs: boundedInteger(raw.timeoutMs, defaults.timeoutMs, 1_000, 60_000),
    };
  } catch {
    return defaults;
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, Math.floor(numeric))) : fallback;
}

async function generateRecommendations(db: any, auditId: string, metrics: any): Promise<void> {
  const now = new Date().toISOString();
  const audit = await db.prepare('SELECT website_id FROM audits WHERE id = ?').bind(auditId).first();

  for (const finding of metrics.findings) {
    const recommendationId = `rec_${nanoid(16)}`;
    await db.prepare(`
      INSERT INTO recommendations (
        id, audit_id, website_id, category, priority, title, description, affected_pages, estimated_impact, estimated_effort, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      recommendationId,
      auditId,
      audit.website_id,
      finding.category,
      finding.priority,
      finding.title,
      finding.description,
      finding.evidence.length,
      finding.impact,
      finding.effort,
      now
    ).run();

    for (const evidence of finding.evidence) {
      await db.prepare(`
        INSERT INTO recommendation_evidence (
          id, recommendation_id, audit_id, page_url, element, observed, recommended_change, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `evidence_${nanoid(16)}`,
        recommendationId,
        auditId,
        evidence.url,
        evidence.element,
        evidence.observed,
        evidence.recommendation,
        now
      ).run();
    }
  }
}

export async function getAuditInsights(db: any, auditId: string): Promise<{ audit: Audit; metrics: any; recommendations: any[] } | null> {
  const audit = await getAudit(db, auditId);
  if (!audit) return null;
  const metrics = await db.prepare('SELECT * FROM seo_metrics WHERE audit_id = ?').bind(auditId).first();
  const recommendationRows = await db.prepare('SELECT * FROM recommendations WHERE audit_id = ? ORDER BY CASE priority WHEN "critical" THEN 0 WHEN "high" THEN 1 WHEN "medium" THEN 2 ELSE 3 END, created_at').bind(auditId).all();
  const recommendations = await Promise.all(recommendationRows.results.map(async (recommendation: any) => {
    const evidence = await db.prepare('SELECT page_url, element, observed, recommended_change FROM recommendation_evidence WHERE recommendation_id = ? ORDER BY page_url').bind(recommendation.id).all();
    return { ...recommendation, evidence: evidence.results };
  }));
  let foundation = null;
  try { foundation = await getAuditFoundation(db, auditId); } catch { /* Pre-blueprint databases retain the legacy insights response. */ }
  return { audit, metrics, recommendations, foundation } as any;
}

function mapAuditRow(row: any): Audit {
  return {
    id: row.id,
    websiteId: row.website_id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    pagesCrawled: row.pages_crawled,
    pagesFound: row.pages_found,
    createdAt: row.created_at,
  };
}
