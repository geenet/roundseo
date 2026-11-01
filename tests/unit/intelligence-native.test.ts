import { describe, expect, it } from 'vitest';
import {
  clickThroughShare,
  competitorsFromObservations,
  domainRankingsFromObservations,
  estimateClicks,
  answerVisibility,
  appCompetitorsFromSearches,
  classifyKeyword,
  marketCategoriesFromObservations,
  type ObservationRow,
} from '../../src/worker/intelligence/analysis';
import { askAnswerEngine } from '../../src/worker/intelligence/answers';
import { lookupStoreApp, searchStore, validAppId } from '../../src/worker/intelligence/apps';
import { IntelligenceError } from '../../src/worker/intelligence/errors';
import { fetchPublicPage } from '../../src/worker/intelligence/http';
import { fetchKeywordIdeas, fetchKeywordMetrics, googleAdsMarket } from '../../src/worker/intelligence/keywords';
import { htmlToMarkdown, inspectPage, pageChecks } from '../../src/worker/intelligence/pages';
import { collectSerp, detectSerpBlock, parseRelatedTerms, parseSerpHtml, serpSearchUrl } from '../../src/worker/intelligence/serp';
import { readIntelligenceConfig } from '../../src/worker/intelligence/config';
import { intelligenceActionStatuses, validateIntelligenceRequest } from '../../src/worker/services/intelligence';
import type { EvidenceSource } from '../../src/shared/intelligence';
import { parsePageMetrics } from '../../src/worker/crawlers/parser';

const observedAt = '2026-11-01T00:00:00.000Z';
const source: EvidenceSource = { origin: 'stored_observations', label: 'test source', method: 'test-v1', observedAt, limitations: [] };
const idFor = (kind: string, parts: unknown[]) => `${kind}-${parts.join('|')}`;
const noKeys = readIntelligenceConfig({});

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('native SERP parsing', () => {
  it('reads Google organic results from redirect links, drops Google-internal and duplicate links, and numbers positions', () => {
    const html = [
      '<div class="g"><a href="/url?q=https://www.example.com/guide&amp;sa=U"><h3>Example Guide</h3></a><div><span>This complete guide explains how to audit a website for technical SEO issues.</span></div></div>',
      '<div class="g"><a href="https://blog.example.org/post"><h3>Blog Post</h3></a></div>',
      '<div class="g"><a href="/url?q=https://www.example.com/guide&amp;sa=U"><h3>Duplicate</h3></a></div>',
      '<div class="g"><a href="https://www.google.com/search?q=self"><h3>Google internal</h3></a></div>',
    ].join('');
    const parsed = parseSerpHtml('google', html, 10);
    expect(parsed.results.map(item => [item.position, item.title, item.url, item.domain])).toEqual([
      [1, 'Example Guide', 'https://www.example.com/guide', 'example.com'],
      [2, 'Blog Post', 'https://blog.example.org/post', 'blog.example.org'],
    ]);
    expect(parsed.results[0].description).toContain('technical SEO issues');
    expect(parsed.features).toContain('organic');
  });

  it('reads Bing results and decodes Bing redirect targets', () => {
    const target = Buffer.from('https://example.com/bing-page').toString('base64');
    const html = [
      `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${target}&amp;ntb=1">Bing Result</a></h2><p>A description of the Bing result that is useful.</p></li>`,
      '<li class="b_algo"><h2><a href="https://direct.example.net/page">Direct</a></h2></li>',
    ].join('');
    const parsed = parseSerpHtml('bing', html, 10);
    expect(parsed.results.map(item => [item.position, item.url, item.domain])).toEqual([
      [1, 'https://example.com/bing-page', 'example.com'],
      [2, 'https://direct.example.net/page', 'direct.example.net'],
    ]);
  });

  it('reads YouTube video results by video ID and title', () => {
    const html = '<a id="video-title" class="yt" href="/watch?v=abcdef123456&amp;t=3" title="First Video">First</a><a id="video-title" href="/watch?v=zyxwvu987654">Second</a>';
    const parsed = parseSerpHtml('youtube', html, 10);
    expect(parsed.results.map(item => [item.feature, item.title, item.url])).toEqual([
      ['video', 'First Video', 'https://www.youtube.com/watch?v=abcdef123456'],
      ['video', 'Second', 'https://www.youtube.com/watch?v=zyxwvu987654'],
    ]);
  });

  it('recognizes CAPTCHA, consent, and rate-limit responses as blocked', () => {
    expect(detectSerpBlock(200, '<div id="captcha-form">Our systems detected unusual traffic</div>', 'https://www.google.com/sorry/index', 'www.google.com', 'google')).toMatch(/CAPTCHA/);
    expect(detectSerpBlock(200, '<html></html>', 'https://consent.google.com/m', 'consent.google.com', 'google')).toMatch(/consent/);
    expect(detectSerpBlock(429, '', 'https://www.bing.com/search', 'www.bing.com', 'bing')).toMatch(/rate-limited/);
    expect(detectSerpBlock(200, '<div>results</div>', 'https://www.google.com/search', 'www.google.com', 'google')).toBeNull();
  });

  it('returns blocked coverage with no saved results when the search engine refuses the request', async () => {
    const collection = await collectSerp({ surface: 'google', query: 'seo audit', countryCode: 'US', languageCode: 'en', device: 'desktop', resultLimit: 10 }, noKeys, {
      fetcher: async () => new Response('', { status: 429 }),
    });
    expect(collection.results).toEqual([]);
    expect(collection.coverage.status).toBe('blocked');
    expect(collection.coverage.reason).toMatch(/rate-limited/);
  });

  it('reports unparsed coverage when a page loads but matches no result markup', async () => {
    const collection = await collectSerp({ surface: 'bing', query: 'seo audit', countryCode: 'US', languageCode: 'en', device: 'desktop', resultLimit: 10 }, noKeys, {
      fetcher: async () => htmlResponse('<html><body>layout changed</body></html>'),
    });
    expect(collection.coverage.status).toBe('unparsed');
    expect(collection.results).toEqual([]);
  });

  it('extracts related searches and question phrasing from the results page', () => {
    const html = [
      '<div>People also ask</div><div>What is technical SEO? A short answer follows here. Which tools audit it? Another answer.</div>',
      '<div>Related searches</div><a href="/search?q=seo+audit+tool">seo audit tool</a><a href="/search?q=seo+audit+checklist">seo audit checklist</a>',
    ].join('');
    const terms = parseRelatedTerms(html);
    expect(terms.relatedTerms).toEqual(['seo audit tool', 'seo audit checklist']);
    expect(terms.questions).toEqual(expect.arrayContaining(['What is technical SEO?', 'Which tools audit it?']));
  });

  it('builds surface-specific search URLs with bounded, encoded queries', () => {
    const url = serpSearchUrl({ surface: 'google', query: 'crm & sales', countryCode: 'PL', languageCode: 'pl-PL', device: 'mobile', resultLimit: 500 });
    expect(url).toContain('q=crm%20%26%20sales');
    expect(url).toContain('num=100');
    expect(url).toContain('gl=pl');
    expect(url).toContain('hl=pl');
  });
});

describe('request validation and availability', () => {
  it('pins domain-scoped actions to the website being acted on', () => {
    expect(() => validateIntelligenceRequest({ action: 'domain_rankings', domain: 'other.test', countryCode: 'US' }, { websiteDomain: 'example.com', config: noKeys }))
      .toThrow(/limited to this website/);
    expect(validateIntelligenceRequest({ action: 'domain_rankings', domain: 'www.example.com', countryCode: 'us' }, { websiteDomain: 'example.com', config: noKeys }))
      .toEqual({ action: 'domain_rankings', domain: 'example.com', countryCode: 'US', limit: 100 });
  });

  it('normalizes market codes and refuses malformed input with a 400', () => {
    const normalized = validateIntelligenceRequest({ action: 'keyword_overview', keywords: [' seo tool ', 'seo tool', ''], countryCode: 'us', languageCode: 'EN' }, { websiteDomain: 'example.com', config: noKeys });
    expect(normalized).toEqual({ action: 'keyword_overview', keywords: ['seo tool'], countryCode: 'US', languageCode: 'en' });
    expect(() => validateIntelligenceRequest({ action: 'keyword_overview', keywords: ['x'], countryCode: 'USA', languageCode: 'en' }, { websiteDomain: 'example.com', config: noKeys }))
      .toThrow(IntelligenceError);
    expect(() => validateIntelligenceRequest({ action: 'not_real' }, { websiteDomain: 'example.com', config: noKeys })).toThrow(/supported RoundSEO intelligence action/);
  });

  it('refuses private and non-HTTP page addresses before any request is made', () => {
    for (const url of ['http://127.0.0.1/admin', 'http://10.0.0.4/', 'file:///etc/passwd', 'https://user:pass@example.com/']) {
      expect(() => validateIntelligenceRequest({ action: 'page_inspection', url }, { websiteDomain: 'example.com', config: noKeys }))
        .toThrow(/Only public HTTP or HTTPS/);
    }
  });

  it('marks Google Ads actions unavailable without credentials and keeps local page checks available', () => {
    const byAction = Object.fromEntries(intelligenceActionStatuses(noKeys).map(item => [item.action, item]));
    expect(byAction.keyword_overview.available).toBe(false);
    expect(byAction.keyword_overview.reason).toMatch(/keyword-metrics source/);
    expect(byAction.keyword_discovery.available).toBe(true);
    expect(byAction.keyword_discovery.reason).toMatch(/Ideas, search volume, and CPC need/);
    expect(byAction.page_inspection.available).toBe(true);
    expect(byAction.site_crawl.available).toBe(true);
    expect(byAction.answer_response.available).toBe(false);
    expect(byAction.page_screenshot.available).toBe(false);
  });

  it('never reports AI keyword demand as available, because no public source exists', () => {
    const everything = readIntelligenceConfig({
      GOOGLE_ADS_DEVELOPER_TOKEN: 'd', GOOGLE_ADS_CUSTOMER_ID: '1234567890', GOOGLE_ADS_CLIENT_ID: 'c', GOOGLE_ADS_CLIENT_SECRET: 's', GOOGLE_ADS_REFRESH_TOKEN: 'r',
      ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', PERPLEXITY_API_KEY: 'p',
      ROUNDSEO_PERFORMANCE_RUNNER_URL: 'https://runner.test', ROUNDSEO_RUNNER_TOKEN: 'x'.repeat(32),
    });
    const demand = intelligenceActionStatuses(everything).find(item => item.action === 'answer_demand');
    expect(demand?.available).toBe(false);
    expect(demand?.reason).toMatch(/does not estimate AI demand/);
    const engines = intelligenceActionStatuses(everything).find(item => item.action === 'answer_response');
    expect(engines?.sources).toEqual(['claude', 'chatgpt', 'gemini', 'perplexity']);
  });
});

describe('keyword metrics source', () => {
  const credentials = readIntelligenceConfig({
    GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token-test', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ADS_CLIENT_ID: 'client', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
  }).googleAds!;

  function adsFetcher(calls: Array<{ url: string; init?: RequestInit }>, results: unknown[]) {
    return async (input: string, init?: RequestInit) => {
      const url = input;
      calls.push({ url, init });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'access-token-test' });
      return Response.json({ results });
    };
  }

  it('maps historical metrics: micros to USD, monthly enum months to dates, and competition index', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const metrics = await fetchKeywordMetrics(['crm software'], { countryCode: 'US', languageCode: 'en' }, credentials, {
      fetcher: adsFetcher(calls, [{
        text: 'crm software',
        keywordMetrics: {
          avgMonthlySearches: '1900',
          monthlySearchVolumes: [{ year: '2026', month: 'JANUARY', monthlySearches: '1500' }],
          competitionIndex: 42,
          lowTopOfPageBidMicros: '1200000',
          highTopOfPageBidMicros: '4500000',
        },
      }]),
      now: () => new Date(observedAt),
    });
    expect(metrics).toEqual([{
      keyword: 'crm software',
      searchVolume: 1900,
      cpcLow: 1.2,
      cpcHigh: 4.5,
      competition: 42,
      monthlySeries: [{ date: '2026-01-01', value: 1500 }],
      observedAt,
    }]);
    const metricsCall = calls.find(call => call.url.includes(':generateKeywordHistoricalMetrics'));
    expect(metricsCall?.url).toBe('https://googleads.googleapis.com/v20/customers/1234567890:generateKeywordHistoricalMetrics');
    expect(jsonBody(metricsCall?.init)).toMatchObject({ language: 'languages/1000', geoTargetConstants: ['geoTargetConstants/2840'], keywordPlanNetwork: 'GOOGLE_SEARCH' });
    expect((metricsCall?.init?.headers as Record<string, string>)['developer-token']).toBe('developer-token-test');
    expect((metricsCall?.init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token-test');
  });

  it('sends keyword ideas to the ideas endpoint and caps the returned rows', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const ideas = await fetchKeywordIdeas(['seo'], { countryCode: 'GB', languageCode: 'en' }, 1, credentials, {
      fetcher: adsFetcher(calls, [
        { text: 'seo audit', keywordIdeaMetrics: { avgMonthlySearches: '480' } },
        { text: 'seo tool', keywordIdeaMetrics: { avgMonthlySearches: '320' } },
      ]),
    });
    expect(ideas.map(item => [item.keyword, item.searchVolume])).toEqual([['seo audit', 480]]);
    expect(calls.some(call => call.url.endsWith(':generateKeywordIdeas'))).toBe(true);
  });

  it('refuses markets the source has no criteria for, with a clear reason', () => {
    expect(() => googleAdsMarket({ countryCode: 'ZZ', languageCode: 'en' })).toThrow(/country code ZZ/);
    expect(() => googleAdsMarket({ countryCode: 'US', languageCode: 'xx' })).toThrow(/language code xx/);
    expect(googleAdsMarket({ countryCode: 'pl', languageCode: 'pl-PL' })).toEqual({ geo: 'geoTargetConstants/2616', language: 'languages/1030' });
  });
});

describe('app-store sources', () => {
  it('reads Apple lookup and ranked search results from the public iTunes API', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/lookup')) return Response.json({ results: [{ trackId: 555, trackName: 'Habit Planner: Daily Goals', trackViewUrl: 'https://apps.apple.com/us/app/habit/id555' }] });
      return Response.json({ results: [{ trackId: 111, trackName: 'Alpha' }, { trackId: 222, trackName: 'Beta' }, { trackId: 555, trackName: 'Habit' }] });
    };
    expect(await lookupStoreApp('apple_app_store', '555', 'US', { fetcher })).toMatchObject({ appId: '555', title: 'Habit Planner: Daily Goals' });
    const apps = await searchStore('apple_app_store', 'habit tracker', 'US', 10, { fetcher });
    expect(apps.map(app => app.appId)).toEqual(['111', '222', '555']);
  });

  it('reads Google Play search results from public store pages in order without duplicates', async () => {
    const fetcher = async () => htmlResponse('<a href="/store/apps/details?id=com.example.one">One</a><a href="/store/apps/details?id=com.example.two">Two</a><a href="/store/apps/details?id=com.example.one">One again</a>');
    const apps = await searchStore('google_play', 'habit tracker', 'US', 10, { fetcher });
    expect(apps.map(app => app.appId)).toEqual(['com.example.one', 'com.example.two']);
  });

  it('validates app IDs for each marketplace', () => {
    expect(validAppId('apple_app_store', '123456789')).toBe(true);
    expect(validAppId('apple_app_store', 'com.example.app')).toBe(false);
    expect(validAppId('google_play', 'com.example.app')).toBe(true);
    expect(validAppId('google_play', 'nodots')).toBe(false);
  });
});

describe('answer-engine adapters', () => {
  const observation = { prompt: 'best seo tools', maximumOutputTokens: 512 };

  it('reads Claude text citations and web-search result blocks', async () => {
    const result = await askAnswerEngine({ engine: 'claude', model: 'claude-sonnet-5-5', useWeb: true, ...observation }, 'key', {
      fetcher: async () => Response.json({
        content: [
          { type: 'text', text: 'RoundSEO is a practical tool.', citations: [{ type: 'web_search_result_location', url: 'https://www.example.com/x', title: 'X' }] },
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://news.test/a', title: 'A' }] },
        ],
      }),
      now: () => new Date(observedAt),
    });
    expect(result).toMatchObject({ engine: 'claude', responseText: 'RoundSEO is a practical tool.', webSearchUsed: true, observedAt });
    expect(result.citations.map(citation => citation.domain)).toEqual(['example.com', 'news.test']);
  });

  it('reads OpenAI output text and URL citation annotations', async () => {
    const result = await askAnswerEngine({ engine: 'chatgpt', model: 'gpt-4.1-mini', useWeb: true, ...observation }, 'key', {
      fetcher: async () => Response.json({
        output: [
          { type: 'web_search_call' },
          { type: 'message', content: [{ type: 'output_text', text: 'Answer text', annotations: [{ type: 'url_citation', url: 'https://www.example.com/y', title: 'Y' }] }] },
        ],
      }),
    });
    expect(result.responseText).toBe('Answer text');
    expect(result.webSearchUsed).toBe(true);
    expect(result.citations).toEqual([{ url: 'https://www.example.com/y', domain: 'example.com', title: 'Y' }]);
  });

  it('reads Gemini candidate text and grounding chunks', async () => {
    const result = await askAnswerEngine({ engine: 'gemini', model: 'gemini-2.5-flash', useWeb: true, ...observation }, 'key', {
      fetcher: async () => Response.json({
        candidates: [{
          content: { parts: [{ text: 'Gemini answer.' }] },
          groundingMetadata: { webSearchQueries: ['seo tools'], groundingChunks: [{ web: { uri: 'https://vertex.test/redirect', title: 'vertex' } }] },
        }],
      }),
    });
    expect(result).toMatchObject({ responseText: 'Gemini answer.', webSearchUsed: true });
    expect(result.citations[0].domain).toBe('vertex.test');
  });

  it('reads Perplexity answers with both citation lists, de-duplicated', async () => {
    const result = await askAnswerEngine({ engine: 'perplexity', model: 'sonar', useWeb: true, ...observation }, 'key', {
      fetcher: async () => Response.json({
        choices: [{ message: { content: 'Perplexity answer.' } }],
        citations: ['https://www.example.com/p'],
        search_results: [{ title: 'P', url: 'https://www.example.com/p' }, { title: 'Q', url: 'https://other.test/q' }],
      }),
    });
    expect(result.responseText).toBe('Perplexity answer.');
    expect(result.citations.map(citation => citation.url)).toEqual(['https://www.example.com/p', 'https://other.test/q']);
  });

  it('reports rate limits and rejected credentials with distinct public codes', async () => {
    await expect(askAnswerEngine({ engine: 'claude', model: 'claude-sonnet-5-5', useWeb: false, ...observation }, 'key', { fetcher: async () => new Response('', { status: 429 }) }))
      .rejects.toMatchObject({ code: 'ANSWER_ENGINE_RATE_LIMITED', status: 429 });
    await expect(askAnswerEngine({ engine: 'chatgpt', model: 'gpt-4.1-mini', useWeb: false, ...observation }, 'key', { fetcher: async () => new Response('', { status: 401 }) }))
      .rejects.toMatchObject({ code: 'ANSWER_ENGINE_REJECTED' });
  });

  it('refuses model names that could alter the provider request path', async () => {
    await expect(askAnswerEngine({ engine: 'gemini', model: '../other', useWeb: false, ...observation }, 'key', { fetcher: async () => Response.json({}) }))
      .rejects.toMatchObject({ code: 'INVALID_MODEL' });
  });
});

describe('page inspection and extraction', () => {
  it('fetches each redirect hop through the public-URL policy and refuses private targets', async () => {
    await expect(fetchPublicPage('http://127.0.0.1/admin')).rejects.toMatchObject({ code: 'PUBLIC_URL_REQUIRED' });
    const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/start')
      ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/internal' } })
      : htmlResponse('<html></html>');
    await expect(fetchPublicPage('https://example.com/start', { fetcher })).rejects.toMatchObject({ code: 'PUBLIC_URL_REQUIRED' });
  });

  it('reports native SEO checks for a thin, unlabeled, noindex page', async () => {
    const html = '<html><head><title>Short</title><meta name="robots" content="noindex"></head><body><h1>Only heading</h1><p>A few words here.</p></body></html>';
    const analysis = await inspectPage('https://example.com/thin', {
      renderJavascript: false,
      config: noKeys,
      fetcher: async () => htmlResponse(html),
      observedAt,
    });
    const codes = analysis.page.issues.map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['noindex', 'title_short', 'description_missing', 'thin_content', 'canonical_missing', 'lang_missing', 'viewport_missing']));
    expect(analysis.page.renderingMode).toBe('html');
    expect(analysis.page.source.limitations.join(' ')).toMatch(/HTML response only/);
  });

  it('records that rendering was requested but the runner is not configured', async () => {
    const analysis = await inspectPage('https://example.com/js', {
      renderJavascript: true,
      config: noKeys,
      fetcher: async () => htmlResponse('<html><head><title>A reasonably long title for the page here</title></head><body><h1>Heading</h1></body></html>'),
      observedAt,
    });
    expect(analysis.renderingMode).toBe('html');
    expect(analysis.page.source.limitations[0]).toMatch(/JavaScript rendering is not configured/);
  });

  it('turns page content into markdown that keeps structure and drops navigation and scripts', () => {
    const markdown = htmlToMarkdown('<nav>menu links</nav><main><h1>Title</h1><p>Hello <a href="x">world</a></p><ul><li>one</li><li>two</li></ul><script>bad()</script></main>');
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('Hello world');
    expect(markdown).toContain('- one');
    expect(markdown).toContain('- two');
    expect(markdown).not.toContain('menu');
    expect(markdown).not.toContain('bad()');
  });

  it('keeps a page with a complete title, description, and single H1 free of metadata findings', () => {
    const html = '<html lang="en"><head><title>A complete page title that is long enough</title><meta name="description" content="A description that explains the page clearly for search results."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/full"></head><body><h1>Full page</h1><p>' + 'word '.repeat(320) + '</p></body></html>';
    const metrics = parsePageMetrics('https://example.com/full', html, { responseHeaders: {} });
    const codes = pageChecks(metrics, 200).map(issue => issue.code);
    expect(codes).not.toContain('title_missing');
    expect(codes).not.toContain('description_missing');
    expect(codes).not.toContain('h1_missing');
    expect(codes).not.toContain('thin_content');
  });
});

const rows = (overrides: Partial<ObservationRow>[]): ObservationRow[] => overrides.map(item => ({
  query: 'seo tool', queryKey: 'seo tool', surface: 'google', countryCode: 'US', position: 1, domain: null, url: null, observedAt, ...item,
}));

describe('analysis over stored observations', () => {
  it('estimates clicks only from volume and a modeled top-ten position', () => {
    expect(clickThroughShare(1)).toBe(0.316);
    expect(estimateClicks(1000, 1)).toBe(316);
    expect(estimateClicks(null, 1)).toBeNull();
    expect(estimateClicks(1000, 11)).toBeNull();
  });

  it('builds domain ranking history from every observation and reports the latest position', () => {
    const observations = rows([
      { domain: 'example.com', position: 5, observedAt: '2026-10-01T00:00:00.000Z', url: 'https://example.com/old' },
      { domain: 'example.com', position: 3, observedAt: '2026-11-01T00:00:00.000Z', url: 'https://example.com/new' },
      { domain: 'rival.test', position: 1, observedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    const [ranking] = domainRankingsFromObservations('www.example.com', observations, new Map([['seo tool', 1000]]), source, idFor, 10);
    expect(ranking).toMatchObject({ domain: 'example.com', keyword: 'seo tool', position: 3, url: 'https://example.com/new', searchVolume: 1000, estimatedTraffic: 110 });
    expect(ranking.history).toHaveLength(2);
  });

  it('counts competitor overlap only where both domains appear in the same latest snapshot', () => {
    const observations = rows([
      { query: 'crm software', queryKey: 'crm software', domain: 'example.com', position: 1, observedAt: '2026-11-01T00:00:00.000Z' },
      { query: 'crm software', queryKey: 'crm software', domain: 'rival.test', position: 2, observedAt: '2026-11-01T00:00:00.000Z' },
      { query: 'crm tools', queryKey: 'crm tools', domain: 'rival.test', position: 1, observedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    const [competitor] = competitorsFromObservations('example.com', observations, new Map(), source, idFor, 10);
    expect(competitor).toMatchObject({ domain: 'rival.test', sharedKeywords: 1, averagePosition: 2, observedKeywordCount: 2, estimatedTraffic: null });
  });

  it('groups observed keywords into categories with their share and leaves unmatched keywords visible', () => {
    expect(classifyKeyword('crm software for startups').code).toBe('software');
    expect(classifyKeyword('zebra')).toEqual({ code: 'uncategorized', label: 'Uncategorized' });
    const observations = rows([
      { query: 'crm software', queryKey: 'crm software', domain: 'example.com', position: 2 },
      { query: 'buy running shoes', queryKey: 'buy running shoes', domain: 'example.com', position: 4 },
      { query: 'zebra', queryKey: 'zebra', domain: 'example.com', position: 9 },
    ]);
    const categories = marketCategoriesFromObservations('example.com', observations, new Map([['crm software', 1000]]), source, idFor);
    expect(categories.map(item => [item.category, item.observedKeywordCount, item.share])).toEqual([
      ['ecommerce', 1, 0.333], ['software', 1, 0.333], ['uncategorized', 1, 0.333],
    ]);
    expect(categories.find(item => item.category === 'software')?.estimatedTraffic).toBe(Math.round(1000 * clickThroughShare(2)!));
  });

  it('measures answer visibility from text and citations, and names competitor domains from the same sample', () => {
    const answer = {
      kind: 'answer' as const, id: 'a1', engine: 'chatgpt' as const, model: 'gpt-4.1-mini', prompt: 'best tools', responseText: 'example.com is recommended. rival.test is also popular, and rival.test is cited.',
      webSearchUsed: true, citations: [{ url: 'https://www.example.com/page', domain: 'example.com', title: 'Example' }], source,
    };
    const [visibility] = answerVisibility('example.com', [answer], source, idFor);
    expect(visibility.mentioned).toBe(true);
    expect(visibility.mentionCount).toBeGreaterThanOrEqual(2);
    expect(visibility.competingDomains[0]).toMatchObject({ domain: 'rival.test' });
    expect(visibility.sentimentMethod).toBe('lexicon_heuristic');
    expect(visibility.sentiment).toBe('positive');
  });

  it('finds competing apps that share store results with the target app', () => {
    const competitors = appCompetitorsFromSearches('apple_app_store', '1', [
      { term: 'habit', apps: [{ appId: '1', title: 'Target', url: null }, { appId: '2', title: 'Rival', url: null }] },
      { term: 'daily goals', apps: [{ appId: '2', title: 'Rival', url: null }, { appId: '1', title: 'Target', url: null }] },
    ], source, idFor, 10);
    expect(competitors).toHaveLength(1);
    expect(competitors[0]).toMatchObject({ appId: '2', sharedKeywords: 2, position: 2, observedKeywordCount: 2 });
  });

  it('reads search results for the same query consistently across repeated parses', () => {
    const html = '<div class="g"><a href="https://www.example.com/a"><h3>A</h3></a></div>';
    expect(parseSerpHtml('google', html, 5).results).toEqual(parseSerpHtml('google', html, 5).results);
  });
});
