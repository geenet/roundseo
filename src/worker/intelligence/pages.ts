import type { BrowserProfile, EvidenceSource, PageEvidence, PageIssueEvidence } from '../../shared/intelligence';
import { parsePageMetrics, type PageMetrics } from '../crawlers/parser';
import type { IntelligenceConfig } from './config';
import { IntelligenceError } from './errors';
import { collapseWhitespace, decodeEntities } from './html';
import { fetchPublicPage, fetchWithTimeout, readBoundedText, type FetchedPage, type IntelligenceFetch } from './http';

export const PAGE_METHOD = 'page-inspection-v1';
export const RENDER_METHOD = 'page-render-runner-v1';
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const RUNNER_TIMEOUT_MS = 60_000;

export interface LoadedPage {
  url: string;
  status: number;
  html: string;
  renderingMode: 'html' | 'rendered';
  /** Set when rendering was requested but could not run; the HTML result is still saved. */
  renderNote: string | null;
}

export interface PageAnalysis {
  page: PageEvidence;
  metrics: PageMetrics | null;
  renderingMode: 'html' | 'rendered';
}

/** Load a page as HTML, or through the browser runner when JavaScript rendering was requested. */
export async function loadPage(
  url: string,
  options: { renderJavascript: boolean; profile?: BrowserProfile; config: IntelligenceConfig; fetcher?: IntelligenceFetch },
): Promise<LoadedPage> {
  if (options.renderJavascript && options.config.runner) {
    const rendered = await renderThroughRunner(url, options.profile || 'desktop', options.config.runner, options.fetcher);
    return { url: rendered.url, status: rendered.status, html: rendered.html, renderingMode: 'rendered', renderNote: null };
  }
  const fetched: FetchedPage = await fetchPublicPage(url, { fetcher: options.fetcher });
  return {
    url: fetched.url,
    status: fetched.status,
    html: fetched.html,
    renderingMode: 'html',
    renderNote: options.renderJavascript ? 'JavaScript rendering is not configured on this deployment, so the saved result is the HTML response.' : null,
  };
}

/** Inspect a page's SEO signals with native fetch and the shared parser. */
export async function inspectPage(
  url: string,
  options: { renderJavascript: boolean; profile?: BrowserProfile; config: IntelligenceConfig; fetcher?: IntelligenceFetch; observedAt: string },
): Promise<PageAnalysis> {
  const loaded = await loadPage(url, options);
  const metrics = loaded.html ? parsePageMetrics(loaded.url, loaded.html, { responseHeaders: {} }) : null;
  return {
    renderingMode: loaded.renderingMode,
    metrics,
    page: pageEvidence({ url: loaded.url, status: loaded.status, metrics, markdown: null, renderingMode: loaded.renderingMode, renderNote: loaded.renderNote, observedAt: options.observedAt, screenshotUrl: null }),
  };
}

/** Extract readable page content as markdown, with the HTML-or-rendered distinction recorded. */
export async function extractPageContent(
  url: string,
  options: { renderJavascript: boolean; config: IntelligenceConfig; fetcher?: IntelligenceFetch; observedAt: string },
): Promise<PageAnalysis> {
  const loaded = await loadPage(url, options);
  const metrics = loaded.html ? parsePageMetrics(loaded.url, loaded.html, { responseHeaders: {} }) : null;
  const markdown = loaded.html ? htmlToMarkdown(loaded.html) : null;
  return {
    renderingMode: loaded.renderingMode,
    metrics,
    page: pageEvidence({ url: loaded.url, status: loaded.status, metrics, markdown, renderingMode: loaded.renderingMode, renderNote: loaded.renderNote, observedAt: options.observedAt, screenshotUrl: null }),
  };
}

export interface ScreenshotCapture {
  bytes: Uint8Array;
  contentType: 'image/png';
  finalUrl: string;
}

/** Capture a PNG through the browser runner. Screenshots need the runner; nothing is faked without it. */
export async function capturePageScreenshot(
  url: string,
  options: { profile?: BrowserProfile; fullPage: boolean; config: IntelligenceConfig; fetcher?: IntelligenceFetch },
): Promise<ScreenshotCapture> {
  if (!options.config.runner) throw new IntelligenceError('Screenshots need the browser runner, which is not configured on this deployment.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  const response = await fetchWithTimeout(options.fetcher ?? fetch, `${options.config.runner.url}/screenshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.config.runner.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url, device: options.profile || 'desktop', fullPage: options.fullPage }),
  }, RUNNER_TIMEOUT_MS);
  if (!response.ok) throw new IntelligenceError('The browser runner could not capture this page.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  const { text } = await readBoundedText(response, Math.ceil(MAX_SCREENSHOT_BYTES * 1.4));
  const body = parseJsonRecord(text);
  const encoded = typeof body.base64 === 'string' ? body.base64 : '';
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new IntelligenceError('The browser runner returned no image.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  const bytes = base64ToBytes(encoded);
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) throw new IntelligenceError('The screenshot is larger than RoundSEO stores.', { status: 413, code: 'SCREENSHOT_TOO_LARGE' });
  if (!isPng(bytes)) throw new IntelligenceError('The browser runner returned a non-PNG image.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  return { bytes, contentType: 'image/png', finalUrl: typeof body.finalUrl === 'string' ? body.finalUrl : url };
}

async function renderThroughRunner(
  url: string,
  profile: BrowserProfile,
  runner: { url: string; token: string },
  fetcher?: IntelligenceFetch,
): Promise<{ url: string; status: number; html: string }> {
  const response = await fetchWithTimeout(fetcher ?? fetch, `${runner.url}/render`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runner.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url, device: profile }),
  }, RUNNER_TIMEOUT_MS);
  if (!response.ok) throw new IntelligenceError('The browser runner could not render this page.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  const { text } = await readBoundedText(response, 8 * 1024 * 1024);
  const body = parseJsonRecord(text);
  if (typeof body.html !== 'string') throw new IntelligenceError('The browser runner returned an unreadable page.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  return { url: typeof body.finalUrl === 'string' ? body.finalUrl : url, status: typeof body.status === 'number' ? body.status : 200, html: body.html };
}

function pageEvidence(input: {
  url: string; status: number; metrics: PageMetrics | null; markdown: string | null; renderingMode: 'html' | 'rendered';
  renderNote: string | null; observedAt: string; screenshotUrl: string | null;
}): PageEvidence {
  const limitations = [
    input.renderingMode === 'rendered'
      ? 'Rendered by RoundSEO\'s browser runner at collection time.'
      : 'HTML response only. Content added later by JavaScript is not included.',
    'Checks are native rule evaluations, not search-engine verdicts.',
  ];
  if (input.renderNote) limitations.unshift(input.renderNote);
  const headings = input.metrics ? [...input.metrics.h1Text, ...input.metrics.h2Text].slice(0, 40) : [];
  return {
    kind: 'page',
    id: `page-${stableHash(`${input.url}|${input.observedAt}|${input.renderingMode}`)}`,
    url: input.url,
    statusCode: input.metrics ? (input.metrics.statusCode ?? (input.status || null)) : (input.status || null),
    title: input.metrics?.title ?? null,
    description: input.metrics?.metaDescription ?? null,
    canonicalUrl: input.metrics?.canonicalTag ?? null,
    robots: input.metrics?.robotsMeta ?? null,
    wordCount: input.metrics ? input.metrics.wordCount : null,
    headings,
    contentMarkdown: input.markdown,
    renderingMode: input.renderingMode,
    screenshotUrl: input.screenshotUrl,
    issues: input.metrics ? pageChecks(input.metrics, input.status) : [],
    source: pageSource(input.observedAt, limitations),
  };
}

export function pageSource(observedAt: string, limitations: string[]): EvidenceSource {
  return { origin: 'fetched_page', label: 'RoundSEO page fetch', method: PAGE_METHOD, observedAt, limitations };
}

/** Deterministic checks over the parsed page. Each finding names its rule and value. */
export function pageChecks(metrics: PageMetrics, status: number): PageIssueEvidence[] {
  const issues: PageIssueEvidence[] = [];
  const add = (code: string, category: PageIssueEvidence['category'], severity: PageIssueEvidence['severity'], message: string, value: PageIssueEvidence['value']) => {
    issues.push({ code, category, severity, message, value });
  };
  if (status >= 400) add('http_status_error', 'indexability', 'high', 'The page returned an error status.', status);
  if (!metrics.isIndexable) add('noindex', 'indexability', 'high', 'The page asks search engines not to index it.', metrics.robotsMeta ?? true);
  if (!metrics.title) add('title_missing', 'metadata', 'high', 'The page has no title element.', null);
  else if (metrics.titleLength !== undefined && metrics.titleLength > 60) add('title_long', 'metadata', 'low', 'The title is longer than about 60 characters and may truncate.', metrics.titleLength);
  else if (metrics.titleLength !== undefined && metrics.titleLength < 30) add('title_short', 'metadata', 'low', 'The title is shorter than about 30 characters.', metrics.titleLength);
  if (!metrics.metaDescription) add('description_missing', 'metadata', 'medium', 'The page has no meta description.', null);
  else if (metrics.metaDescLength !== undefined && metrics.metaDescLength > 160) add('description_long', 'metadata', 'low', 'The meta description is longer than about 160 characters.', metrics.metaDescLength);
  if (metrics.h1Count === 0) add('h1_missing', 'structure', 'high', 'The page has no H1 heading.', 0);
  else if (metrics.h1Count > 1) add('h1_multiple', 'structure', 'medium', 'The page has more than one H1 heading.', metrics.h1Count);
  if (!metrics.lang) add('lang_missing', 'structure', 'low', 'The html element has no lang attribute.', null);
  if (!metrics.hasViewport) add('viewport_missing', 'structure', 'medium', 'The page has no viewport meta tag.', null);
  if (metrics.canonicalTag && metrics.canonicalIsSelf === false) add('canonical_elsewhere', 'indexability', 'medium', 'The canonical URL points to a different page.', metrics.canonicalTag);
  if (!metrics.canonicalTag) add('canonical_missing', 'indexability', 'low', 'The page declares no canonical URL.', null);
  if (metrics.wordCount < 300) add('thin_content', 'content', 'medium', 'The main content has fewer than 300 words.', metrics.wordCount);
  if (metrics.requiresJavaScriptRendering) add('rendering_required', 'rendering', 'medium', 'The HTML response has little visible text, so JavaScript may be required to read the content.', true);
  if (metrics.imagesWithoutAlt > 0) add('images_without_alt', 'content', 'low', 'Some images have no alt attribute.', metrics.imagesWithoutAlt);
  if (metrics.nonDescriptiveInternalAnchors > 0) add('generic_anchor_text', 'links', 'low', 'Some internal links use generic anchor text.', metrics.nonDescriptiveInternalAnchors);
  return issues;
}

/** Readable markdown from the main content of an HTML document. */
export function htmlToMarkdown(html: string): string {
  let source = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(source);
  if (main) source = main[2];
  const withStructure = source
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${collapseWhitespace(stripInline(inner))}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_match, inner: string) => `\n- ${collapseWhitespace(stripInline(inner))}`)
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote)\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = decodeEntities(withStructure.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, 60_000) || '';
}

function stripInline(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '));
}

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}
