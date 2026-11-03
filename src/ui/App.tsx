import type { AuditAssurance } from '../worker/crawlers/assurance/types';
import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  buildPpcSeoOpportunities,
  clusterKeywordMetrics,
  compareCompetitorKeywords,
  groupKeywordIdeas,
  normalizeDomain,
  parseKeywordMetrics,
  parseSerpResults,
  summarizeRankTracking,
  summarizeSerpResults,
  type KeywordMetric,
  type SerpResult,
} from '../shared/search-intelligence';
import {
  parsePageAnalyticsRecords,
  parseRetentionCohortRecords,
  summarizePageAnalytics,
  summarizeRetentionCohorts,
  type AnalyticsPageRecord,
  type RetentionCohortRecord,
} from '../shared/analytics-intelligence';
import { compareAuditIssues, type IssueComparison } from '../shared/audit-issue-intelligence';
import type { WebsiteMedia, WebsiteMediaItem } from '../shared/website-media';
import {
  AnswerEnginePanel,
  KeywordIntelligencePanel,
  MarketAndAppIntelligencePanel,
  PageIntelligencePanel,
  SerpIntelligencePanel,
} from './components/IntelligencePanels';
import OnPageReport from './components/OnPageReport';
import { BacklinksWorkspace } from './components/BacklinksPanels';
import { IndexingWorkspace } from './components/IndexingPanels';
import { readStoredJson, writeStoredJson, removeStoredValue } from './storage';

type User = { name: string; email: string };
type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
type Availability = 'measured' | 'not_connected' | 'not_measured' | 'insufficient' | 'partial' | 'stale' | 'failed' | 'unsupported' | 'not_applicable';
type ActionStatus = 'open' | 'planned' | 'in_progress' | 'awaiting_verification' | 'verified_resolved' | 'recurring' | 'ignored' | 'not_applicable';
type SiteRoute = 'overview' | 'on-page' | 'audit' | 'pageload' | 'real-user-loading' | 'analytics' | 'keywords' | 'search-intelligence' | 'backlinks' | 'indexing' | 'ai-visibility' | 'security' | 'action-plan' | 'pages' | 'changes' | 'data-scope';
type IntelligenceTab = 'clusters' | 'rank-tracking' | 'serp-analysis' | 'competitors' | 'ppc-seo';
type AnalyticsTab = 'pages' | 'retention';
type LocationRoute = { domain: string | null; section: SiteRoute; pageUrl: string | null; intelligenceTab: IntelligenceTab };

type Evidence = { url: string; element: string; observed: string; recommendation: string; relatedUrls?: string[] };
type Finding = { id: string; ruleId: string; ruleVersion: string; priority: Priority; category: string; title: string; rationale: string; outcome: string; effort: string; confidence: 'high' | 'medium' | 'low'; evidence: Evidence[]; matchCount?: number; affectedUrlCount?: number; evidenceTruncated?: boolean };
type PageRecord = { url: string; statusCode: number; crawlDepth: number; title?: string; metaDescription?: string; h1: string[]; h2?: string[]; h3?: string[]; canonicalUrl?: string; robots?: string; indexable: boolean; contentSource?: string; requiresJavaScriptRendering?: boolean; wordCount: number; textToHtmlRatio?: number; imageCount?: number; imagesWithoutAlt?: number; contentExcerpt: string; internalLinks: number; externalLinks: number; nonDescriptiveInternalAnchors?: number; structuredDataTypes: string[]; linkEvidence: Array<{ target?: string; anchorText: string; placement: string; isInternal: boolean; relAttributes?: string }> };
type TechnicalHealth = { value: number | null; passedChecks: number; evaluatedChecks: number; expectedChecks: number; unknownChecks: number; ruleSetVersion: string };
type CrawlCoverage = { availability: Availability; inspectedPages: number; discoveredUrls: number; failedUrls: number; renderingRequiredPages: number; limitReached: boolean; method: 'http' | 'browser'; scopeNote: string; attemptedUrls?: number; remainingUrls?: number; robotsExcludedUrls?: number; pendingUrls?: string[]; sitemapStatus?: 'not_checked' | 'available' | 'unavailable' | 'partial'; sitemapFiles?: number; sitemapUrls?: number; discoveryWarnings?: string[] };
type Action = { id: string; ruleId: string; title: string; priority: Priority; status: ActionStatus; effort: string; owner: string; verification: string; outcome: string; evidence: Evidence[]; explanation?: string; matchCount?: number; affectedUrlCount?: number; evidenceTruncated?: boolean };
type Change = { id: string; pageUrl: string; field: string; before: string; after: string; detectedAt: string };
type DataSource = { key: string; label: string; availability: Availability; detail: string; value?: string; updatedAt?: string };
type PerformanceMetric = { key: 'fcp' | 'lcp' | 'cls' | 'inp' | 'tbt' | 'speed_index' | 'ttfb'; label: string; value: number | null; unit: 'ms' | 'ratio'; displayValue?: string; rating: 'good' | 'needs_improvement' | 'poor' | 'unknown'; source: 'lab' | 'field' };
type PerformanceOpportunity = { key: string; title: string; estimatedSavingsMs: number | null; estimatedSavingsBytes: number | null; evidence?: Array<{ url: string; observed: string; recommendation: string }> };
type PerformanceResource = { url: string; kind: string; status: number; transferredBytes: number | null; durationMs?: number; sequence?: number; startedAtMs?: number; hostname?: string; initiator?: string; cacheControl?: string; cacheStatus?: string; age?: string; contentEncoding?: string; thirdParty?: boolean };
type PerformanceDeviceResult = { device: 'mobile' | 'desktop'; availability: Availability; labScore: number | null; labMetrics: PerformanceMetric[]; fieldMetrics: PerformanceMetric[]; fieldDataAvailability: Availability; fieldDataScope: 'url' | 'origin' | 'none'; opportunities: PerformanceOpportunity[]; fetchedAt: string; error?: string; resources?: PerformanceResource[]; loadSequence?: PerformanceResource[]; requests?: number; transferredBytes?: number; profile?: string };
type PerformanceAudit = { targetUrl: string; provider: 'google_pagespeed_insights' | 'local_browser'; providerLabel: string; availability: Availability; fetchedAt: string; methodVersion: string; devices: PerformanceDeviceResult[]; error?: string; sourceNote?: string };
type RealUserPageLoadingLink = { url: string; text: string; placement: 'main' | 'header' | 'footer' | 'other' };
type RealUserDeliveryHost = { hostname: string; firstParty: boolean; requests: number; transferredBytes: number; cacheControl: string[]; cacheStatus: string[]; age: string[] };
type RealUserLoadStructure = { potentialBlockingScripts: Array<{ url: string; location: 'head' | 'body'; type: string | null; thirdParty: boolean }>; inlineHeadScriptCount: number; headStylesheets: Array<{ url: string; media: string | null; thirdParty: boolean }>; deliveryHosts: RealUserDeliveryHost[] };
type RealUserPageLoadingPage = { url: string; role: 'landing' | 'linked'; discoveredFrom?: RealUserPageLoadingLink; availability: Availability; fetchedAt: string; devices: PerformanceDeviceResult[]; loadStructure?: RealUserLoadStructure; loadStructureDevice?: 'mobile' | 'desktop'; error?: string };
type RealUserPageLoadingAudit = { targetUrl: string; landingUrl: string; availability: Availability; fetchedAt: string; methodVersion: string; requestedLinkedPages: number; eligibleLinkedPages: number; pages: RealUserPageLoadingPage[]; error?: string; sourceNote: string };
type SecurityAudit = { availability: Availability; transport: 'https' | 'http' | 'unknown'; tlsStatus: 'validated' | 'not_applicable' | 'unavailable'; rootStatusCode: number | null; httpPageCount: number; httpLinkCount: number; securityHeaders: string[]; missingSecurityHeaders: string[]; checkedAt: string; note: string };
type KeywordSuggestion = { term: string; occurrences: number; pageCount: number; pageUrl: string };
type AiPromptCheck = { id: string; engine: 'ChatGPT' | 'Perplexity' | 'Gemini' | 'Claude' | 'Other'; prompt: string; outcome: 'mentioned' | 'mixed' | 'not_mentioned'; note: string; checkedAt: string };
type AuditResult = { assurance?: AuditAssurance; pages: number; issues: number; evidenceCount: number; checkedAt: string; source: 'live'; rendered: boolean; technicalHealth: TechnicalHealth; crawlCoverage: CrawlCoverage; findings: Finding[]; actions: Action[]; pagesInventory: PageRecord[]; changes: Change[]; issueComparison?: IssueComparison; dataSources: DataSource[]; security?: SecurityAudit; performance?: PerformanceAudit; performanceHistory?: PerformanceAudit[]; realUserPageLoading?: RealUserPageLoadingAudit };
type CrawlPhase = 'discovery' | 'crawling' | 'analysis' | 'performance';
type CrawlProgressState = { attempted: number; discovered: number; currentUrl?: string };
type RealUserPageLoadingProgress = { phase: 'discovering' | 'measuring'; completedPages: number; totalPages: number; currentUrl?: string };
type Website = { id: string; name: string; domain: string; url: string; description?: string; country?: string; created_at?: string; status: 'ready' | 'running' | 'complete' | 'failed'; crawlPhase?: CrawlPhase; crawlJobId?: string; crawlProgress?: CrawlProgressState; error?: string; crawlStartedAt?: string; crawlUpdatedAt?: string; realUserPageLoadingJobId?: string; realUserPageLoadingProgress?: RealUserPageLoadingProgress; realUserPageLoadingStartedAt?: string; realUserPageLoadingUpdatedAt?: string; realUserPageLoadingError?: string; result?: AuditResult };
type LocalFinding = { category: string; priority: 'critical' | 'high' | 'medium' | 'low'; ruleId?: string; ruleVersion?: string; confidence?: 'high' | 'medium' | 'low'; title: string; description: string; impact: string; effort: string; evidence: Evidence[]; matchCount?: number; affectedUrlCount?: number; evidenceTruncated?: boolean };
type LocalAuditPayload = { audit: { pagesCrawled: number; completedAt: string; rendered: boolean; methodVersion: string }; metrics: { assurance?: AuditAssurance; technicalHealth: TechnicalHealth; crawlCoverage: CrawlCoverage }; findings: LocalFinding[]; pages: PageRecord[]; security?: SecurityAudit };
type LocalPerformancePayload = { performance?: PerformanceAudit; error?: string };
type LocalAuditJob = { id: string; status: 'running' | 'complete' | 'failed'; phase: CrawlPhase; progress: CrawlProgressState; startedAt: string; updatedAt: string; error?: string; result?: { crawl: LocalAuditPayload; performance?: PerformanceAudit; performanceError?: string } };
type LocalRealUserPageLoadingJob = { id: string; status: 'running' | 'complete' | 'failed'; startedAt: string; updatedAt: string; progress: RealUserPageLoadingProgress; error?: string; result?: { loading: RealUserPageLoadingAudit } };

const SITE_ROUTE_SECTIONS: SiteRoute[] = ['overview', 'on-page', 'audit', 'pageload', 'real-user-loading', 'analytics', 'keywords', 'search-intelligence', 'backlinks', 'indexing', 'ai-visibility', 'security', 'action-plan', 'pages', 'changes', 'data-scope'];
const INTELLIGENCE_TABS: Array<{ key: IntelligenceTab; label: string }> = [
  { key: 'clusters', label: 'Clustering' },
  { key: 'rank-tracking', label: 'Rank tracking' },
  { key: 'serp-analysis', label: 'SERP analysis' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'ppc-seo', label: 'PPC / SEO' },
];
const SITE_ROUTE_COPY: Record<SiteRoute, { title: string; description: string }> = {
  overview: { title: 'Audit overview', description: 'Coverage, findings, and the next work to prioritise' },
  'on-page': { title: 'On-page SEO analysis', description: 'Titles, descriptions, headings, content and structured page signals' },
  audit: { title: 'Site audits & indexability', description: 'Every evaluated control and its URL-level evidence' },
  pageload: { title: 'Speed & performance', description: 'Mobile and desktop browser measurements for real pages' },
  'real-user-loading': { title: 'Real user page loading', description: 'A cold browser replay of the landing page and its live same-site links' },
  analytics: { title: 'Audience & engagement', description: 'Imported page and cohort analytics, held apart from crawl evidence' },
  keywords: { title: 'Keyword research', description: 'Crawl-derived topics plus provider or imported search metrics and target tracking' },
  'search-intelligence': { title: 'Search intelligence', description: 'Clustering, rankings, SERPs, competitors and PPC / SEO decisions from source records' },
  backlinks: { title: 'Backlinks', description: 'Monitored inbound links, verification history, lists and confirmed-change alerts' },
  indexing: { title: 'Indexing', description: "Google's own index evidence for this website, inspections, and sitemap submission" },
  'ai-visibility': { title: 'AI search visibility', description: 'Sampled prompts and recorded mentions across answer engines' },
  security: { title: 'Security & SSL checks', description: 'Transport, TLS and response-security signals collected with the crawl' },
  'action-plan': { title: 'Priority action plan', description: 'Prioritised work tied to evidence, verification and AI-ready fixes' },
  pages: { title: 'Inspected pages', description: 'Stored snapshots, page structure, links, and related actions' },
  changes: { title: 'Changes', description: 'Comparable crawl history and detected page-level differences' },
  'data-scope': { title: 'Data & scope', description: 'Sources, limits, and unknowns behind this report' },
};

function normalizeSiteDomain(value: string): string { return value.trim().toLowerCase().replace(/^www\./, ''); }
function sitePath(domain: string, section: SiteRoute = 'overview', pageUrl?: string | null, intelligenceTab?: IntelligenceTab): string {
  const params = new URLSearchParams();
  if (section === 'pages' && pageUrl) params.set('page', pageUrl);
  if (section === 'search-intelligence' && intelligenceTab) params.set('tool', intelligenceTab);
  const query = params.size ? `?${params.toString()}` : '';
  return `/site/${encodeURIComponent(normalizeSiteDomain(domain))}/${section}${query}`;
}
function readLocationRoute(): LocationRoute {
  const match = window.location.pathname.match(/^\/site\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return { domain: null, section: 'overview', pageUrl: null, intelligenceTab: 'clusters' };
  let domain: string | null = null;
  try { domain = normalizeSiteDomain(decodeURIComponent(match[1])); } catch { return { domain: null, section: 'overview', pageUrl: null, intelligenceTab: 'clusters' }; }
  const candidate = match[2] as SiteRoute | undefined;
  const section = candidate && SITE_ROUTE_SECTIONS.includes(candidate) ? candidate : 'overview';
  const pageUrl = section === 'pages' ? new URLSearchParams(window.location.search).get('page') : null;
  const requestedTool = new URLSearchParams(window.location.search).get('tool') as IntelligenceTab | null;
  const intelligenceTab = requestedTool && INTELLIGENCE_TABS.some(tab => tab.key === requestedTool) ? requestedTool : 'clusters';
  return { domain, section, pageUrl, intelligenceTab };
}
const SOURCE_TEMPLATE: DataSource[] = [
  { key: 'performance', label: 'Visitor performance', availability: 'not_measured', detail: 'Run a browser loading test to record separate mobile and desktop measurements.' },
  { key: 'real-user-loading', label: 'Real user page loading', availability: 'not_measured', detail: 'Run the visitor-path browser replay to inspect the landing page and up to ten live same-site links.' },
  { key: 'search', label: 'Organic search', availability: 'not_connected', detail: 'Connect Google Search Console to see clicks, impressions, queries, and index inspection evidence.' },
  { key: 'analytics', label: 'Audience & engagement', availability: 'not_connected', detail: 'Import a GA4 Pages and screens or retention export to bring visitor behavior into this workspace.' },
  { key: 'conversions', label: 'Conversions', availability: 'not_connected', detail: 'Connect one analytics source to measure agreed leads, purchases, or other outcomes.' },
  { key: 'ai', label: 'AI search visibility', availability: 'not_measured', detail: 'Record sampled prompts and mentions across answer engines. Referral traffic is measured separately in analytics.' },
];

function readJson<T>(key: string, fallback: T): T { return readStoredJson(key, fallback); }
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] { return [...new Map([...current, ...incoming].map(item => [item.id, item])).values()]; }
function replaceSourceRows<T extends { id: string; source?: string | null }>(current: T[], incoming: T[], source: string): T[] {
  return mergeById(current.filter(item => item.source !== source), incoming);
}
function keywordResearchStorageKey(domain: string): string { return `roundseo-keyword-research-${normalizeSiteDomain(domain)}`; }
function rankTrackingStorageKey(domain: string): string { return `roundseo-rank-tracking-${normalizeSiteDomain(domain)}`; }
function serpAnalysisStorageKey(domain: string): string { return `roundseo-serp-analysis-${normalizeSiteDomain(domain)}`; }
function competitorResearchStorageKey(domain: string): string { return `roundseo-competitor-keywords-${normalizeSiteDomain(domain)}`; }
function pageAnalyticsStorageKey(domain: string): string { return `roundseo-page-analytics-${normalizeSiteDomain(domain)}`; }
function retentionCohortsStorageKey(domain: string): string { return `roundseo-retention-cohorts-${normalizeSiteDomain(domain)}`; }
function formatSourceNumber(value: number | null, fractionDigits = 0): string { return value === null ? 'Not supplied' : new Intl.NumberFormat(undefined, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(value); }
function dateLabel(value: string | null): string { return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date not supplied'; }
function crawlKeywordMetrics(pages: PageRecord[], domain: string): KeywordMetric[] { return deriveKeywordSuggestions(pages).map(suggestion => ({ id: `crawl-keyword-${encodeURIComponent(suggestion.term)}-${encodeURIComponent(suggestion.pageUrl)}`, keyword: suggestion.term, volume: null, difficulty: null, cpc: null, intent: null, position: null, domain: normalizeDomain(domain), landingPage: suggestion.pageUrl, checkedAt: null, source: 'Crawl observation' })); }
function loadWebsites(): Website[] { return readJson<Website[]>('roundseo-websites', []).filter(site => site && typeof site.id === 'string' && typeof site.domain === 'string' && typeof site.name === 'string').map(site => {
  const result = site.result?.source === 'live' && site.result.pagesInventory ? site.result : undefined;
  const interrupted = site.status === 'running' && !site.crawlJobId;
  return { ...site, url: site.url || `https://${site.domain}`, result, status: interrupted ? 'failed' : site.status === 'complete' && !result ? 'ready' : site.status, error: interrupted ? 'The previous audit was interrupted before its result was saved. Please run it again.' : site.error };
}); }
function presentPriority(priority: LocalFinding['priority']): Priority { return `${priority[0].toUpperCase()}${priority.slice(1)}` as Priority; }
function presentCategory(category: string): string { return ({ technical: 'Technical reliability', indexability: 'Indexability', onpage: 'Search appearance', content: 'Content review', linking: 'Internal structure' } as Record<string, string>)[category] || category; }
function presentEffort(effort: string): string { return ({ quick_win: 'Quick change', medium: 'Focused work', complex: 'Deeper work' } as Record<string, string>)[effort] || 'Review'; }
function actionIdFor(finding: Finding): string { return `action-${finding.ruleId}`; }
function isPerformanceRule(ruleId: string): boolean { return ruleId.startsWith('performance.pagespeed.'); }
function hasCoverageGaps(coverage: CrawlCoverage): boolean { return coverage.availability !== 'measured' || coverage.failedUrls > 0 || Boolean(coverage.robotsExcludedUrls) || Boolean(coverage.discoveryWarnings?.length) || (coverage.method !== 'browser' && coverage.renderingRequiredPages > 0); }
function crawlTime(value?: string): string { if (!value) return 'No update time'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

const KEYWORD_STOP_WORDS = new Set('about after again against all also an and any are as at be because been before being between but by can could did do does doing down each for from further get got had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves'.split(' '));

function deriveKeywordSuggestions(pages: PageRecord[]): KeywordSuggestion[] {
  const terms = new Map<string, { occurrences: number; pages: Set<string>; pageUrl: string }>();
  for (const page of pages) {
    const text = [page.title, ...page.h1, ...(page.h2 || []), page.contentExcerpt].filter(Boolean).join(' ');
    const tokens = (text.toLowerCase().match(/[a-z0-9\u00c0-\u024f]+/g) || []).filter(token => token.length > 2 && !KEYWORD_STOP_WORDS.has(token));
    const pageTerms = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const candidates = [tokens[index], index < tokens.length - 1 ? `${tokens[index]} ${tokens[index + 1]}` : ''];
      for (const term of candidates) {
        if (!term || term.length < 4 || pageTerms.has(term)) continue;
        pageTerms.add(term);
        const existing = terms.get(term) || { occurrences: 0, pages: new Set<string>(), pageUrl: page.url };
        existing.occurrences += 1;
        existing.pages.add(page.url);
        terms.set(term, existing);
      }
    }
  }
  return [...terms.entries()]
    .filter(([term, value]) => term.includes(' ') || value.occurrences > 1)
    .sort(([, left], [, right]) => right.pages.size - left.pages.size || right.occurrences - left.occurrences || left.pageUrl.localeCompare(right.pageUrl))
    .slice(0, 18)
    .map(([term, value]) => ({ term, occurrences: value.occurrences, pageCount: value.pages.size, pageUrl: value.pageUrl }));
}

function fallbackSecurityAudit(websiteUrl: string, pages: PageRecord[]): SecurityAudit {
  const isHttps = /^https:\/\//i.test(websiteUrl);
  const httpPageCount = pages.filter(page => /^http:\/\//i.test(page.url)).length;
  const httpLinkCount = pages.reduce((total, page) => total + page.linkEvidence.filter(link => /^http:\/\//i.test(link.target || '')).length, 0);
  return {
    availability: isHttps ? 'partial' : 'measured',
    transport: isHttps ? 'https' : /^http:\/\//i.test(websiteUrl) ? 'http' : 'unknown',
    tlsStatus: isHttps ? 'unavailable' : 'not_applicable',
    rootStatusCode: null,
    httpPageCount,
    httpLinkCount,
    securityHeaders: [],
    missingSecurityHeaders: ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'],
    checkedAt: new Date().toISOString(),
    note: 'This saved report predates RoundSEO security signal collection. Run a new audit to record TLS and response-header evidence.',
  };
}

function buildActionFixPrompt(action: Action): string {
  const observations = action.evidence.slice(0, 5).map(item => `- ${item.url}\n  Observed: ${item.observed}\n  Suggested change: ${item.recommendation}`).join('\n');
  return `You are an SEO implementation partner. Help me resolve this RoundSEO action without changing unrelated behavior.\n\nAction: ${action.title}\nPriority: ${action.priority}\nEffort: ${action.effort}\nWhy it matters: ${action.outcome}\n\nEvidence:\n${observations || '- No URL-level evidence was retained.'}\n\nReturn:\n1. A concise diagnosis.\n2. The smallest safe implementation plan.\n3. The exact code or content changes needed.\n4. A verification checklist for the next comparable crawl.`;
}

async function copyText(value: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; } catch { return false; }
}

function metricFor(device: PerformanceDeviceResult | undefined, key: PerformanceMetric['key'], source: 'lab' | 'field' = 'lab'): PerformanceMetric | undefined {
  const metrics = source === 'lab' ? device?.labMetrics : device?.fieldMetrics;
  return (metrics || []).find(metric => metric.key === key);
}

function performanceDataSource(performance?: PerformanceAudit): DataSource {
  if (!performance) return SOURCE_TEMPLATE[0];
  const mobile = performance.devices.find(device => device.device === 'mobile');
  const lcp = metricFor(mobile, 'lcp');
  const score = mobile?.labScore;
  const value = lcp?.value !== null && lcp?.value !== undefined
    ? `Mobile LCP ${formatPerformanceMetric(lcp)}`
    : score !== null && score !== undefined ? `Mobile ${score}/100 lab` : availabilityCopy(performance.availability);
  const fieldDevice = performance.devices.find(device => device.fieldMetrics.length > 0);
  return {
    key: 'performance',
    label: 'Visitor performance',
    availability: performance.availability,
    value,
    updatedAt: new Date(performance.fetchedAt).toLocaleString(),
    detail: performance.provider === 'local_browser' ? performance.sourceNote || 'A local browser recorded a limited loading sample.' : performance.availability === 'measured' || performance.availability === 'partial'
      ? `${performance.providerLabel} checked ${performance.devices.map(device => device.device).join(' and ')}. Lab results are separated from ${fieldDevice ? `${fieldDevice.fieldDataScope}-level real-user data` : 'unavailable real-user data'}.`
      : performance.error || 'The browser measurement has not returned usable data yet.',
  };
}

function realUserPageLoadingDataSource(loading?: RealUserPageLoadingAudit): DataSource {
  if (!loading) return SOURCE_TEMPLATE.find(source => source.key === 'real-user-loading')!;
  const measuredPages = loading.pages.filter(page => page.availability === 'measured' || page.availability === 'partial').length;
  return {
    key: 'real-user-loading',
    label: 'Real user page loading',
    availability: loading.availability,
    value: measuredPages ? `${measuredPages} browser page${measuredPages === 1 ? '' : 's'}` : availabilityCopy(loading.availability),
    updatedAt: new Date(loading.fetchedAt).toLocaleString(),
    detail: loading.availability === 'measured' || loading.availability === 'partial'
      ? `Landing page plus ${Math.max(0, loading.pages.length - 1)} live same-site link${loading.pages.length === 2 ? '' : 's'} replayed in fresh browser contexts. This is not field/RUM data.`
      : loading.error || 'No visitor-path browser replay has returned usable measurements yet.',
  };
}

function failedPerformanceAudit(targetUrl: string, error: string): PerformanceAudit {
  return { targetUrl, provider: 'local_browser', providerLabel: 'RoundSEO browser test', availability: 'failed', fetchedAt: new Date().toISOString(), methodVersion: 'roundseo-browser-2026.10.2', devices: [], error };
}

function dataSourcesWithPerformance(existing?: DataSource[], performance?: PerformanceAudit, realUserPageLoading?: RealUserPageLoadingAudit): DataSource[] {
  const sourceByKey = new Map(SOURCE_TEMPLATE.map(source => [source.key, source]));
  for (const source of existing || []) sourceByKey.set(source.key, source);
  const sources = [...sourceByKey.values()].filter(source => source.key !== 'performance' && source.key !== 'real-user-loading');
  return [performanceDataSource(performance), realUserPageLoadingDataSource(realUserPageLoading), ...sources];
}

function auditResultFromLocalCrawl(payload: LocalAuditPayload, previous?: AuditResult, websiteUrl?: string): AuditResult {
  const findings = payload.findings.map((finding, index): Finding => ({ id: `finding-${finding.ruleId || index}-${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, ruleId: finding.ruleId || `${finding.category}.${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, ruleVersion: finding.ruleVersion || payload.audit.methodVersion, priority: presentPriority(finding.priority), category: presentCategory(finding.category), title: finding.title, rationale: finding.description, outcome: finding.impact || 'A clearer, more reliable page experience.', effort: presentEffort(finding.effort), confidence: finding.confidence || (finding.category === 'content' ? 'medium' : 'high'), evidence: finding.evidence, matchCount: finding.matchCount, affectedUrlCount: finding.affectedUrlCount, evidenceTruncated: finding.evidenceTruncated }));
  const issueComparison = previous ? compareAuditIssues(
    { checkedAt: previous.checkedAt, rendered: previous.rendered, ruleSetVersion: previous.technicalHealth.ruleSetVersion, method: previous.crawlCoverage.method, pages: previous.pagesInventory, findings: previous.findings },
    { checkedAt: payload.audit.completedAt, rendered: payload.audit.rendered, ruleSetVersion: payload.metrics.technicalHealth.ruleSetVersion, method: payload.metrics.crawlCoverage.method, pages: payload.pages, findings },
  ) : undefined;
  const previousActions = new Map((previous?.actions || []).map(action => [action.ruleId, action]));
  const actions = findings.map(finding => {
    const existing = previousActions.get(finding.ruleId);
    return { id: actionIdFor(finding), ruleId: finding.ruleId, title: finding.title, priority: finding.priority, status: existing?.status === 'awaiting_verification' ? 'open' : existing?.status || 'open', effort: finding.effort, owner: existing?.owner || 'Unassigned', verification: 'Run a comparable crawl and confirm this condition no longer appears in the recorded evidence.', outcome: finding.outcome, explanation: finding.rationale, evidence: finding.evidence, matchCount: finding.matchCount, affectedUrlCount: finding.affectedUrlCount, evidenceTruncated: finding.evidenceTruncated } as Action;
  });
  return { assurance: payload.metrics.assurance, pages: payload.audit.pagesCrawled, issues: findings.length, evidenceCount: findings.reduce((count, finding) => count + finding.evidence.length, 0), checkedAt: new Date(payload.audit.completedAt).toLocaleString(), source: 'live', rendered: payload.audit.rendered, technicalHealth: payload.metrics.technicalHealth, crawlCoverage: payload.metrics.crawlCoverage, findings, actions, pagesInventory: payload.pages, changes: comparePages(previous?.pagesInventory || [], payload.pages), issueComparison, security: payload.security || fallbackSecurityAudit(websiteUrl || '', payload.pages), performance: previous?.performance, performanceHistory: previous?.performanceHistory, realUserPageLoading: previous?.realUserPageLoading, dataSources: dataSourcesWithPerformance(previous?.dataSources, previous?.performance, previous?.realUserPageLoading) };
}

function performanceFindingsFromAudit(performance?: PerformanceAudit): Finding[] {
  const measured = performance?.devices.filter(device => device.availability === 'measured' || device.availability === 'partial') || [];
  if (!performance || !measured.length) return [];
  const groups = new Map<string, { title: string; maxMs: number; maxBytes: number; evidence: Evidence[] }>();
  for (const device of measured) {
    for (const opportunity of device.opportunities) {
      const savingsMs = opportunity.estimatedSavingsMs || 0;
      const savingsBytes = opportunity.estimatedSavingsBytes || 0;
      if (savingsMs <= 0 && savingsBytes <= 0 && !opportunity.evidence?.length) continue;
      const ruleId = `performance.pagespeed.${opportunity.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
      const group = groups.get(ruleId) || { title: opportunity.title, maxMs: 0, maxBytes: 0, evidence: [] };
      group.maxMs = Math.max(group.maxMs, savingsMs);
      group.maxBytes = Math.max(group.maxBytes, savingsBytes);
      if (opportunity.evidence?.length) group.evidence.push(...opportunity.evidence.map(item => ({
        url: performance.targetUrl,
        relatedUrls: item.url === performance.targetUrl ? undefined : [item.url],
        element: `${device.device === 'mobile' ? 'Mobile' : 'Desktop'} browser observation`,
        observed: `${item.url}: ${item.observed}`,
        recommendation: item.recommendation,
      })));
      else group.evidence.push({ url: performance.targetUrl, element: `${device.device === 'mobile' ? 'Mobile' : 'Desktop'} lab opportunity`, observed: performanceSavingCopy(savingsMs, savingsBytes), recommendation: `Review ${opportunity.title.toLowerCase()} for this exact URL on ${device.device}; then rerun the comparable test.` });
      groups.set(ruleId, group);
    }
  }
  return [...groups.entries()]
    .sort(([, left], [, right]) => right.maxMs - left.maxMs || right.maxBytes - left.maxBytes)
    .slice(0, 8)
    .map(([ruleId, group], index): Finding => ({
      id: `finding-${ruleId}-${index}`,
      ruleId,
      ruleVersion: performance.methodVersion,
      priority: group.maxMs || group.maxBytes ? performancePriority(group.maxMs, group.maxBytes) : 'Medium',
      category: 'Visitor performance',
      title: `Performance: ${group.title}`,
      rationale: 'This is a browser observation for the tested page and device. Potential improvements require review and are not assumed to affect every page.',
      outcome: `Reducing this avoidable work can improve the measured loading experience for visitors of ${pathFor(performance.targetUrl)}.`,
      effort: performanceEffort(ruleId),
      confidence: 'high',
      evidence: group.evidence,
    }));
}

function applyPerformanceEvidence(result: AuditResult, performance?: PerformanceAudit): AuditResult {
  const crawlFindings = result.findings.filter(finding => !isPerformanceRule(finding.ruleId));
  const crawlActions = result.actions.filter(action => !isPerformanceRule(action.ruleId));
  const previousPerformanceActions = new Map(result.actions.filter(action => isPerformanceRule(action.ruleId)).map(action => [action.ruleId, action]));
  const performanceFindings = performanceFindingsFromAudit(performance);
  const performanceActions = performanceFindings.map(finding => {
    const existing = previousPerformanceActions.get(finding.ruleId);
    return {
      id: actionIdFor(finding),
      ruleId: finding.ruleId,
      title: finding.title,
      priority: finding.priority,
      status: existing?.status === 'awaiting_verification' ? 'open' : existing?.status || 'open',
      effort: finding.effort,
      owner: existing?.owner || 'Unassigned',
      verification: 'Rerun the same mobile and desktop browser test and compare this exact URL before considering it resolved.',
      outcome: finding.outcome,
      evidence: finding.evidence,
    } as Action;
  });
  const findings = [...crawlFindings, ...performanceFindings];
  return {
    ...result,
    performance,
    performanceHistory: performance ? [performance, ...(result.performanceHistory || (result.performance ? [result.performance] : [])).filter(item => item.targetUrl !== performance.targetUrl)].slice(0, 20) : result.performanceHistory,
    findings,
    actions: [...crawlActions, ...performanceActions],
    issues: findings.length,
    evidenceCount: findings.reduce((count, finding) => count + finding.evidence.length, 0),
    dataSources: dataSourcesWithPerformance(result.dataSources, performance, result.realUserPageLoading),
  };
}

function applyRealUserPageLoadingEvidence(result: AuditResult, realUserPageLoading: RealUserPageLoadingAudit): AuditResult {
  return {
    ...result,
    realUserPageLoading,
    dataSources: dataSourcesWithPerformance(result.dataSources, result.performance, realUserPageLoading),
  };
}

function performancePriority(savingsMs: number, savingsBytes: number): Priority {
  if (savingsMs >= 1_500 || savingsBytes >= 500_000) return 'High';
  if (savingsMs >= 400 || savingsBytes >= 125_000) return 'Medium';
  return 'Low';
}

function performanceEffort(ruleId: string): string {
  if (/render_blocking|redirect|unused_css|unused_javascript|text_compression/.test(ruleId)) return 'Quick change';
  if (/image|font|third_party|mainthread/.test(ruleId)) return 'Focused work';
  return 'Deeper work';
}

function performanceSavingCopy(savingsMs: number, savingsBytes: number): string {
  const parts: string[] = [];
  if (savingsMs > 0) parts.push(`${Math.round(savingsMs)} ms estimated savings`);
  if (savingsBytes > 0) parts.push(`${Math.max(1, Math.round(savingsBytes / 1024))} KB estimated transfer savings`);
  return parts.join(' · ');
}

function comparePages(before: PageRecord[], after: PageRecord[]): Change[] {
  if (!before.length) return [];
  const oldPages = new Map(before.map(page => [page.url, page]));
  const changes: Change[] = [];
  for (const page of after) {
    const old = oldPages.get(page.url);
    if (!old) { changes.push({ id: `new-${page.url}`, pageUrl: page.url, field: 'Newly inspected', before: 'Not inspected in the prior crawl', after: 'Inspected in this crawl; creation date unknown', detectedAt: 'This crawl' }); continue; }
    const compared: Array<[string, string | undefined, string | undefined]> = [['Title', old.title, page.title], ['Meta description', old.metaDescription, page.metaDescription], ['Canonical URL', old.canonicalUrl, page.canonicalUrl], ['Robots directive', old.robots, page.robots]];
    for (const [field, previous, current] of compared) if ((previous || '') !== (current || '')) changes.push({ id: `${page.url}-${field}`, pageUrl: page.url, field, before: previous || 'Not present', after: current || 'Not present', detectedAt: 'This crawl' });
  }
  return changes;
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => { const stored = readJson<User | null>('roundseo-user', null); return stored && typeof stored.name === 'string' && typeof stored.email === 'string' ? stored : null; });
  const [websites, setWebsites] = useState<Website[]>(loadWebsites);
  const [media, setMedia] = useState<Record<string, WebsiteMedia>>({});
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const mediaRequested = useRef<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => readJson<string | null>('roundseo-selected', null));
  const [route, setRoute] = useState<LocationRoute>(readLocationRoute);
  const [addOpen, setAddOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const filteredWebsites = websites.filter(w => w.name.toLowerCase().includes(searchQuery.toLowerCase()) || w.domain.toLowerCase().includes(searchQuery.toLowerCase())).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'domain') return a.domain.localeCompare(b.domain);
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  useEffect(() => { writeStoredJson('roundseo-websites', websites); }, [websites]);
  // Once an account has an API token, its websites join the local portfolio without replacing local entries.
  /** Capture the favicon and preview for one API website, then keep the stored state. */
  const refreshWebsiteMediaFor = async (websiteId: string) => {
    const token = readJson<string>('roundseo-token', '');
    if (!token) return;
    const response = await fetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/media/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const body = await response.json() as { media: WebsiteMedia };
    setMedia(current => ({ ...current, [websiteId]: body.media }));
  };
  const refreshAllMedia = async () => {
    setRefreshingMedia(true);
    try {
      for (const site of websites.filter(isAccountWebsite)) await refreshWebsiteMediaFor(site.id);
    } finally {
      setRefreshingMedia(false);
    }
  };
  useEffect(() => {
    const token = readJson<string>('roundseo-token', '');
    if (!user || !token) return undefined;
    let cancelled = false;
    void loadApiWebsites(token).then(async ({ sites, media: remoteMedia }) => {
      if (cancelled) return;
      if (sites.length > 0) {
        setWebsites(current => {
          const known = new Set(current.map(site => site.id));
          const added = sites.filter(site => !known.has(site.id));
          return added.length ? [...current, ...added] : current;
        });
      }
      setMedia(current => ({ ...current, ...Object.fromEntries(remoteMedia.map(entry => [entry.websiteId, entry])) }));
      // First sight of a website: capture its favicon and preview once, so the portfolio is never left blank.
      for (const entry of remoteMedia) {
        const uncaptured = !entry.favicon?.capturedAt && !entry.thumbnail?.capturedAt;
        if (cancelled || !uncaptured || mediaRequested.current.has(entry.websiteId)) continue;
        mediaRequested.current.add(entry.websiteId);
        await refreshWebsiteMediaFor(entry.websiteId);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [user]);
  useEffect(() => { writeStoredJson('roundseo-selected', selectedId); }, [selectedId]);
  useEffect(() => {
    const syncRoute = () => setRoute(readLocationRoute());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);
  const activeJobs = websites.filter(site => site.status === 'running' && site.crawlJobId).map(site => site.crawlJobId!).sort().join(',');
  const activeRealUserPageLoadingJobs = websites.filter(site => site.realUserPageLoadingJobId).map(site => site.realUserPageLoadingJobId!).sort().join(',');
  useEffect(() => {
    if (!activeJobs) return;
    let disposed = false;
    let checking = false;
    const poll = async () => {
      if (checking) return;
      checking = true;
      try {
        await Promise.all(activeJobs.split(',').map(async jobId => {
          try {
            const response = await fetch(`/__roundseo/audit-jobs?id=${encodeURIComponent(jobId)}`);
            const job = await response.json() as LocalAuditJob & { error?: string };
            if (disposed) return;
            if (!response.ok) {
              if (response.status === 404) setWebsites(current => current.map(site => site.crawlJobId === jobId ? { ...site, status: 'failed', crawlJobId: undefined, error: job.error || 'The audit was interrupted. Run it again.' } : site));
              return;
            }
            setWebsites(current => current.map(site => {
              if (site.crawlJobId !== jobId) return site;
              if (job.status === 'failed') return { ...site, status: 'failed', crawlJobId: undefined, error: job.error || 'The crawl could not be completed.', crawlUpdatedAt: job.updatedAt };
              if (job.status === 'complete' && job.result) {
                const result = auditResultFromLocalCrawl(job.result.crawl, site.result, site.url);
                const performance = job.result.performance || failedPerformanceAudit(site.url, job.result.performanceError || 'The performance measurement did not return a result.');
                return { ...site, status: 'complete', crawlJobId: undefined, crawlPhase: undefined, crawlProgress: undefined, crawlUpdatedAt: job.updatedAt, result: applyPerformanceEvidence(result, performance), error: undefined };
              }
              return { ...site, crawlPhase: job.phase, crawlProgress: job.progress, crawlStartedAt: job.startedAt, crawlUpdatedAt: job.updatedAt };
            }));
          } catch { /* The server may be briefly unreachable; retry without inventing a failure. */ }
        }));
      } finally { checking = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeJobs]);
  useEffect(() => {
    if (!activeRealUserPageLoadingJobs) return;
    let disposed = false;
    let checking = false;
    const poll = async () => {
      if (checking) return;
      checking = true;
      try {
        await Promise.all(activeRealUserPageLoadingJobs.split(',').map(async jobId => {
          try {
            const response = await fetch(`/__roundseo/real-user-page-loading-jobs?id=${encodeURIComponent(jobId)}`);
            const job = await response.json() as LocalRealUserPageLoadingJob & { error?: string };
            if (disposed) return;
            if (!response.ok) {
              if (response.status === 404) setWebsites(current => current.map(site => site.realUserPageLoadingJobId === jobId ? { ...site, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: undefined, realUserPageLoadingUpdatedAt: new Date().toISOString(), realUserPageLoadingError: job.error || 'The visitor-path replay was interrupted. Run it again.' } : site));
              return;
            }
            setWebsites(current => current.map(site => {
              if (site.realUserPageLoadingJobId !== jobId) return site;
              if (job.status === 'failed') return { ...site, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: undefined, realUserPageLoadingUpdatedAt: job.updatedAt, realUserPageLoadingError: job.error || 'The visitor-path replay could not be completed.' };
              if (job.status === 'complete' && job.result) {
                if (site.result) return { ...site, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: undefined, realUserPageLoadingUpdatedAt: job.updatedAt, realUserPageLoadingError: undefined, result: applyRealUserPageLoadingEvidence(site.result, job.result.loading) };
                return { ...site, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: undefined, realUserPageLoadingUpdatedAt: job.updatedAt, realUserPageLoadingError: 'The visitor-path replay completed after its audit report was no longer available. Run the audit, then replay it again.' };
              }
              return { ...site, realUserPageLoadingProgress: job.progress, realUserPageLoadingStartedAt: job.startedAt, realUserPageLoadingUpdatedAt: job.updatedAt, realUserPageLoadingError: undefined };
            }));
          } catch { /* The local server may be briefly unavailable; retry without inventing a failure. */ }
        }));
      } finally { checking = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeRealUserPageLoadingJobs]);
  const selected = route.domain ? websites.find(site => normalizeSiteDomain(site.domain) === route.domain) : undefined;
  const navigate = (path: string) => {
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== path) window.history.pushState({}, '', path);
    setRoute(readLocationRoute());
  };
  const openSite = (site: Website, section: SiteRoute = 'overview', pageUrl?: string | null, intelligenceTab?: IntelligenceTab) => {
    setSelectedId(site.id);
    navigate(sitePath(site.domain, section, pageUrl, intelligenceTab));
  };
  const goPortfolio = () => { setSelectedId(null); navigate('/'); };
  const signOut = () => { removeStoredValue('roundseo-user'); removeStoredValue('roundseo-token'); setUser(null); goPortfolio(); };
  const addSite = (input: { name: string; url: string; description: string; country: string }) => {
    const enteredUrl = input.url.trim();
    const normalized = /^https?:\/\//i.test(enteredUrl) ? enteredUrl : `https://${enteredUrl}`;
    const domain = new URL(normalized).hostname.replace(/^www\./, '');
    if (websites.some(site => normalizeSiteDomain(site.domain) === normalizeSiteDomain(domain))) throw new Error('This website is already in your workspace. Open its existing report.');
    const site: Website = { id: `local_${crypto.randomUUID()}`, name: input.name || domain, domain, url: normalized, description: input.description, country: input.country, created_at: new Date().toISOString(), status: 'ready' };
    setWebsites(current => [...current, site]); setAddOpen(false); void runAudit(site);
  };
  const deleteSite = (websiteId: string) => {
    const site = websites.find(item => item.id === websiteId);
    if (site) for (const prefix of ['keyword-research', 'rank-tracking', 'serp-analysis', 'competitor-keywords', 'backlink-analysis', 'page-analytics', 'retention-cohorts', 'backlinks', 'keywords', 'ai-visibility']) removeStoredValue(`roundseo-${prefix}-${normalizeSiteDomain(site.domain)}`);
    setWebsites(current => current.filter(site => site.id !== websiteId));
    if (selectedId === websiteId || selected?.id === websiteId) goPortfolio();
    else setSelectedId(current => current === websiteId ? null : current);
  };
  const runAudit = async (website: Website) => {
    const startedAt = new Date().toISOString();
    openSite(website); setWebsites(current => current.map(item => item.id === website.id ? { ...item, status: 'running', crawlPhase: 'discovery', crawlJobId: undefined, crawlProgress: { attempted: 0, discovered: 0 }, crawlStartedAt: startedAt, crawlUpdatedAt: startedAt, error: undefined } : item));
    try {
      const response = await fetch('/__roundseo/audit-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website.url }) });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || 'The audit could not be started.');
      setWebsites(current => current.map(item => item.id === website.id ? { ...item, crawlJobId: payload.id } : item));
    } catch (error) { setWebsites(current => current.map(item => item.id === website.id ? { ...item, status: 'failed', crawlPhase: undefined, crawlJobId: undefined, crawlUpdatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'The crawl could not be started.' } : item)); }
  };
  const runPerformanceAudit = async (website: Website, targetUrl = website.url): Promise<void> => {
    const response = await fetch('/__roundseo/local-performance-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: targetUrl }) });
    const payload = await response.json().catch(() => ({})) as LocalPerformancePayload;
    if (!response.ok || !payload.performance) {
      const failure = failedPerformanceAudit(targetUrl, payload.error || 'The browser performance test could not be completed.');
      setWebsites(current => current.map(item => item.id !== website.id || !item.result ? item : { ...item, result: applyPerformanceEvidence(item.result, failure) }));
      throw new Error(failure.error);
    }
    setWebsites(current => current.map(item => item.id !== website.id || !item.result ? item : {
      ...item,
      result: applyPerformanceEvidence(item.result, payload.performance),
    }));
  };
  const runRealUserPageLoading = async (website: Website): Promise<void> => {
    const startedAt = new Date().toISOString();
    setWebsites(current => current.map(item => item.id === website.id ? { ...item, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: { phase: 'discovering', completedPages: 0, totalPages: 1, currentUrl: website.url }, realUserPageLoadingStartedAt: startedAt, realUserPageLoadingUpdatedAt: startedAt, realUserPageLoadingError: undefined } : item));
    try {
      const response = await fetch('/__roundseo/real-user-page-loading-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website.url }) });
      const payload = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || 'The visitor-path browser replay could not be started.');
      setWebsites(current => current.map(item => item.id === website.id ? { ...item, realUserPageLoadingJobId: payload.id } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The visitor-path browser replay could not be started.';
      setWebsites(current => current.map(item => item.id === website.id ? { ...item, realUserPageLoadingJobId: undefined, realUserPageLoadingProgress: undefined, realUserPageLoadingUpdatedAt: new Date().toISOString(), realUserPageLoadingError: message } : item));
      throw new Error(message);
    }
  };
  const updateAction = (websiteId: string, actionId: string, update: Partial<Action>) => setWebsites(current => current.map(site => site.id !== websiteId || !site.result ? site : { ...site, result: { ...site.result, actions: site.result.actions.map(action => action.id === actionId ? { ...action, ...update } : action) } }));
  if (!user) return <AuthScreen onComplete={next => { writeStoredJson('roundseo-user', next); setUser(next); }} />;
  const org = { id: 'org_local', name: user.name };
  return <div className="product-shell"><AppNav user={user} websites={websites} selected={selected?.id || null} onOverview={goPortfolio} onSelect={websiteId => { const site = websites.find(item => item.id === websiteId); if (site) openSite(site); }} onAdd={() => setAddOpen(true)} onTeam={() => setTeamOpen(true)} onSignOut={signOut} /><main className="workspace">{selected ? <AuditWorkspace website={selected} section={route.section} selectedPageUrl={route.pageUrl} intelligenceTab={route.intelligenceTab} onBack={goPortfolio} onNavigate={(section, pageUrl, intelligenceTab) => openSite(selected, section, pageUrl, intelligenceTab)} onRun={() => runAudit(selected)} onRunPerformance={url => runPerformanceAudit(selected, url)} onRunRealUserPageLoading={() => runRealUserPageLoading(selected)} onUpdateAction={(actionId, update) => updateAction(selected.id, actionId, update)} /> : <Portfolio websites={filteredWebsites} searchQuery={searchQuery} onSearchChange={setSearchQuery} sortBy={sortBy} onSortChange={setSortBy} onAdd={() => setAddOpen(true)} onSelect={websiteId => { const site = websites.find(item => item.id === websiteId); if (site) openSite(site); }} onRun={runAudit} onDelete={deleteSite} media={media} refreshingMedia={refreshingMedia} onRefreshMedia={() => void refreshAllMedia()} />}</main>{addOpen && <AddSite onClose={() => setAddOpen(false)} onSubmit={addSite} />}{teamOpen && <TeamManager orgId={org.id} onClose={() => setTeamOpen(false)} />}</div>;
}

function AppNav({ user, websites, selected, onOverview, onSelect, onAdd, onTeam, onSignOut }: { user: User; websites: Website[]; selected: string | null; onOverview: () => void; onSelect: (id: string) => void; onAdd: () => void; onTeam: () => void; onSignOut: () => void }) {
  return <aside className="app-nav"><button className="nav-brand" onClick={onOverview}><span className="logo">R</span><strong>RoundSEO</strong></button><div className="workspace-user"><span>{user.name[0]?.toUpperCase() || 'R'}</span><div><small>Workspace</small><strong>{user.name}</strong></div></div><nav aria-label="Workspace navigation"><button className={!selected ? 'selected' : ''} onClick={onOverview}><Icon name="home" />Portfolio</button><span className="nav-label">Managed sites ({websites.length})</span>{websites.slice(0, 8).map(site => <button key={site.id} className={selected === site.id ? 'selected site-link' : 'site-link'} onClick={() => onSelect(site.id)}><span className="site-dot">{site.domain[0]?.toUpperCase()}</span><span>{site.name}</span>{site.result && <em>{site.result.issues}</em>}</button>)}{websites.length > 8 && <small className="nav-more">+{websites.length - 8} more</small>}<button className="add-site-link" onClick={onAdd}><Icon name="plus" />Add website</button></nav><div className="nav-footer"><button onClick={onTeam}><Icon name="search" />Team</button><button onClick={onSignOut}><Icon name="logout" />Sign out</button></div></aside>;
}

/** The site's favicon when one was captured, otherwise the domain's letter. */
function SiteFavicon({ item, letter }: { item: WebsiteMediaItem | null | undefined; letter: string | undefined }) {
  const [failed, setFailed] = useState(false);
  if (item?.url && !failed) return <img className="site-favicon" src={item.url} alt="" width={20} height={20} loading="lazy" onError={() => setFailed(true)} />;
  return <span className="site-dot" aria-hidden="true">{letter}</span>;
}

/** Websites saved to the account have a server id; browser-only entries do not, so no media can be captured for them. */
function isAccountWebsite(site: Website): boolean {
  return site.id.startsWith('web_');
}

/** A small page preview when one was captured, otherwise a placeholder that says why. The row's name already labels it, so it is decorative for assistive tech. */
function SiteThumbnail({ item, label, savedToAccount }: { item: WebsiteMediaItem | null | undefined; label: string; savedToAccount: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item?.url && !failed) return <span className="site-thumb" title={`Preview of ${label}`} aria-hidden="true"><img src={item.url} alt="" width={96} height={60} loading="lazy" onError={() => setFailed(true)} /></span>;
  const reason = item?.reason || (savedToAccount ? 'Preview not captured yet' : 'Saved only in this browser, so no preview yet');
  return <span className="site-thumb is-empty" aria-hidden="true" title={reason}>{label.slice(0, 1).toUpperCase()}</span>;
}

function Portfolio({ websites, searchQuery, onSearchChange, sortBy, onSortChange, onAdd, onSelect, onRun, onDelete, media, refreshingMedia, onRefreshMedia }: { websites: Website[]; searchQuery: string; onSearchChange: (q: string) => void; sortBy: string; onSortChange: (s: string) => void; onAdd: () => void; onSelect: (id: string) => void; onRun: (site: Website) => void; onDelete: (id: string) => void; media: Record<string, WebsiteMedia>; refreshingMedia: boolean; onRefreshMedia: () => void }) {
  const completed = websites.filter(site => site.result).length;
  const actions = websites.reduce((total, site) => total + (site.result?.actions.filter(action => ['open', 'recurring', 'in_progress'].includes(action.status)).length || 0), 0);
  const [deleteTarget, setDeleteTarget] = useState<Website | null>(null);
  const confirmDelete = () => { if (!deleteTarget) return; onDelete(deleteTarget.id); setDeleteTarget(null); };
  return <><header className="workspace-header"><div><h1>Portfolio</h1><p>{websites.length} website{websites.length !== 1 ? 's' : ''} {searchQuery && `matching "${searchQuery}"`}</p></div><button className="button solid" onClick={onAdd}><Icon name="plus" />Add website</button></header><section className="portfolio-controls"><input type="text" className="search-input" placeholder="🔍 Search by name or domain..." value={searchQuery} onChange={e => onSearchChange(e.target.value)} /><select className="sort-select" value={sortBy} onChange={e => onSortChange(e.target.value)}><option value="created_at">Recently added</option><option value="name">Name (A–Z)</option><option value="domain">Domain</option></select><button className="button outline small" onClick={onRefreshMedia} disabled={refreshingMedia}>{refreshingMedia ? 'Refreshing previews…' : 'Refresh previews'}</button></section><section className="portfolio-summary" aria-label="Portfolio summary"><div><span>Audited</span><strong>{completed}</strong></div><div><span>Listed</span><strong>{websites.length}</strong></div><div><span>Issues</span><strong>{actions}</strong></div></section>{websites.length === 0 ? <section className="first-site"><span className="large-icon"><Icon name="globe" /></span><h2>Start with one website.</h2><p>Add a public site, tell us a little about it, then run the first evidence-led crawl. You will always see what was measured and what still needs a connection.</p><button className="button solid" onClick={onAdd}>Add a website <Icon name="arrow" /></button></section> : <section className="site-table" aria-label="Managed websites"><div className="table-head"><span>Website</span><span>Search & outcomes</span><span>Current attention</span><span>Freshness</span><span>Actions</span></div>{websites.map(site => <div className="site-row" key={site.id}><button className="site-name" onClick={() => onSelect(site.id)}><SiteThumbnail item={media[site.id]?.thumbnail} label={site.domain} savedToAccount={isAccountWebsite(site)} /><span><span className="site-title"><SiteFavicon item={media[site.id]?.favicon} letter={site.domain[0]?.toUpperCase()} /><strong>{site.name}</strong></span><small>{site.domain}</small></span></button><span className="source-cell">{site.result ? <><strong>Not connected</strong><small>Connect Search Console and analytics</small></> : <span className="quiet">No baseline yet</span>}</span><span className="attention-cell">{site.result ? <><strong>{site.result.actions.filter(action => ['open', 'recurring', 'in_progress'].includes(action.status)).length} actions</strong><small>{technicalHealthLabel(site.result.technicalHealth)}</small></> : <span className="quiet">—</span>}</span><span className="freshness-cell">{site.result ? <><strong>{coverageLabel(site.result.crawlCoverage.availability)}</strong><small>{site.result.checkedAt}</small></> : <span className="quiet">Not run</span>}</span><span className="site-row-actions">{site.status === 'running' ? <span className="quiet">Crawling…</span> : <button className="row-action" onClick={() => site.result ? onSelect(site.id) : onRun(site)}>{site.result ? 'Open workspace' : 'Run baseline'} <Icon name="arrow" /></button>}<button className="delete-site-button" onClick={() => setDeleteTarget(site)} aria-label={`Delete ${site.name}`}><Icon name="trash" />Delete</button></span></div>)}</section>}{deleteTarget && <DeleteSiteDialog site={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}</>;
}

function DeleteSiteDialog({ site, onCancel, onConfirm }: { site: Website; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><section className="modal delete-site-modal" role="dialog" aria-modal="true" aria-labelledby="delete-site-title"><button className="close-button" onClick={onCancel} aria-label="Cancel deletion">×</button><span className="delete-site-icon"><Icon name="trash" /></span><h2 id="delete-site-title">Delete {site.name}?</h2><p>This removes <strong>{site.domain}</strong> from this workspace and clears its locally saved audit history. This cannot be undone.</p><div className="modal-actions"><button className="button outline" autoFocus onClick={onCancel}>Keep site</button><button className="button danger" onClick={onConfirm}><Icon name="trash" />Delete site</button></div></section></div>;
}

function AuditWorkspace({ website, section, selectedPageUrl, intelligenceTab, onBack, onNavigate, onRun, onRunPerformance, onRunRealUserPageLoading, onUpdateAction }: { website: Website; section: SiteRoute; selectedPageUrl: string | null; intelligenceTab: IntelligenceTab; onBack: () => void; onNavigate: (section: SiteRoute, pageUrl?: string | null, intelligenceTab?: IntelligenceTab) => void; onRun: () => void; onRunPerformance: (url?: string) => Promise<void>; onRunRealUserPageLoading: () => Promise<void>; onUpdateAction: (id: string, update: Partial<Action>) => void }) {
  const result = website.result;
  if (!result) return website.status === 'running' ? <CrawlProgress website={website} onBack={onBack} /> : <AuditPending website={website} onBack={onBack} onRun={onRun} />;
  const selected = result.pagesInventory.find(page => page.url === selectedPageUrl) || null;
  const openActions = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status));
  const mobile = result.performance?.devices.find(device => device.device === 'mobile');
  const mobileLcp = metricFor(mobile, 'lcp');
  const routeCopy = SITE_ROUTE_COPY[section];
  const href = (next: SiteRoute, pageUrl?: string | null, nextIntelligenceTab?: IntelligenceTab) => sitePath(website.domain, next, pageUrl, nextIntelligenceTab);
  return <>
    <header className="audit-top">
      <button className="crumb" onClick={onBack}>← Portfolio</button>
      <div className="audit-headline">
        <div className="domain-chip"><span className="site-dot">{website.domain[0]?.toUpperCase()}</span><span>{website.domain}</span><EvidenceBadge kind="observed" label={result.rendered ? 'Browser-rendered crawl' : 'HTTP crawl'} /></div>
        <h1>{routeCopy.title}</h1>
        <p>{routeCopy.description} for {website.domain} · Last completed {result.checkedAt}</p>
      </div>
      <div className="audit-actions"><button className="button outline" onClick={onRun} disabled={website.status === 'running'}><Icon name="refresh" />{website.status === 'running' ? 'Refreshing…' : 'Run a new audit'}</button></div>
    </header>
    <nav className="audit-tabs site-section-nav" aria-label={`Navigate ${website.domain} audit screens`}>
      <AuditRouteLink active={section === 'overview'} href={href('overview')}>Overview</AuditRouteLink>
      <AuditRouteLink active={section === 'on-page'} href={href('on-page')}>On-page SEO</AuditRouteLink>
      <AuditRouteLink active={section === 'audit'} href={href('audit')}>Site audits</AuditRouteLink>
      <AuditRouteLink active={section === 'pageload'} href={href('pageload')}>Speed & performance</AuditRouteLink>
      <AuditRouteLink active={section === 'real-user-loading'} href={href('real-user-loading')}>Real user loading</AuditRouteLink>
      <AuditRouteLink active={section === 'analytics'} href={href('analytics')}>Audience & engagement</AuditRouteLink>
      <AuditRouteLink active={section === 'keywords'} href={href('keywords')}>Keyword research</AuditRouteLink>
      <AuditRouteLink active={section === 'search-intelligence'} href={href('search-intelligence', null, 'clusters')}>Search intelligence</AuditRouteLink>
      <AuditRouteLink active={section === 'backlinks'} href={href('backlinks')}>Backlinks</AuditRouteLink>
      <AuditRouteLink active={section === 'indexing'} href={href('indexing')}>Indexing</AuditRouteLink>
      <AuditRouteLink active={section === 'ai-visibility'} href={href('ai-visibility')}>AI visibility</AuditRouteLink>
      <AuditRouteLink active={section === 'security'} href={href('security')}>Security & SSL</AuditRouteLink>
      <AuditRouteLink active={section === 'action-plan'} href={href('action-plan')}>Priority issues <b>{openActions.length}</b></AuditRouteLink>
      <AuditRouteLink active={section === 'pages'} href={href('pages')}>Pages <b>{result.pagesInventory.length}</b></AuditRouteLink>
      <AuditRouteLink active={section === 'changes'} href={href('changes')}>Changes</AuditRouteLink>
      <AuditRouteLink active={section === 'data-scope'} href={href('data-scope')}>Data & scope</AuditRouteLink>
    </nav>
    {website.status === 'running' && <CrawlProgressStatus website={website} />}
    {website.status === 'failed' && <p className="audit-status-message" role="alert">Latest audit failed: {website.error}. The report below is from the previous completed audit.</p>}
    {result.technicalHealth.ruleSetVersion !== '2026.10.6' && <p className="audit-status-message">This report uses an older crawl. Run a new audit to include declaration conflicts, canonical syntax and JSON-LD validation.</p>}
    {section === 'overview' && <>
      <AuditIntegrityNotice result={result} />
      <section className="audit-facts" aria-label="Audit status">
        <Fact label={result.assurance ? "Evaluated controls" : "Observed checks"} value={result.assurance ? `${result.assurance.counts.pass + result.assurance.counts.fail + result.assurance.counts.review} / ${result.assurance.controls.length - result.assurance.counts.not_applicable}` : technicalHealthValue(result.technicalHealth, result.crawlCoverage)} note={result.assurance ? `${result.assurance.counts.unknown} controls unknown · ${result.assurance.counts.not_applicable} not applicable · ${result.assurance.verdict.replace(/_/g, " ")}` : technicalHealthNote(result.technicalHealth, result.crawlCoverage)} emphasis />
        <Fact label="Mobile LCP" value={mobileLcp ? formatPerformanceMetric(mobileLcp) : availabilityCopy(result.performance?.availability || 'not_measured')} note={mobileLcp ? `${pathFor(result.performance!.targetUrl)} · ${result.performance?.providerLabel} · ${ratingCopy(mobileLcp.rating)}` : result.performance?.error || 'Run a browser loading test'} />
        <Fact label="Coverage" value={coverageLabel(result.crawlCoverage.availability)} note={result.crawlCoverage.scopeNote} />
        <Fact label="Pages inspected" value={String(result.pages)} note={`${result.evidenceCount} URL-level observations`} />
        <Fact label="Actions now" value={String(openActions.length)} note={openActions.length ? 'Prioritised by severity and evidence' : 'No open crawl actions'} />
      </section>
      <Overview result={result} websiteDomain={website.domain} onNavigate={onNavigate} onShowActions={() => onNavigate('action-plan')} onShowPageLoad={() => onNavigate('pageload')} onOpenPage={url => onNavigate('pages', url)} onUpdateAction={onUpdateAction} />
    </>}
    {section === 'on-page' && <OnPageView key={website.id} website={website} result={result} onOpenPage={url => onNavigate('pages', url)} />}
    {section === 'audit' && <AuditView result={result} onOpenPage={url => onNavigate('pages', url)} />}
    {section === 'pageload' && <PageLoadView result={result} onRunPerformance={onRunPerformance} onShowActions={() => onNavigate('action-plan')} />}
    {section === 'real-user-loading' && <RealUserPageLoadingView website={website} result={result} onRun={onRunRealUserPageLoading} />}
    {section === 'analytics' && <AnalyticsView key={website.id} websiteDomain={website.domain} />}
    {section === 'keywords' && <KeywordView key={website.id} websiteId={website.id} pages={result.pagesInventory} onOpenPage={url => onNavigate('pages', url)} websiteDomain={website.domain} onOpenIntelligence={() => onNavigate('search-intelligence', null, 'clusters')} />}
    {section === 'search-intelligence' && <SearchIntelligenceView key={website.id} websiteId={website.id} websiteDomain={website.domain} pages={result.pagesInventory} activeTab={intelligenceTab} onSelectTab={tab => onNavigate('search-intelligence', null, tab)} onOpenKeywordResearch={() => onNavigate('keywords')} />}
    {section === 'backlinks' && <BacklinksWorkspace key={website.id} websiteId={website.id} websiteDomain={website.domain} />}
    {section === 'indexing' && <IndexingWorkspace key={website.id} websiteId={website.id} />}
    {section === 'ai-visibility' && <AiVisibilityView key={website.id} websiteId={website.id} websiteDomain={website.domain} />}
    {section === 'security' && <SecurityView website={website} result={result} onRun={onRun} />}
    {section === 'action-plan' && <ActionPlan actions={result.actions} onUpdateAction={onUpdateAction} onOpenPage={url => onNavigate('pages', url)} />}
    {section === 'pages' && <PagesView pages={result.pagesInventory} findings={result.findings} selected={selected} onSelect={url => onNavigate('pages', url)} />}
    {section === 'changes' && <ChangesView result={result} onOpenAudit={() => onNavigate('audit')} />}
    {section === 'data-scope' && <ScopeView result={result} websiteDomain={website.domain} />}
  </>;
}

function AuditIntegrityNotice({ result }: { result: AuditResult }) {
  const partial = hasCoverageGaps(result.crawlCoverage);
  const discoveryStoppedAtCap = result.crawlCoverage.limitReached && result.crawlCoverage.discoveredUrls <= result.crawlCoverage.inspectedPages;
  const performanceMeasured = Boolean(result.performance?.devices.some(device => device.availability === 'measured' || device.availability === 'partial'));
  const searchSource = result.dataSources.find(source => source.key === 'search');
  const searchConnected = searchSource?.availability === 'measured' || searchSource?.availability === 'partial';
  const blocked = partial || !performanceMeasured;
  const duplicateFinding = result.findings.find(finding => /identical|similar/i.test(finding.title));
  const similarSummary = duplicateFinding?.matchCount !== undefined ? `${duplicateFinding.matchCount} page pairs to review` : duplicateFinding ? `${duplicateFinding.evidence.length} saved observations` : 'No matches recorded';
  return <section className={`audit-integrity ${blocked ? 'blocked' : 'ready'}`} aria-label="Audit confidence">
    <div className="audit-integrity-verdict"><span className="integrity-mark"><Icon name={blocked ? 'clock' : 'check'} /></span><div><strong>{blocked ? 'The audit has coverage or measurement gaps.' : 'The discovered crawl scope was checked.'}</strong><p>{discoveryStoppedAtCap ? `At least ${result.crawlCoverage.inspectedPages} pages were inspected before the crawl stopped. The site total is unknown.` : `${result.crawlCoverage.discoveredUrls} URLs discovered; ${result.crawlCoverage.inspectedPages} unique pages inspected${result.crawlCoverage.remainingUrls ? `; ${result.crawlCoverage.remainingUrls} URLs not attempted` : ''}. The total number of pages on the site is unknown.`}</p></div></div>
    <dl className="audit-integrity-grid">
      <div><dt>Crawl coverage</dt><dd className={partial ? 'bad' : 'good'}>{partial ? 'Partial' : 'Discovered scope checked'}</dd><small>{result.crawlCoverage.sitemapStatus === 'available' ? `${result.crawlCoverage.sitemapUrls} URLs found in ${result.crawlCoverage.sitemapFiles} sitemap file(s)` : result.crawlCoverage.limitReached ? 'Page or depth limit reached' : 'Sitemap coverage is unavailable or was not checked'}</small></div>
      <div><dt>Performance evidence</dt><dd className={performanceMeasured ? 'good' : 'bad'}>{performanceMeasured ? result.performance?.provider === 'local_browser' ? 'Browser sample' : 'Earlier provider sample' : 'Unavailable'}</dd><small>{performanceMeasured ? 'See tested page, device results and resource evidence below' : result.performance?.error || 'No browser loading result was returned'}</small></div>
      <div><dt>Content similarity</dt><dd className={duplicateFinding ? 'bad' : 'unknown'}>{duplicateFinding ? similarSummary : 'No matches recorded'}</dd><small>{duplicateFinding ? `${duplicateFinding.title}${duplicateFinding.matchCount === undefined ? ' · older sample may be capped' : ''}` : 'Only inspected excerpts were compared'}</small></div>
      <div><dt>Failed URLs</dt><dd className={result.crawlCoverage.failedUrls ? 'bad' : 'good'}>{result.crawlCoverage.failedUrls}</dd><small>{result.crawlCoverage.failedUrls ? 'Could not be fully inspected' : 'No fetch failures in the inspected set'}</small></div>
      <div><dt>Google index coverage</dt><dd className={searchConnected ? 'good' : 'bad'}>{searchConnected ? 'Connected' : 'Not connected'}</dd><small>{searchConnected ? searchSource?.detail : 'Cannot compare this crawl with URLs Google reports as indexed'}</small></div>
    </dl>
  </section>;
}

function AuditPending({ website, onBack, onRun }: { website: Website; onBack: () => void; onRun: () => void }) { const failed = website.status === 'failed'; return <section className="audit-empty"><button className="crumb" onClick={onBack}>← Portfolio</button><span className="large-icon"><Icon name="radar" /></span><h1>{failed ? 'The crawl needs another try.' : `Ready to audit ${website.domain}?`}</h1><p>{failed ? website.error : 'The audit discovers pages through links and sitemaps, records page-level evidence, and runs browser loading tests on mobile and desktop.'}</p><button className="button solid" onClick={onRun}>{failed ? 'Try again' : <>Run audit <Icon name="arrow" /></>}</button></section>; }

function CrawlProgress({ website, onBack }: { website: Website; onBack: () => void }) {
  const phases: Array<{ key: CrawlPhase; title: string; detail: string }> = [
    { key: 'discovery', title: 'Discovering URLs', detail: 'Reading robots.txt and same-site sitemaps.' },
    { key: 'crawling', title: 'Inspecting pages', detail: 'Following links and recording each response and page snapshot.' },
    { key: 'analysis', title: 'Analyzing observations', detail: 'Comparing metadata, content excerpts, indexing instructions, and links.' },
    { key: 'performance', title: 'Finishing the loading test', detail: 'The mobile and desktop browser test runs alongside the crawl.' },
  ];
  const activeIndex = Math.max(0, phases.findIndex(phase => phase.key === website.crawlPhase));
  return <section className="crawl-progress"><button className="crumb" onClick={onBack}>← Portfolio</button><div className="crawl-progress-header"><span className="large-icon"><Icon name="radar" /></span><div><h1>Auditing {website.domain}</h1><p>The audit runs on the local server. You can refresh this page and reconnect while that server remains running.</p></div></div><CrawlProgressStatus website={website} /><ol className="crawl-timeline">{phases.map((phase, index) => { const done = index < activeIndex; const active = index === activeIndex; return <li className={`${done ? 'done' : ''} ${active ? 'active' : ''}`} key={phase.key}><span className="crawl-step-marker">{done ? '✓' : index + 1}</span><div><strong>{phase.title}</strong><p>{phase.detail}</p>{active && <small>In progress · updated {crawlTime(website.crawlUpdatedAt)}</small>}</div></li>; })}</ol></section>;
}

function CrawlProgressStatus({ website }: { website: Website }) {
  const labels: Record<CrawlPhase, string> = { discovery: 'Reading site and sitemap', crawling: 'Inspecting discovered URLs', analysis: 'Analyzing crawl evidence', performance: 'Finishing the browser loading test' };
  const progress = website.crawlProgress;
  return <div className="audit-progress-status" role="status"><strong>{labels[website.crawlPhase || 'discovery']}</strong><span>{progress?.discovered ? `${progress.attempted} URLs attempted · ${progress.discovered} discovered` : 'Preparing the audit'}{progress?.currentUrl ? ` · Latest: ${pathFor(progress.currentUrl)}` : ''}</span><small>Updated {crawlTime(website.crawlUpdatedAt)}.{website.result ? ' The previous report stays visible until the new audit finishes.' : ''}</small></div>;
}

function CapabilityMap({ result, websiteDomain, onNavigate }: { result: AuditResult; websiteDomain: string; onNavigate: (section: SiteRoute, pageUrl?: string | null, intelligenceTab?: IntelligenceTab) => void }) {
  const pages = result.pagesInventory;
  const openActions = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).length;
  const performanceMeasured = Boolean(result.performance?.devices.some(device => device.availability === 'measured' || device.availability === 'partial'));
  const realUserLoadingMeasured = Boolean(result.realUserPageLoading?.pages.some(page => page.availability === 'measured' || page.availability === 'partial'));
  const analyticsPages = readJson<AnalyticsPageRecord[]>(pageAnalyticsStorageKey(websiteDomain), []);
  const retentionCohorts = readJson<RetentionCohortRecord[]>(retentionCohortsStorageKey(websiteDomain), []);
  const analytics = summarizePageAnalytics(analyticsPages);
  const retention = summarizeRetentionCohorts(retentionCohorts);
  const suggestions = deriveKeywordSuggestions(pages);
  const pageSignals = [pages.filter(page => page.title?.trim()).length, pages.filter(page => page.metaDescription?.trim()).length, pages.filter(page => page.h1.length > 0).length].reduce((total, value) => total + value, 0);
  const securityReady = result.security?.tlsStatus === 'validated';
  const capabilities: Array<{ route: SiteRoute; tab?: IntelligenceTab; icon: 'search' | 'radar' | 'clock' | 'globe' | 'check' | 'arrow'; label: string; detail: string; state: string; tone: 'ready' | 'partial' | 'connect' }> = [
    { route: 'on-page', icon: 'search', label: 'On-page SEO analysis', detail: 'Titles, descriptions, headings and content signals', state: `${pageSignals} page signals`, tone: 'ready' },
    { route: 'audit', icon: 'radar', label: 'Site audits & indexability', detail: 'Discovery, robots, canonicals and page eligibility', state: coverageLabel(result.crawlCoverage.availability), tone: result.crawlCoverage.availability === 'measured' ? 'ready' : 'partial' },
    { route: 'pageload', icon: 'clock', label: 'Speed & performance audits', detail: 'Mobile and desktop loading evidence', state: performanceMeasured ? 'Measured' : 'Run test', tone: performanceMeasured ? 'ready' : 'partial' },
    { route: 'real-user-loading', icon: 'clock', label: 'Real user page loading', detail: 'Landing page plus live same-site links, request sequencing and delivery signals', state: realUserLoadingMeasured ? `${result.realUserPageLoading?.pages.length} pages` : 'Run replay', tone: realUserLoadingMeasured ? 'ready' : 'partial' },
    { route: 'analytics', icon: 'radar', label: 'Audience & engagement', detail: 'Imported page demand and cohort behavior; separate from crawl evidence', state: analytics.pageCount ? `${analytics.pageCount} pages` : retention.cohortCount ? `${retention.cohortCount} cohorts` : 'Import analytics', tone: analytics.pageCount || retention.cohortCount ? 'ready' : 'connect' },
    { route: 'keywords', icon: 'search', label: 'Keyword research', detail: 'Crawl topics plus imported volume, difficulty, CPC and intent', state: `${suggestions.length} crawl terms`, tone: suggestions.length ? 'ready' : 'partial' },
    { route: 'search-intelligence', tab: 'clusters', icon: 'search', label: 'Keyword clustering', detail: 'Group related imported and crawl-derived terms', state: 'Open clusters', tone: 'connect' },
    { route: 'search-intelligence', tab: 'rank-tracking', icon: 'radar', label: 'Rank tracking', detail: 'Compare dated position records without proxy estimates', state: 'Import positions', tone: 'connect' },
    { route: 'search-intelligence', tab: 'serp-analysis', icon: 'search', label: 'SERP analysis', detail: 'Run live searches or inspect imported result types, domains and placements', state: 'Run SERP', tone: 'connect' },
    { route: 'search-intelligence', tab: 'competitors', icon: 'globe', label: 'Competitor keyword research', detail: 'Compare source-recorded positions by competitor domain', state: 'Import competitor data', tone: 'connect' },
    { route: 'search-intelligence', tab: 'ppc-seo', icon: 'clock', label: 'PPC / SEO intelligence', detail: 'Prioritise supplied CPC, position and SERP evidence together', state: 'Open PPC / SEO', tone: 'connect' },
    { route: 'backlinks', icon: 'globe', label: 'Backlink monitoring', detail: 'Verified source-page checks, history and confirmed-change alerts', state: 'Open backlinks', tone: 'connect' },
    { route: 'indexing', icon: 'search', label: 'Indexing', detail: "Google's own index evidence, inspections and sitemap submission", state: 'Open indexing', tone: 'connect' },
    { route: 'ai-visibility', icon: 'radar', label: 'AI search visibility', detail: 'Record sampled prompts and brand mentions', state: 'Record samples', tone: 'connect' },
    { route: 'security', icon: 'check', label: 'Security & SSL checks', detail: 'HTTPS, TLS and response-header observations', state: securityReady ? 'Measured' : 'Run new audit', tone: securityReady ? 'ready' : 'partial' },
    { route: 'action-plan', icon: 'arrow', label: 'Priority issues action plan', detail: 'Evidence-backed work with verification steps', state: `${openActions} open`, tone: openActions ? 'partial' : 'ready' },
    { route: 'action-plan', icon: 'arrow', label: 'One-click AI fix prompts', detail: 'Copy evidence-backed briefs into your implementation workflow', state: `${openActions} ready`, tone: openActions ? 'partial' : 'ready' },
  ];
  return <section className="capability-map" aria-label="RoundSEO capabilities for this website">
    <div className="capability-map-heading"><div><h2>One audit, {capabilities.length} connected capabilities.</h2><p>Each view stays tied to the same crawl, stored page snapshots, and imported-source boundary. Select a capability to work in it.</p></div><span className="capability-map-note">Measured where evidence exists</span></div>
    <div className="capability-ledger">{capabilities.map(capability => <button className="capability-row" key={`${capability.route}-${capability.tab || capability.label}`} onClick={() => onNavigate(capability.route, null, capability.tab)}><span className={`capability-icon ${capability.tone}`}><Icon name={capability.icon} /></span><span className="capability-copy"><strong>{capability.label}</strong><small>{capability.detail}</small></span><span className={`capability-state ${capability.tone}`}>{capability.state}</span><Icon name="arrow" /></button>)}</div>
  </section>;
}

function Overview({ result, websiteDomain, onNavigate, onShowActions, onShowPageLoad, onOpenPage, onUpdateAction }: { result: AuditResult; websiteDomain: string; onNavigate: (section: SiteRoute, pageUrl?: string | null, intelligenceTab?: IntelligenceTab) => void; onShowActions: () => void; onShowPageLoad: () => void; onOpenPage: (url: string) => void; onUpdateAction: (id: string, update: Partial<Action>) => void }) {
  const actions = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).slice(0, 4);
  const urgent = actions.find(action => action.priority === 'Critical' || action.priority === 'High');
  const connectedSources = result.dataSources.filter(source => source.key !== 'performance' && source.key !== 'real-user-loading' && source.key !== 'analytics');
  const analyticsPages = readJson<AnalyticsPageRecord[]>(pageAnalyticsStorageKey(websiteDomain), []);
  const retentionCohorts = readJson<RetentionCohortRecord[]>(retentionCohortsStorageKey(websiteDomain), []);
  const analytics = summarizePageAnalytics(analyticsPages);
  const retention = summarizeRetentionCohorts(retentionCohorts);
  const partial = hasCoverageGaps(result.crawlCoverage);
  const performanceMeasured = Boolean(result.performance?.devices.some(device => device.availability === 'measured' || device.availability === 'partial'));
  const duplicateFinding = result.findings.find(finding => /identical|similar/i.test(finding.title));
  const newlyInspected = result.changes.filter(change => change.field === 'Newly inspected').length;
  const snapshotChanges = result.changes.length - newlyInspected;

  return <div className="audit-view overview-view">
    <CapabilityMap result={result} websiteDomain={websiteDomain} onNavigate={onNavigate} />
    <section className="evidence-summary" aria-label="Audit evidence summary">
      <div className="evidence-summary-lead"><h2>{partial ? 'Coverage needs review.' : 'Discovered pages checked.'}</h2><p>{partial ? 'Some discovered URLs or page content were not inspected. Findings apply to the inspected pages only.' : 'The crawler checked its discovered scope. It cannot know every URL that exists or whether Google indexed them.'}</p></div>
      <div className="evidence-stat"><span>Inspected</span><strong>{result.crawlCoverage.inspectedPages}<small>{result.crawlCoverage.limitReached && result.crawlCoverage.discoveredUrls <= result.crawlCoverage.inspectedPages ? ' pages; total unknown' : ` / ${result.crawlCoverage.discoveredUrls} discovered`}</small></strong><p>{result.crawlCoverage.limitReached ? 'Coverage limit reached' : 'Discovered crawl scope completed'}</p></div>
      <div className="evidence-stat"><span>Limited checks</span><strong>{result.technicalHealth.passedChecks}<small> / {result.technicalHealth.evaluatedChecks} passed</small></strong><p>Five types of observed checks; not an overall SEO score</p></div>
      <div className="evidence-stat"><span>Similarity signals</span><strong>{duplicateFinding?.matchCount ?? duplicateFinding?.evidence.length ?? 0}<small>{duplicateFinding?.matchCount !== undefined ? ' matching pairs' : ' saved observations'}</small></strong><p>{duplicateFinding?.matchCount !== undefined ? `${duplicateFinding.affectedUrlCount} pages to review` : duplicateFinding ? 'Older sample may be capped; rerun' : 'Unknown outside inspected excerpts'}</p></div>
      <div className="evidence-stat"><span>Loading test</span><strong className={performanceMeasured ? 'good' : 'bad'}>{performanceMeasured ? 'Recorded' : 'Unavailable'}</strong><p>{performanceMeasured ? 'Device and resource evidence is available.' : 'No loading score has been inferred.'}</p><button className="text-action" onClick={onShowPageLoad}>Open speed & performance <Icon name="arrow" /></button></div>
    </section>
    <section className="results-row" aria-label="Business results">
      {connectedSources.map(source => <SourceResult key={source.key} source={source} />)}
      <AnalyticsSourceResult analytics={analytics} retention={retention} onOpen={() => onNavigate('analytics')} />
      <article className="result-cell actionable"><div><span>Open finding types</span><strong>{result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).length}</strong></div><p>{urgent ? urgent.title : 'Review the recorded findings and crawl coverage.'}</p><button className="text-action" onClick={onShowActions}>Open action plan <Icon name="arrow" /></button></article>
    </section>
    <section className="change-summary"><div><h2>{result.changes.length ? 'Changes and newly inspected pages.' : 'This is the first comparable baseline.'}</h2></div><div className="change-summary-copy">{result.changes.length ? <p>{snapshotChanges} changes to previously inspected snapshots; {newlyInspected} pages newly inspected. A newly inspected page may have existed before this crawl.</p> : <p>RoundSEO captured titles, descriptions, canonical targets, robots directives, content excerpts, status and link evidence for later comparison.</p>}<span>{result.checkedAt}</span></div></section>
    <section className="plan-section"><div className="section-title"><div><h2>Short queue. Exact evidence.</h2></div><button className="text-action" onClick={onShowActions}>See all actions <Icon name="arrow" /></button></div><div className="action-list">{actions.length ? actions.map(action => <ActionRow key={action.id} action={action} compact onUpdate={onUpdateAction} onOpenPage={onOpenPage} />) : <EmptyRow message="No crawl action is open. Check the page inventory and source coverage before assuming there is nothing left to improve." />}</div></section>
    <section className="coverage-section"><div><h2>What this baseline can and cannot tell you.</h2><p>{result.crawlCoverage.scopeNote}. {result.crawlCoverage.availability === 'partial' ? 'Some conclusions remain partial; open Data & scope before treating an absence of evidence as a pass.' : 'The crawl evidence is ready for action, while acquisition and conversion measures still need their own data sources.'}</p></div><div className="coverage-lines"><CoverageLine label="Method" value={result.rendered ? 'Browser-rendered DOM' : 'HTTP response HTML'} /><CoverageLine label="Evidence" value={`${result.evidenceCount} observations`} /><CoverageLine label="Findings" value={`${result.issues} grouped conditions`} /><CoverageLine label="Page detail" value="Snapshots and links retained" /></div></section>
  </div>;
}

function OnPageView({ website, result, onOpenPage }: { website: Website; result: AuditResult; onOpenPage: (url: string) => void }) {
  return <>
    <PageIntelligencePanel websiteId={website.id} websiteDomain={website.domain} websiteUrl={website.url} />
    <section className="provider-boundary-note"><EvidenceBadge kind="observed" label="RoundSEO crawl" /><p>The report below remains evidence from RoundSEO's primary site crawl. Page Intelligence runs above are retained separately so their external observations never overwrite this baseline.</p></section>
    <OnPageReport pages={result.pagesInventory} findings={result.findings} controls={result.assurance?.controls} checkedAt={result.checkedAt} rendered={result.rendered} onOpenPage={onOpenPage} />
  </>;
}

function KeywordView({ pages, websiteId, websiteDomain, onOpenPage, onOpenIntelligence }: { pages: PageRecord[]; websiteId: string; websiteDomain: string; onOpenPage: (url: string) => void; onOpenIntelligence: () => void }) {
  const suggestions = deriveKeywordSuggestions(pages);
  const trackedStorageKey = `roundseo-keywords-${normalizeSiteDomain(websiteDomain)}`;
  const storageKey = keywordResearchStorageKey(websiteDomain);
  const [query, setQuery] = useState('');
  const [focusDraft, setFocusDraft] = useState('');
  const [ideaFilter, setIdeaFilter] = useState<'all' | 'matching' | 'questions' | 'sharedWords'>('all');
  const [tracked, setTracked] = useState<string[]>(() => readJson<string[]>(trackedStorageKey, []));
  const [records, setRecords] = useState<KeywordMetric[]>(() => readJson<KeywordMetric[]>(storageKey, []));
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { writeStoredJson(trackedStorageKey, tracked); }, [trackedStorageKey, tracked]);
  useEffect(() => { writeStoredJson(storageKey, records); }, [storageKey, records]);
  const importedByKeyword = new Map<string, KeywordMetric>();
  for (const record of records) {
    const key = record.keyword.toLowerCase();
    const existing = importedByKeyword.get(key);
    if (!existing || (record.checkedAt || '') > (existing.checkedAt || '')) importedByKeyword.set(key, record);
  }
  const rowsByKeyword = new Map<string, { term: string; suggestion?: KeywordSuggestion; record?: KeywordMetric }>();
  for (const suggestion of suggestions) rowsByKeyword.set(suggestion.term.toLowerCase(), { term: suggestion.term, suggestion });
  for (const record of importedByKeyword.values()) {
    const key = record.keyword.toLowerCase();
    const existing = rowsByKeyword.get(key);
    rowsByKeyword.set(key, { term: existing?.term || record.keyword, suggestion: existing?.suggestion, record });
  }
  const focus = focusDraft.trim() || tracked[0] || records[0]?.keyword || suggestions[0]?.term || '';
  const ideaGroups = groupKeywordIdeas([...crawlKeywordMetrics(pages, websiteDomain), ...records], focus);
  const ideaTerms = new Set(ideaFilter === 'all' ? [] : ideaGroups[ideaFilter].map(record => record.keyword.toLowerCase()));
  const visible = [...rowsByKeyword.values()].filter(row => row.term.toLowerCase().includes(query.toLowerCase()) && (ideaFilter === 'all' || ideaTerms.has(row.term.toLowerCase()))).sort((left, right) => (right.record?.volume ?? -1) - (left.record?.volume ?? -1) || (right.suggestion?.pageCount ?? 0) - (left.suggestion?.pageCount ?? 0) || left.term.localeCompare(right.term));
  const toggleTracked = (term: string) => setTracked(current => current.includes(term) ? current.filter(item => item !== term) : [...current, term]);
  const importResearch = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseKeywordMetrics(draft, { defaultDomain: websiteDomain, sourceLabel: 'Keyword research import' });
    if (!parsed.items.length) { setMessage(parsed.errors[0] || 'No usable keyword rows were found.'); return; }
    setRecords(current => mergeById(current, parsed.items));
    setDraft('');
    setMessage(`${parsed.items.length} keyword row${parsed.items.length === 1 ? '' : 's'} imported.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  return <section className="audit-view capability-view keyword-view">
    <div className="section-title"><div><h2>Research the language already earning a place on the site.</h2><p>RoundSEO starts with observed titles, headings and extracted copy, then joins only source-reported search metrics from Intelligence runs or imports. Nothing missing from a source is turned into a guessed number.</p></div><label className="table-search"><span className="sr-only">Filter keyword research</span><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter keywords" /></label></div>
    <KeywordIntelligencePanel websiteId={websiteId} websiteDomain={websiteDomain} onResults={incoming => setRecords(current => replaceSourceRows(current, incoming, 'RoundSEO search intelligence'))} />
    <MarketAndAppIntelligencePanel websiteId={websiteId} websiteDomain={websiteDomain} />
    <div className="capability-stat-band keyword-stat-band"><div className="capability-stat"><span>Crawl-derived topics</span><strong>{suggestions.length}</strong><p>Repeated terms and phrases observed in this crawl.</p></div><div className="capability-stat"><span>Research rows</span><strong>{records.length}</strong><p>RoundSEO Intelligence and imported records retained for this website.</p></div><div className="capability-stat"><span>Tracked targets</span><strong>{tracked.length}</strong><p>Terms saved to the workspace list.</p></div></div>
    <details className="provider-fallback"><summary>Import an existing keyword export</summary><form className="import-panel" onSubmit={importResearch}><div><h3>Import keyword research.</h3><p>Use CSV, TSV, or semicolon-separated rows. A keyword column is required; volume, difficulty, CPC, intent, position, URL, date, and source are optional.</p><p className="import-format">Expected headers: keyword, volume, difficulty, cpc, intent, position, url, date, source</p></div><label>Research export<textarea value={draft} onChange={event => setDraft(event.target.value)} rows={5} placeholder="keyword,volume,difficulty,cpc,intent,position,url,date&#10;technical seo audit,1200,32,4.80,commercial,14,https://example.com/audit,2026-10-31" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import research <Icon name="arrow" /></button><button className="button outline small" type="button" onClick={onOpenIntelligence}>Open clustering</button>{message && <span role="status">{message}</span>}</div></form></details>
    <section className="keyword-ideas" aria-label="Keyword ideas by topic words"><div className="keyword-ideas-heading"><div><h3>Keyword ideas around a focus topic</h3><p>Group only terms found in this crawl, provider research, or an import. Shared words are a lexical clue, not a search demand estimate.</p></div><label>Focus topic<input value={focusDraft} onChange={event => { setFocusDraft(event.target.value); setIdeaFilter('all'); }} placeholder={focus || 'Enter a keyword'} /></label></div>{focus ? <><p className="keyword-ideas-focus">Showing ideas around <strong>{focus}</strong>{ideaFilter !== 'all' && <button className="text-action" onClick={() => setIdeaFilter('all')}>Clear group filter</button>}</p><div className="keyword-ideas-grid">{([['matching', 'Matching terms', 'Contain the full focus phrase.'], ['questions', 'Questions', 'Question-form searches sharing a topic word.'], ['sharedWords', 'Shared words', 'Other terms sharing at least one topic word.']] as const).map(([key, label, detail]) => <div className="keyword-idea-group" key={key}><div><h4>{label} <span>{ideaGroups[key].length}</span></h4><p>{detail}</p></div>{ideaGroups[key].length ? <><div className="keyword-idea-rows">{ideaGroups[key].slice(0, 5).map(item => <button key={item.keyword} onClick={() => { setQuery(item.keyword); setIdeaFilter('all'); }}><span>{item.keyword}</span><small>{item.volume === null ? 'Volume not supplied' : `${formatSourceNumber(item.volume)} supplied volume`}</small></button>)}</div><button className="keyword-idea-show" onClick={() => { setIdeaFilter(key); setQuery(''); }}>Show {ideaGroups[key].length} in table <Icon name="arrow" /></button></> : <p className="keyword-idea-empty">No matching source terms yet.</p>}</div>)}</div></> : <p className="keyword-idea-empty">Run provider research, import an export, or crawl the site to find a focus topic.</p>}</section>
    <div className="research-table"><div className="research-table-head"><span>Keyword</span><span>Evidence</span><span>Supplied metrics</span><span>Target</span></div>{visible.map(row => {
      const metrics = row.record ? [row.record.volume !== null ? `${formatSourceNumber(row.record.volume)} volume` : null, row.record.difficulty !== null ? `${formatSourceNumber(row.record.difficulty, 1)} difficulty` : null, row.record.cpc !== null ? `${formatSourceNumber(row.record.cpc, 2)} CPC` : null, row.record.intent || null].filter(Boolean).join(' · ') : '';
      return <div className="research-table-row" key={row.term}><div><strong>{row.term}</strong><small>{row.record?.source || 'Crawl observation'}</small></div><div>{row.suggestion ? <><span className="keyword-evidence">{row.suggestion.pageCount} page{row.suggestion.pageCount === 1 ? '' : 's'} · {row.suggestion.occurrences} signals</span><button className="keyword-page-link" onClick={() => onOpenPage(row.suggestion!.pageUrl)}>{pathFor(row.suggestion.pageUrl)} <Icon name="arrow" /></button></> : <small>Source record</small>}</div><div><strong className={metrics ? '' : 'quiet'}>{metrics || 'No metrics supplied'}</strong><small>{row.record?.checkedAt ? `Measured ${dateLabel(row.record.checkedAt)}` : row.record ? 'Date not supplied' : 'Crawl language only'}</small></div><button className={`button small ${tracked.includes(row.term) ? 'solid' : 'outline'}`} onClick={() => toggleTracked(row.term)}>{tracked.includes(row.term) ? 'Tracked' : 'Track'}</button></div>;
    })}{!visible.length && <EmptyRow message="No keyword or imported research record matches this filter." />}</div>
  </section>;
}

// Backlinks are now a real, server-backed module (see components/BacklinksPanels.tsx) —
// the previous localStorage-only CSV import view was replaced, not kept as a fallback.

function SearchIntelligenceView({ websiteId, websiteDomain, pages, activeTab, onSelectTab, onOpenKeywordResearch }: { websiteId: string; websiteDomain: string; pages: PageRecord[]; activeTab: IntelligenceTab; onSelectTab: (tab: IntelligenceTab) => void; onOpenKeywordResearch: () => void }) {
  const rankStorage = rankTrackingStorageKey(websiteDomain);
  const serpStorage = serpAnalysisStorageKey(websiteDomain);
  const competitorStorage = competitorResearchStorageKey(websiteDomain);
  const researchRecords = readJson<KeywordMetric[]>(keywordResearchStorageKey(websiteDomain), []);
  const [rankRecords, setRankRecords] = useState<KeywordMetric[]>(() => readJson<KeywordMetric[]>(rankStorage, []));
  const [serpRecords, setSerpRecords] = useState<SerpResult[]>(() => readJson<SerpResult[]>(serpStorage, []));
  const [competitorRecords, setCompetitorRecords] = useState<KeywordMetric[]>(() => readJson<KeywordMetric[]>(competitorStorage, []));
  const [rankDraft, setRankDraft] = useState('');
  const [serpDraft, setSerpDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [rankMessage, setRankMessage] = useState('');
  const [serpMessage, setSerpMessage] = useState('');
  const [competitorMessage, setCompetitorMessage] = useState('');
  useEffect(() => { writeStoredJson(rankStorage, rankRecords); }, [rankStorage, rankRecords]);
  useEffect(() => { writeStoredJson(serpStorage, serpRecords); }, [serpStorage, serpRecords]);
  useEffect(() => { writeStoredJson(competitorStorage, competitorRecords); }, [competitorStorage, competitorRecords]);
  const crawlRecords = crawlKeywordMetrics(pages, websiteDomain);
  const clusters = clusterKeywordMetrics([...crawlRecords, ...researchRecords]);
  const rankSummary = summarizeRankTracking([...researchRecords, ...rankRecords], websiteDomain);
  const serpSummary = summarizeSerpResults(serpRecords);
  const competitorGaps = compareCompetitorKeywords([...researchRecords, ...rankRecords, ...competitorRecords], websiteDomain);
  const ppcOpportunities = buildPpcSeoOpportunities([...researchRecords, ...rankRecords], websiteDomain, serpRecords);
  const importRanks = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseKeywordMetrics(rankDraft, { defaultDomain: websiteDomain, sourceLabel: 'Rank tracking import' });
    const measured = parsed.items.filter(record => record.position !== null && record.checkedAt !== null);
    if (!measured.length) { setRankMessage(parsed.errors[0] || 'Each rank row needs a keyword, position, and date.'); return; }
    setRankRecords(current => mergeById(current, measured));
    setRankDraft('');
    setRankMessage(`${measured.length} dated position row${measured.length === 1 ? '' : 's'} added.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  const importSerps = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseSerpResults(serpDraft, { sourceLabel: 'SERP import' });
    if (!parsed.items.length) { setSerpMessage(parsed.errors[0] || 'No usable SERP rows were found.'); return; }
    setSerpRecords(current => mergeById(current, parsed.items));
    setSerpDraft('');
    setSerpMessage(`${parsed.items.length} SERP row${parsed.items.length === 1 ? '' : 's'} added.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  const importCompetitors = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseKeywordMetrics(competitorDraft, { sourceLabel: 'Competitor keyword import' });
    const imported = parsed.items.filter(record => record.position !== null && record.domain && normalizeDomain(record.domain) !== normalizeDomain(websiteDomain));
    if (!imported.length) { setCompetitorMessage(parsed.errors[0] || 'Competitor rows need keyword, domain, and position.'); return; }
    setCompetitorRecords(current => mergeById(current, imported));
    setCompetitorDraft('');
    setCompetitorMessage(`${imported.length} competitor keyword row${imported.length === 1 ? '' : 's'} added.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  return <section className="audit-view capability-view search-intelligence-view">
    <div className="section-title"><div><h2>Search intelligence that preserves the source boundary.</h2><p>Use the same research records across clustering, rank movement, SERP composition, competitor gaps, and PPC / SEO prioritisation. RoundSEO calculates relationships; it never fills missing metrics with estimates.</p></div></div>
    <nav className="intelligence-tabs" aria-label="Search intelligence tools">{INTELLIGENCE_TABS.map(tab => <button type="button" key={tab.key} className={activeTab === tab.key ? 'active' : ''} aria-current={activeTab === tab.key ? 'page' : undefined} onClick={() => onSelectTab(tab.key)}>{tab.label}</button>)}</nav>
    {activeTab === 'clusters' && <section className="intelligence-panel"><div className="capability-stat-band"><div className="capability-stat"><span>Clusters</span><strong>{clusters.length}</strong><p>Groups built from shared topical tokens.</p></div><div className="capability-stat"><span>Research records</span><strong>{researchRecords.length}</strong><p>Provider or imported terms with optional metrics.</p></div><div className="capability-stat"><span>Crawl terms</span><strong>{crawlRecords.length}</strong><p>Observed language contributing context.</p></div></div>{clusters.length ? <div className="intelligence-table"><div className="intelligence-table-head clusters"><span>Cluster</span><span>Keywords</span><span>Supplied demand</span><span>Difficulty / intent</span></div>{clusters.map(cluster => <div className="intelligence-table-row clusters" key={cluster.id}><div><strong>{cluster.label}</strong><small>{cluster.keywordCount} keyword{cluster.keywordCount === 1 ? '' : 's'}</small></div><p>{cluster.keywords.slice(0, 7).map(record => record.keyword).join(' · ')}{cluster.keywordCount > 7 ? ` · +${cluster.keywordCount - 7} more` : ''}</p><div><strong>{formatSourceNumber(cluster.totalVolume)}</strong><small>{cluster.knownVolumeKeywords ? `${cluster.knownVolumeKeywords} supplied volume value${cluster.knownVolumeKeywords === 1 ? '' : 's'}` : 'No volume supplied'}</small></div><div><strong>{cluster.averageDifficulty === null ? 'Not supplied' : formatSourceNumber(cluster.averageDifficulty, 1)}</strong><small>{cluster.intents.length ? cluster.intents.join(', ') : 'Intent not supplied'}</small></div></div>)}</div> : <div className="capability-empty"><Icon name="search" /><p>Run a crawl, provider research, or import to create clusters from actual language. Keywords with no shared topical token stay as their own cluster.</p></div>}</section>}
    {activeTab === 'rank-tracking' && <section className="intelligence-panel"><div className="capability-stat-band"><div className="capability-stat"><span>Measured keywords</span><strong>{rankSummary.measuredKeywords}</strong><p>Terms with at least one dated position.</p></div><div className="capability-stat"><span>Improved / declined</span><strong>{rankSummary.improved} / {rankSummary.declined}</strong><p>Change compares two imported dates for the same keyword.</p></div><div className="capability-stat"><span>New baselines</span><strong>{rankSummary.new}</strong><p>Only one dated observation so far.</p></div></div><form className="import-panel" onSubmit={importRanks}><div><h3>Import rank snapshots.</h3><p>Position movement is calculated only when the same keyword has two dated position records. A first record establishes a baseline instead of implying a change.</p><p className="import-format">Expected headers: keyword, position, date, volume, url, source</p></div><label>Rank export<textarea value={rankDraft} onChange={event => setRankDraft(event.target.value)} rows={5} placeholder="keyword,position,date,volume,url&#10;technical seo audit,14,2026-10-01,1200,https://example.com/audit&#10;technical seo audit,9,2026-10-31,1200,https://example.com/audit" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import positions <Icon name="arrow" /></button>{rankMessage && <span role="status">{rankMessage}</span>}</div></form>{rankSummary.movers.length ? <div className="intelligence-table"><div className="intelligence-table-head ranks"><span>Keyword</span><span>Current position</span><span>Movement</span><span>Comparison dates</span></div>{rankSummary.movers.slice(0, 30).map(mover => <div className="intelligence-table-row ranks" key={`${mover.keyword}-${mover.checkedAt}`}><div><strong>{mover.keyword}</strong><small>{mover.volume === null ? 'Volume not supplied' : `${formatSourceNumber(mover.volume)} supplied volume`}</small></div><strong>#{formatSourceNumber(mover.currentPosition)}</strong><span className={`movement ${mover.direction}`}>{mover.direction === 'new' ? 'Baseline' : mover.direction === 'improved' ? `Up ${mover.change}` : mover.direction === 'declined' ? `Down ${Math.abs(mover.change || 0)}` : 'No change'}</span><small>{mover.previousCheckedAt ? `${dateLabel(mover.previousCheckedAt)} → ${dateLabel(mover.checkedAt)}` : dateLabel(mover.checkedAt)}</small></div>)}</div> : <div className="capability-empty"><Icon name="radar" /><p>Import at least one keyword position with a measurement date. Add a second dated snapshot for the same keyword to calculate a mover.</p></div>}</section>}
    {activeTab === 'serp-analysis' && <section className="intelligence-panel"><SerpIntelligencePanel websiteId={websiteId} websiteDomain={websiteDomain} onResults={incoming => setSerpRecords(current => replaceSourceRows(current, incoming, 'RoundSEO SERP snapshot'))} /><div className="capability-stat-band"><div className="capability-stat"><span>Queries</span><strong>{serpSummary.queryCount}</strong><p>Distinct RoundSEO Intelligence or imported SERP queries.</p></div><div className="capability-stat"><span>Result rows</span><strong>{serpSummary.resultCount}</strong><p>Ranked results retained from supplied evidence.</p></div><div className="capability-stat"><span>Paid result rows</span><strong>{serpSummary.paidResultCount}</strong><p>Only rows explicitly typed as paid.</p></div></div><details className="provider-fallback"><summary>Import existing SERP results</summary><form className="import-panel" onSubmit={importSerps}><div><h3>Import SERP results.</h3><p>Use one row per result. Result type lets the analysis keep organic, paid, local, shopping, video, and news placements distinct.</p><p className="import-format">Expected headers: keyword, position, url, domain, result_type, title, date, source</p></div><label>SERP export<textarea value={serpDraft} onChange={event => setSerpDraft(event.target.value)} rows={5} placeholder="keyword,position,url,result_type,title,date&#10;technical seo audit,1,https://example.com/audit,organic,Technical SEO Audit,2026-10-31" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import SERPs <Icon name="arrow" /></button>{serpMessage && <span role="status">{serpMessage}</span>}</div></form></details>{serpRecords.length ? <><div className="serp-type-ledger">{serpSummary.resultTypes.map(item => <span key={item.type}>{item.type} <strong>{item.count}</strong></span>)}</div><div className="intelligence-table"><div className="intelligence-table-head serp"><span>Keyword</span><span>Position</span><span>Type</span><span>Result domain</span></div>{[...serpRecords].sort((left, right) => left.keyword.localeCompare(right.keyword) || left.position - right.position).slice(0, 40).map(result => <div className="intelligence-table-row serp" key={result.id}><div><strong>{result.keyword}</strong><small>{result.title || 'Title not supplied'}</small></div><strong>#{formatSourceNumber(result.position)}</strong><span>{result.resultType}</span><div><strong>{result.domain}</strong><small>{result.checkedAt ? dateLabel(result.checkedAt) : 'Date not supplied'}</small></div></div>)}</div><section className="capability-table-section"><div className="section-title"><div><h3>Most visible result domains.</h3><p>Counts are placements within the saved Intelligence and import sample, not domain-level market share.</p></div></div><div className="compact-ledger">{serpSummary.domains.slice(0, 10).map(domain => <div key={domain.domain}><strong>{domain.domain}</strong><span>{domain.resultCount} rows · best #{domain.bestPosition}</span></div>)}</div></section></> : <div className="capability-empty"><Icon name="search" /><p>Run a live SERP or import existing rows to inspect result composition. Until evidence is saved, RoundSEO does not claim which domains, ads, or features appear.</p></div>}</section>}
    {activeTab === 'competitors' && <section className="intelligence-panel"><div className="capability-stat-band"><div className="capability-stat"><span>Comparison rows</span><strong>{competitorGaps.length}</strong><p>Keywords with at least one imported competitor position.</p></div><div className="capability-stat"><span>Competitor ahead</span><strong>{competitorGaps.filter(gap => gap.status === 'competitor_ahead').length}</strong><p>Same-keyword rows where their supplied position is better.</p></div><div className="capability-stat"><span>Site rows missing</span><strong>{competitorGaps.filter(gap => gap.status === 'not_in_imported_site_rows').length}</strong><p>Not found in this imported site dataset—not a claim of non-ranking.</p></div></div><form className="import-panel" onSubmit={importCompetitors}><div><h3>Import competitor keyword positions.</h3><p>Include a competitor domain on each row. Imported current-site records from keyword research and rank tracking are used as the comparison side.</p><p className="import-format">Expected headers: keyword, domain, position, volume, difficulty, cpc, intent, date, source</p></div><label>Competitor export<textarea value={competitorDraft} onChange={event => setCompetitorDraft(event.target.value)} rows={5} placeholder="keyword,domain,position,volume,difficulty,cpc,intent,date&#10;technical seo audit,competitor.example,3,1200,32,4.80,commercial,2026-10-31" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import competitors <Icon name="arrow" /></button>{competitorMessage && <span role="status">{competitorMessage}</span>}</div></form>{competitorGaps.length ? <div className="intelligence-table"><div className="intelligence-table-head competitors"><span>Keyword</span><span>Competitor</span><span>Their / your position</span><span>Reading</span></div>{competitorGaps.slice(0, 30).map(gap => <div className="intelligence-table-row competitors" key={`${gap.keyword}-${gap.competitorDomain}`}><div><strong>{gap.keyword}</strong><small>{gap.volume === null ? 'Volume not supplied' : `${formatSourceNumber(gap.volume)} supplied volume`}</small></div><strong>{gap.competitorDomain}</strong><span>#{formatSourceNumber(gap.competitorPosition)} / {gap.ourPosition === null ? 'No imported site row' : `#${formatSourceNumber(gap.ourPosition)}`}</span><small>{gap.status === 'competitor_ahead' ? `${gap.competitorDomain} is ahead by ${gap.positionGap} supplied position${gap.positionGap === 1 ? '' : 's'}.` : gap.status === 'we_lead' ? `Your imported position is ahead by ${Math.abs(gap.positionGap || 0)}.` : gap.status === 'tie' ? 'Imported positions are tied.' : 'No matching current-site position was imported.'}</small></div>)}</div> : <div className="capability-empty"><Icon name="globe" /><p>Import competitor keyword positions, then add your own keyword research or dated rank records to compare the same terms. Missing records remain explicitly unknown.</p></div>}</section>}
    {activeTab === 'ppc-seo' && <section className="intelligence-panel"><div className="capability-stat-band"><div className="capability-stat"><span>PPC / SEO records</span><strong>{ppcOpportunities.length}</strong><p>Current-site terms with a positive supplied CPC.</p></div><div className="capability-stat"><span>Bridge candidates</span><strong>{ppcOpportunities.filter(item => item.recommendation === 'bridge_to_organic').length}</strong><p>Terms outside the supplied top 10 position range.</p></div><div className="capability-stat"><span>Organic protection</span><strong>{ppcOpportunities.filter(item => item.recommendation === 'protect_organic').length}</strong><p>Terms already in the supplied top 10.</p></div></div>{ppcOpportunities.length ? <div className="intelligence-table"><div className="intelligence-table-head ppc"><span>Keyword</span><span>Inputs</span><span>Paid SERP rows</span><span>Decision cue</span></div>{ppcOpportunities.slice(0, 30).map(opportunity => <div className="intelligence-table-row ppc" key={opportunity.keyword}><div><strong>{opportunity.keyword}</strong><small>{opportunity.intent || 'Intent not supplied'}</small></div><div><strong>{formatSourceNumber(opportunity.cpc, 2)} CPC</strong><small>{opportunity.position === null ? 'Position not supplied' : `Position #${formatSourceNumber(opportunity.position)}`} · {opportunity.volume === null ? 'Volume not supplied' : `${formatSourceNumber(opportunity.volume)} volume`}</small></div><span>{opportunity.paidResultCount === null ? 'No SERP import for this keyword' : `${opportunity.paidResultCount} typed paid row${opportunity.paidResultCount === 1 ? '' : 's'}`}</span><small>{opportunity.recommendation === 'bridge_to_organic' ? 'Consider paid coverage while improving the organic position; no traffic or ROI is assumed.' : opportunity.recommendation === 'protect_organic' ? 'Protect the existing organic position while reviewing paid competition and intent.' : 'Add dated rank data before assigning an organic-versus-paid role.'}</small></div>)}</div> : <div className="capability-empty"><Icon name="clock" /><p>Import keyword research with CPC for this website. Add position and SERP rows when available to make the PPC / SEO reading more specific without creating traffic or spend estimates.</p><button className="button outline small" onClick={onOpenKeywordResearch}>Open keyword research</button></div>}</section>}
    <div className="capability-note"><Icon name="check" /><p>RoundSEO Intelligence results are retained in the workspace, while imports remain local to this website. Values such as volume, difficulty, CPC, rankings, and results stay source-reported; RoundSEO only calculates transparent comparisons from them.</p></div>
  </section>;
}

function AnalyticsView({ websiteDomain }: { websiteDomain: string }) {
  const pageStorage = pageAnalyticsStorageKey(websiteDomain);
  const retentionStorage = retentionCohortsStorageKey(websiteDomain);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('pages');
  const [pageRecords, setPageRecords] = useState<AnalyticsPageRecord[]>(() => readJson<AnalyticsPageRecord[]>(pageStorage, []));
  const [retentionRecords, setRetentionRecords] = useState<RetentionCohortRecord[]>(() => readJson<RetentionCohortRecord[]>(retentionStorage, []));
  const [pageDraft, setPageDraft] = useState('');
  const [retentionDraft, setRetentionDraft] = useState('');
  const [pageMessage, setPageMessage] = useState('');
  const [retentionMessage, setRetentionMessage] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { writeStoredJson(pageStorage, pageRecords); }, [pageStorage, pageRecords]);
  useEffect(() => { writeStoredJson(retentionStorage, retentionRecords); }, [retentionStorage, retentionRecords]);
  const pages = summarizePageAnalytics(pageRecords);
  const retention = summarizeRetentionCohorts(retentionRecords);
  const visiblePages = pages.pages.filter(record => `${record.pageTitle || ''} ${record.pagePath || ''}`.toLowerCase().includes(query.toLowerCase()));
  const importPages = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parsePageAnalyticsRecords(pageDraft, { sourceLabel: 'GA4 Pages and screens export' });
    if (!parsed.items.length) { setPageMessage(parsed.errors[0] || 'No usable page analytics rows were found.'); return; }
    setPageRecords(current => mergeById(current, parsed.items));
    setPageDraft('');
    setPageMessage(`${parsed.items.length} page row${parsed.items.length === 1 ? '' : 's'} imported.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  const importRetention = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseRetentionCohortRecords(retentionDraft, { sourceLabel: 'GA4 retention export' });
    if (!parsed.items.length) { setRetentionMessage(parsed.errors[0] || 'No usable retention rows were found.'); return; }
    setRetentionRecords(current => mergeById(current, parsed.items));
    setRetentionDraft('');
    setRetentionMessage(`${parsed.items.length} cohort row${parsed.items.length === 1 ? '' : 's'} imported.${parsed.errors.length ? ` ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} need review.` : ''}`);
  };
  return <section className="audit-view capability-view analytics-view">
    <div className="section-title"><div><h2>Audience evidence beside SEO evidence.</h2><p>Import exported analytics rows to see which pages people reach, use, and return to. RoundSEO never derives visitor behavior from a crawl, keywords, or loading test.</p></div></div>
    <nav className="intelligence-tabs" aria-label="Audience and engagement views"><button type="button" className={activeTab === 'pages' ? 'active' : ''} aria-current={activeTab === 'pages' ? 'page' : undefined} onClick={() => setActiveTab('pages')}>Pages & engagement</button><button type="button" className={activeTab === 'retention' ? 'active' : ''} aria-current={activeTab === 'retention' ? 'page' : undefined} onClick={() => setActiveTab('retention')}>Retention cohorts</button></nav>
    {activeTab === 'pages' && <section className="analytics-panel">
      <div className="capability-stat-band analytics-stat-band"><div className="capability-stat"><span>Imported pages</span><strong>{pages.pageCount || '—'}</strong><p>Latest imported row per page title or path.</p></div><div className="capability-stat"><span>Page views</span><strong>{formatAnalyticsNumber(pages.totalViews)}</strong><p>Sum across the imported page rows—not estimated organic traffic.</p></div><div className="capability-stat"><span>Page active users</span><strong>{formatAnalyticsNumber(pages.totalPageActiveUsers)}</strong><p>Page-row total; visitors can appear on more than one page.</p></div><div className="capability-stat"><span>Average engagement</span><strong>{formatDuration(pages.averageEngagementSeconds)}</strong><p>Weighted by supplied active-user values where available.</p></div></div>
      <form className="import-panel analytics-import" onSubmit={importPages}><div><h3>Import Pages and screens.</h3><p>Paste a CSV, TSV, or semicolon-separated export. Page title or path plus at least one metric is required. Re-importing the same page, date and source updates that local row.</p><p className="import-format">Expected headers: page_title, page_path, views, active_users, views_per_active_user, average_engagement_time, event_count, date, source</p></div><label>Pages and screens export<textarea value={pageDraft} onChange={event => setPageDraft(event.target.value)} rows={5} placeholder="page_title,page_path,views,active_users,average_engagement_time,event_count,date&#10;Pricing,/pricing,1250,800,1m 17s,4240,2026-10-31" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import page metrics <Icon name="arrow" /></button>{pageMessage && <span role="status">{pageMessage}</span>}</div></form>
      {pages.pageCount ? <><AnalyticsTrendChart trend={pages.trend} /><section className="capability-table-section analytics-table-section"><div className="section-title"><div><h3>Imported page performance.</h3><p>Sort order follows supplied views. Page rows and their metrics remain source-reported; no source connection or site-wide user de-duplication is implied.</p></div><label className="table-search"><span className="sr-only">Filter imported pages</span><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter page title or path" /></label></div><div className="analytics-table"><div className="analytics-table-head"><span>Page</span><span>Views</span><span>Active users</span><span>Views / active user</span><span>Engagement</span><span>Events</span></div>{visiblePages.map(record => <div className="analytics-table-row" key={record.id}><div><strong>{record.pageTitle || record.pagePath || 'Untitled page'}</strong><small>{record.pagePath || 'Path not supplied'}{record.source ? ` · ${record.source}` : ''}</small></div><strong>{formatAnalyticsNumber(record.views)}</strong><strong>{formatAnalyticsNumber(record.activeUsers)}</strong><span>{record.viewsPerActiveUser === null ? (record.views !== null && record.activeUsers && record.activeUsers > 0 ? `${(record.views / record.activeUsers).toFixed(2)} derived` : 'Not supplied') : formatAnalyticsNumber(record.viewsPerActiveUser, 2)}</span><span>{formatDuration(record.averageEngagementSeconds)}</span><strong>{formatAnalyticsNumber(record.eventCount)}</strong></div>)}{!visiblePages.length && <EmptyRow message="No imported page analytics row matches this filter." />}</div></section></> : <div className="capability-empty"><Icon name="radar" /><p>No page analytics are stored yet. Paste a Pages and screens export to compare source-reported reach and engagement with the technical evidence elsewhere in RoundSEO.</p></div>}
    </section>}
    {activeTab === 'retention' && <section className="analytics-panel">
      <div className="capability-stat-band analytics-stat-band"><div className="capability-stat"><span>Imported cohorts</span><strong>{retention.cohortCount || '—'}</strong><p>Unique cohort labels in the imported evidence.</p></div><div className="capability-stat"><span>Day-one retention</span><strong>{formatPercent(retention.dayOneRetention)}</strong><p>Average across cohort rows that supplied day-one retention.</p></div><div className="capability-stat"><span>Latest measured day</span><strong>{retention.lastMeasuredDay === null ? '—' : `Day ${retention.lastMeasuredDay}`}</strong><p>Latest day index present in the retained cohort rows.</p></div><div className="capability-stat"><span>Avg. engagement</span><strong>{formatDuration(retention.averageEngagementSeconds)}</strong><p>Simple average of supplied retention-row engagement times.</p></div></div>
      <form className="import-panel analytics-import" onSubmit={importRetention}><div><h3>Import retention cohorts.</h3><p>Paste cohort or retention export rows. Use a percentage such as <code>5%</code> or a ratio such as <code>0.05</code> for retention rate; both are normalized to percentage points in this workspace.</p><p className="import-format">Expected headers: cohort, day, retention_rate, average_engagement_time, new_users, returning_users, date, source</p></div><label>Retention export<textarea value={retentionDraft} onChange={event => setRetentionDraft(event.target.value)} rows={5} placeholder="cohort,day,retention_rate,average_engagement_time,new_users,returning_users,date&#10;2026-10-01,1,5%,1m 30s,100,5,2026-10-31" /></label><div className="import-panel-actions"><button className="button solid small" type="submit">Import cohorts <Icon name="arrow" /></button>{retentionMessage && <span role="status">{retentionMessage}</span>}</div></form>
      {retention.records.length ? <><RetentionCohortChart curve={retention.curve} /><section className="capability-table-section analytics-table-section"><div className="section-title"><div><h3>Imported cohort checkpoints.</h3><p>Each row is kept as source evidence. Cohort averages are shown only where more than one supplied row shares the same day.</p></div></div><div className="analytics-table retention-table"><div className="analytics-table-head"><span>Cohort</span><span>Day</span><span>Retention</span><span>Engagement</span><span>New users</span><span>Returning users</span></div>{retention.records.map(record => <div className="analytics-table-row" key={record.id}><div><strong>{record.cohort || 'Cohort not supplied'}</strong><small>{record.checkedAt ? `Imported ${dateLabel(record.checkedAt)}` : record.source || 'Import date not supplied'}</small></div><strong>{record.day === null ? 'Not supplied' : `Day ${record.day}`}</strong><span>{formatPercent(record.retentionRate)}</span><span>{formatDuration(record.averageEngagementSeconds)}</span><strong>{formatAnalyticsNumber(record.newUsers)}</strong><strong>{formatAnalyticsNumber(record.returningUsers)}</strong></div>)}</div></section></> : <div className="capability-empty"><Icon name="radar" /><p>No retention cohorts are stored yet. Import a dated cohort export to see source-reported return behavior without turning a technical crawl into a visitor claim.</p></div>}
    </section>}
    <div className="capability-note"><Icon name="check" /><p>These imports stay in this browser for {websiteDomain}. They are not an OAuth connection, and their metrics do not alter crawl health, rank tracking, or the real-user page-loading replay.</p></div>
  </section>;
}

function AnalyticsTrendChart({ trend }: { trend: ReturnType<typeof summarizePageAnalytics>['trend'] }) {
  if (!trend.length) return <section className="analytics-chart-empty"><h3>Imported page trend.</h3><p>No date column was supplied, so RoundSEO is showing the current page table without a time comparison.</p></section>;
  if (trend.length === 1) return <section className="analytics-chart-empty"><h3>Imported page trend.</h3><p>One dated snapshot is available for {trend[0].date}. Import another dated export to compare page views and active users over time.</p></section>;
  const values = trend.flatMap(point => [point.views, point.activeUsers].filter((value): value is number => value !== null));
  const maximum = Math.max(1, ...values);
  const points = (key: 'views' | 'activeUsers') => trend.flatMap((point, index) => point[key] === null ? [] : [`${42 + (index / (trend.length - 1)) * 556},${158 - ((point[key] || 0) / maximum) * 126}`]).join(' ');
  return <section className="analytics-chart" aria-label="Imported page trend"><div><h3>Imported page trend.</h3><p>Dates and values come only from the page export. A shared scale preserves the relationship between page views and page-row active users.</p></div><div className="analytics-chart-legend"><span className="views">Views</span><span className="users">Page active users</span></div><svg viewBox="0 0 640 190" role="img" aria-label="Imported views and page active-user totals over time"><line x1="42" y1="158" x2="598" y2="158" /><line x1="42" y1="32" x2="42" y2="158" /><text x="42" y="181">{trend[0].date}</text><text x="598" y="181" textAnchor="end">{trend[trend.length - 1].date}</text><text x="35" y="38" textAnchor="end">{formatSourceNumber(maximum)}</text><text x="35" y="161" textAnchor="end">0</text><polyline className="views-line" points={points('views')} /><polyline className="users-line" points={points('activeUsers')} /></svg></section>;
}

function RetentionCohortChart({ curve }: { curve: ReturnType<typeof summarizeRetentionCohorts>['curve'] }) {
  const usable = curve.filter(point => point.retentionRate !== null);
  if (!usable.length) return <section className="analytics-chart-empty"><h3>Cohort retention curve.</h3><p>Retention-rate values were not supplied. The cohort table preserves any other imported metrics below.</p></section>;
  if (usable.length === 1) return <section className="analytics-chart-empty"><h3>Cohort retention curve.</h3><p>Only day {usable[0].day} has a supplied retention rate. Add another day to plot a retention curve.</p></section>;
  const maximum = Math.max(1, ...usable.map(point => point.retentionRate || 0));
  const firstDay = usable[0].day;
  const lastDay = usable[usable.length - 1].day;
  const points = usable.map((point, index) => `${42 + (index / (usable.length - 1)) * 556},${158 - ((point.retentionRate || 0) / maximum) * 126}`).join(' ');
  return <section className="analytics-chart retention-chart" aria-label="Imported retention curve"><div><h3>Cohort retention curve.</h3><p>Each point is the average supplied retention rate for that day across the imported cohorts.</p></div><div className="analytics-chart-legend"><span className="retention">Retention rate</span><small>Maximum shown: {formatPercent(maximum)}</small></div><svg viewBox="0 0 640 190" role="img" aria-label="Imported cohort retention over measured days"><line x1="42" y1="158" x2="598" y2="158" /><line x1="42" y1="32" x2="42" y2="158" /><text x="42" y="181">Day {firstDay}</text><text x="598" y="181" textAnchor="end">Day {lastDay}</text><text x="35" y="38" textAnchor="end">{formatPercent(maximum)}</text><text x="35" y="161" textAnchor="end">0%</text><polyline className="retention-line" points={points} /></svg></section>;
}

function AiVisibilityView({ websiteId, websiteDomain }: { websiteId: string; websiteDomain: string }) {
  const storageKey = `roundseo-ai-visibility-${normalizeSiteDomain(websiteDomain)}`;
  const [checks, setChecks] = useState<AiPromptCheck[]>(() => readJson<AiPromptCheck[]>(storageKey, []));
  const [engine, setEngine] = useState<AiPromptCheck['engine']>('ChatGPT');
  const [prompt, setPrompt] = useState(`What are the best resources for ${websiteDomain}?`);
  const [outcome, setOutcome] = useState<AiPromptCheck['outcome']>('mentioned');
  const [note, setNote] = useState('');
  const [copyState, setCopyState] = useState('Copy prompt');
  useEffect(() => { writeStoredJson(storageKey, checks); }, [storageKey, checks]);
  const mentioned = checks.filter(check => check.outcome === 'mentioned').length;
  const mixed = checks.filter(check => check.outcome === 'mixed').length;
  const visibility = checks.length ? Math.round(((mentioned + mixed * 0.5) / checks.length) * 100) : null;
  const saveCheck = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setChecks(current => [{ id: `ai-${Date.now()}`, engine, prompt: prompt.trim(), outcome, note: note.trim(), checkedAt: new Date().toISOString() }, ...current]);
    setNote('');
  };
  const copyPrompt = async () => { setCopyState(await copyText(prompt) ? 'Copied' : 'Select and copy'); window.setTimeout(() => setCopyState('Copy prompt'), 1600); };
  return <section className="audit-view capability-view ai-visibility-view">
    <div className="section-title"><div><h2>Measure how answer engines describe you.</h2><p>Run saved RoundSEO answer-engine research, or keep a manual observation when you need a separate comparison sample.</p></div></div>
    <AnswerEnginePanel websiteId={websiteId} websiteDomain={websiteDomain} />
    <div className="capability-stat-band"><div className="capability-stat"><span>Manual observations</span><strong>{checks.length}</strong><p>Prompt observations manually saved for this website.</p></div><div className="capability-stat"><span>Manual visibility</span><strong>{visibility === null ? 'Not measured' : `${visibility}%`}</strong><p>Within manual observations, mentions count fully and mixed results count half.</p></div><div className="capability-stat"><span>Data source</span><strong className="unavailable">Sampled</strong><p>Manual result recording; automated Intelligence evidence is retained separately above.</p></div></div>
    <details className="provider-fallback"><summary>Record a manual observation</summary><form className="prompt-check-form" onSubmit={saveCheck}><div className="prompt-check-head"><div><h3>Record a visibility check.</h3><p>Use the same prompt again on your next review for a meaningful comparison.</p></div><button className="button outline small" type="button" onClick={copyPrompt}>{copyState}</button></div><label>Answer engine<select value={engine} onChange={event => setEngine(event.target.value as AiPromptCheck['engine'])}><option>ChatGPT</option><option>Perplexity</option><option>Gemini</option><option>Claude</option><option>Other</option></select></label><label>Prompt<textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} /></label><div className="prompt-check-grid"><label>Result<select value={outcome} onChange={event => setOutcome(event.target.value as AiPromptCheck['outcome'])}><option value="mentioned">Mentioned</option><option value="mixed">Mixed / partial</option><option value="not_mentioned">Not mentioned</option></select></label><label>Note <input value={note} onChange={event => setNote(event.target.value)} placeholder="Position, competitors or context" /></label></div><button className="button solid small" type="submit">Save visibility check <Icon name="arrow" /></button></form></details>
    <section className="capability-table-section"><div className="section-title"><div><h3>Recent prompt checks.</h3><p>Keep the exact question and result together so the trend stays interpretable.</p></div></div>{checks.length ? <div className="ai-check-list">{checks.slice(0, 12).map(check => <div className="ai-check-row" key={check.id}><div><strong>{check.engine}</strong><small>{new Date(check.checkedAt).toLocaleString()}</small></div><p>{check.prompt}</p><span className={`ai-outcome ${check.outcome}`}>{check.outcome === 'not_mentioned' ? 'Not mentioned' : check.outcome === 'mixed' ? 'Mixed' : 'Mentioned'}</span>{check.note && <small className="ai-note">{check.note}</small>}</div>)}</div> : <div className="capability-empty"><Icon name="radar" /><p>No prompt checks saved yet. Start with the suggested question above.</p></div>}</section>
  </section>;
}

function SecurityView({ website, result, onRun }: { website: Website; result: AuditResult; onRun: () => void }) {
  const security = result.security || fallbackSecurityAudit(website.url, result.pagesInventory);
  const checks = [
    { label: 'HTTPS transport', value: security.transport === 'https' ? 'Observed' : security.transport === 'http' ? 'HTTP only' : 'Unknown', detail: security.transport === 'https' ? 'The declared website target uses HTTPS.' : 'Run the site from its HTTPS origin before treating the report as secure.', tone: security.transport === 'https' ? 'good' : 'bad' },
    { label: 'TLS / SSL handshake', value: security.tlsStatus === 'validated' ? 'Validated' : security.tlsStatus === 'not_applicable' ? 'Not applicable' : 'Not measured', detail: security.tlsStatus === 'validated' ? 'The crawl reached the HTTPS origin with certificate validation enabled.' : 'A new audit records this signal from the root response.', tone: security.tlsStatus === 'validated' ? 'good' : 'unknown' },
    { label: 'HTTP pages in crawl', value: String(security.httpPageCount), detail: security.httpPageCount ? 'Review protocol redirects and canonical targets for these pages.' : 'No HTTP page URLs were retained in the inspected set.', tone: security.httpPageCount ? 'bad' : 'good' },
    { label: 'Security headers', value: security.securityHeaders.length ? `${security.securityHeaders.length} observed` : 'Not measured', detail: security.securityHeaders.length ? security.securityHeaders.join(', ') : 'Response headers were not present in this saved report.', tone: security.securityHeaders.length ? 'good' : 'unknown' },
    { label: 'HTTP link candidates', value: String(security.httpLinkCount), detail: security.httpLinkCount ? 'Review these links for redirects or mixed-content risk in their page context.' : 'No HTTP link candidates were retained.', tone: security.httpLinkCount ? 'unknown' : 'good' },
  ];
  return <section className="audit-view capability-view security-view">
    <div className="section-title"><div><h2>Security signals with a precise scope.</h2><p>RoundSEO records transport and response evidence that can be observed during a public crawl. Certificate issuer, WAF posture and authenticated headers remain outside this report.</p></div><button className="button outline small" onClick={onRun}><Icon name="refresh" />Run new audit</button></div>
    <div className="capability-stat-band"><div className="capability-stat"><span>Transport</span><strong>{security.transport.toUpperCase()}</strong><p>{security.rootStatusCode ? `Root response HTTP ${security.rootStatusCode}` : 'Root response status not retained'}</p></div><div className="capability-stat"><span>Headers observed</span><strong>{security.securityHeaders.length}</strong><p>Allowed response-security headers saved with the crawl.</p></div><div className="capability-stat"><span>Checked</span><strong>{crawlTime(security.checkedAt)}</strong><p>Security snapshot timestamp.</p></div></div>
    <div className="security-check-list">{checks.map(check => <div className="security-check-row" key={check.label}><span className={`security-check-mark ${check.tone}`}><Icon name={check.tone === 'good' ? 'check' : 'clock'} /></span><div><strong>{check.label}</strong><p>{check.detail}</p></div><span className={`security-check-value ${check.tone}`}>{check.value}</span></div>)}</div>
    <div className="capability-note"><Icon name="check" /><p>{security.note} Security checks are evidence, not a guarantee that every route, asset or integration is protected.</p></div>
  </section>;
}

function AuditView({ result, onOpenPage }: { result: AuditResult; onOpenPage: (url: string) => void }) {
  return <div className="audit-view audit-register-view">
    <div className="section-title route-section-title"><div><h2>Crawl and indexability controls.</h2><p>Review every registered check, then open a finding to see its affected URLs, observed value, and recommended verification.</p></div></div>
    <IssueMovementPanel comparison={result.issueComparison} onOpenPage={onOpenPage} />
    <AssuranceRegister assurance={result.assurance} />
    <AuditControlMatrix result={result} onOpenPage={onOpenPage} />
  </div>;
}

function IssueMovementPanel({ comparison, onOpenPage }: { comparison?: IssueComparison; onOpenPage: (url: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'new' | 'cleared' | 'continuing'>('all');
  const rows = comparison?.rows.filter(row => filter === 'all' || filter === 'new' && row.newlyObserved.length > 0 || filter === 'cleared' && row.noLongerObserved.length > 0 || filter === 'continuing' && row.stillObserved.length > 0) || [];
  return <section className="issue-movement" aria-label="Issue movement between crawls">
    <div className="issue-movement-heading"><div><h2>Issue movement between crawls</h2><p>Compare rule and page observations on URLs inspected by both compatible crawls.</p></div>{comparison?.status === 'comparable' && <span>{comparison.overlappingPages} shared pages · prior {comparison.previousAt}</span>}</div>
    {!comparison ? <div className="issue-movement-empty"><Icon name="clock" /><p>This audit is a baseline. Run it again to compare findings on the same inspected pages.</p></div> : comparison.status === 'unavailable' ? <div className="issue-movement-empty"><Icon name="clock" /><p>{comparison.reason} The current findings remain available below.</p></div> : <>
      <div className="issue-movement-stats"><div><span>Newly observed</span><strong>{comparison.newlyObserved}</strong></div><div><span>No longer observed</span><strong>{comparison.noLongerObserved}</strong></div><div><span>Still observed</span><strong>{comparison.stillObserved}</strong></div></div>
      <div className="change-filter" aria-label="Filter issue movement">
        {([['all', 'All rules', comparison.rows.length], ['new', 'Newly observed', comparison.rows.filter(row => row.newlyObserved.length).length], ['cleared', 'No longer observed', comparison.rows.filter(row => row.noLongerObserved.length).length], ['continuing', 'Still observed', comparison.rows.filter(row => row.stillObserved.length).length]] as const).map(([key, label, count]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} <strong>{count}</strong></button>)}
      </div>
      <div className="issue-movement-list">{rows.length ? rows.map(row => <details key={row.ruleId} className="issue-movement-row"><summary><span className={`control-priority ${row.priority.toLowerCase()}`}>{row.priority}</span><span className="issue-movement-name"><strong>{row.title}</strong><small>{row.category} · {row.ruleId}</small></span><span className="issue-movement-values"><span>+{row.newlyObserved.length} new</span><span>−{row.noLongerObserved.length} absent</span><span>{row.stillObserved.length} continuing</span></span></summary><div className="issue-movement-detail">{([['Newly observed', row.newlyObserved], ['No longer observed', row.noLongerObserved], ['Still observed', row.stillObserved]] as const).map(([label, urls]) => urls.length ? <div key={label}><strong>{label} on these pages</strong>{urls.map(url => <button className="control-url" key={url} onClick={() => onOpenPage(url)}>{pathFor(url)}</button>)}</div> : null)}</div></details>) : <div className="issue-movement-empty"><p>{filter === 'all' ? 'No URL-level issue observations were found on the shared pages.' : 'No rule matches this movement filter.'}</p></div>}</div>
      <p className="issue-movement-note">Counts are rule-page observations, not unique URLs or proof of a fix. Newly inspected pages are excluded.{comparison.excludedRules ? ` ${comparison.excludedRules} rule${comparison.excludedRules === 1 ? '' : 's'} with capped or incomplete URL evidence could not be compared.` : ''}</p>
    </>}
  </section>;
}

function PageLoadView({ result, onRunPerformance, onShowActions }: { result: AuditResult; onRunPerformance: (url?: string) => Promise<void>; onShowActions: () => void }) {
  const actionCount = result.actions.filter(action => isPerformanceRule(action.ruleId) && !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).length;
  return <div className="audit-view pageload-view">
    <div className="section-title"><div><h2>Page-load evidence for real URLs.</h2><p>Choose a page to create a separate mobile and desktop browser sample, then review the recorded requests and specific resources.</p></div></div>
    <PerformancePanel performance={result.performance} history={result.performanceHistory || []} pages={result.pagesInventory} onRun={onRunPerformance} onShowActions={onShowActions} actionCount={actionCount} />
  </div>;
}

function RealUserPageLoadingView({ website, result, onRun }: { website: Website; result: AuditResult; onRun: () => Promise<void> }) {
  const [runError, setRunError] = useState('');
  const loading = result.realUserPageLoading;
  const progress = website.realUserPageLoadingProgress;
  const running = Boolean(progress);
  const measuredPages = loading?.pages.filter(page => page.availability === 'measured' || page.availability === 'partial') || [];
  const recordedRequests = measuredPages.reduce((total, page) => total + page.devices.reduce((deviceTotal, device) => deviceTotal + (device.requests || 0), 0), 0);
  const recordedBytes = measuredPages.reduce((total, page) => total + page.devices.reduce((deviceTotal, device) => deviceTotal + (device.transferredBytes || 0), 0), 0);
  const run = async () => {
    setRunError('');
    try { await onRun(); } catch (error) { setRunError(error instanceof Error ? error.message : 'The visitor-path browser replay could not be started.'); }
  };
  return <section className="audit-view capability-view real-user-loading-view">
    <div className="section-title">
      <div><h2>Real user page loading, replayed in a cold browser.</h2><p>RoundSEO opens the landing page, takes up to ten real same-site links from its rendered DOM, then measures each page in fresh mobile and desktop browser contexts.</p></div>
      <button className="button outline small" onClick={run} disabled={running}>{running ? 'Replaying…' : <><Icon name="refresh" />{loading ? 'Replay landing path' : 'Run browser replay'}</>}</button>
    </div>
    <section className="real-user-method" aria-label="Measurement method">
      <div><h3>Browser-path evidence, not field telemetry.</h3><p>This is the load sequence a new browser must work through. It records response headers, resource arrival order, classic scripts without async or defer, and head stylesheets. It does not claim to be RUM or real-user Core Web Vitals.</p></div>
      <dl><div><dt>Entry page</dt><dd>{pathFor(loading?.landingUrl || website.url)}</dd></div><div><dt>Link selection</dt><dd>Main content first, then live header, body and footer links</dd></div><div><dt>Cold state</dt><dd>Fresh storage, cache disabled, service workers blocked</dd></div></dl>
    </section>
    {running && progress && <section className="real-user-progress" role="status"><div><strong>{progress.phase === 'discovering' ? 'Reading the rendered landing page' : `Loading page ${Math.min(progress.completedPages + 1, progress.totalPages)} of ${progress.totalPages}`}</strong><span>{progress.currentUrl ? pathFor(progress.currentUrl) : 'Preparing browser context'}</span></div><progress value={progress.completedPages} max={Math.max(progress.totalPages, 1)} aria-label="Real user page loading progress" /><small>Each page runs as a separate cold mobile and desktop browser sample. You can leave this screen open while the local server completes the replay.</small></section>}
    {(runError || website.realUserPageLoadingError) && <p className="form-error performance-error" role="alert">{runError || website.realUserPageLoadingError}</p>}
    {!loading && !running && <div className="capability-empty real-user-empty"><Icon name="clock" /><p>No visitor-path replay has been recorded. Run it to inspect what the landing page and up to ten genuine same-site links request, execute and cache on a cold visit.</p></div>}
    {loading && <>
      <p className="performance-method real-user-source-note">{loading.sourceNote}</p>
      <div className="capability-stat-band real-user-stat-band">
        <div className="capability-stat"><span>Pages sampled</span><strong>{measuredPages.length}<small> / {loading.pages.length}</small></strong><p>Landing page plus observed links with usable browser timings.</p></div>
        <div className="capability-stat"><span>Eligible same-site links</span><strong>{loading.eligibleLinkedPages}</strong><p>{loading.requestedLinkedPages} can be selected; none are invented when the landing page has fewer.</p></div>
        <div className="capability-stat"><span>Recorded browser work</span><strong>{recordedRequests}</strong><p>{formatBytes(recordedBytes)} transferred across mobile and desktop samples.</p></div>
      </div>
      {loading.availability === 'failed' && <p className="device-error">{loading.error || 'The browser replay did not return any usable timings.'}</p>}
      <section className="real-user-page-section">
        <div className="section-title"><div><h3>Landing-path loading structure.</h3><p>Pages are ordered exactly as they were selected from the rendered landing page. Open a row for device timings, delivery headers, potential parser-blocking scripts, stylesheets and request arrival order.</p></div></div>
        <div className="real-user-page-list">{loading.pages.map((page, index) => <RealUserPageLoadingRow key={`${page.url}-${index}`} page={page} index={index} />)}</div>
      </section>
    </>}
  </section>;
}

function RealUserPageLoadingRow({ page, index }: { page: RealUserPageLoadingPage; index: number }) {
  const mobile = page.devices.find(device => device.device === 'mobile');
  const desktop = page.devices.find(device => device.device === 'desktop');
  const sequenceDevice = mobile?.loadSequence?.length ? mobile : desktop?.loadSequence?.length ? desktop : undefined;
  return <details className="real-user-page-row" open={index === 0}>
    <summary>
      <span className="real-user-page-index">{index + 1}</span>
      <span className="real-user-page-address"><strong>{page.role === 'landing' ? 'Landing page' : 'Linked page'}</strong><a href={page.url} target="_blank" rel="noreferrer">{pathFor(page.url)} ↗</a>{page.discoveredFrom && <small>Observed as “{page.discoveredFrom.text}” in {page.discoveredFrom.placement}</small>}</span>
      <span className="real-user-page-glance"><span>Mobile LCP <strong>{browserMetricCopy(mobile, 'lcp')}</strong></span><span>Desktop LCP <strong>{browserMetricCopy(desktop, 'lcp')}</strong></span></span>
      <span className={`real-user-page-state ${page.availability}`}>{availabilityCopy(page.availability)}</span>
      <Icon name="chevron" />
    </summary>
    <div className="real-user-page-detail">
      <div className="real-user-device-strip">{[mobile, desktop].filter((device): device is PerformanceDeviceResult => Boolean(device)).map(device => <div key={device.device}><span>{device.device} cold browser</span><strong>{browserMetricCopy(device, 'lcp')} LCP</strong><small>{browserMetricCopy(device, 'ttfb')} TTFB · {browserMetricCopy(device, 'fcp')} FCP · {browserMetricCopy(device, 'cls')} CLS · {device.requests ?? '—'} responses · {device.transferredBytes === undefined ? 'transfer unavailable' : formatBytes(device.transferredBytes)}</small></div>)}</div>
      {page.error && <p className="device-error">{page.error}</p>}
      {page.loadStructure ? <RealUserLoadStructureView structure={page.loadStructure} structureDevice={page.loadStructureDevice || 'mobile'} /> : <p className="performance-method">Document structure was unavailable because this page did not return a usable browser sample.</p>}
      {sequenceDevice?.loadSequence?.length ? <RealUserRequestSequence device={sequenceDevice} /> : null}
    </div>
  </details>;
}

function RealUserLoadStructureView({ structure, structureDevice }: { structure: RealUserLoadStructure; structureDevice: 'mobile' | 'desktop' }) {
  return <div className="real-user-structure-grid">
    <section><h3>Potentially parser-blocking scripts</h3><p>Classic external scripts without async or defer in the {structureDevice} DOM. This is a structural cue, not proof of a long task.</p>{structure.potentialBlockingScripts.length ? <ul>{structure.potentialBlockingScripts.map(script => <li key={script.url}><a href={script.url} target="_blank" rel="noreferrer">{pathFor(script.url)} ↗</a><span>{script.location} · {script.type || 'classic'} · {script.thirdParty ? 'external host' : 'same site'}</span></li>)}</ul> : <small>No external classic scripts without async or defer were observed in this DOM sample.</small>}{structure.inlineHeadScriptCount > 0 && <small className="real-user-inline-note">{structure.inlineHeadScriptCount} inline head script{structure.inlineHeadScriptCount === 1 ? '' : 's'} also observed.</small>}</section>
    <section><h3>Head stylesheets</h3><p>Stylesheets present in the live document head for the same device sample.</p>{structure.headStylesheets.length ? <ul>{structure.headStylesheets.map(stylesheet => <li key={stylesheet.url}><a href={stylesheet.url} target="_blank" rel="noreferrer">{pathFor(stylesheet.url)} ↗</a><span>{stylesheet.media || 'all media'} · {stylesheet.thirdParty ? 'external host' : 'same site'}</span></li>)}</ul> : <small>No head stylesheet URLs were observed in this DOM sample.</small>}</section>
    <section className="real-user-delivery"><h3>CDN / delivery & cache signals</h3><p>Response headers are shown as observed; RoundSEO does not infer or name a CDN vendor.</p>{structure.deliveryHosts.length ? <ul>{structure.deliveryHosts.map(host => <li key={host.hostname}><div><strong>{host.hostname}</strong><span>{host.firstParty ? 'same site' : 'external host'} · {host.requests} request{host.requests === 1 ? '' : 's'} · {formatBytes(host.transferredBytes)}</span></div><small>{host.cacheStatus.length ? `Cache status: ${host.cacheStatus.join(', ')}` : host.cacheControl.length ? `Cache-Control: ${host.cacheControl.join(', ')}` : 'No cache response header retained'}{host.age.length ? ` · Age: ${host.age.join(', ')}` : ''}</small></li>)}</ul> : <small>No response-host records were retained for this page.</small>}</section>
  </div>;
}

function RealUserRequestSequence({ device }: { device: PerformanceDeviceResult }) {
  return <details className="real-user-request-sequence"><summary>Request arrival sequence · {device.device} sample · {device.loadSequence?.length || 0} earliest responses</summary><p>Arrival order is observed from the browser network stream. It is not a dependency graph or a claim that every request blocks rendering.</p><div className="real-user-request-table"><div className="real-user-request-head"><span>#</span><span>Arrival</span><span>Resource</span><span>Response</span><span>Delivery signal</span></div>{device.loadSequence?.map((resource, index) => <div className="real-user-request-row" key={`${resource.url}-${index}`}><span>{resource.sequence ?? index + 1}</span><span>{resource.startedAtMs === undefined ? '—' : `+${resource.startedAtMs} ms`}</span><span><a href={resource.url} target="_blank" rel="noreferrer">{pathFor(resource.url)} ↗</a><small>{resource.kind}{resource.initiator ? ` · ${resource.initiator}` : ''}</small></span><span>HTTP {resource.status}<small>{resource.transferredBytes === null ? 'size unavailable' : formatBytes(resource.transferredBytes)}{resource.durationMs === undefined ? '' : ` · ${resource.durationMs} ms`}</small></span><span>{resource.cacheStatus || resource.cacheControl || resource.age ? <>{resource.cacheStatus || 'No cache status'}<small>{resource.cacheControl || (resource.age ? `Age ${resource.age}` : 'Cache-Control not retained')}</small></> : 'No cache header retained'}</span></div>)}</div></details>;
}

function browserMetricCopy(device: PerformanceDeviceResult | undefined, key: PerformanceMetric['key']): string {
  const metric = metricFor(device, key);
  return metric ? formatPerformanceMetric(metric) : '—';
}

function AssuranceRegister({ assurance }: { assurance?: AuditAssurance }) {
  const [status, setStatus] = useState('all');
  const [filter, setFilter] = useState('');
  if (!assurance) return <section className="assurance-missing">Coverage ledger unavailable for this saved audit. Run a new audit to evaluate the full control catalog.</section>;
  const visible = assurance.controls.filter(control => (status === 'all' || control.status === status) && `${control.id} ${control.name} ${control.group}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="audit-controls assurance-register" aria-label="Complete audit coverage ledger">
    <header><div><h2>SEO assurance · {assurance.verdict.replace(/_/g, ' ')}</h2><p>{assurance.version} · {assurance.controls.length} registered controls · {assurance.evaluatedInstances} evaluated / {assurance.applicableInstances} applicable instances</p><p>{assurance.controls.filter(c => c.group === "External evidence" && c.status === "unknown").length} external verification requirements pending · {assurance.controls.filter(c => c.group !== "External evidence" && c.unknown > 0).length} automated controls with evidence gaps</p></div><div><strong>{assurance.coveragePercent ?? '—'}% evidence coverage</strong><a className="assurance-export" download={`seo-assurance-${assurance.version}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(assurance, null, 2))}`}>Export evidence JSON</a></div></header>
    <div className="assurance-counts">{Object.entries(assurance.counts).map(([key, count]) => <button key={key} aria-pressed={status === key} onClick={() => setStatus(status === key ? 'all' : key)}>{key.replace(/_/g, ' ')} <strong>{count}</strong></button>)}</div>
    <div className="control-toolbar"><label htmlFor="assurance-filter">Find control</label><input id="assurance-filter" type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Control, group or rule" /><button onClick={() => { setStatus('all'); setFilter(''); }}>Reset</button><span>{visible.length} controls</span></div>
    <div className="control-table-scroll"><table className="control-table"><caption className="sr-only">Complete control catalog, results, denominators and missing evidence requirements</caption><thead><tr><th>Status</th><th>Control / requirement</th><th>Pass</th><th>Flagged</th><th>Unknown</th><th>N/A</th></tr></thead><tbody>{visible.map(control => <tr key={control.id}><td><span className={`assurance-status ${control.status}`}>{control.status.replace(/_/g, ' ')}</span></td><th scope="row"><details><summary>{control.name}</summary><p>{control.requirement}</p><p>Basis: {control.basis.replace(/_/g, ' ')} · {control.severity} · {control.group}</p><a href={control.source} target="_blank" rel="noreferrer">Reference</a>{control.evidence.map((item, index) => <p key={index}>{item.url} · {item.observed}</p>)}{control.evidenceTruncated && <p>Evidence capped at 100 examples; counts include all evaluated URLs.</p>}</details><code>{control.id}</code></th><td>{control.passed}</td><td>{control.failed}</td><td>{control.unknown}</td><td>{control.notApplicable}</td></tr>)}</tbody></table></div>
    <footer>{assurance.scope} Coverage measures evidence availability, not SEO quality. Review signals and project conventions are separated from technical failures.</footer>
  </section>;
}

function AuditControlMatrix({ result, onOpenPage }: { result: AuditResult; onOpenPage: (url: string) => void }) {
  const [severity, setSeverity] = useState('All');
  const [query, setQuery] = useState('');
  const findings = result.findings.filter(item => (severity === 'All' || item.priority === severity) && `${item.title} ${item.ruleId} ${item.evidence.map(e => e.url).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const health = result.technicalHealth;
  const failed = Math.max(0, health.evaluatedChecks - health.passedChecks);
  return <section className="audit-controls" aria-label="Audit control register">
    <header><div><h2>Observed findings</h2><p>Rules {health.ruleSetVersion} · {result.rendered ? 'Rendered DOM' : 'Response HTML'} · {result.checkedAt}</p></div><span className="control-verdict">{failed ? `${failed} failed checks` : health.evaluatedChecks ? 'Limited checks clear' : 'Not evaluated'}{health.unknownChecks > 0 ? ` · ${health.unknownChecks} unknown` : ''}</span></header>
    <div className="control-totals">
      {(['Critical', 'High', 'Medium', 'Low'] as Priority[]).map(priority => <button key={priority} className={severity === priority ? 'selected' : ''} onClick={() => setSeverity(severity === priority ? 'All' : priority)} aria-pressed={severity === priority}><span>{priority}</span><strong>{result.findings.filter(item => item.priority === priority).length}</strong><small>finding types</small></button>)}
      <div><span>Evaluated / expected</span><strong>{health.evaluatedChecks} / {health.expectedChecks}</strong><small>{health.unknownChecks} checks unknown</small></div>
    </div>
    <div className="control-toolbar"><label htmlFor="control-search">Filter evidence</label><input id="control-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rule, finding or URL" /><button onClick={() => { setSeverity('All'); setQuery(''); }}>Reset filters</button><span>{findings.length} / {result.findings.length} findings</span></div>
    <div className="control-table-scroll"><table className="control-table"><caption className="sr-only">Observed findings with severity, affected URL counts and evidence</caption><thead><tr><th scope="col">Severity</th><th scope="col">Control / rule</th><th scope="col">URLs</th><th scope="col">Confidence</th><th scope="col">Observed evidence</th></tr></thead><tbody>
      {findings.map(item => <tr key={item.id}><td><span className={`control-priority ${item.priority.toLowerCase()}`}>{item.priority}</span></td><th scope="row"><details><summary>{item.title}</summary><p>{item.rationale}</p><p>{item.evidence[0]?.recommendation}</p></details><code>{item.ruleId}</code></th><td className="control-number">{item.affectedUrlCount ?? new Set(item.evidence.map(e => e.url)).size}{item.evidenceTruncated ? '+' : ''}</td><td>{item.confidence}</td><td>{item.evidence[0] ? <><button className="control-url" onClick={() => onOpenPage(item.evidence[0].url)}>{pathFor(item.evidence[0].url)}</button><p>{item.evidence[0].observed}</p><small>{item.evidence.length} saved observations{item.evidenceTruncated ? ' · sample capped' : ''}</small></> : 'Evidence unavailable'}</td></tr>)}
      {!findings.length && <tr><td colSpan={5}>No findings match these filters. Uninspected URLs and untested controls remain unknown.</td></tr>}
    </tbody></table></div>
    <footer>Finding counts describe observed conditions. Indexing intent, Google-selected canonicals, rich-result eligibility and field performance require separate verification.</footer>
  </section>;
}

function PerformancePanel({ performance, history, pages, onRun, onShowActions, actionCount }: { performance?: PerformanceAudit; history: PerformanceAudit[]; pages: PageRecord[]; onRun: (url?: string) => Promise<void>; onShowActions: () => void; actionCount: number }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selectedUrl, setSelectedUrl] = useState(performance?.targetUrl || pages[0]?.url || '');
  const displayedPerformance = history.find(item => item.targetUrl === selectedUrl) || performance;
  const showingPreviousPage = Boolean(displayedPerformance && displayedPerformance.targetUrl !== selectedUrl);
  performance = displayedPerformance;
  const availableUrls = [...new Set([...history.map(item => item.targetUrl), ...(performance ? [performance.targetUrl] : []), ...pages.map(page => page.url)])];
  const hasMeasurements = Boolean(performance?.devices.some(device => device.availability === 'measured' || device.availability === 'partial'));
  const run = async () => {
    setRunning(true); setError('');
    try { await onRun(selectedUrl || undefined); } catch (runError) { setError(runError instanceof Error ? runError.message : 'The browser test could not be completed.'); }
    finally { setRunning(false); }
  };
  return <section className={`performance-panel ${performance?.availability === 'failed' ? 'failed' : ''}`} aria-label="Visitor performance">
    <div className="performance-panel-head">
      <div>
        <h2>Page loading: mobile and desktop</h2>
        <p>RoundSEO loads the selected page in its own browser and records timings, network requests and specific resources to review.</p>
      </div>
      <div className="performance-controls"><label>Page to test<select value={selectedUrl} onChange={event => setSelectedUrl(event.target.value)}>{availableUrls.map(url => <option value={url} key={url}>{url.replace(/^https?:\/\//, '')}</option>)}</select></label><button className="button outline" onClick={run} disabled={running || !selectedUrl}>{running ? 'Testing…' : <><Icon name="refresh" />Test selected page</>}</button></div>
    </div>
    {showingPreviousPage && <p className="performance-method">The selected page has not been tested yet. Showing the most recent result below until you run its test.</p>}
    {performance?.sourceNote && <p className="performance-method">{performance.sourceNote}</p>}
    {hasMeasurements && performance ? <>
      <div className="performance-device-grid">
        {performance.devices.map(device => <PerformanceDeviceCard key={device.device} device={device} provider={performance.provider} />)}
      </div>
      <div className="performance-context">
        <span>Target <a href={performance.targetUrl} target="_blank" rel="noreferrer">{performance.targetUrl} ↗</a></span>
        <span><EvidenceBadge kind="sampled" label="Browser test" /> {performance.providerLabel}</span>
        <span>{new Date(performance.fetchedAt).toLocaleString()}</span>
      </div>
      {actionCount > 0 && performance.targetUrl === history[0]?.targetUrl && <button className="text-action performance-action-link" onClick={onShowActions}>Review {actionCount} performance finding{actionCount === 1 ? '' : 's'} <Icon name="arrow" /></button>}
    </> : <div className="performance-empty">
      <div><strong>{performance ? availabilityCopy(performance.availability) : 'No loading measurement yet'}</strong><p>{performance?.error || 'Run the browser test to measure the selected page on mobile and desktop.'}</p></div>
      <span>Expected evidence: first byte, first paint, largest paint, layout movement, long tasks, and individual network resources when the browser can observe them.</span>
    </div>}
    {error && <p className="form-error performance-error" role="alert">{error}</p>}
  </section>;
}

function PerformanceDeviceCard({ device, provider }: { device: PerformanceDeviceResult; provider: PerformanceAudit['provider'] }) {
  const headlineMetrics = ['ttfb', 'fcp', 'lcp', 'cls', 'tbt'] as const;
  const labMetrics = headlineMetrics.map(key => metricFor(device, key)).filter((metric): metric is PerformanceMetric => Boolean(metric));
  return <article className={`performance-device ${device.device}`}>
    <header><div><span>{device.device}</span><small>{provider === 'local_browser' ? 'RoundSEO browser sample' : 'Historical PageSpeed lab'}</small></div><strong>{device.labScore === null ? labMetrics.length ? 'Measured' : availabilityCopy(device.availability) : `${device.labScore}/100`}</strong></header>
    {device.profile && <p className="device-profile">{device.profile}</p>}
    {device.availability === 'measured' || device.availability === 'partial' ? <>
      <div className="performance-metric-list">{labMetrics.map(metric => <div className={`performance-metric ${metric.rating}`} key={metric.key}><span>{metric.label}</span><strong>{formatPerformanceMetric(metric)}</strong><small>{ratingCopy(metric.rating)}</small></div>)}</div>
      <div className="field-metrics"><p>Real-user data {device.fieldDataScope === 'none' ? '' : `· ${device.fieldDataScope} level`}</p>{device.fieldMetrics.length ? <div>{device.fieldMetrics.map(metric => <span className={metric.rating} key={metric.key}>{metric.label.replace('Largest Contentful Paint', 'LCP').replace('Interaction to Next Paint', 'INP').replace('Cumulative Layout Shift', 'CLS')} {formatPerformanceMetric(metric)} · {ratingCopy(metric.rating)}</span>)}</div> : <small>Not collected by this browser test. Real-user INP and field Core Web Vitals need visitor measurements.</small>}</div>
      {device.opportunities.length > 0 && <div className="performance-opportunities"><p>What to investigate</p>{device.opportunities.map(opportunity => <details className="performance-finding" key={opportunity.key}><summary>{opportunity.title}{opportunity.evidence?.length ? ` · ${opportunity.evidence.length} example${opportunity.evidence.length === 1 ? '' : 's'}` : ` · ${formatSavings(opportunity)}`}</summary>{opportunity.evidence?.map((item, index) => <div key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noreferrer">{item.url} ↗</a><p>{item.observed} {item.recommendation}</p></div>)}</details>)}</div>}
      {device.resources?.length ? <details className="performance-resources"><summary>Largest requests · {device.requests} responses · at least {formatBytes(device.transferredBytes || 0)} recorded</summary><p>Up to 50 responses, sorted by recorded transfer size. Some resources may not report a size.</p><ul>{device.resources.map((resource, index) => <li key={`${resource.url}-${index}`}><a href={resource.url} target="_blank" rel="noreferrer">{resource.url} ↗</a><span>{resource.kind} · HTTP {resource.status} · {resource.transferredBytes === null ? 'size unavailable' : formatBytes(resource.transferredBytes)}{resource.durationMs !== undefined ? ` · ${resource.durationMs} ms` : ''}</span></li>)}</ul></details> : null}
      {device.error && <p className="device-error">{device.error}</p>}
    </> : <p className="device-error">{device.error || 'This device did not return a browser measurement.'}</p>}
  </article>;
}

function SourceResult({ source }: { source: DataSource }) {
  const label = source.key === 'ai' ? 'AI search visibility' : source.label;
  const detail = source.key === 'ai' ? 'Record sampled prompts and mentions across answer engines. Referral traffic is measured separately.' : source.detail;
  return <article className="result-cell">
    <div>
      <span>{label}</span>
      <strong>{source.value || availabilityCopy(source.availability)}</strong>
    </div>
    <p>{detail}</p>
    <small className="source-state">{source.updatedAt ? `Updated ${source.updatedAt}` : source.key === 'performance' ? 'Run a browser test to create this evidence.' : 'No source connected.'}</small>
  </article>;
}

function AnalyticsSourceResult({ analytics, retention, onOpen }: { analytics: ReturnType<typeof summarizePageAnalytics>; retention: ReturnType<typeof summarizeRetentionCohorts>; onOpen: () => void }) {
  const hasPages = analytics.pageCount > 0;
  const hasRetention = retention.cohortCount > 0;
  const headline = hasPages ? `${analytics.pageCount} page${analytics.pageCount === 1 ? '' : 's'} imported` : hasRetention ? `${retention.cohortCount} cohort${retention.cohortCount === 1 ? '' : 's'} imported` : 'Not imported';
  const detail = hasPages
    ? `${analytics.totalViews === null ? 'Views not supplied' : `${formatSourceNumber(analytics.totalViews)} page views`} · visitor metrics are imported evidence, not crawl estimates.`
    : hasRetention
      ? `Retention through day ${retention.lastMeasuredDay ?? '—'} is available from imported cohort rows.`
      : 'Import a GA4 Pages and screens or retention export; RoundSEO will keep it separate from crawl evidence.';
  return <article className="result-cell analytics-result">
    <div><span>Audience & engagement</span><strong className={hasPages || hasRetention ? '' : 'source-unavailable'}>{headline}</strong></div>
    <p>{detail}</p>
    <button className="text-action" onClick={onOpen}>{hasPages || hasRetention ? 'Open analytics' : 'Import analytics'} <Icon name="arrow" /></button>
  </article>;
}

function ActionPlan({ actions, onUpdateAction, onOpenPage }: { actions: Action[]; onUpdateAction: (id: string, update: Partial<Action>) => void; onOpenPage: (url: string) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const visible = actions.filter(action => showClosed || !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status));

  return <section className="audit-view action-plan-view">
    <div className="section-title">
      <div>
        <h2>Priority issues, ready for action.</h2>
        <p>Marking an action done never silently resolves it: it moves to verification until a comparable crawl confirms the condition changed. Every issue can also become a copy-ready AI implementation brief.</p>
      </div>
      <button className="button outline small" onClick={() => setShowClosed(value => !value)}>
        {showClosed ? 'Hide resolved' : 'Show resolved'}
      </button>
    </div>
    <div className="action-list">
      {visible.length
        ? visible.map(action => <ActionRow key={action.id} action={action} onUpdate={onUpdateAction} onOpenPage={onOpenPage} />)
        : <EmptyRow message="There are no actions in this view." />}
    </div>
  </section>;
}

function ActionRow({ action, compact = false, onUpdate, onOpenPage }: { action: Action; compact?: boolean; onUpdate: (id: string, update: Partial<Action>) => void; onOpenPage: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copyState, setCopyState] = useState('Copy prompt');
  const next = action.status === 'open' || action.status === 'planned' || action.status === 'recurring' ? { label: 'Start work', status: 'in_progress' as ActionStatus } : action.status === 'in_progress' ? { label: 'Ready for verification', status: 'awaiting_verification' as ActionStatus } : null;
  const oldNoindex = action.title === 'Indexable content is blocked from search';
  const title = oldNoindex ? 'Pages have a noindex instruction to review' : action.title;
  const priority = oldNoindex ? 'Medium' : action.priority;
  const count = action.matchCount !== undefined ? `${action.matchCount} matching pairs across ${action.affectedUrlCount} pages` : `${action.evidence.length} saved observation${action.evidence.length === 1 ? '' : 's'}`;
  const fixPrompt = buildActionFixPrompt(action);
  const copyPrompt = async () => { setCopyState(await copyText(fixPrompt) ? 'Copied' : 'Select and copy'); window.setTimeout(() => setCopyState('Copy prompt'), 1600); };
  return <article className={`action-row ${open ? 'open' : ''}`}>
    <button className="action-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open}><span className={`priority ${priority.toLowerCase()}`}>{priority}</span><span className="action-summary"><strong>{title}</strong><small>{count} · {action.effort}</small></span><StatusBadge status={action.status} /><Icon name="chevron" /></button>
    {!compact && <div className="action-inline-meta"><span>Owner <strong>{action.owner}</strong></span><span>Verification <strong>{action.status === 'awaiting_verification' ? 'Queued for next crawl' : 'Not started'}</strong></span></div>}
    {open && <div className="action-detail"><div className="action-detail-top"><div><p className="section-label">Why this matters</p><p>{oldNoindex ? 'These pages contain a noindex directive. Check their intended indexing status before making a change.' : action.outcome}</p>{action.explanation && <p>{action.explanation}</p>}</div><div><p className="section-label">Verification</p><p>{action.verification}</p></div></div>
      <div className="evidence-heading"><span>URLs and observed evidence</span><small>{action.evidenceTruncated ? `Showing ${action.evidence.length} of ${action.matchCount} matching pairs. Run a more targeted review for the remaining pairs.` : /similar/i.test(action.title) && action.matchCount === undefined ? 'This older similarity sample may be capped. Run a new audit for complete comparison counts.' : 'Open each page or resource to verify the observation.'}</small></div>
      <div className="evidence-list">{action.evidence.map((item, index) => <article className="evidence-row" key={`${item.url}-${item.element}-${index}`}><div><strong>{pathFor(item.url)}</strong><span>{item.element}</span>{item.relatedUrls?.map(related => <a className="related-url" href={related} key={related} target="_blank" rel="noreferrer">Compare: {pathFor(related)} ↗</a>)}</div><div><small>Observed</small><p>{item.observed}</p></div><div><small>Suggested change</small><p>{item.recommendation}</p></div><div className="evidence-buttons"><button className="text-action" onClick={() => onOpenPage(item.url)}>Inspect page <Icon name="arrow" /></button>{item.relatedUrls?.length && !isPerformanceRule(action.ruleId) ? <button className="text-action" onClick={() => onOpenPage(item.relatedUrls![0])}>Inspect compared page <Icon name="arrow" /></button> : null}<a className="text-action" href={item.url} target="_blank" rel="noreferrer">Open ↗</a></div></article>)}</div>
      <div className="fix-prompt-tools"><div><strong>AI fix prompt</strong><small>Turn this evidence into an implementation brief without losing the source URLs.</small></div><button className="button outline small" onClick={() => setPromptOpen(value => !value)}>{promptOpen ? 'Hide prompt' : 'Generate prompt'} <Icon name="arrow" /></button></div>
      {promptOpen && <div className="fix-prompt"><textarea readOnly value={fixPrompt} aria-label={`AI fix prompt for ${title}`} /><button className="button outline small" onClick={copyPrompt}>{copyState}</button></div>}
      {next ? <button className="button action-button" onClick={() => onUpdate(action.id, { status: next.status })}>{next.label} <Icon name="arrow" /></button> : <p className="action-state-note">{action.status === 'awaiting_verification' ? 'Awaiting a comparable crawl before this can be resolved.' : action.status === 'verified_resolved' ? 'Resolved by a comparable crawl.' : 'No further workflow action is required.'}</p>}
    </div>}
  </article>;
}

function PagesView({ pages, findings, selected, onSelect }: { pages: PageRecord[]; findings: Finding[]; selected: PageRecord | null; onSelect: (url: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = pages.filter(page => `${page.url} ${page.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const issuesFor = (url: string) => findings.filter(finding => finding.evidence.some(item => item.url === url || item.relatedUrls?.includes(url)));

  return <section className="audit-view pages-view">
    <div className="section-title">
      <div>
        <h2>Every inspected page, not only the ones with findings.</h2>
        <p>Open a page to see the stored snapshot, its links, and the exact actions connected to it.</p>
      </div>
      <label className="table-search">
        <span className="sr-only">Filter pages</span>
        <Icon name="search" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter URL or title" />
      </label>
    </div>
    {selected && <PageDetail page={selected} actions={issuesFor(selected.url)} />}
    <div className="page-table">
      <div className="page-table-head"><span>Page</span><span>Search eligibility</span><span>Observed structure</span><span>Actions</span><span /></div>
      {filtered.map(page => {
        const issues = issuesFor(page.url);
        return <button className={`page-table-row ${selected?.url === page.url ? 'selected' : ''}`} key={page.url} onClick={() => onSelect(page.url)}>
          <span><strong>{pathFor(page.url)}</strong><small>{page.title || 'No title recorded'}</small></span>
          <span><StatusPill good={page.indexable} label={page.indexable ? 'Technically eligible' : 'noindex or none'} /><small>{page.canonicalUrl ? 'Canonical recorded' : 'No canonical observed'}</small></span>
          <span><strong>{page.wordCount} words</strong><small>{page.internalLinks} internal links · {page.crawlDepth < 0 ? 'depth unknown (sitemap)' : `depth ${page.crawlDepth}`}</small></span>
          <span>{issues.length ? <strong className="issue-count">{issues.length} action{issues.length === 1 ? '' : 's'}</strong> : <small className="quiet">No grouped action</small>}</span>
          <Icon name="chevron" />
        </button>;
      })}
    </div>
    {!filtered.length && <EmptyRow message="No inspected page matches that filter." />}
  </section>;
}

function PageDetail({ page, actions }: { page: PageRecord; actions: Finding[] }) {
  return <aside className="page-detail">
    <div className="page-detail-heading">
      <div>
        <h3>{pathFor(page.url)}</h3>
        <a href={page.url} target="_blank" rel="noreferrer">{page.url} ↗</a>
      </div>
      <StatusPill good={page.statusCode >= 200 && page.statusCode < 400} label={`HTTP ${page.statusCode}`} />
    </div>
    <dl className="page-spec">
      <div><dt>Title</dt><dd>{page.title || 'Not present'}</dd></div>
      <div><dt>Description</dt><dd>{page.metaDescription || 'Not present'}</dd></div>
      <div><dt>Primary heading</dt><dd>{page.h1.join(' · ') || 'Not present'}</dd></div>
      <div><dt>Section headings</dt><dd>{page.h2?.join(' · ') || 'None recorded'}</dd></div>
      <div><dt>Subsection headings</dt><dd>{page.h3 ? page.h3.join(' · ') || 'None observed' : 'Not retained in this report'}</dd></div>
      <div><dt>Canonical</dt><dd>{page.canonicalUrl || 'Not present'}</dd></div>
      <div><dt>Robots</dt><dd>{page.robots || 'No directive observed'}</dd></div>
      <div><dt>Structured data</dt><dd>{page.structuredDataTypes.length ? page.structuredDataTypes.join(', ') : 'Not observed'}</dd></div>
      <div><dt>Content source</dt><dd>{page.requiresJavaScriptRendering ? 'Initial HTML needs browser rendering' : page.contentSource || 'Document body'}</dd></div>
      <div><dt>Content / markup</dt><dd>{page.textToHtmlRatio === undefined ? 'Not retained' : `${page.textToHtmlRatio}% visible text`}</dd></div>
      <div><dt>Images</dt><dd>{page.imageCount === undefined ? 'Not retained' : `${page.imageCount} observed · ${page.imagesWithoutAlt || 0} without alt text`}</dd></div>
      <div><dt>Link context</dt><dd>{page.internalLinks} internal · {page.externalLinks} external · {page.nonDescriptiveInternalAnchors || 0} generic anchors</dd></div>
    </dl>
    {page.contentExcerpt && <div className="page-excerpt"><p className="section-label">Extracted main-page text</p><p>{page.contentExcerpt}</p></div>}
    <div className="page-links">
      <p className="section-label">Observed links</p>
      {page.linkEvidence.length ? <ul>{page.linkEvidence.slice(0, 8).map((link, index) => <li key={`${link.target}-${index}`}>
        <strong>{link.anchorText || 'No anchor text'}</strong>
        <span>{link.isInternal ? 'Internal' : 'External'} · {link.placement} · {link.target ? pathFor(link.target) : 'Unresolved target'}{link.relAttributes ? ` · rel=${link.relAttributes}` : ''}</span>
      </li>)}</ul> : <p className="quiet">No anchor evidence was retained for this page.</p>}
    </div>
    {actions.length > 0 && <div className="page-actions">
      <p className="section-label">Related actions</p>
      {actions.map(action => <div key={action.id}><span className={`priority ${action.priority.toLowerCase()}`}>{action.priority}</span><strong>{action.title}</strong></div>)}
    </div>}
  </aside>;
}

function ChangesView({ result, onOpenAudit }: { result: AuditResult; onOpenAudit: () => void }) {
  const [filter, setFilter] = useState<'all' | 'changed' | 'newly_inspected'>('all');
  const changes = result.changes;
  const newlyInspected = changes.filter(change => change.field === 'Newly inspected');
  const snapshotChanges = changes.filter(change => change.field !== 'Newly inspected');
  const visible = filter === 'changed' ? snapshotChanges : filter === 'newly_inspected' ? newlyInspected : changes;
  const openFindings = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).length;
  return <section className="audit-view changes-view">
    <div className="section-title"><div>
      <h2>{changes.length ? 'What the next crawl found.' : 'Baseline captured. Waiting for a comparison.'}</h2>
      <p>{changes.length ? 'Rows compare saved snapshots. A newly inspected page may have existed before; wider crawl coverage does not mean it was created recently.' : 'The next comparable scan will report changes to titles, descriptions, canonical targets and robots directives on inspected pages.'}</p>
    </div></div>
    <div className="change-lens" aria-label="Crawl change summary"><div><span>Changed snapshots</span><strong>{snapshotChanges.length}</strong><p>Fields that differ from the prior saved page snapshot.</p></div><div><span>Newly inspected</span><strong>{newlyInspected.length}</strong><p>Pages now in this crawl that were not saved previously.</p></div><div><span>Current finding types</span><strong>{openFindings}</strong><p>Current conditions, not a count of new issues.</p></div></div>
    {result.issueComparison?.status === 'comparable' && <div className="issue-change-bridge"><div><strong>Finding movement on {result.issueComparison.overlappingPages} shared pages</strong><p>{result.issueComparison.newlyObserved} newly observed · {result.issueComparison.noLongerObserved} no longer observed · {result.issueComparison.stillObserved} continuing rule-page observations.</p></div><button className="text-action" onClick={onOpenAudit}>Inspect issue movement <Icon name="arrow" /></button></div>}
    {changes.length ? <><div className="change-filter" aria-label="Filter crawl changes"><button className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All comparisons <strong>{changes.length}</strong></button><button className={filter === 'changed' ? 'active' : ''} aria-pressed={filter === 'changed'} onClick={() => setFilter('changed')}>Changed fields <strong>{snapshotChanges.length}</strong></button><button className={filter === 'newly_inspected' ? 'active' : ''} aria-pressed={filter === 'newly_inspected'} onClick={() => setFilter('newly_inspected')}>Newly inspected <strong>{newlyInspected.length}</strong></button></div><div className="change-list">{visible.map(change => <article key={change.id}>
      <span>{pathFor(change.pageUrl)}</span><strong>{change.field}</strong>
      <p><del>{change.before}</del><ins>{change.after}</ins></p><small>{change.detectedAt}</small>
    </article>)}</div></> : <div className="baseline-note"><Icon name="clock" /><p>There are no invented “improvements” on a first crawl. This baseline is the reference point for the next scan.</p></div>}
  </section>;
}

function ScopeView({ result, websiteDomain }: { result: AuditResult; websiteDomain: string }) {
  const technicalDetail = `${result.technicalHealth.evaluatedChecks} applicable checks evaluated from rule set ${result.technicalHealth.ruleSetVersion}.${result.technicalHealth.unknownChecks ? ` ${result.technicalHealth.unknownChecks} checks remain unknown.` : ''}`;
  const performance = result.performance;
  const fieldData = performance?.devices.filter(device => device.fieldMetrics.length > 0) || [];
  const keywordResearch = readJson<KeywordMetric[]>(keywordResearchStorageKey(websiteDomain), []);
  const rankTracking = readJson<KeywordMetric[]>(rankTrackingStorageKey(websiteDomain), []);
  const serpAnalysis = readJson<SerpResult[]>(serpAnalysisStorageKey(websiteDomain), []);
  const competitorResearch = readJson<KeywordMetric[]>(competitorResearchStorageKey(websiteDomain), []);
  const pageAnalytics = summarizePageAnalytics(readJson<AnalyticsPageRecord[]>(pageAnalyticsStorageKey(websiteDomain), []));
  const retentionCohorts = summarizeRetentionCohorts(readJson<RetentionCohortRecord[]>(retentionCohortsStorageKey(websiteDomain), []));
  return <section className="audit-view scope-view">
    <div className="section-title"><div>
      <h2>Know the evidence before trusting the conclusion.</h2>
      <p>Measurements preserve their source, scope, freshness, and availability. A missing connection is not shown as a red zero.</p>
    </div></div>
    <div className="scope-grid">
      <section>
        <h3>This crawl</h3>
        <ScopeDefinition label="Collection method" value={result.rendered ? 'Browser-rendered DOM' : 'Public HTTP response'} detail={result.rendered ? 'Rendered DOM was used because the initial HTML needed JavaScript.' : 'Static HTML was inspected. Browser rendering is used only where it adds coverage.'} />
        <ScopeDefinition label="Coverage state" value={coverageLabel(result.crawlCoverage.availability)} detail={result.crawlCoverage.scopeNote} />
        <ScopeDefinition label="Observed checks" value={technicalHealthValue(result.technicalHealth, result.crawlCoverage)} detail={`${technicalDetail} Checks cover only HTTP responses, robots directives, canonical presence, viewport and document language.`} />
        <ScopeDefinition label="Sitemap" value={result.crawlCoverage.sitemapStatus || 'Not checked'} detail={result.crawlCoverage.sitemapStatus === 'available' ? `${result.crawlCoverage.sitemapUrls} URLs listed across ${result.crawlCoverage.sitemapFiles} sitemap files. Sitemap entries are not proof of Google indexing.` : 'Sitemap discovery may be unavailable, incomplete, or absent from an older report.'} />
      </section>
      <section>
        <h3>Performance audit</h3>
        <ScopeDefinition label="State" value={performance ? availabilityCopy(performance.availability) : 'Not measured'} detail={performance?.error || 'No browser performance test has been stored for this website yet.'} />
        <ScopeDefinition label="Target" value={performance ? pathFor(performance.targetUrl) : '—'} detail={performance ? `${performance.providerLabel} checked the declared site target at ${new Date(performance.fetchedAt).toLocaleString()}.` : 'The performance check measures the public site root unless a production workflow selects a specific template URL.'} />
        <ScopeDefinition label="Evidence" value={!performance ? 'Not measured' : performance.availability !== 'measured' && performance.availability !== 'partial' ? 'No usable result' : fieldData.length ? 'Lab + field' : 'Lab only'} detail={!performance ? 'No browser test has been stored for this website yet.' : performance.availability !== 'measured' && performance.availability !== 'partial' ? performance.error || 'The browser did not return usable timing evidence.' : fieldData.length ? `Real-user metrics were available at ${fieldData.map(device => `${device.device} ${device.fieldDataScope}`).join(', ')} scope.` : performance.sourceNote || 'A controlled test cannot measure real visitors or real-user INP.'} />
      </section>
      <section><h3>Sources & integrations</h3>{result.dataSources.filter(source => source.key !== 'performance' && source.key !== 'analytics').map(source => <ScopeDefinition key={source.key} label={source.label} value={availabilityCopy(source.availability)} detail={source.detail} />)}<ScopeDefinition label="Audience & engagement" value={pageAnalytics.pageCount || retentionCohorts.cohortCount ? 'Imported locally' : 'Not imported'} detail={pageAnalytics.pageCount || retentionCohorts.cohortCount ? `${pageAnalytics.pageCount} page rows and ${retentionCohorts.cohortCount} cohort labels are stored from pasted exports. This is not a live provider connection.` : 'Import a Pages and screens or retention export in Audience & engagement to add source-reported visitor data.'} /></section>
      <section><h3>Research imports</h3><ScopeDefinition label="Keyword research" value={keywordResearch.length ? `${keywordResearch.length} local rows` : 'Not imported'} detail={keywordResearch.length ? 'User-imported keyword metrics and target records. Values remain exactly as supplied by the source.' : 'Crawl language is available in Keyword research, but no keyword-metric export has been imported.'} /><ScopeDefinition label="Rank tracking" value={rankTracking.length ? `${rankTracking.length} local rows` : 'Not imported'} detail={rankTracking.length ? 'Dated position records used only for transparent before-and-after movement.' : 'No dated rank export is stored for this website.'} /><ScopeDefinition label="SERP analysis" value={serpAnalysis.length ? `${serpAnalysis.length} local rows` : 'Not imported'} detail={serpAnalysis.length ? 'Result rows, types, domains, and positions from the imported SERP sample.' : 'No SERP export is stored, so RoundSEO does not claim what appears in a live result page.'} /><ScopeDefinition label="Competitors" value={competitorResearch.length ? `${competitorResearch.length} local rows` : 'Not imported'} detail={competitorResearch.length ? 'Competitor position records are locally stored imports, separate from the public site crawl.' : 'No competitor keyword export is stored for this website.'} /><ScopeDefinition label="Backlinks" value="Server-side module" detail="Monitored backlinks, their checks, and Google indexing evidence are stored by the API, not as a local import — see the Backlinks and Indexing tabs." /></section>
    </div>
    <UrlReconciliation pages={result.pagesInventory} />
    {result.crawlCoverage.pendingUrls?.length ? <section className="pending-urls"><h3>Discovered URLs not attempted</h3><p>Showing {result.crawlCoverage.pendingUrls.length} of {result.crawlCoverage.remainingUrls} URLs left outside this crawl.</p><ul>{result.crawlCoverage.pendingUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url} ↗</a></li>)}</ul></section> : null}
    {result.crawlCoverage.discoveryWarnings?.map(warning => <p className="form-error" key={warning}>{warning}</p>)}
    <section className="evidence-key"><h3>Evidence labels</h3><div>
      <EvidenceBadge kind="observed" label="Observed" /><p>Directly collected from a public crawl or a page snapshot.</p>
      <EvidenceBadge kind="provider" label="Provider reported" /><p>Used for connected sources and available Chrome UX real-user measurements.</p>
      <EvidenceBadge kind="sampled" label="Sampled" /><p>Reserved for controlled tests such as lab performance or an AI prompt panel.</p>
      <EvidenceBadge kind="inferred" label="Inferred review" /><p>Used for contextual content suggestions and always paired with its evidence.</p>
    </div></section>
  </section>;
}

function UrlReconciliation({ pages }: { pages: PageRecord[] }) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string[] | null>(null);
  const parseUrls = (value: string): string[] => {
    const fields: string[] = []; let field = ''; let quoted = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === '"') { if (quoted && value[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted; }
      else if (!quoted && (char === ',' || char === '\n' || char === '\r' || char === '\t')) { fields.push(field.trim()); field = ''; }
      else field += char;
    }
    fields.push(field.trim());
    return [...new Set(fields.flatMap(value => { try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) return []; url.hash = ''; return [url.href]; } catch { return []; } }))];
  };
  const inspected = new Set(pages.map(page => { try { const url = new URL(page.url); url.hash = ''; return url.href; } catch { return page.url; } }));
  const unmatched = submitted?.filter(url => !inspected.has(url)) || [];
  return <section className="url-reconciliation"><h3>Compare an external URL list</h3><p>Paste URLs or CSV exported from Search Console or your sitemap. The comparison happens in this browser and checks exact URLs against the pages inspected in this report.</p><label>URLs or CSV<textarea rows={4} value={input} onChange={event => setInput(event.target.value)} placeholder="https://example.com/page-one&#10;https://example.com/page-two" /></label><button className="button outline small" onClick={() => setSubmitted(parseUrls(input))} disabled={!input.trim()}>Compare URLs</button>{submitted && <div className="reconciliation-result" role="status"><strong>{submitted.length} valid unique URLs · {submitted.length - unmatched.length} matched · {unmatched.length} not in the inspected snapshots</strong><p>An unmatched URL may be an alias, a redirect or outside the crawl scope. It does not automatically mean the page is missing from Google or the site.</p>{unmatched.length > 0 && <details><summary>Show up to 100 unmatched URLs</summary><ul>{unmatched.slice(0, 100).map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url} ↗</a></li>)}</ul></details>}</div>}</section>;
}

function ScopeDefinition({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="scope-definition"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>; }
function Fact({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) { return <div className={emphasis ? 'fact emphasis' : 'fact'}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function AuditRouteLink({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!active || !linkRef.current) return;
    const link = linkRef.current;
    const navigation = link.parentElement;
    if (!navigation || navigation.scrollWidth <= navigation.clientWidth) return;
    navigation.scrollTo({ left: Math.max(0, link.offsetLeft - (navigation.clientWidth - link.offsetWidth) / 2), behavior: 'auto' });
  }, [active]);
  return <a ref={linkRef} className={active ? 'active' : ''} href={href} aria-current={active ? 'page' : undefined}>{children}</a>;
}
function EmptyRow({ message }: { message: string }) { return <div className="empty-row"><Icon name="check" /><p>{message}</p></div>; }
function CoverageLine({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function StatusBadge({ status }: { status: ActionStatus }) { return <span className={`status-badge ${status}`}>{status.replace(/_/g, ' ')}</span>; }
function StatusPill({ good, label }: { good: boolean; label: string }) { return <span className={`status-pill ${good ? 'good' : 'attention'}`}>{label}</span>; }
function EvidenceBadge({ kind, label }: { kind: 'observed' | 'provider' | 'sampled' | 'inferred'; label: string }) { return <span className={`evidence-badge ${kind}`}>{label}</span>; }

/** The signed-in account's websites from the API, so Intelligence targets the same IDs the Worker stores. */
async function loadApiWebsites(token: string): Promise<{ sites: Website[]; media: WebsiteMedia[] }> {
  const headers = { Authorization: `Bearer ${token}` };
  const organizations = await fetch('/api/v2/organizations', { headers });
  if (!organizations.ok) return { sites: [], media: [] };
  const body = await organizations.json() as { organizations?: Array<{ id: string }> };
  const sites: Website[] = [];
  const media: WebsiteMedia[] = [];
  for (const organization of body.organizations ?? []) {
    const id = encodeURIComponent(organization.id);
    const [websitesResponse, mediaResponse] = await Promise.all([
      fetch(`/api/v2/organizations/${id}/websites`, { headers }),
      fetch(`/api/v2/organizations/${id}/website-media`, { headers }),
    ]);
    if (websitesResponse.ok) {
      const list = await websitesResponse.json() as { websites?: Array<{ id: string; name: string; domain: string; url: string; createdAt?: string }> };
      for (const site of list.websites ?? []) sites.push({ id: site.id, name: site.name, domain: site.domain, url: site.url, status: 'ready', created_at: site.createdAt });
    }
    if (mediaResponse.ok) {
      const list = await mediaResponse.json() as { media?: WebsiteMedia[] };
      media.push(...(list.media ?? []));
    }
  }
  return { sites, media };
}

function AuthScreen({ onComplete }: { onComplete: (user: User) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a work email address so we can create your workspace.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    const fallbackName = name.trim() || email.split('@')[0];
    setPending(true);
    setError('');
    try {
      // The account is real: signup or login issues the API token that Intelligence and other API calls use.
      const response = await fetch(mode === 'register' ? '/api/v2/auth/signup' : '/api/v2/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { email, name: fallbackName, password } : { email, password }),
      });
      const body = await response.json().catch(() => null) as { token?: string; user?: { name?: string; email?: string }; error?: string } | null;
      if (!response.ok || !body?.token) {
        setError(body?.error || (mode === 'register' ? 'RoundSEO could not create this account.' : 'That email and password did not match an account.'));
        return;
      }
      writeStoredJson('roundseo-token', body.token);
      onComplete({ name: body.user?.name || fallbackName, email: body.user?.email || email });
    } catch {
      // Without the API, the session stays in this browser, as local preview always did. Intelligence needs the API.
      onComplete({ name: fallbackName, email });
    } finally {
      setPending(false);
    }
  };

  return <main className="auth-shell">
    <section className="auth-art">
      <div className="nav-brand"><span className="logo">R</span><strong>RoundSEO</strong></div>
      <div className="art-copy"><h1>Make every crawl lead to a clear next move.</h1><p>RoundSEO keeps evidence, actions, and verification together—so you can see what changed, what matters, and what is still unknown.</p></div>
    </section>
    <section className="auth-panel"><form className="auth-card" onSubmit={submit}>
      <div className="auth-toggle"><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button></div>
      <h2>{mode === 'register' ? 'Start with a public site.' : 'Open your workspace.'}</h2>
      {mode === 'register' && <label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Alex Morgan" autoComplete="name" /></label>}
      <label>Work email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button solid full" disabled={pending}>{pending ? 'Checking…' : mode === 'register' ? 'Create workspace' : 'Sign in'} <Icon name="arrow" /></button>
      <small className="auth-note">Accounts are stored by the RoundSEO API. If the API is unreachable, this session stays in your browser and Intelligence stays unavailable.</small>
    </form></section>
  </main>;
}

function TeamManager({ onClose }: { orgId: string; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="team-availability-title"><button className="close-button" onClick={onClose} aria-label="Close team details">×</button><h2 id="team-availability-title">Team sharing needs a connected account.</h2><p>This local workspace stores audits and imports in this browser. Team invitations become available when an authenticated organization is connected.</p><button className="button outline" onClick={onClose}>Back to workspace</button></section></div>;
}

function AddSite({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: { name: string; url: string; description: string; country: string }) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const enteredUrl = url.trim();
      const normalized = /^https?:\/\//i.test(enteredUrl) ? enteredUrl : `https://${enteredUrl}`;
      const parsed = new URL(normalized);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      onSubmit({ name: parsed.hostname || url, url: normalized, description: '', country: '' });
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : 'Enter a valid domain or URL (e.g., example.com or https://example.com)');
    }
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal add-site" onSubmit={submit}>
      <button className="close-button" type="button" onClick={onClose} aria-label="Close">×</button>
      <h2>Start with a website.</h2>
      <p>Enter a domain or URL to run your first baseline audit.</p>
      <label>Domain or URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="example.com" autoFocus required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button solid full">Audit <Icon name="arrow" /></button>
    </form>
  </div>;
}

function formatPerformanceMetric(metric: PerformanceMetric): string {
  if (metric.value === null) return 'Not measured';
  if (metric.unit === 'ratio') return metric.value.toFixed(metric.value < 0.1 ? 3 : 2);
  return metric.value >= 1000 ? `${(metric.value / 1000).toFixed(metric.value >= 10_000 ? 0 : 1)} s` : `${Math.round(metric.value)} ms`;
}
function formatAnalyticsNumber(value: number | null, fractionDigits = 0): string { return value === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(value); }
function formatDuration(value: number | null): string {
  if (value === null) return '—';
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
function formatPercent(value: number | null): string { return value === null ? '—' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`; }
function ratingCopy(rating: PerformanceMetric['rating']): string { return ({ good: 'Good', needs_improvement: 'Needs work', poor: 'Poor', unknown: 'Observed sample' } as Record<PerformanceMetric['rating'], string>)[rating]; }
function formatSavings(opportunity: PerformanceOpportunity): string { if (opportunity.estimatedSavingsMs !== null) return `${Math.round(opportunity.estimatedSavingsMs)} ms`; if (opportunity.estimatedSavingsBytes !== null) return `${Math.round(opportunity.estimatedSavingsBytes / 1024)} KB`; return 'Review'; }
function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function technicalHealthValue(health: TechnicalHealth, coverage: CrawlCoverage): string { return health.value === null ? availabilityCopy(coverage.availability) : `${health.passedChecks} / ${health.evaluatedChecks}`; }
function technicalHealthNote(health: TechnicalHealth, _coverage?: CrawlCoverage): string { return health.value === null ? 'No applicable deterministic checks were evaluated.' : 'Passed limited HTTP, robots directive, canonical presence, viewport and language checks. This is not an overall SEO score.'; }
function technicalHealthLabel(health: TechnicalHealth): string { return health.value === null ? 'Checks not measured' : `${health.passedChecks} / ${health.evaluatedChecks} limited checks passed`; }
function coverageLabel(value: Availability): string { return ({ measured: 'Measured', partial: 'Partial', failed: 'Failed', stale: 'Stale', insufficient: 'Insufficient', not_measured: 'Not measured', not_connected: 'Not connected', unsupported: 'Unsupported', not_applicable: 'Not applicable' } as Record<Availability, string>)[value]; }
function availabilityCopy(value: Availability): string { return ({ measured: 'Measured', partial: 'Partial coverage', failed: 'Failed collection', stale: 'Stale', insufficient: 'Insufficient data', not_measured: 'Not measured', not_connected: 'Not connected', unsupported: 'Unsupported', not_applicable: 'Not applicable' } as Record<Availability, string>)[value]; }
function pathFor(value: string): string { try { const url = new URL(value); return `${url.pathname || '/'}${url.search}`; } catch { return value; } }

function Icon({ name }: { name: 'home' | 'plus' | 'chevron' | 'logout' | 'globe' | 'refresh' | 'arrow' | 'radar' | 'check' | 'clock' | 'search' | 'trash' }) { const paths: Record<string, string> = { home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9.5ZM9 21v-6h6v6', plus: 'M12 5v14M5 12h14', chevron: 'm8 10 4 4 4-4', logout: 'M10 17l5-5-5-5m5 5H3m9-8V3h7v18h-7v-1', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.1 2.4 3 5.4 3 9s-.9 6.6-3 9c-2.1-2.4-3-5.4-3-9s.9-6.6 3-9ZM3 12h18', refresh: 'M20 11a8 8 0 0 0-14.7-4L4 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.7 4L20 15m0 0v5m0-5h-5', arrow: 'M5 12h14m-6-6 6 6-6 6', radar: 'M12 20a8 8 0 1 0-8-8m8 8V12l6-6M4 4l16 16M12 3v2m9 7h-2M3 12h2', check: 'm5 12 4 4L19 6', clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', search: 'm20 20-4.5-4.5m2.5-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', trash: 'M5 7h14m-9 4v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14' }; return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]} /></svg>; }
