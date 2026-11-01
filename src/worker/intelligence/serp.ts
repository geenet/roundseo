import type { SearchDevice, SearchSurface, SerpCoverage, SerpFeature } from '../../shared/intelligence';
import { absoluteHttpUrl, attributeValue, collapseWhitespace, domainOf, stripTags } from './html';
import { IntelligenceError } from './errors';
import { fetchWithTimeout, readBoundedText, type IntelligenceFetch } from './http';
import type { IntelligenceConfig } from './config';

export const SERP_METHOD = 'serp-html-v1';
export const MAX_SERP_RESULTS = 100;
const SERP_TIMEOUT_MS = 20_000;
const SERP_MAX_BYTES = 3 * 1024 * 1024;

const DESKTOP_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MOBILE_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export interface SerpRecord {
  position: number;
  feature: SerpFeature;
  title: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
}

export interface SerpCollection {
  surface: SearchSurface;
  query: string;
  observedAt: string;
  coverage: SerpCoverage;
  results: SerpRecord[];
  /** Related searches and "People also ask" questions, when the surface shows them. */
  relatedTerms: string[];
  questions: string[];
}

export interface SerpRequest {
  surface: SearchSurface;
  query: string;
  countryCode: string;
  languageCode: string;
  device: SearchDevice;
  resultLimit: number;
}

/** Build the public search URL for one surface. Query text is URL-encoded and bounded. */
export function serpSearchUrl(request: SerpRequest): string {
  const query = encodeURIComponent(request.query.trim().slice(0, 200));
  const country = request.countryCode.toLowerCase();
  const language = request.languageCode.toLowerCase().split('-')[0];
  const limit = Math.min(MAX_SERP_RESULTS, Math.max(1, request.resultLimit));
  switch (request.surface) {
    case 'google': return `https://www.google.com/search?q=${query}&num=${limit}&hl=${language}&gl=${country}&pws=0`;
    case 'google_ai': return `https://www.google.com/search?q=${query}&udm=50&hl=${language}&gl=${country}&pws=0`;
    case 'google_maps': return `https://www.google.com/maps/search/${query}?hl=${language}&gl=${country}`;
    case 'bing': return `https://www.bing.com/search?q=${query}&count=${limit}&setlang=${language}&cc=${country}`;
    case 'youtube': return `https://www.youtube.com/results?search_query=${query}`;
  }
}

const ALLOWED_SERP_HOSTS: Record<SearchSurface, RegExp> = {
  google: /(^|\.)google\.[a-z.]+$/i,
  google_ai: /(^|\.)google\.[a-z.]+$/i,
  google_maps: /(^|\.)google\.[a-z.]+$/i,
  bing: /(^|\.)bing\.com$/i,
  youtube: /(^|\.)youtube\.com$/i,
};

/**
 * Collect one search results page. A configured runner renders the page; with
 * no runner, RoundSEO fetches the page directly. Blocked, consent, or CAPTCHA
 * responses are recorded as blocked coverage. They are never bypassed.
 */
export async function collectSerp(
  request: SerpRequest,
  config: IntelligenceConfig,
  options: { fetcher?: IntelligenceFetch; now?: () => Date } = {},
): Promise<SerpCollection> {
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const url = serpSearchUrl(request);
  const page = config.runner
    ? await fetchThroughRunner(url, request, config.runner, options.fetcher)
    : await fetchSearchPage(url, request.device, options.fetcher);
  const finalHost = domainOf(page.url) || '';
  const block = detectSerpBlock(page.status, page.html, page.url, finalHost, request.surface);
  if (block) {
    return {
      surface: request.surface,
      query: request.query,
      observedAt,
      results: [],
      relatedTerms: [],
      questions: [],
      coverage: { surface: request.surface, query: request.query, status: 'blocked', resultsRequested: request.resultLimit, resultsParsed: 0, featuresDetected: [], reason: block },
    };
  }
  const parsed = parseSerpHtml(request.surface, page.html, request.resultLimit);
  const status = parsed.results.length === 0 ? 'unparsed' : parsed.results.length < request.resultLimit ? 'partial' : 'complete';
  const terms = request.surface === 'google' ? parseRelatedTerms(page.html) : { relatedTerms: [], questions: [] };
  return {
    surface: request.surface,
    query: request.query,
    observedAt,
    results: parsed.results,
    relatedTerms: terms.relatedTerms,
    questions: terms.questions,
    coverage: {
      surface: request.surface,
      query: request.query,
      status,
      resultsRequested: request.resultLimit,
      resultsParsed: parsed.results.length,
      featuresDetected: parsed.features,
      reason: status === 'unparsed'
        ? 'No results matched the parser for this surface. The page layout may have changed or the search returned no results.'
        : status === 'partial'
          ? 'The page returned fewer results than requested.'
          : null,
    },
  };
}

async function fetchSearchPage(url: string, device: SearchDevice, fetcher?: IntelligenceFetch): Promise<{ url: string; status: number; html: string }> {
  const response = await fetchWithTimeout(fetcher ?? fetch, url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': device === 'mobile' ? MOBILE_AGENT : DESKTOP_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en;q=0.8' },
  }, SERP_TIMEOUT_MS);
  const finalUrl = new URL(response.url || url);
  if (!isAllowedSerpHost(finalUrl, url)) {
    await response.body?.cancel().catch(() => undefined);
    return { url: finalUrl.href, status: 302, html: '' };
  }
  const { text } = await readBoundedText(response, SERP_MAX_BYTES);
  return { url: finalUrl.href, status: response.status, html: text };
}

async function fetchThroughRunner(
  url: string,
  request: SerpRequest,
  runner: { url: string; token: string },
  fetcher?: IntelligenceFetch,
): Promise<{ url: string; status: number; html: string }> {
  const response = await fetchWithTimeout(fetcher ?? fetch, `${runner.url}/render`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runner.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url, device: request.device, countryCode: request.countryCode, languageCode: request.languageCode }),
  }, SERP_TIMEOUT_MS + 15_000);
  if (!response.ok) throw new IntelligenceError('The browser collector could not render the search page.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  const body = await response.json().catch(() => null) as { finalUrl?: unknown; status?: unknown; html?: unknown } | null;
  if (!body || typeof body.html !== 'string') throw new IntelligenceError('The browser collector returned an unreadable page.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
  return {
    url: typeof body.finalUrl === 'string' ? body.finalUrl : url,
    status: typeof body.status === 'number' ? body.status : 200,
    html: body.html.slice(0, SERP_MAX_BYTES),
  };
}

function isAllowedSerpHost(finalUrl: URL, requested: string): boolean {
  const requestedHost = new URL(requested).hostname;
  return ALLOWED_SERP_HOSTS[surfaceForUrl(requested)].test(finalUrl.hostname) || finalUrl.hostname === requestedHost;
}

function surfaceForUrl(url: string): SearchSurface {
  const host = new URL(url).hostname;
  if (/bing\.com$/i.test(host)) return 'bing';
  if (/youtube\.com$/i.test(host)) return 'youtube';
  return 'google';
}

/** Recognize search-engine interstitials that must not be parsed as results. */
export function detectSerpBlock(status: number, html: string, finalUrl: string, finalHost: string, surface: SearchSurface): string | null {
  if (status === 429 || status === 503) return 'The search engine rate-limited or refused this request.';
  if (/consent\.google\./i.test(finalHost) || /consent\.google\./i.test(finalUrl)) return 'The search engine returned a consent page instead of results.';
  if (/\/sorry\//i.test(finalUrl) || /unusual traffic|id=["']captcha-form["']|g-recaptcha|detected unusual traffic/i.test(html)) {
    return 'The search engine presented a CAPTCHA or unusual-traffic check. RoundSEO does not bypass it, so no results were saved.';
  }
  if (!html && surface !== 'google_maps') return 'The search page returned no content.';
  return null;
}

/** Parse one rendered results page into stable records. Pure and fixture-tested. */
export function parseSerpHtml(surface: SearchSurface, html: string, resultLimit: number): { results: SerpRecord[]; features: SerpFeature[] } {
  const limit = Math.max(1, resultLimit);
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const features = detectSerpFeatures(surface, body);
  const records = surface === 'bing'
    ? parseBingResults(body)
    : surface === 'youtube'
      ? parseYouTubeResults(body)
      : surface === 'google_maps'
        ? parseMapsResults(body)
        : parseGoogleResults(body, surface === 'google_ai');
  const results = records.slice(0, limit).map((record, index) => ({ ...record, position: index + 1 }));
  return { results, features };
}

const QUESTION_PATTERN = /\b(?:What|How|Why|When|Where|Which|Who|Can|Is|Are|Does|Do|Should|Will)\b[^?<>]{5,140}\?/g;

/** Related searches and question phrasing from the Google results page. Heuristic and capped. */
export function parseRelatedTerms(html: string): { relatedTerms: string[]; questions: string[] } {
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const relatedTerms: string[] = [];
  const relatedStart = body.search(/Related searches/i);
  if (relatedStart !== -1) {
    const segment = body.slice(relatedStart, relatedStart + 4_000);
    for (const match of segment.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
      const term = collapseWhitespace(stripTags(match[1]));
      if (term.length >= 3 && term.length <= 120 && !/related searches/i.test(term) && !relatedTerms.includes(term)) relatedTerms.push(term);
      if (relatedTerms.length >= 8) break;
    }
  }
  const questions: string[] = [];
  const questionStart = body.search(/People also ask/i);
  if (questionStart !== -1) {
    const text = collapseWhitespace(stripTags(body.slice(questionStart + 'People also ask'.length, questionStart + 6_000)));
    for (const match of text.matchAll(QUESTION_PATTERN)) {
      const question = collapseWhitespace(match[0]);
      if (!questions.includes(question)) questions.push(question);
      if (questions.length >= 8) break;
    }
  }
  return { relatedTerms, questions };
}

function detectSerpFeatures(surface: SearchSurface, html: string): SerpFeature[] {
  const found = new Set<SerpFeature>();
  if (/data-attrid="[^"]*ai_overview|AI Overview|id="(?:ai|gen)[-_]?overview/i.test(html) || surface === 'google_ai') found.add('ai_overview');
  if (/People also ask/i.test(html)) found.add('people_also_ask');
  if (/Related searches/i.test(html)) found.add('related_searches');
  if (/data-attrid="wa:\/description|featured_snippet/i.test(html)) found.add('featured_snippet');
  if (/data-attrid="kc:|class="[^"]*kno-kp/i.test(html)) found.add('knowledge_graph');
  if (/Sponsored|data-text-ad=/i.test(html)) found.add('paid');
  if (/google\.com\/maps\/place\//i.test(html)) found.add('map');
  if (surface === 'youtube' && /id="video-title"/i.test(html)) found.add('video');
  found.add('organic');
  return [...found];
}

function parseGoogleResults(html: string, aiMode: boolean): SerpRecord[] {
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>((?:(?!<\/a>)[\s\S])*?)<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const records: SerpRecord[] = [];
  const seen = new Set<string>();
  anchors.forEach((match, index) => {
    const url = googleTargetUrl(decodeHref(match[1]));
    if (!url || seen.has(url)) return;
    seen.add(url);
    const segmentEnd = anchors[index + 1]?.index ?? Math.min(html.length, (match.index ?? 0) + 2_000);
    const segment = html.slice((match.index ?? 0) + match[0].length, segmentEnd);
    records.push({
      position: 0,
      feature: 'organic',
      title: stripTags(match[3]) || null,
      url,
      domain: domainOf(url),
      description: descriptionFrom(segment),
    });
  });
  if (aiMode && records.length === 0) {
    for (const url of externalLinks(html)) {
      if (seen.has(url)) continue;
      seen.add(url);
      records.push({ position: 0, feature: 'ai_overview', title: null, url, domain: domainOf(url), description: null });
    }
  }
  return records;
}

function parseBingResults(html: string): SerpRecord[] {
  const blocks = html.split(/<li\b[^>]*\bclass="[^"]*\bb_algo\b[^"]*"/i).slice(1);
  const records: SerpRecord[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const anchor = /<h2\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = bingTargetUrl(attributeValue(`<a ${anchor[1]}>`, 'href') || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    records.push({
      position: 0,
      feature: 'organic',
      title: stripTags(anchor[2]) || null,
      url,
      domain: domainOf(url),
      description: paragraph ? collapseWhitespace(stripTags(paragraph[1])) || null : null,
    });
  }
  return records;
}

function parseYouTubeResults(html: string): SerpRecord[] {
  const records: SerpRecord[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*\bid="video-title"[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a ${match[1]}>`;
    const videoId = /\/watch\?v=([A-Za-z0-9_-]{6,20})/.exec(attributeValue(tag, 'href') || '')?.[1];
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const title = attributeValue(tag, 'title') || collapseWhitespace(stripTags(match[2])) || null;
    records.push({ position: 0, feature: 'video', title, url: `https://www.youtube.com/watch?v=${videoId}`, domain: 'youtube.com', description: null });
  }
  return records;
}

function parseMapsResults(html: string): SerpRecord[] {
  const records: SerpRecord[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/https:\/\/www\.google\.com\/maps\/place\/([^"'\s<>?]+)[^"'\s<>]*/gi)) {
    const url = match[0].replace(/&amp;/g, '&');
    const name = decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    records.push({ position: 0, feature: 'map', title: name, url, domain: null, description: null });
  }
  return records;
}

function decodeHref(value: string): string {
  return value.replace(/&amp;/g, '&');
}

function googleTargetUrl(href: string): string | null {
  let candidate = href;
  if (href.startsWith('/url?') || href.includes('google.com/url?')) {
    try { candidate = new URL(href, 'https://www.google.com').searchParams.get('q') || ''; } catch { return null; }
  }
  const url = absoluteHttpUrl(candidate);
  if (!url) return null;
  const host = domainOf(url) || '';
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === 'webcache.googleusercontent.com') return null;
  return url;
}

function bingTargetUrl(href: string): string | null {
  const absolute = absoluteHttpUrl(decodeHref(href));
  if (!absolute) return null;
  const url = new URL(absolute);
  if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname.startsWith('/ck/')) {
    const encoded = url.searchParams.get('u') || '';
    try {
      const decoded = atob(encoded.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/'));
      return absoluteHttpUrl(decoded);
    } catch {
      return null;
    }
  }
  if (/(^|\.)bing\.com$/.test(url.hostname)) return null;
  return url.href;
}

function externalLinks(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    const url = googleTargetUrl(decodeHref(match[1]));
    if (url && !links.includes(url)) links.push(url);
  }
  return links;
}

function descriptionFrom(segment: string): string | null {
  const text = collapseWhitespace(stripTags(segment));
  if (text.length < 40) return null;
  return text.slice(0, 320);
}
