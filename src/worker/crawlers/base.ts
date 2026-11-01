// Base crawler class for RoundSEO
export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  respectRobotsTxt?: boolean;
  delay?: number;
  timeout?: number;
  /** Discover same-site URLs from robots.txt and XML sitemaps. */
  discoverSitemaps?: boolean;
  /** Site-owner supplied paths that must remain outside the crawl scope. */
  excludedPaths?: string[];
}

export interface CrawlResult {
  url: string;
  finalUrl?: string;
  depth: number;
  statusCode: number;
  redirected?: boolean;
  contentType?: string;
  title?: string;
  metaDescription?: string;
  html: string;
  links: string[];
  crawledAt: string;
  error?: string;
  blockedByRobots?: boolean;
  responseHeaders?: Record<string, string>;
}

export interface CrawlDiscovery {
  discoveredUrls: number;
  remainingUrls: number;
  limitReached: boolean;
  sitemapStatus: 'not_checked' | 'available' | 'unavailable' | 'partial';
  sitemapFiles: number;
  sitemapUrls: number;
  pendingUrls: string[];
  warnings: string[];
}

export class BaseCrawler {
  private baseUrl: string;
  private visited = new Set<string>();
  private discovered = new Set<string>();
  private queued = new Set<string>();
  private queue: Array<{ url: string; depth: number }> = [];
  private options: Required<CrawlOptions>;
  private robotsRules: Array<{ path: string; allow: boolean }> = [];
  private excludedPaths: string[];
  private sitemapStatus: CrawlDiscovery['sitemapStatus'] = 'not_checked';
  private sitemapFiles = 0;
  private sitemapUrls = new Set<string>();
  private discoveryWarnings: string[] = [];

  constructor(baseUrl: string, options: CrawlOptions = {}) {
    if (!isPublicCrawlUrl(baseUrl)) throw new Error('Only public HTTP or HTTPS websites can be crawled.');
    this.baseUrl = normalizeCrawlUrl(baseUrl);
    this.options = {
      maxPages: options.maxPages || 500,
      maxDepth: options.maxDepth ?? 50,
      respectRobotsTxt: options.respectRobotsTxt !== false,
      delay: options.delay || 1000,
      timeout: options.timeout || 30000,
      discoverSitemaps: options.discoverSitemaps === true,
      excludedPaths: options.excludedPaths || [],
    };
    this.excludedPaths = this.options.excludedPaths
      .map(path => path.trim())
      .filter(path => path.startsWith('/'));
    this.discovered.add(this.baseUrl);
    this.queued.add(this.baseUrl);
    this.queue.push({ url: this.baseUrl, depth: 0 });
  }

  getCoverageSnapshot(): CrawlDiscovery {
    const pendingUrls = [...this.discovered].filter(url => !this.visited.has(url));
    return {
      discoveredUrls: this.discovered.size,
      remainingUrls: pendingUrls.length,
      limitReached: pendingUrls.length > 0 || this.discoveryWarnings.includes('URL discovery stopped at 20,000 URLs.'),
      sitemapStatus: this.sitemapStatus,
      sitemapFiles: this.sitemapFiles,
      sitemapUrls: this.sitemapUrls.size,
      pendingUrls: pendingUrls.slice(0, 200),
      warnings: this.discoveryWarnings,
    };
  }

  async crawl(onProgress?: (progress: { attempted: number; discovered: number; currentUrl?: string }) => void): Promise<CrawlResult[]> {
    const results: CrawlResult[] = [];
    const robots = this.options.respectRobotsTxt || this.options.discoverSitemaps ? await this.fetchRobots() : '';
    if (this.options.respectRobotsTxt) this.robotsRules = parseRobotsRules(robots);
    if (this.options.discoverSitemaps) await this.discoverSitemapUrls(robots);
    onProgress?.({ attempted: 0, discovered: this.discovered.size });
    while (this.queue.length > 0 && results.length < this.options.maxPages) {
      const next = this.queue.shift();
      if (!next || next.depth > this.options.maxDepth || this.visited.has(next.url)) continue;
      const { url, depth } = next;

      this.queued.delete(url);
      this.visited.add(url);

      if (!this.isAllowedByRobots(url)) {
        results.push({
          url,
          depth,
          statusCode: 0,
          html: '',
          links: [],
          crawledAt: new Date().toISOString(),
          error: 'Excluded by robots.txt',
          blockedByRobots: true,
        });
        onProgress?.({ attempted: results.length, discovered: this.discovered.size, currentUrl: url });
        continue;
      }

      try {
        const result = await this.crawlPage(url, depth);
        results.push(result);

        // Only successful HTML documents can contribute reliable crawl paths.
        if (result.statusCode >= 200 && result.statusCode < 300) {
          for (const link of result.links) {
            this.registerUrl(link, depth < 0 ? -1 : depth + 1);
          }
        }

        // Delay between requests
        await this.delay(this.options.delay);
      } catch (error) {
        results.push({
          url,
          depth,
          statusCode: 0,
          html: '',
          links: [],
          crawledAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      onProgress?.({ attempted: results.length, discovered: this.discovered.size, currentUrl: url });
    }

    return results;
  }

  private registerUrl(value: string, depth: number): void {
    if (!this.isValidUrl(value)) return;
    const url = normalizeCrawlUrl(value);
    if (!this.discovered.has(url) && this.discovered.size >= 20_000) {
      if (!this.discoveryWarnings.includes('URL discovery stopped at 20,000 URLs.')) this.discoveryWarnings.push('URL discovery stopped at 20,000 URLs.');
      return;
    }
    this.discovered.add(url);
    if (this.visited.has(url)) return;
    if (this.queued.has(url)) {
      const existing = this.queue.find(item => item.url === url);
      if (existing && depth >= 0 && (existing.depth < 0 || depth < existing.depth)) existing.depth = depth;
      return;
    }
    if (depth >= 0 && depth > this.options.maxDepth) return;
    this.queue.push({ url, depth });
    this.queued.add(url);
  }

  private async crawlPage(url: string, depth: number): Promise<CrawlResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      let currentUrl = url;
      let redirected = false;

      for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
        const response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'RoundSEO-Crawler/1.0 (+https://roundseo.com)',
          },
        });
        const location = response.headers.get('location');

        if (response.status >= 300 && response.status < 400 && location) {
          const nextUrl = new URL(location, currentUrl).href;
          redirected = true;
          if (redirectCount === 5 || !this.isValidUrl(nextUrl)) {
            return {
              url,
              finalUrl: nextUrl,
              depth,
              statusCode: response.status,
              redirected,
              contentType: response.headers.get('content-type') || undefined,
              html: '',
              links: [],
              crawledAt: new Date().toISOString(),
              responseHeaders: safeHeaders(response.headers),
            };
          }
          currentUrl = nextUrl;
          continue;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > 2_000_000) {
          return {
            url,
            finalUrl: currentUrl,
            depth,
            statusCode: response.status,
            redirected,
            contentType: response.headers.get('content-type') || undefined,
            html: '',
            links: [],
            crawledAt: new Date().toISOString(),
            error: 'HTML response exceeded the 2 MB crawl body limit',
            responseHeaders: safeHeaders(response.headers),
          };
        }
        const html = await response.text();
        return {
          url,
          finalUrl: currentUrl,
          depth,
          statusCode: response.status,
          redirected,
          contentType: response.headers.get('content-type') || undefined,
          html,
          links: this.extractLinks(html, currentUrl),
          title: this.extractTitle(html),
          metaDescription: this.extractMetaDescription(html),
          crawledAt: new Date().toISOString(),
          responseHeaders: safeHeaders(response.headers),
        };
      }

      throw new Error('Too many redirects');
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links = new Set<string>();
    const linkRegex = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const link = new URL(match[2], baseUrl).href;
        if (this.isValidUrl(link)) links.add(normalizeCrawlUrl(link));
      } catch {
        // Invalid URL, skip
      }
    }

    return Array.from(links);
  }

  private extractTitle(html: string): string | undefined {
    const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    return match?.[1]?.trim();
  }

  private extractMetaDescription(html: string): string | undefined {
    const match = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i.exec(html);
    return match?.[1];
  }

  private isValidUrl(url: string): boolean {
    if (!isPublicCrawlUrl(url, this.baseUrl)) return false;
    if (/\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|xml)(?:$|[?#])/i.test(url)) return false;
    const pathname = new URL(url).pathname;
    // Cloudflare's email-obfuscation placeholder is not a page or a broken
    // navigational link; the actual address is decoded by the site's script.
    if (/^\/cdn-cgi\/l\/email-protection\/?$/i.test(pathname)) return false;
    return !this.excludedPaths.some(excluded => pathname === excluded || pathname.startsWith(`${excluded.replace(/\/$/, '')}/`));
  }

  private async fetchRobots(): Promise<string> {
    try {
      const robotsUrl = new URL('/robots.txt', this.baseUrl).href;
      return await this.fetchScopedText(robotsUrl, 512_000) || '';
    } catch {
      this.discoveryWarnings.push('robots.txt could not be read; crawl restrictions could not be verified.');
      return '';
    }
  }

  private async discoverSitemapUrls(robots: string): Promise<void> {
    const declared = robots.split(/\r?\n/).map(line => /^\s*sitemap\s*:\s*(\S+)/i.exec(line)?.[1]).filter((url): url is string => Boolean(url));
    const pending = declared.length ? declared : [new URL('/sitemap.xml', this.baseUrl).href];
    const checked = new Set<string>();
    let failed = false;
    while (pending.length && checked.size < 25) {
      const next = pending.shift()!;
      if (checked.has(next)) continue;
      checked.add(next);
      if (!isPublicCrawlUrl(next, this.baseUrl)) {
        failed = true;
        this.discoveryWarnings.push('A sitemap was skipped because it is outside the site domain.');
        continue;
      }
      if (/\.gz(?:[?#]|$)/i.test(next)) {
        failed = true;
        this.discoveryWarnings.push('A compressed sitemap could not be read.');
        continue;
      }
      try {
        const xml = await this.fetchScopedText(next, 5_000_000);
        if (xml === null) continue;
        const parsed = parseSitemap(xml);
        if (!parsed) throw new Error('Not a supported XML sitemap');
        this.sitemapFiles += 1;
        if (parsed.kind === 'index') {
          for (const location of parsed.locations) {
            try { pending.push(new URL(location, next).href); } catch { failed = true; }
          }
        } else {
          for (const location of parsed.locations) {
            try {
              const url = normalizeCrawlUrl(new URL(location, next).href);
              if (this.isValidUrl(url)) { this.sitemapUrls.add(url); this.registerUrl(url, -1); }
            } catch { failed = true; }
          }
        }
      } catch {
        failed = true;
        this.discoveryWarnings.push(`Could not read sitemap ${next}.`);
      }
    }
    if (pending.length) { failed = true; this.discoveryWarnings.push('Sitemap discovery stopped after 25 files.'); }
    this.sitemapStatus = this.sitemapFiles ? (failed ? 'partial' : 'available') : 'unavailable';
  }

  private async fetchScopedText(value: string, maxBytes: number): Promise<string | null> {
    let url = value;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      if (!isPublicCrawlUrl(url, this.baseUrl)) throw new Error('Resource is outside the site domain');
      const response = await fetch(url, {
        redirect: 'manual', signal: AbortSignal.timeout(this.options.timeout),
        headers: { 'User-Agent': 'RoundSEO-Crawler/1.0 (+https://roundseo.com)' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) { url = new URL(location, url).href; continue; }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Resource is too large');
      return readBoundedText(response, maxBytes);
    }
    throw new Error('Too many redirects');
  }

  private isAllowedByRobots(value: string): boolean {
    return robotsRulesAllow(this.robotsRules, value);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function parseSitemap(xml: string): { kind: 'index' | 'urls'; locations: string[] } | null {
  const kind = /<(?:[\w-]+:)?sitemapindex\b/i.test(xml) ? 'index' : /<(?:[\w-]+:)?urlset\b/i.test(xml) ? 'urls' : null;
  if (!kind) return null;
  const item = kind === 'index' ? 'sitemap' : 'url';
  const blocks = xml.match(new RegExp(`<(?:[\\w-]+:)?${item}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w-]+:)?${item}\\s*>`, 'gi')) || [];
  const locations = blocks.flatMap(block => {
    const match = /<(?:[\w-]+:)?loc\b[^>]*>\s*([^<]+?)\s*<\/(?:[\w-]+:)?loc\s*>/i.exec(block);
    return match ? [decodeXml(match[1])] : [];
  });
  return { kind, locations };
}

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new Error('Resource is too large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Resource is too large'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** A Worker-safe first line of defence against SSRF and accidental scope creep. */
export function isPublicCrawlUrl(value: string, baseUrl?: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (url.port && !['80', '443'].includes(url.port)) return false;
    if (url.search.length > 512 || isPrivateHostname(url.hostname)) return false;
    if (baseUrl) {
      const base = new URL(baseUrl);
      const hostname = normalisedHostname(url.hostname);
      if (hostname !== normalisedHostname(base.hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeCrawlUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

function normalisedHostname(value: string): string { return value.toLowerCase().replace(/^www\./, ''); }

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/[\[\]]/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0') return true;
  if (host.includes(':') && (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/** Longest matching rule wins; an allow rule beats a disallow of equal length. */
export function robotsRulesAllow(rules: Array<{ path: string; allow: boolean }>, value: string): boolean {
  if (!rules.length) return true;
  const pathname = new URL(value).pathname || '/';
  const matches = rules.filter(rule => rule.path && pathname.startsWith(rule.path));
  if (!matches.length) return true;
  matches.sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
  return matches[0].allow;
}

export function parseRobotsRules(source: string): Array<{ path: string; allow: boolean }> {
  const rules: Array<{ path: string; allow: boolean }> = [];
  let agents: string[] = [];
  let groupRules: Array<{ path: string; allow: boolean }> = [];
  const flushGroup = () => {
    if (agents.some(agent => /^(\*|roundseo(?:-crawler)?)$/i.test(agent))) rules.push(...groupRules);
    agents = [];
    groupRules = [];
  };
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (groupRules.length) flushGroup();
      agents.push(value);
      continue;
    }
    if ((key === 'allow' || key === 'disallow') && value) {
      groupRules.push({ path: value.replace(/\*.*$/, ''), allow: key === 'allow' });
    }
  }
  flushGroup();
  return rules;
}

function safeHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set(['cache-control', 'content-security-policy', 'content-type', 'etag', 'last-modified', 'location', 'permissions-policy', 'referrer-policy', 'strict-transport-security', 'x-content-type-options', 'x-robots-tag']);
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) if (allowed.has(key.toLowerCase())) output[key.toLowerCase()] = value;
  return output;
}
