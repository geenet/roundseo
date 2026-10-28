import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BaseCrawler } from './src/worker/crawlers/base';
import { parsePageMetrics } from './src/worker/crawlers/parser';
import { calculateSiteMetrics } from './src/worker/crawlers/metrics';
import { fetchPageSpeedData } from './src/worker/services/integrations';

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
  // The Vite server reads this value, but it is never bundled into the client.
  // Put GOOGLE_PAGESPEED_API_KEY in .env.local for a live local preview.
  const localEnv = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [localAuditPlugin(localEnv.GOOGLE_PAGESPEED_API_KEY), react()],
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

function localAuditPlugin(pageSpeedApiKey?: string): Plugin {
  return {
    name: 'roundseo-local-audit',
    configureServer(server) {
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
        void runLocalPerformanceAudit(request, response, pageSpeedApiKey);
      });
    },
  };
}

async function runLocalAudit(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    const rawUrl = typeof payload.url === 'string' ? payload.url : '';
    const website = await parsePublicWebsite(rawUrl);
    const crawler = new BaseCrawler(website.href, { maxPages: 30, maxDepth: 4, delay: 120, timeout: 8_000 });
    const staticResults = await crawler.crawl();
    const staticPages = collectPageMetrics(staticResults);
    let results: CrawlSnapshot[] = staticResults;
    let rendered = false;

    // Static HTML is the fastest and most reproducible crawl mode. When it is
    // only an application shell, use a real browser locally rather than
    // presenting missing-content or missing-link guesses as facts.
    if (Array.from(staticPages.values()).some(page => page.requiresJavaScriptRendering)) {
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
      maxPages: rendered ? 12 : 30,
      maxDepth: 4,
      rendered,
      limitReached: results.length >= (rendered ? 12 : 30),
    });
    const { findings, ...summary } = metrics;
    sendJson(response, 200, {
      audit: {
        status: 'completed',
        pagesCrawled: pagesByUrl.size,
        pagesFound: results.length,
        completedAt: new Date().toISOString(),
        rendered,
        methodVersion: 'local-audit-2026.10.0',
      },
      metrics: summary,
      findings,
      pages: Array.from(pagesByUrl.values()).map(pageToInventoryRow),
    });
  } catch (error) {
    sendJson(response, 422, { error: error instanceof Error ? error.message : 'The crawl could not be completed.' });
  }
}

/**
 * A local-preview adapter for the same PageSpeed mapper the Worker uses. It
 * does not synthesize scores: a missing provider response remains explicitly
 * unavailable in the UI.
 */
async function runLocalPerformanceAudit(request: IncomingMessage, response: ServerResponse, pageSpeedApiKey?: string): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    const rawUrl = typeof payload.url === 'string' ? payload.url : '';
    const website = await parsePublicWebsite(rawUrl);
    const performance = await fetchPageSpeedData(website.href, {
      GOOGLE_PAGESPEED_API_KEY: pageSpeedApiKey,
    }, { allowUnauthenticated: true });
    sendJson(response, 200, { performance });
  } catch (error) {
    sendJson(response, 422, { error: error instanceof Error ? error.message : 'The PageSpeed audit could not be completed.' });
  }
}

function pageToInventoryRow(page: ReturnType<typeof parsePageMetrics>): LocalPageInventoryRow {
  return {
    url: page.url,
    statusCode: page.statusCode || 200,
    crawlDepth: page.crawlDepth || 0,
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
    while (queue.length && results.length < 12) {
      const next = queue.shift();
      if (!next || next.depth > 4 || visited.has(next.url)) continue;
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
            if (normalized && !visited.has(normalized) && queue.length < 12) queue.push({ url: normalized, depth: next.depth + 1 });
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

async function readJsonBody(request: IncomingMessage): Promise<{ url?: unknown }> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 10_000) throw new Error('The audit request is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { url?: unknown };
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
