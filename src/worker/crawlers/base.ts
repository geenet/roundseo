// Base crawler class for RoundSEO
export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  respectRobotsTxt?: boolean;
  delay?: number;
  timeout?: number;
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

export class BaseCrawler {
  private baseUrl: string;
  private visited = new Set<string>();
  private queue: Array<{ url: string; depth: number }> = [];
  private options: Required<CrawlOptions>;
  private robotsRules: Array<{ path: string; allow: boolean }> = [];
  private excludedPaths: string[];

  constructor(baseUrl: string, options: CrawlOptions = {}) {
    if (!isPublicCrawlUrl(baseUrl)) throw new Error('Only public HTTP or HTTPS websites can be crawled.');
    this.baseUrl = normalizeCrawlUrl(baseUrl);
    this.options = {
      maxPages: options.maxPages || 500,
      maxDepth: options.maxDepth || 5,
      respectRobotsTxt: options.respectRobotsTxt !== false,
      delay: options.delay || 1000,
      timeout: options.timeout || 30000,
      excludedPaths: options.excludedPaths || [],
    };
    this.excludedPaths = this.options.excludedPaths
      .map(path => path.trim())
      .filter(path => path.startsWith('/'));
    this.queue.push({ url: this.baseUrl, depth: 0 });
  }

  async crawl(): Promise<CrawlResult[]> {
    const results: CrawlResult[] = [];
    if (this.options.respectRobotsTxt) this.robotsRules = await this.fetchRobotsRules();
    while (this.queue.length > 0 && results.length < this.options.maxPages) {
      const next = this.queue.shift();
      if (!next || next.depth > this.options.maxDepth || this.visited.has(next.url)) continue;
      const { url, depth } = next;

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
        continue;
      }

      try {
        const result = await this.crawlPage(url, depth);
        results.push(result);

        // Only successful HTML documents can contribute reliable crawl paths.
        if (result.statusCode >= 200 && result.statusCode < 300) {
          for (const link of result.links) {
            if (
              !this.visited.has(link) &&
              this.isValidUrl(link) &&
              this.queue.length < this.options.maxPages
            ) {
              this.queue.push({ url: link, depth: depth + 1 });
            }
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
    }

    return results;
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
    return !this.excludedPaths.some(excluded => pathname === excluded || pathname.startsWith(`${excluded.replace(/\/$/, '')}/`));
  }

  private async fetchRobotsRules(): Promise<Array<{ path: string; allow: boolean }>> {
    try {
      const robotsUrl = new URL('/robots.txt', this.baseUrl).href;
      const response = await fetch(robotsUrl, {
        redirect: 'manual',
        headers: { 'User-Agent': 'RoundSEO-Crawler/1.0 (+https://roundseo.com)' },
      });
      if (!response.ok) return [];
      return parseRobotsRules(await response.text());
    } catch {
      // A monitoring gap must not be represented as a robots block. The audit
      // metadata records normal crawl coverage separately.
      return [];
    }
  }

  private isAllowedByRobots(value: string): boolean {
    if (!this.robotsRules.length) return true;
    const pathname = new URL(value).pathname || '/';
    const matches = this.robotsRules.filter(rule => rule.path && pathname.startsWith(rule.path));
    if (!matches.length) return true;
    matches.sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
    return matches[0].allow;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
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
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function parseRobotsRules(source: string): Array<{ path: string; allow: boolean }> {
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
  const allowed = new Set(['cache-control', 'content-type', 'etag', 'last-modified', 'location', 'x-robots-tag']);
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) if (allowed.has(key.toLowerCase())) output[key.toLowerCase()] = value;
  return output;
}
