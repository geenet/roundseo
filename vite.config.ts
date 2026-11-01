import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BaseCrawler } from './src/worker/crawlers/base';
import { parsePageMetrics } from './src/worker/crawlers/parser';
import { calculateSiteMetrics } from './src/worker/crawlers/metrics';
import { measureLocalBrowserPerformance } from './src/local/browser-performance';
import { measureRealUserPageLoading, type RealUserPageLoadingProgress } from './src/local/real-user-page-loading';
import type { PerformanceAudit, RealUserPageLoadingAudit } from './src/shared/operating-model';
import { createLocalIntelligenceGateway, type LocalIntelligenceGateway } from './src/local/intelligence-gateway';

type CrawlSnapshot = {
  url: string;
  finalUrl?: string;
  depth: number;
  statusCode: number;
  contentType?: string;
  html: string;
  links: string[];
  error?: string;
  redirected?: boolean;
  blockedByRobots?: boolean;
  responseHeaders?: Record<string, string>;
};

type LocalPageInventoryRow = {
  url: string;
  statusCode: number;
  crawlDepth: number;
  title?: string;
  metaDescription?: string;
  h1: string[];
  h2: string[];
  h3: string[];
  canonicalUrl?: string;
  robots?: string;
  indexable: boolean;
  contentSource: string;
  requiresJavaScriptRendering: boolean;
  wordCount: number;
  textToHtmlRatio: number;
  imageCount: number;
  imagesWithoutAlt: number;
  contentExcerpt: string;
  internalLinks: number;
  externalLinks: number;
  nonDescriptiveInternalAnchors: number;
  structuredDataTypes: string[];
  linkEvidence: Array<{ target?: string; anchorText: string; placement: string; isInternal: boolean; relAttributes?: string }>;
};

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const intelligence = createLocalIntelligenceGateway({
    databasePath: path.resolve(process.cwd(), loadedEnv.DATABASE_URL || '.local/roundseo-dev.db'),
    environment: { ...loadedEnv, ...process.env },
  });
  return {
    plugins: [localAuditPlugin(intelligence), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5175,
      proxy: {
        '/api': {
          target: 'http://localhost:8789',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'ES2022',
      outDir: 'dist/client',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    define: {
      'process.env.VITE_ROUNDSEO_BUILD_COMMIT': JSON.stringify(
        process.env.VITE_ROUNDSEO_BUILD_COMMIT || 'dev'
      ),
      'process.env.VITE_ROUNDSEO_BUILD_TIME': JSON.stringify(
        process.env.VITE_ROUNDSEO_BUILD_TIME || new Date().toISOString()
      ),
    },
  };
});

function localAuditPlugin(intelligence: LocalIntelligenceGateway): Plugin {
  const jobs = new Map<string, LocalAuditJob>();
  const realUserPageLoadingJobs = new Map<string, LocalRealUserPageLoadingJob>();
  return {
    name: 'roundseo-local-audit',
    configureServer(server) {
      server.middlewares.use('/__roundseo/intelligence', (request, response, next) => intelligence.handle(request, response, next));
      server.middlewares.use('/__roundseo/local-audit', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        void runLocalAudit(request, response);
      });
      server.middlewares.use('/__roundseo/local-performance-audit', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        void runLocalPerformanceAudit(request, response);
      });
      server.middlewares.use('/__roundseo/real-user-page-loading-jobs', (request, response, next) => {
        if (request.method === 'POST') {
          void (async () => {
            try {
              const payload = await readJsonBody(request);
              const website = await parsePublicWebsite(typeof payload.url === 'string' ? payload.url : '');
              const now = new Date().toISOString();
              for (const [id, job] of realUserPageLoadingJobs) if (job.status !== 'running' && Date.now() - Date.parse(job.updatedAt) > 2 * 60 * 60 * 1000) realUserPageLoadingJobs.delete(id);
              const job: LocalRealUserPageLoadingJob = {
                id: randomUUID(),
                status: 'running',
                startedAt: now,
                updatedAt: now,
                progress: { phase: 'discovering', completedPages: 0, totalPages: 1, currentUrl: website.href },
              };
              realUserPageLoadingJobs.set(job.id, job);
              sendJson(response, 202, { id: job.id });
              void runRealUserPageLoadingJob(job, website);
            } catch (error) { sendJson(response, 422, { error: error instanceof Error ? error.message : 'Could not start the real user page-loading replay.' }); }
          })();
          return;
        }
        if (request.method === 'GET') {
          const id = new URL(request.url || '/', 'http://localhost').searchParams.get('id');
          const job = id ? realUserPageLoadingJobs.get(id) : undefined;
          if (!job) { sendJson(response, 404, { error: 'This real user page-loading run is no longer available because the local server restarted or the job expired. Run it again.' }); return; }
          sendJson(response, 200, job);
          return;
        }
        next();
      });
      server.middlewares.use('/__roundseo/audit-jobs', (request, response, next) => {
        if (request.method === 'POST') {
          void (async () => {
            try {
              const payload = await readJsonBody(request);
              const website = await parsePublicWebsite(typeof payload.url === 'string' ? payload.url : '');
              const now = new Date().toISOString();
              for (const [id, job] of jobs) if (job.status !== 'running' && Date.now() - Date.parse(job.updatedAt) > 2 * 60 * 60 * 1000) jobs.delete(id);
              const job: LocalAuditJob = { id: randomUUID(), status: 'running', phase: 'discovery', startedAt: now, updatedAt: now, progress: { attempted: 0, discovered: 0 } };
              jobs.set(job.id, job);
              sendJson(response, 202, { id: job.id });
              void runLocalAuditJob(job, website);
            } catch (error) { sendJson(response, 422, { error: error instanceof Error ? error.message : 'Could not start the audit.' }); }
          })();
          return;
        }
        if (request.method === 'GET') {
          const id = new URL(request.url || '/', 'http://localhost').searchParams.get('id');
          const job = id ? jobs.get(id) : undefined;
          if (!job) { sendJson(response, 404, { error: 'This audit is no longer available because the local server restarted or the job expired. Run it again.' }); return; }
          sendJson(response, 200, job);
          return;
        }
        next();
      });
    },
  };
}

type LocalAuditJob = {
  id: string;
  status: 'running' | 'complete' | 'failed';
  phase: 'discovery' | 'crawling' | 'analysis' | 'performance';
  startedAt: string;
  updatedAt: string;
  progress: { attempted: number; discovered: number; currentUrl?: string };
  result?: { crawl: Awaited<ReturnType<typeof collectLocalAudit>>; performance?: PerformanceAudit; performanceError?: string };
  error?: string;
};

type LocalRealUserPageLoadingJob = {
  id: string;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  updatedAt: string;
  progress: RealUserPageLoadingProgress;
  result?: { loading: RealUserPageLoadingAudit };
  error?: string;
};

async function runLocalAuditJob(job: LocalAuditJob, website: URL): Promise<void> {
  const timing = collectLocalPerformance(website).then(performance => ({ performance })).catch(error => ({ performanceError: error instanceof Error ? error.message : 'Performance measurement failed.' }));
  try {
    const crawl = await collectLocalAudit(website, (phase, progress) => {
      job.phase = phase;
      if (progress) job.progress = progress;
      job.updatedAt = new Date().toISOString();
    });
    job.phase = 'performance'; job.updatedAt = new Date().toISOString();
    const performance = await timing;
    job.result = { crawl, ...performance };
    job.status = 'complete';
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'The crawl could not be completed.';
  } finally { job.updatedAt = new Date().toISOString(); }
}

async function runRealUserPageLoadingJob(job: LocalRealUserPageLoadingJob, website: URL): Promise<void> {
  try {
    const loading = await measureRealUserPageLoading(website.href, {
      maxLinkedPages: 10,
      onProgress: progress => {
        job.progress = progress;
        job.updatedAt = new Date().toISOString();
      },
    });
    job.result = { loading };
    job.status = 'complete';
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'The real user page-loading replay could not be completed.';
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

async function runLocalAudit(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    const rawUrl = typeof payload.url === 'string' ? payload.url : '';
    const website = await parsePublicWebsite(rawUrl);
    sendJson(response, 200, await collectLocalAudit(website));
  } catch (error) {
    sendJson(response, 422, { error: error instanceof Error ? error.message : 'The crawl could not be completed.' });
  }
}

async function collectLocalAudit(website: URL, onProgress?: (phase: LocalAuditJob['phase'], progress?: LocalAuditJob['progress']) => void) {
    const crawler = new BaseCrawler(website.href, { maxPages: 500, maxDepth: 50, delay: 100, timeout: 10_000, discoverSitemaps: true });
    const staticResults = await crawler.crawl(progress => onProgress?.('crawling', progress));
    onProgress?.('analysis');
    const staticCoverage = crawler.getCoverageSnapshot();
    const staticPages = collectPageMetrics(staticResults);
    let results: CrawlSnapshot[] = staticResults;
    let rendered = false;

    // Static HTML is the fastest and most reproducible crawl mode. When it is
    // only an application shell, use a real browser locally rather than
    // presenting missing-content or missing-link guesses as facts.
    if (staticPages.size <= 1 && Array.from(staticPages.values()).some(page => page.requiresJavaScriptRendering)) {
      try {
        const renderedResults = await crawlRenderedSite(website);
        if (renderedResults.length) {
          results = renderedResults;
          rendered = true;
        }
      } catch {
        // The static result already records that rendering is required.
      }
    }

    const pagesByUrl = collectPageMetrics(results, rendered);

    const metrics = calculateSiteMetrics(Array.from(pagesByUrl.values()), results.map(result => ({
      url: result.url,
      finalUrl: result.finalUrl,
      depth: result.depth,
      statusCode: result.statusCode,
      error: result.error,
      redirected: result.redirected,
      blockedByRobots: result.blockedByRobots,
    })), {
      maxPages: rendered ? 30 : 500,
      maxDepth: 50,
      rendered,
      discoveredUrls: Math.max(staticCoverage.discoveredUrls, results.length),
      limitReached: rendered ? staticCoverage.discoveredUrls > results.length : staticCoverage.limitReached,
      discovery: rendered ? undefined : staticCoverage,
    });
    const { findings, ...summary } = metrics;
    return {
      audit: {
        status: 'completed',
        pagesCrawled: pagesByUrl.size,
        pagesFound: metrics.crawlCoverage.discoveredUrls,
        completedAt: new Date().toISOString(),
        rendered,
        methodVersion: 'local-audit-2026.10.4',
      },
      metrics: summary,
      findings,
      security: collectLocalSecurityAudit(website, staticResults, results),
      pages: Array.from(pagesByUrl.values()).map(pageToInventoryRow),
    };
}

function collectLocalSecurityAudit(website: URL, staticResults: CrawlSnapshot[], inspectedResults: CrawlSnapshot[]) {
  const root = staticResults.find(result => result.url === website.href) || staticResults[0];
  const isHttps = website.protocol === 'https:';
  const securityHeaderNames = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
  const securityHeaders = securityHeaderNames.filter(name => Boolean(root?.responseHeaders?.[name]));
  const httpPageCount = inspectedResults.filter(result => /^http:\/\//i.test(result.finalUrl || result.url)).length;
  const httpLinkCount = inspectedResults.reduce((total, result) => total + result.links.filter(link => /^http:\/\//i.test(link)).length, 0);
  const tlsStatus = isHttps && root?.statusCode ? 'validated' : isHttps ? 'unavailable' : 'not_applicable';
  return {
    availability: root?.statusCode ? isHttps ? 'measured' : 'partial' : 'failed',
    transport: isHttps ? 'https' : website.protocol === 'http:' ? 'http' : 'unknown',
    tlsStatus,
    rootStatusCode: root?.statusCode || null,
    httpPageCount,
    httpLinkCount,
    securityHeaders,
    missingSecurityHeaders: securityHeaderNames.filter(name => !securityHeaders.includes(name)),
    checkedAt: new Date().toISOString(),
    note: isHttps && root?.statusCode ? 'HTTPS was reached from the public crawl with certificate validation enabled. Header presence is checked only for the retained response.' : 'The public crawl could not validate the HTTPS origin for this report.',
  };
}

/** Run a local browser performance audit without an external performance API. */
async function runLocalPerformanceAudit(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    const rawUrl = typeof payload.url === 'string' ? payload.url : '';
    const website = await parsePublicWebsite(rawUrl);
    sendJson(response, 200, { performance: await collectLocalPerformance(website) });
  } catch (error) {
    sendJson(response, 422, { error: error instanceof Error ? error.message : 'The browser performance audit could not be completed.' });
  }
}

async function collectLocalPerformance(website: URL): Promise<PerformanceAudit> {
  return measureLocalBrowserPerformance(website.href);
}

function pageToInventoryRow(page: ReturnType<typeof parsePageMetrics>): LocalPageInventoryRow {
  return {
    url: page.url,
    statusCode: page.statusCode || 200,
    crawlDepth: page.crawlDepth ?? 0,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1Text,
    h2: page.h2Text,
    h3: page.h3Text,
    canonicalUrl: page.canonicalTag,
    robots: page.robotsMeta,
    indexable: page.isIndexable,
    contentSource: page.contentSource,
    requiresJavaScriptRendering: page.requiresJavaScriptRendering,
    wordCount: page.wordCount,
    textToHtmlRatio: page.textToHtmlRatio,
    imageCount: page.imageCount,
    imagesWithoutAlt: page.imagesWithoutAlt,
    contentExcerpt: page.mainContentExcerpt,
    internalLinks: page.internalLinks,
    externalLinks: page.externalLinks,
    nonDescriptiveInternalAnchors: page.nonDescriptiveInternalAnchors,
    structuredDataTypes: page.structuredDataTypes,
    linkEvidence: page.links.slice(0, 20).map(link => ({
      target: link.target,
      anchorText: link.anchorText,
      placement: link.placement,
      isInternal: link.isInternal,
      relAttributes: link.relAttributes,
    })),
  };
}

function collectPageMetrics(results: CrawlSnapshot[], rendered = false): Map<string, ReturnType<typeof parsePageMetrics>> {
  const pagesByUrl = new Map<string, ReturnType<typeof parsePageMetrics>>();
  for (const result of results) {
    if (!isInspectableHtml(result.statusCode, result.contentType, result.html)) continue;
    const url = result.finalUrl || result.url;
    const parsed = parsePageMetrics(url, result.html, { responseHeaders: result.responseHeaders });
    const page = { ...parsed, requiresJavaScriptRendering: rendered ? false : parsed.requiresJavaScriptRendering, statusCode: result.statusCode, crawlDepth: result.depth };
    const existing = pagesByUrl.get(page.url);
    if (!existing || (page.crawlDepth || 0) < (existing.crawlDepth || 0)) pagesByUrl.set(page.url, page);
  }
  return pagesByUrl;
}

async function crawlRenderedSite(rootUrl: URL): Promise<CrawlSnapshot[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'RoundSEO-LocalRenderer/1.0 (+http://127.0.0.1:5175)' });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest() && !normalizeCrawlUrl(request.url(), rootUrl)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl.href, depth: 0 }];
  const visited = new Set<string>();
  const results: CrawlSnapshot[] = [];

  try {
    while (queue.length && results.length < 30) {
      const next = queue.shift();
      if (!next || next.depth > 50 || visited.has(next.url)) continue;
      visited.add(next.url);
      const page = await context.newPage();
      try {
        page.setDefaultNavigationTimeout(10_000);
        const response = await page.goto(next.url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 1_200 }).catch(() => undefined);
        await page.waitForTimeout(250);
        const finalUrl = page.url();
        const statusCode = response?.status() || 0;
        const html = await page.content();
        const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
        const result: CrawlSnapshot = {
          url: next.url,
          finalUrl,
          depth: next.depth,
          statusCode,
          contentType: 'text/html',
          html,
          links,
          redirected: !sameCrawlUrl(next.url, finalUrl),
        };
        results.push(result);
        if (statusCode >= 200 && statusCode < 300) {
          for (const link of links) {
            const normalized = normalizeCrawlUrl(link, rootUrl);
            if (normalized && !visited.has(normalized) && queue.length < 500) queue.push({ url: normalized, depth: next.depth + 1 });
          }
        }
      } catch (error) {
        results.push({ url: next.url, depth: next.depth, statusCode: 0, html: '', links: [], error: error instanceof Error ? error.message : 'Rendered page request failed' });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return results;
}

function normalizeCrawlUrl(value: string, rootUrl: URL): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const rootHostname = rootUrl.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol) || hostname !== rootHostname || /\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|xml)(?:$|[?#])/i.test(url.href)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function sameCrawlUrl(left: string, right: string): boolean {
  try { return normalizeCrawlUrl(left, new URL(left)) === normalizeCrawlUrl(right, new URL(left)); } catch { return left === right; }
}

function isInspectableHtml(statusCode: number, contentType: string | undefined, html: string): boolean {
  if (statusCode < 200 || statusCode >= 300 || !html) return false;
  const type = contentType?.toLowerCase();
  return !type || type.includes('text/html') || type.includes('application/xhtml+xml');
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 256_000) throw new Error('The request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function parsePublicWebsite(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Enter a valid public HTTP or HTTPS website address.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isLocalHostname(url.hostname)) {
    throw new Error('Only public HTTP or HTTPS websites can be crawled.');
  }
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error('That address does not resolve to a public website.');
  }
  url.hash = '';
  return url;
}

function isLocalHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value === '0.0.0.0';
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.includes(':')) return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.includes('127.0.0.1') || value.includes('10.');
  const [first = 0, second = 0] = value.split('.').map(Number);
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
