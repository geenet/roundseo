import type {
  AnswerEngine,
  AnswerEvidence,
  AnswerVisibilityEvidence,
  AppEvidence,
  AppMarketplace,
  BrowserProfile,
  EvidenceSource,
  IntelligenceAction,
  IntelligenceActionStatus,
  IntelligenceCapability,
  IntelligenceCapabilityStatus,
  IntelligenceEvidence,
  IntelligenceRun,
  IntelligenceRunRequest,
  IntelligenceRunStatus,
  KeywordEvidence,
  KeywordTrendEvidence,
  SearchDevice,
  SearchSurface,
  SerpCoverage,
  SerpEvidence,
  UnavailableMetric,
} from '../../shared/intelligence';
import { isPublicCrawlUrl } from '../crawlers/base';
import {
  answerVisibility,
  appCompetitorsFromSearches,
  appRankingsFromSearches,
  CATEGORY_METHOD,
  competitorsFromObservations,
  domainRankingsFromObservations,
  marketCategoriesFromObservations,
} from '../intelligence/analysis';
import { ANSWER_METHOD, askAnswerEngine, defaultModelFor } from '../intelligence/answers';
import { APP_STORE_METHOD, assertValidAppId, lookupStoreApp, searchStore, validAppId, type StoreApp } from '../intelligence/apps';
import type { IntelligenceConfig } from '../intelligence/config';
import { IntelligenceError } from '../intelligence/errors';
import { domainOf, normalizeHost } from '../intelligence/html';
import { type IntelligenceFetch } from '../intelligence/http';
import {
  fetchKeywordIdeas,
  fetchKeywordMetrics,
  isKeywordMarketSupported,
  KEYWORD_MARKET_COUNTRIES,
  KEYWORD_MARKET_LANGUAGES,
  KEYWORD_METRICS_METHOD,
  type KeywordMetricRecord,
} from '../intelligence/keywords';
import { capturePageScreenshot, extractPageContent, inspectPage, pageSource, type PageAnalysis } from '../intelligence/pages';
import { collectSerp, SERP_METHOD, type SerpCollection } from '../intelligence/serp';
import {
  consumeLiveRequests,
  insertIntelligenceAsset,
  insertIntelligenceObservations,
  insertKeywordMetrics,
  latestKeywordVolumes,
  listIntelligenceObservations,
  replaceIntelligenceEvidence,
  updateIntelligenceRun,
  type IntelligenceEvidenceInput,
  type IntelligenceRunRecord,
  type ObservationInput,
} from './intelligence-store';

export const STORED_OBSERVATIONS_METHOD = 'stored-observations-v1';
export const ANSWER_VISIBILITY_METHOD = 'answer-visibility-v1';
export const KEYWORD_LIMIT = 50;
export const SERP_RESULT_LIMIT = 100;
const SERP_SEED_LIMIT = 5;
const IDEA_LIMIT_MAX = 1000;

export const INTELLIGENCE_CAPABILITY_ORDER: IntelligenceCapability[] = [
  'keyword_research', 'serp_analysis', 'market_intelligence', 'app_intelligence', 'answer_engine_visibility', 'page_intelligence',
];

const ACTION_CAPABILITY: Record<Exclude<IntelligenceAction, 'site_crawl_refresh'>, IntelligenceCapability> = {
  keyword_discovery: 'keyword_research',
  keyword_overview: 'keyword_research',
  keyword_metrics: 'keyword_research',
  keyword_trends: 'keyword_research',
  domain_rankings: 'market_intelligence',
  domain_competitors: 'market_intelligence',
  market_categories: 'market_intelligence',
  app_competitors: 'app_intelligence',
  app_rankings: 'app_intelligence',
  serp_snapshot: 'serp_analysis',
  answer_response: 'answer_engine_visibility',
  answer_snapshot: 'answer_engine_visibility',
  answer_demand: 'answer_engine_visibility',
  page_inspection: 'page_intelligence',
  content_extraction: 'page_intelligence',
  page_screenshot: 'page_intelligence',
  site_crawl: 'page_intelligence',
};

export const INTELLIGENCE_ACTIONS = Object.keys(ACTION_CAPABILITY) as Array<keyof typeof ACTION_CAPABILITY>;

export function capabilityForAction(action: IntelligenceAction): IntelligenceCapability {
  return action === 'site_crawl_refresh' ? 'page_intelligence' : ACTION_CAPABILITY[action];
}

export function isIntelligenceAction(value: unknown): value is IntelligenceRunRequest['action'] {
  return typeof value === 'string' && (INTELLIGENCE_ACTIONS as string[]).includes(value);
}

export function isAsyncIntelligenceAction(action: IntelligenceAction): boolean {
  return action === 'site_crawl' || action === 'site_crawl_refresh';
}

/** Per-action availability for this deployment. Partial availability is described in `reason`. */
export function intelligenceActionStatuses(config: IntelligenceConfig): IntelligenceActionStatus[] {
  const googleAds = config.googleAds !== null;
  const engines = Object.keys(config.answerEngines) as AnswerEngine[];
  const screenshots = Boolean(config.runner && config.assetStore);
  const rows: Array<[IntelligenceAction, boolean, string | null, string[]]> = [
    ['keyword_discovery', true, googleAds
      ? 'Ideas, volumes, and CPC ranges come from the keyword-metrics source. Related searches and questions come from SERP collection.'
      : 'Related searches and questions come from SERP collection. Ideas, search volume, and CPC need the keyword-metrics source, which is not configured.',
    ['Google results page', ...(googleAds ? ['Google Ads Keyword Plan'] : [])]],
    ['keyword_overview', googleAds, googleAds ? null : 'Volume, CPC range, and competition need the keyword-metrics source, which is not configured.', ['Google Ads Keyword Plan']],
    ['keyword_metrics', googleAds, googleAds ? 'Bing metrics need a Microsoft Advertising source, which is not configured.' : 'Google metrics need the keyword-metrics source, which is not configured.', ['Google Ads Keyword Plan']],
    ['keyword_trends', googleAds, googleAds ? null : 'Monthly trends need the keyword-metrics source, which is not configured.', ['Google Ads Keyword Plan']],
    ['domain_rankings', true, 'Built from RoundSEO SERP observations stored for this website. Capture SERP snapshots to build history.', ['RoundSEO SERP observations']],
    ['domain_competitors', true, 'Competitor overlap is built from RoundSEO SERP observations stored for this website.', ['RoundSEO SERP observations']],
    ['market_categories', true, 'Categories are a keyword-lexicon classification of observed keywords, not a registry or survey.', ['RoundSEO SERP observations']],
    ['app_competitors', true, 'Apple data uses the public iTunes API. Google Play data is read from public store pages and can change without notice.', ['Apple iTunes Search API', 'Google Play store pages']],
    ['app_rankings', true, 'Apple data uses the public iTunes API. Google Play data is read from public store pages and can change without notice.', ['Apple iTunes Search API', 'Google Play store pages']],
    ['serp_snapshot', true, config.runner
      ? 'Search pages are rendered by RoundSEO\'s browser runner. Blocked or CAPTCHA pages are reported, not bypassed.'
      : 'Search pages are fetched directly. Blocked or CAPTCHA pages are reported, not bypassed.',
    ['Search results pages']],
    ['answer_response', engines.length > 0, engines.length > 0 ? `Answer engines configured here: ${engines.join(', ')}.` : 'No answer-engine API key is configured on this deployment.', engines],
    ['answer_snapshot', engines.length > 0, engines.length > 0 ? `Web-grounded answers from: ${engines.join(', ')}. Location and device do not apply to API answers.` : 'No answer-engine API key is configured on this deployment.', engines],
    ['answer_demand', false, 'No public source for AI query volume is connected. RoundSEO does not estimate AI demand.', []],
    ['page_inspection', true, null, ['Fetched HTML']],
    ['content_extraction', true, config.runner ? null : 'Rendered extraction needs the browser runner. Without it, RoundSEO saves the HTML result and says so.', ['Fetched HTML']],
    ['page_screenshot', screenshots, screenshots ? null : 'Screenshots need both the browser runner and screenshot storage, and at least one is not configured.', ['Browser runner']],
    ['site_crawl', true, `Durable crawl of this website's public HTML pages, capped at ${config.maximumSiteCrawlPages} pages.`, ['Fetched HTML']],
  ];
  return rows.map(([action, available, reason, sources]) => ({
    action,
    capability: capabilityForAction(action),
    available,
    reason,
    sources,
  }));
}

export function intelligenceCapabilityStatus(config: IntelligenceConfig): IntelligenceCapabilityStatus {
  const actions = intelligenceActionStatuses(config);
  const capabilities = INTELLIGENCE_CAPABILITY_ORDER.filter(capability => actions.some(action => action.capability === capability && action.available));
  return {
    available: capabilities.length > 0,
    capabilities,
    actions,
    safeguards: { maximumSiteCrawlPages: config.maximumSiteCrawlPages, maximumLiveRequestsPerDay: config.dailyRequestLimit },
    markets: { countries: [...KEYWORD_MARKET_COUNTRIES], languages: [...KEYWORD_MARKET_LANGUAGES] },
  };
}

/** Refuse an unavailable action with an accurate reason before any run is created. */
export function assertActionAvailable(config: IntelligenceConfig, action: IntelligenceAction): void {
  const status = intelligenceActionStatuses(config).find(item => item.action === action);
  if (!status) throw invalid('Choose a supported RoundSEO intelligence action.');
  if (!status.available) throw new IntelligenceError(status.reason || 'This intelligence action is not available on this deployment.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
}

export interface ValidationScope {
  websiteDomain: string;
  config: IntelligenceConfig;
}

/** Validate and normalize a client request. Domains are pinned to the website being acted on. */
export function validateIntelligenceRequest(input: unknown, scope: ValidationScope): IntelligenceRunRequest {
  if (!isRecord(input)) throw invalid('Send one RoundSEO intelligence request as a JSON object.');
  if (!isIntelligenceAction(input.action)) throw invalid('Choose a supported RoundSEO intelligence action.');
  switch (input.action) {
    case 'keyword_discovery':
      return { action: 'keyword_discovery', seeds: keywordList(input.seeds, 'seeds', 20), limit: limitOf(input.limit, 100, IDEA_LIMIT_MAX), ...market(input) };
    case 'keyword_overview':
      return { action: 'keyword_overview', keywords: keywordList(input.keywords, 'keywords', KEYWORD_LIMIT), ...market(input) };
    case 'keyword_metrics':
      return { action: 'keyword_metrics', source: enumOf(input.source, ['google', 'bing'], 'metrics source') as 'google' | 'bing', keywords: keywordList(input.keywords, 'keywords', KEYWORD_LIMIT), ...market(input) };
    case 'keyword_trends':
      return { action: 'keyword_trends', keywords: keywordList(input.keywords, 'keywords', 20), ...market(input) };
    case 'domain_rankings':
      return { action: 'domain_rankings', domain: websiteDomainOnly(input.domain, scope.websiteDomain), countryCode: countryOf(input.countryCode), limit: limitOf(input.limit, 100) };
    case 'domain_competitors':
      return { action: 'domain_competitors', domain: websiteDomainOnly(input.domain, scope.websiteDomain), countryCode: countryOf(input.countryCode), limit: limitOf(input.limit, 100) };
    case 'market_categories':
      return { action: 'market_categories', domain: websiteDomainOnly(input.domain, scope.websiteDomain), countryCode: countryOf(input.countryCode), limit: limitOf(input.limit, 100) };
    case 'app_competitors': {
      const marketplace = marketplaceOf(input.marketplace);
      return { action: 'app_competitors', marketplace, appId: appIdOf(marketplace, input.appId), countryCode: countryOf(input.countryCode), limit: limitOf(input.limit, 50, 100) };
    }
    case 'app_rankings': {
      const marketplace = marketplaceOf(input.marketplace);
      return { action: 'app_rankings', marketplace, appId: appIdOf(marketplace, input.appId), countryCode: countryOf(input.countryCode), keywords: keywordList(input.keywords, 'keywords', 20), limit: limitOf(input.limit, 100) };
    }
    case 'serp_snapshot':
      return {
        action: 'serp_snapshot',
        surface: enumOf(input.surface, ['google', 'google_maps', 'google_ai', 'bing', 'youtube'], 'search surface') as SearchSurface,
        query: textOf(input.query, 'a query', 200),
        device: optionalEnum(input.device, ['desktop', 'mobile'], 'device', 'desktop') as SearchDevice,
        resultLimit: limitOf(input.resultLimit, 20, SERP_RESULT_LIMIT),
        ...market(input),
        ...optionalTargetDomain(input.targetDomain),
      };
    case 'answer_response':
      return {
        action: 'answer_response',
        engine: enumOf(input.engine, ['chatgpt', 'gemini', 'claude', 'perplexity'], 'answer engine') as AnswerEngine,
        prompt: textOf(input.prompt, 'a prompt', 2_000),
        model: textOf(input.model, 'a model name', 80),
        ...optionalTargetDomain(input.targetDomain),
        maximumOutputTokens: limitOf(input.maximumOutputTokens, 1024, 2048),
        useWeb: input.useWeb === true,
        ...(typeof input.systemInstruction === 'string' && input.systemInstruction.trim() ? { systemInstruction: input.systemInstruction.trim().slice(0, 1_000) } : {}),
      };
    case 'answer_snapshot':
      return {
        action: 'answer_snapshot',
        engine: enumOf(input.engine, ['chatgpt', 'gemini', 'claude', 'perplexity'], 'answer engine') as AnswerEngine,
        prompt: textOf(input.prompt, 'a prompt', 2_000),
        ...optionalTargetDomain(input.targetDomain),
        maximumOutputTokens: limitOf(input.maximumOutputTokens, 1024, 2048),
      };
    case 'answer_demand':
      return { action: 'answer_demand', keywords: keywordList(input.keywords, 'keywords', KEYWORD_LIMIT) };
    case 'page_inspection':
      return { action: 'page_inspection', url: publicUrlOf(input.url), browserProfile: optionalEnum(input.browserProfile, ['desktop', 'mobile', 'tablet'], 'browser profile', 'desktop') as BrowserProfile, renderJavascript: input.renderJavascript === true };
    case 'content_extraction':
      return { action: 'content_extraction', url: publicUrlOf(input.url), renderJavascript: input.renderJavascript === true };
    case 'page_screenshot':
      return { action: 'page_screenshot', url: publicUrlOf(input.url), browserProfile: optionalEnum(input.browserProfile, ['desktop', 'mobile', 'tablet'], 'browser profile', 'desktop') as BrowserProfile, fullPage: input.fullPage !== false };
    case 'site_crawl': {
      const maximumPages = Number(input.maximumPages);
      if (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > scope.config.maximumSiteCrawlPages) {
        throw invalid(`Choose between 1 and ${scope.config.maximumSiteCrawlPages} pages for a site crawl.`);
      }
      const domain = websiteDomainOnly(input.domain, scope.websiteDomain);
      const startUrl = typeof input.startUrl === 'string' && input.startUrl.trim() ? publicUrlOf(input.startUrl) : undefined;
      if (startUrl && normalizeHost(new URL(startUrl).hostname) !== domain) throw invalid('The start URL must belong to this website.');
      return { action: 'site_crawl', domain, maximumPages, ...(startUrl ? { startUrl } : {}), extractContent: input.extractContent === true };
    }
  }
}

export interface ExecutionScope {
  db: any;
  websiteId: string;
  websiteDomain: string;
  config: IntelligenceConfig;
  fetcher?: IntelligenceFetch;
  now?: () => Date;
}

export interface AssetWrite {
  id: string;
  storageKey: string;
  contentType: string;
  byteLength: number;
  pageUrl: string;
  bytes: Uint8Array;
}

export interface ExecutionOutcome {
  status: IntelligenceRunStatus;
  statusMessage: string;
  evidence: IntelligenceEvidence[];
  coverage: SerpCoverage | null;
  unavailable: UnavailableMetric[];
  source: EvidenceSource;
  observations: Array<Omit<ObservationInput, 'runId'>>;
  keywordMetrics: { countryCode: string; languageCode: string; rows: KeywordMetricRecord[] } | null;
  assets: AssetWrite[];
  checkedAt: string;
  error: { code: string; message: string } | null;
}

/** Run one bounded action now and return its evidence, coverage, and gaps. */
export async function executeSingleShotAction(scope: ExecutionScope, request: IntelligenceRunRequest): Promise<ExecutionOutcome> {
  const observedAt = clock(scope).toISOString();
  switch (request.action) {
    case 'keyword_discovery': return keywordDiscovery(scope, request, observedAt);
    case 'keyword_overview':
    case 'keyword_metrics': return keywordMetricsAction(scope, request, observedAt);
    case 'keyword_trends': return keywordTrendsAction(scope, request, observedAt);
    case 'domain_rankings': return domainRankingsAction(scope, request, observedAt);
    case 'domain_competitors': return domainCompetitorsAction(scope, request, observedAt);
    case 'market_categories': return marketCategoriesAction(scope, request, observedAt);
    case 'app_competitors': return appCompetitorsAction(scope, request, observedAt);
    case 'app_rankings': return appRankingsAction(scope, request, observedAt);
    case 'serp_snapshot': return serpAction(scope, request, observedAt);
    case 'answer_response':
    case 'answer_snapshot': return answerAction(scope, request);
    case 'page_inspection': return pageInspectionAction(scope, request, observedAt);
    case 'content_extraction': return contentExtractionAction(scope, request, observedAt);
    case 'page_screenshot': return screenshotAction(scope, request, observedAt);
    case 'answer_demand': throw new IntelligenceError('No public source for AI query volume is connected, so RoundSEO does not estimate AI demand.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
    case 'site_crawl': throw invalid('Site crawls run as durable jobs.');
  }
}

/** Persist an outcome onto a run: observations, metrics, assets, evidence, and status. */
export async function persistOutcome(scope: ExecutionScope, runId: string, outcome: ExecutionOutcome): Promise<void> {
  if (outcome.observations.length) {
    await insertIntelligenceObservations(scope.db, scope.websiteId, outcome.observations.map(row => ({ ...row, runId })));
  }
  if (outcome.keywordMetrics?.rows.length) {
    await insertKeywordMetrics(scope.db, scope.websiteId, runId, 'google_ads_keyword_plan', outcome.keywordMetrics.countryCode, outcome.keywordMetrics.languageCode, outcome.keywordMetrics.rows);
  }
  for (const asset of outcome.assets) {
    await insertIntelligenceAsset(scope.db, { id: asset.id, runId, websiteId: scope.websiteId, pageUrl: asset.pageUrl, storageKey: asset.storageKey, contentType: asset.contentType, byteLength: asset.byteLength });
  }
  await replaceIntelligenceEvidence(scope.db, scope.websiteId, runId, outcome.evidence.map(toEvidenceInput));
  await updateIntelligenceRun(scope.db, scope.websiteId, runId, {
    status: outcome.status,
    statusMessage: outcome.statusMessage,
    summary: summarize(outcome.evidence, outcome.unavailable.length, null, null),
    source: outcome.source,
    coverage: outcome.coverage,
    unavailable: outcome.unavailable,
    progressCompleted: 1,
    progressTotal: 1,
    checkedAt: outcome.checkedAt,
    // The moment the run was saved, not the start time of the action that produced it.
    completedAt: new Date().toISOString(),
    leaseExpiresAt: null,
    errorCode: outcome.error?.code ?? null,
    errorMessage: outcome.error?.message ?? null,
  });
}

/** Charge live requests against the website's daily ceiling before collecting. */
export async function consumeAllowance(scope: ExecutionScope, units: number): Promise<void> {
  const allowed = await consumeLiveRequests(scope.db, scope.websiteId, units, scope.config.dailyRequestLimit, clock(scope));
  if (!allowed) throw new IntelligenceError('This website reached its daily live-request limit for intelligence collection. Try again tomorrow.', { status: 429, code: 'INTELLIGENCE_DAILY_LIMIT' });
}

/** Public view of a stored run, with evidence attached. */
export function publicRun(record: IntelligenceRunRecord, evidence: IntelligenceEvidence[]): IntelligenceRun {
  const source = (record.source as EvidenceSource | null) ?? sourceFor('derived_estimate', 'RoundSEO run', 'run-v1', record.createdAt, []);
  const unavailable = Array.isArray(record.unavailable) ? record.unavailable as UnavailableMetric[] : [];
  const summary = (record.summary as IntelligenceRun['summary'] | null) ?? summarize(evidence, unavailable.length, record.progressCompleted, record.progressTotal);
  return {
    id: record.id,
    capability: record.capability as IntelligenceCapability,
    action: record.action as IntelligenceAction,
    status: record.status,
    statusMessage: record.statusMessage,
    requestedAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    request: record.request as IntelligenceRunRequest | null,
    source,
    progress: { completed: record.progressCompleted, total: record.progressTotal, updatedAt: record.updatedAt },
    coverage: (record.coverage as SerpCoverage | null) ?? null,
    unavailable,
    error: record.error ? { code: record.error.code || 'INTELLIGENCE_ERROR', message: record.error.message } : null,
    summary,
    evidence,
  };
}

export function summarize(evidence: IntelligenceEvidence[], unavailableCount: number, pagesCrawled: number | null, pagesQueued: number | null): IntelligenceRun['summary'] {
  const keywords = new Set(evidence.flatMap(item => item.kind === 'keyword' || item.kind === 'keyword_trend' ? [item.keyword.toLowerCase()] : []));
  const pages = evidence.filter(item => item.kind === 'page').length;
  return {
    evidenceCount: evidence.length,
    keywordCount: keywords.size,
    resultCount: evidence.filter(item => item.kind === 'serp_result').length,
    citationCount: evidence.reduce((sum, item) => sum + (item.kind === 'answer' ? item.citations.length : 0), 0),
    pagesCrawled: pagesCrawled ?? (pages ? pages : null),
    pagesQueued,
    unavailableMetricCount: unavailableCount,
  };
}

export function toEvidenceInput(item: IntelligenceEvidence): IntelligenceEvidenceInput<IntelligenceEvidence> {
  return { kind: item.kind, identityKey: item.id, payload: item, observedAt: item.source.observedAt };
}

export function stableId(prefix: string, values: unknown[]): string {
  const source = values.map(value => String(value ?? '')).join('|');
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function isCrawlLinkCandidate(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !CRAWL_NON_HTML.test(url.pathname);
  } catch {
    return false;
  }
}

const CRAWL_NON_HTML = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|mjs|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|xml|json|txt)$/i;

// --- Keyword actions ------------------------------------------------------

async function keywordDiscovery(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'keyword_discovery' }>, observedAt: string): Promise<ExecutionOutcome> {
  const unavailable: UnavailableMetric[] = [];
  const evidence: IntelligenceEvidence[] = [];
  const observations: Array<Omit<ObservationInput, 'runId'>> = [];
  const coverages: SerpCoverage[] = [];
  const seen = new Set<string>();
  const serpSource = sourceFor('search_results_page', 'Google results page collected by RoundSEO', SERP_METHOD, observedAt, ['Related terms and questions have no volume or CPC attached.']);

  for (const seed of request.seeds.slice(0, SERP_SEED_LIMIT)) {
    const collection = await collectOrReport(scope, { surface: 'google', query: seed, countryCode: request.countryCode, languageCode: request.languageCode, device: 'desktop', resultLimit: 10 });
    coverages.push(collection.coverage);
    observations.push(...serpObservations(collection, request.countryCode, request.languageCode, 'desktop'));
    for (const term of [...collection.relatedTerms, ...collection.questions]) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(keywordEvidence(term, null, serpSource));
    }
  }

  if (scope.config.googleAds && isKeywordMarketSupported(request)) {
    await consumeAllowance(scope, 1);
    const ideas = await fetchKeywordIdeas(request.seeds, request, request.limit ?? 100, scope.config.googleAds, { fetcher: scope.fetcher, now: () => clock(scope) });
    const ideaSource = sourceFor('search_metrics_api', 'Google Ads Keyword Plan', KEYWORD_METRICS_METHOD, observedAt, ['Volume and CPC are source-reported monthly averages for the selected market.']);
    for (const idea of ideas) {
      const key = idea.keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(keywordEvidence(idea.keyword, idea, ideaSource));
    }
    return finishKeywordDiscovery(request, evidence, observations, coverages, unavailable, observedAt, ideas);
  }
  unavailable.push({
    metric: 'keyword ideas, search volume, CPC, and competition',
    reason: scope.config.googleAds
      ? 'The selected market is not supported by the keyword-metrics source.'
      : 'The keyword-metrics source is not configured, so only SERP-derived related terms and questions are returned.',
  });
  return finishKeywordDiscovery(request, evidence, observations, coverages, unavailable, observedAt, []);
}

function finishKeywordDiscovery(
  request: Extract<IntelligenceRunRequest, { action: 'keyword_discovery' }>,
  evidence: IntelligenceEvidence[],
  observations: Array<Omit<ObservationInput, 'runId'>>,
  coverages: SerpCoverage[],
  unavailable: UnavailableMetric[],
  observedAt: string,
  ideas: KeywordMetricRecord[],
): ExecutionOutcome {
  const failedCollections = coverages.filter(item => item.status === 'blocked' || item.status === 'unparsed').length;
  const allFailed = coverages.length > 0 && failedCollections === coverages.length && evidence.length === 0;
  const status: IntelligenceRunStatus = allFailed ? 'failed' : (failedCollections > 0 || unavailable.length > 0 ? 'partial' : 'complete');
  return {
    status,
    statusMessage: allFailed
      ? (coverages.find(item => item.reason)?.reason || 'RoundSEO could not collect keyword ideas for these seeds.')
      : `RoundSEO saved ${evidence.length} keyword record${evidence.length === 1 ? '' : 's'}${status === 'partial' ? ' with gaps. Review the coverage notes.' : '.'}`,
    evidence,
    coverage: coverages[0] ?? null,
    unavailable,
    source: sourceFor('search_results_page', 'Google results page collected by RoundSEO', SERP_METHOD, observedAt, ['Results reflect one collection at the stated location and device.']),
    observations,
    keywordMetrics: ideas.length ? { countryCode: request.countryCode, languageCode: request.languageCode, rows: ideas } : null,
    assets: [],
    checkedAt: observedAt,
    error: allFailed ? { code: 'SERP_BLOCKED', message: coverages[0]?.reason || 'No keyword ideas could be collected.' } : null,
  };
}

async function keywordMetricsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'keyword_overview' | 'keyword_metrics' }>, observedAt: string): Promise<ExecutionOutcome> {
  if (request.action === 'keyword_metrics' && request.source === 'bing') {
    throw new IntelligenceError('Bing search metrics need a Microsoft Advertising source, which is not configured.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  }
  const config = requireGoogleAds(scope);
  await consumeAllowance(scope, 1);
  const metrics = await fetchKeywordMetrics(request.keywords, request, config, { fetcher: scope.fetcher, now: () => clock(scope) });
  const byKeyword = new Map(metrics.map(item => [item.keyword.toLowerCase(), item]));
  const source = sourceFor('search_metrics_api', 'Google Ads Keyword Plan', KEYWORD_METRICS_METHOD, observedAt, ['Volumes are monthly averages for the selected market. RoundSEO does not measure keyword difficulty.']);
  const unavailable: UnavailableMetric[] = [{ metric: 'keyword difficulty', reason: 'RoundSEO does not measure keyword difficulty from a source it can verify.' }];
  const evidence = request.keywords.map(keyword => {
    const match = byKeyword.get(keyword.toLowerCase()) ?? null;
    if (!match) unavailable.push({ metric: `metrics for "${keyword}"`, reason: 'The keyword-metrics source returned no metrics for this exact term in this market.' });
    return keywordEvidence(keyword, match, source);
  });
  const status: IntelligenceRunStatus = metrics.length === 0 ? 'partial' : unavailable.length > 1 ? 'partial' : 'complete';
  return {
    status,
    statusMessage: metrics.length ? 'RoundSEO saved keyword metrics from the source.' : 'The source returned no metrics for these keywords.',
    evidence,
    coverage: null,
    unavailable,
    source,
    observations: [],
    keywordMetrics: { countryCode: request.countryCode, languageCode: request.languageCode, rows: metrics },
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

async function keywordTrendsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'keyword_trends' }>, observedAt: string): Promise<ExecutionOutcome> {
  const config = requireGoogleAds(scope);
  await consumeAllowance(scope, 1);
  const metrics = await fetchKeywordMetrics(request.keywords, request, config, { fetcher: scope.fetcher, now: () => clock(scope) });
  const source = sourceFor('search_metrics_api', 'Google Ads Keyword Plan', KEYWORD_METRICS_METHOD, observedAt, ['Twelve monthly values from the source. Each run is a dated snapshot, so repeated runs build a longer history.']);
  const unavailable: UnavailableMetric[] = [];
  const evidence: KeywordTrendEvidence[] = [];
  for (const keyword of request.keywords) {
    const match = metrics.find(item => item.keyword.toLowerCase() === keyword.toLowerCase());
    if (!match || match.monthlySeries.length === 0) {
      unavailable.push({ metric: `trend history for "${keyword}"`, reason: 'The keyword-metrics source returned no monthly series for this term.' });
      continue;
    }
    evidence.push({
      kind: 'keyword_trend',
      id: stableId('keyword-trend', [keyword.toLowerCase(), request.countryCode, observedAt]),
      keyword,
      points: match.monthlySeries,
      source,
    });
  }
  return {
    status: evidence.length === 0 ? 'partial' : unavailable.length ? 'partial' : 'complete',
    statusMessage: evidence.length ? 'RoundSEO saved monthly search trends from the source.' : 'The source returned no monthly trend data for these keywords.',
    evidence,
    coverage: null,
    unavailable,
    source,
    observations: [],
    keywordMetrics: { countryCode: request.countryCode, languageCode: request.languageCode, rows: metrics },
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

// --- Domain and market analysis -------------------------------------------

async function domainRankingsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'domain_rankings' }>, observedAt: string): Promise<ExecutionOutcome> {
  const rows = await listIntelligenceObservations(scope.db, scope.websiteId, request.countryCode);
  const volumes = await latestKeywordVolumes(scope.db, scope.websiteId, request.countryCode);
  const source = sourceFor('stored_observations', 'RoundSEO SERP observations', STORED_OBSERVATIONS_METHOD, observedAt, ['Rankings cover only queries RoundSEO has collected. Positions are as observed at each collection.', 'Estimated traffic is a modeled click share applied to source-reported volume, not measured traffic.']);
  const evidence = domainRankingsFromObservations(request.domain, rows, volumes, source, stableId, request.limit ?? 100);
  const unavailable: UnavailableMetric[] = [];
  if (!evidence.length) unavailable.push({ metric: 'domain rankings', reason: 'No SERP observations for this domain are stored yet. Capture SERP snapshots for this website\'s keywords to build ranking history.' });
  else if (!evidence.some(item => item.searchVolume !== null)) unavailable.push({ metric: 'estimated traffic', reason: 'Traffic estimates need search volume from the keyword-metrics source for these keywords.' });
  return {
    status: evidence.length ? 'complete' : 'partial',
    statusMessage: evidence.length ? 'RoundSEO built ranking history from stored SERP observations.' : 'No stored SERP observations for this domain yet.',
    evidence,
    coverage: null,
    unavailable,
    source,
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

async function domainCompetitorsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'domain_competitors' }>, observedAt: string): Promise<ExecutionOutcome> {
  const rows = await listIntelligenceObservations(scope.db, scope.websiteId, request.countryCode);
  const volumes = await latestKeywordVolumes(scope.db, scope.websiteId, request.countryCode);
  const source = sourceFor('stored_observations', 'RoundSEO SERP observations', STORED_OBSERVATIONS_METHOD, observedAt, ['Overlap counts only queries RoundSEO collected in the same snapshot as this domain.', 'Shared keywords do not measure competitor traffic.']);
  const evidence = competitorsFromObservations(request.domain, rows, volumes, source, stableId, request.limit ?? 100);
  return {
    status: evidence.length ? 'complete' : 'partial',
    statusMessage: evidence.length ? 'RoundSEO calculated competitor overlap from stored SERP observations.' : 'No overlapping competitor observations are stored yet.',
    evidence,
    coverage: null,
    unavailable: evidence.length ? [] : [{ metric: 'competing domains', reason: 'No competing domains share a stored SERP snapshot with this website yet. Capture more SERP snapshots to build overlap.' }],
    source,
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

async function marketCategoriesAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'market_categories' }>, observedAt: string): Promise<ExecutionOutcome> {
  const rows = await listIntelligenceObservations(scope.db, scope.websiteId, request.countryCode);
  const volumes = await latestKeywordVolumes(scope.db, scope.websiteId, request.countryCode);
  const source = sourceFor('stored_observations', 'RoundSEO keyword categories', CATEGORY_METHOD, observedAt, ['Each keyword is assigned to one category by lexicon match. Uncategorized keywords stay visible.', 'Categories are heuristic and are not an industry registry.']);
  const evidence = marketCategoriesFromObservations(request.domain, rows, volumes, source, stableId);
  return {
    status: evidence.length ? 'complete' : 'partial',
    statusMessage: evidence.length ? 'RoundSEO grouped this domain\'s observed keywords into market categories.' : 'No market categories are available until SERP observations exist.',
    evidence,
    coverage: null,
    unavailable: evidence.length ? [] : [{ metric: 'market categories', reason: 'No stored SERP observations for this domain yet. Capture SERP snapshots first.' }],
    source,
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

// --- App-store actions ----------------------------------------------------

async function appCompetitorsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'app_competitors' }>, observedAt: string): Promise<ExecutionOutcome> {
  const target = await requireStoreApp(scope, request.marketplace, request.appId, request.countryCode);
  const searches = await searchSeeds(request.marketplace, titleSeeds(target.title || request.appId), request.countryCode, 50, scope.fetcher);
  const source = appSource(request.marketplace, observedAt, ['Competitors are apps that appear in the same store results as this app for title-derived terms.']);
  const evidence = appCompetitorsFromSearches(request.marketplace, request.appId, searches, source, stableId, request.limit ?? 50);
  return appOutcome(evidence, searches, source, observedAt, evidence.length
    ? 'RoundSEO found competing apps in store search results.'
    : 'No competing apps were found in the store results for these terms.',
  evidence.length ? [] : [{ metric: 'competing apps', reason: 'The store results for this app\'s title terms did not include other apps.' }]);
}

async function appRankingsAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'app_rankings' }>, observedAt: string): Promise<ExecutionOutcome> {
  await requireStoreApp(scope, request.marketplace, request.appId, request.countryCode);
  const searches = await searchSeeds(request.marketplace, request.keywords, request.countryCode, request.limit ?? 100, scope.fetcher);
  const source = appSource(request.marketplace, observedAt, ['Rank is the app\'s position in the store\'s returned results for each term.']);
  const evidence = appRankingsFromSearches(request.marketplace, request.appId, searches, source, stableId);
  return appOutcome(evidence, searches, source, observedAt, 'RoundSEO recorded where this app ranks for each term.', [
    { metric: 'search volume for app keywords', reason: 'App store search volume is not collected by RoundSEO.' },
  ]);
}

function appOutcome(
  evidence: AppEvidence[],
  searches: Array<{ term: string; apps: StoreApp[]; failed: boolean }>,
  source: EvidenceSource,
  observedAt: string,
  message: string,
  unavailable: UnavailableMetric[],
): ExecutionOutcome {
  const failed = searches.filter(search => search.failed).length;
  const allFailed = searches.length > 0 && failed === searches.length;
  const gaps = failed ? [...unavailable, { metric: 'some store searches', reason: `${failed} of ${searches.length} store searches could not be read.` }] : unavailable;
  return {
    status: allFailed ? 'failed' : failed ? 'partial' : 'complete',
    statusMessage: allFailed ? 'The app store could not be read for these terms.' : message,
    evidence,
    coverage: null,
    unavailable: gaps,
    source,
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observedAt,
    error: allFailed ? { code: 'APP_STORE_UNAVAILABLE', message: 'The app store could not be read for these terms.' } : null,
  };
}

// --- SERP and answer actions ----------------------------------------------

async function serpAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'serp_snapshot' }>, observedAt: string): Promise<ExecutionOutcome> {
  await consumeAllowance(scope, 1);
  const device = request.device || 'desktop';
  const collection = await collectOrReport(scope, {
    surface: request.surface,
    query: request.query,
    countryCode: request.countryCode,
    languageCode: request.languageCode,
    device,
    resultLimit: request.resultLimit || 20,
  });
  const coverage = collection.coverage;
  const source = sourceFor('search_results_page', surfaceLabel(request.surface), SERP_METHOD, collection.observedAt || observedAt, serpLimitations(request.surface));
  const evidence: SerpEvidence[] = collection.results.map(result => ({
    kind: 'serp_result',
    id: stableId('serp', [request.surface, collection.query, request.countryCode, device, result.position, result.url]),
    query: collection.query,
    surface: request.surface,
    position: result.position,
    feature: result.feature,
    title: result.title,
    url: result.url,
    domain: result.domain,
    description: result.description,
    source,
  }));
  const unavailable: UnavailableMetric[] = coverage.status === 'complete' ? [] : [{ metric: 'complete result set', reason: coverage.reason || 'The page did not return every requested result.' }];
  const status: IntelligenceRunStatus = coverage.status === 'blocked' || coverage.status === 'unparsed'
    ? 'failed'
    : coverage.status === 'partial' ? 'partial' : 'complete';
  return {
    status,
    statusMessage: status === 'failed'
      ? (coverage.reason || 'RoundSEO could not read results for this search.')
      : status === 'partial' ? 'RoundSEO saved the results it could read.' : 'RoundSEO saved the search results.',
    evidence,
    coverage,
    unavailable,
    source,
    observations: serpObservations(collection, request.countryCode, request.languageCode, device),
    keywordMetrics: null,
    assets: [],
    checkedAt: collection.observedAt || observedAt,
    error: status === 'failed'
      ? { code: coverage.status === 'blocked' ? 'SERP_BLOCKED' : 'SERP_UNPARSED', message: coverage.reason || 'No results could be read.' }
      : null,
  };
}

async function answerAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'answer_response' | 'answer_snapshot' }>): Promise<ExecutionOutcome> {
  const key = scope.config.answerEngines[request.engine];
  if (!key) throw new IntelligenceError(`${request.engine} has no API key configured on this deployment.`, { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  await consumeAllowance(scope, 1);
  const isSnapshot = request.action === 'answer_snapshot';
  const model = isSnapshot ? defaultModelFor(request.engine) : request.model;
  const observation = await askAnswerEngine({
    engine: request.engine,
    model,
    prompt: request.prompt,
    systemInstruction: 'systemInstruction' in request ? request.systemInstruction : undefined,
    maximumOutputTokens: request.maximumOutputTokens ?? 1024,
    useWeb: isSnapshot ? true : request.useWeb === true,
  }, key, { fetcher: scope.fetcher, now: () => clock(scope) });
  const source = sourceFor('answer_engine_api', `${request.engine} API answer`, ANSWER_METHOD, observation.observedAt, [
    'A single sampled answer. Answers vary between runs and are not a ranking.',
    observation.webSearchUsed ? 'Web search was enabled for this answer.' : 'Web search was not used for this answer.',
    'API answers do not reproduce consumer-app location or personalization.',
  ]);
  const answer: AnswerEvidence = {
    kind: 'answer',
    id: stableId('answer', [request.engine, model, request.prompt, observation.observedAt]),
    engine: request.engine,
    model,
    prompt: request.prompt,
    responseText: observation.responseText,
    webSearchUsed: observation.webSearchUsed,
    citations: observation.citations,
    source,
  };
  const evidence: IntelligenceEvidence[] = [answer];
  if (request.targetDomain) {
    const visibilitySource = sourceFor('derived_estimate', 'RoundSEO analysis of a sampled answer', ANSWER_VISIBILITY_METHOD, observation.observedAt, [
      'Mentions count the domain name or its brand term in the text and citations. Share of voice compares only the domains named in this sample.',
      'Sentiment is a keyword heuristic, not a measured opinion.',
    ]);
    evidence.push(...answerVisibility(request.targetDomain, [answer], visibilitySource, stableId) as AnswerVisibilityEvidence[]);
  }
  const answered = Boolean(observation.responseText || observation.citations.length);
  return {
    status: answered ? 'complete' : 'partial',
    statusMessage: answered ? 'RoundSEO saved this answer and its citations.' : 'The answer engine returned no text or citations for this prompt.',
    evidence,
    coverage: null,
    unavailable: observation.citations.length ? [] : [{ metric: 'citations', reason: 'This answer did not include citations.' }],
    source,
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observation.observedAt,
    error: null,
  };
}

// --- Page actions ----------------------------------------------------------

async function pageInspectionAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'page_inspection' }>, observedAt: string): Promise<ExecutionOutcome> {
  await consumeAllowance(scope, 1);
  const analysis = await inspectPage(request.url, { renderJavascript: request.renderJavascript === true, profile: request.browserProfile, config: scope.config, fetcher: scope.fetcher, observedAt });
  return pageOutcome(analysis, request.renderJavascript === true, observedAt);
}

async function contentExtractionAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'content_extraction' }>, observedAt: string): Promise<ExecutionOutcome> {
  await consumeAllowance(scope, 1);
  const analysis = await extractPageContent(request.url, { renderJavascript: request.renderJavascript === true, config: scope.config, fetcher: scope.fetcher, observedAt });
  return pageOutcome(analysis, request.renderJavascript === true, observedAt);
}

async function screenshotAction(scope: ExecutionScope, request: Extract<IntelligenceRunRequest, { action: 'page_screenshot' }>, observedAt: string): Promise<ExecutionOutcome> {
  if (!scope.config.assetStore) throw new IntelligenceError('Screenshot storage is not configured on this deployment.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  await consumeAllowance(scope, 2);
  const capture = await capturePageScreenshot(request.url, { profile: request.browserProfile, fullPage: request.fullPage !== false, config: scope.config, fetcher: scope.fetcher });
  const assetId = stableId('asset', [scope.websiteId, request.url, observedAt, capture.bytes.byteLength]);
  const storageKey = `intelligence/${scope.websiteId}/${assetId}.png`;
  await scope.config.assetStore.put(storageKey, capture.bytes, { httpMetadata: { contentType: capture.contentType } });
  const analysis = await inspectPage(request.url, { renderJavascript: false, profile: request.browserProfile, config: scope.config, fetcher: scope.fetcher, observedAt });
  const screenshotUrl = `/api/v2/websites/${encodeURIComponent(scope.websiteId)}/intelligence/assets/${assetId}`;
  const page: PageAnalysis['page'] = {
    ...analysis.page,
    screenshotUrl,
    source: pageSource(observedAt, [...analysis.page.source.limitations, 'Screenshot captured by RoundSEO\'s browser runner.']),
  };
  return {
    status: 'complete',
    statusMessage: 'RoundSEO saved the screenshot and its page checks.',
    evidence: [page],
    coverage: null,
    unavailable: [],
    source: pageSource(observedAt, ['Screenshot captured by RoundSEO\'s browser runner.']),
    observations: [],
    keywordMetrics: null,
    assets: [{ id: assetId, storageKey, contentType: capture.contentType, byteLength: capture.bytes.byteLength, pageUrl: request.url, bytes: capture.bytes }],
    checkedAt: observedAt,
    error: null,
  };
}

function pageOutcome(analysis: PageAnalysis, renderRequested: boolean, observedAt: string): ExecutionOutcome {
  const page = analysis.page;
  const unavailable: UnavailableMetric[] = [];
  if (renderRequested && analysis.renderingMode !== 'rendered') unavailable.push({ metric: 'rendered page', reason: 'Rendering needs the browser runner, which is not configured. The saved result is the HTML response.' });
  const errored = page.statusCode !== null && page.statusCode >= 400;
  return {
    status: errored ? 'partial' : 'complete',
    statusMessage: errored ? 'RoundSEO saved the page result, which returned an error status.' : 'RoundSEO saved the page result.',
    evidence: [page],
    coverage: null,
    unavailable,
    source: pageSource(observedAt, page.source.limitations),
    observations: [],
    keywordMetrics: null,
    assets: [],
    checkedAt: observedAt,
    error: null,
  };
}

// --- Shared helpers --------------------------------------------------------

/** Collect a SERP page; a collector failure becomes blocked coverage rather than a thrown error. */
async function collectOrReport(scope: ExecutionScope, request: { surface: SearchSurface; query: string; countryCode: string; languageCode: string; device: SearchDevice; resultLimit: number }): Promise<SerpCollection> {
  try {
    return await collectSerp(request, scope.config, { fetcher: scope.fetcher, now: () => clock(scope) });
  } catch (error) {
    if (!(error instanceof IntelligenceError)) throw error;
    return {
      surface: request.surface,
      query: request.query,
      observedAt: clock(scope).toISOString(),
      results: [],
      relatedTerms: [],
      questions: [],
      coverage: { surface: request.surface, query: request.query, status: 'blocked', resultsRequested: request.resultLimit, resultsParsed: 0, featuresDetected: [], reason: error.message },
    };
  }
}

function serpObservations(collection: SerpCollection, countryCode: string, languageCode: string, device: string): Array<Omit<ObservationInput, 'runId'>> {
  return collection.results
    .filter(result => result.domain)
    .map(result => ({
      surface: collection.surface,
      countryCode,
      languageCode,
      device,
      query: collection.query,
      position: result.position,
      feature: result.feature,
      domain: result.domain,
      url: result.url,
      title: result.title,
      description: result.description,
      observedAt: collection.observedAt,
    }));
}

function keywordEvidence(keyword: string, metrics: Partial<KeywordMetricRecord> | null, source: EvidenceSource): KeywordEvidence {
  return {
    kind: 'keyword',
    id: stableId('keyword', [keyword.toLowerCase(), source.method, source.observedAt]),
    keyword,
    searchVolume: metrics?.searchVolume ?? null,
    cpcLow: metrics?.cpcLow ?? null,
    cpcHigh: metrics?.cpcHigh ?? null,
    competition: metrics?.competition ?? null,
    intent: null,
    source,
  };
}

function serpLimitations(surface: SearchSurface): string[] {
  const limitations = ['Results reflect one collection at the stated location and device. Search results are personalized and change over time.'];
  if (surface === 'google_maps') limitations.push('Map results are read from public place links, which can omit details shown only in the interface.');
  if (surface === 'google_ai') limitations.push('AI-mode results are read from the links on the page, and the layout changes often.');
  return limitations;
}

function surfaceLabel(surface: SearchSurface): string {
  return ({
    google: 'Google organic results collected by RoundSEO',
    google_maps: 'Google Maps results collected by RoundSEO',
    google_ai: 'Google AI results collected by RoundSEO',
    bing: 'Bing organic results collected by RoundSEO',
    youtube: 'YouTube results collected by RoundSEO',
  } as const)[surface];
}

function sourceFor(origin: EvidenceSource['origin'], label: string, method: string, observedAt: string, limitations: string[]): EvidenceSource {
  return { origin, label, method, observedAt, limitations };
}

function appSource(marketplace: AppMarketplace, observedAt: string, limitations: string[]): EvidenceSource {
  return marketplace === 'apple_app_store'
    ? sourceFor('app_store_api', 'Apple iTunes Search API', APP_STORE_METHOD, observedAt, limitations)
    : sourceFor('app_store_page', 'Google Play store pages', APP_STORE_METHOD, observedAt, [...limitations, 'Google Play has no public search API, so results are read from public pages.']);
}

function requireGoogleAds(scope: ExecutionScope): NonNullable<IntelligenceConfig['googleAds']> {
  if (!scope.config.googleAds) throw new IntelligenceError('This action needs the keyword-metrics source, which is not configured on this deployment.', { status: 503, code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  return scope.config.googleAds;
}

async function requireStoreApp(scope: ExecutionScope, marketplace: AppMarketplace, appId: string, countryCode: string): Promise<StoreApp> {
  const target = await lookupStoreApp(marketplace, appId, countryCode, { fetcher: scope.fetcher });
  if (!target) throw new IntelligenceError('The app was not found in this store market.', { status: 404, code: 'APP_NOT_FOUND' });
  return target;
}

function titleSeeds(title: string): string[] {
  const words = title.split(/[\s:–—|-]+/).map(word => word.trim()).filter(word => word.length > 1);
  const seeds = [title.slice(0, 120), words.slice(0, 2).join(' '), words[0] || ''].map(term => term.trim()).filter(term => term.length >= 2);
  return [...new Set(seeds)].slice(0, 3);
}

async function searchSeeds(marketplace: AppMarketplace, terms: string[], countryCode: string, limit: number, fetcher?: IntelligenceFetch): Promise<Array<{ term: string; apps: StoreApp[]; failed: boolean }>> {
  const results: Array<{ term: string; apps: StoreApp[]; failed: boolean }> = [];
  for (const term of terms) {
    try {
      results.push({ term, apps: await searchStore(marketplace, term, countryCode, limit, { fetcher }), failed: false });
    } catch {
      results.push({ term, apps: [], failed: true });
    }
  }
  return results;
}

function clock(scope: { now?: () => Date }): Date {
  return scope.now ? scope.now() : new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): IntelligenceError {
  return new IntelligenceError(message, { status: 400, code: 'INVALID_INTELLIGENCE_REQUEST' });
}

function textOf(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`Enter ${label}.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw invalid(`Keep ${label} to at most ${maximum} characters.`);
  return trimmed;
}

function keywordList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value)) throw invalid(`Enter at least one value for ${label}.`);
  const terms = [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
  if (!terms.length) throw invalid(`Enter at least one value for ${label}.`);
  if (terms.length > maximum) throw invalid(`Use at most ${maximum} values for ${label}.`);
  if (terms.some(term => term.length > 120)) throw invalid(`Keep each value for ${label} to at most 120 characters.`);
  return terms;
}

function enumOf(value: unknown, allowed: string[], label: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw invalid(`Choose a supported ${label}.`);
  return value;
}

function optionalEnum(value: unknown, allowed: string[], label: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return enumOf(value, allowed, label);
}

function limitOf(value: unknown, fallback: number, maximum = 200): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw invalid(`Choose a limit from 1 to ${maximum}.`);
  return parsed;
}

function countryOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) throw invalid('Enter a two-letter country code, such as US.');
  return value.trim().toUpperCase();
}

function languageOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(value.trim())) throw invalid('Enter a language code, such as en.');
  return value.trim().toLowerCase();
}

function market(input: Record<string, unknown>): { countryCode: string; languageCode: string } {
  return { countryCode: countryOf(input.countryCode), languageCode: languageOf(input.languageCode) };
}

function optionalTargetDomain(value: unknown): { targetDomain?: string } {
  if (typeof value !== 'string' || !value.trim()) return {};
  return { targetDomain: domainOrThrow(value, 'target domain') };
}

function domainOrThrow(value: string, label: string): string {
  const host = domainOf(value.trim());
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) throw invalid(`Enter a ${label} such as example.com.`);
  return normalizeHost(host);
}

function websiteDomainOnly(value: unknown, websiteDomain: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Enter the website domain.');
  const host = domainOrThrow(value, 'domain');
  if (host !== normalizeHost(websiteDomain)) throw invalid('Intelligence runs are limited to this website\'s domain.');
  return host;
}

function marketplaceOf(value: unknown): AppMarketplace {
  return enumOf(value, ['google_play', 'apple_app_store'], 'app marketplace') as AppMarketplace;
}

function appIdOf(marketplace: AppMarketplace, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Enter the app ID.');
  const appId = value.trim();
  if (!validAppId(marketplace, appId)) assertValidAppId(marketplace, appId);
  return appId;
}

function publicUrlOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Enter a public page URL.');
  const trimmed = value.trim();
  if (!isPublicCrawlUrl(trimmed)) throw new IntelligenceError('Only public HTTP or HTTPS page addresses can be inspected.', { status: 400, code: 'PUBLIC_URL_REQUIRED' });
  return new URL(trimmed).href;
}
