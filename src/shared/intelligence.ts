/**
 * RoundSEO's native search intelligence contract.
 *
 * Every value here is produced by RoundSEO's own collectors, stored
 * observations, or deterministic analysis. A metric that no configured source
 * can supply is returned as `null` and listed in `unavailable`; it is never
 * estimated silently.
 */
export type IntelligenceCapability = 'keyword_research' | 'market_intelligence' | 'app_intelligence' | 'serp_analysis' | 'answer_engine_visibility' | 'page_intelligence';
export type IntelligenceRunStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'cancelled';
export type SearchDevice = 'desktop' | 'mobile';
export type BrowserProfile = SearchDevice | 'tablet';
export type SearchSurface = 'google' | 'google_maps' | 'google_ai' | 'bing' | 'youtube';
export type AnswerEngine = 'chatgpt' | 'gemini' | 'claude' | 'perplexity';
export type AppMarketplace = 'google_play' | 'apple_app_store';
export type KeywordMetricsSource = 'google' | 'bing';

type LocatedRun = { countryCode: string; languageCode: string };

export type IntelligenceRunRequest =
  | (LocatedRun & { action: 'keyword_discovery'; seeds: string[]; limit?: number })
  | (LocatedRun & { action: 'keyword_overview'; keywords: string[] })
  | { action: 'domain_rankings'; domain: string; countryCode: string; limit?: number }
  | { action: 'domain_competitors'; domain: string; countryCode: string; limit?: number }
  | { action: 'market_categories'; domain: string; countryCode: string; limit?: number }
  | { action: 'app_competitors'; marketplace: AppMarketplace; appId: string; countryCode: string; limit?: number }
  | { action: 'app_rankings'; marketplace: AppMarketplace; appId: string; countryCode: string; keywords: string[]; limit?: number }
  | (LocatedRun & { action: 'keyword_metrics'; source: KeywordMetricsSource; keywords: string[] })
  | (LocatedRun & { action: 'keyword_trends'; keywords: string[] })
  | (LocatedRun & { action: 'serp_snapshot'; surface: SearchSurface; query: string; device?: SearchDevice; resultLimit?: number; targetDomain?: string })
  | { action: 'answer_response'; engine: AnswerEngine; prompt: string; model: string; targetDomain?: string; maximumOutputTokens?: number; useWeb?: boolean; systemInstruction?: string }
  | { action: 'answer_snapshot'; engine: AnswerEngine; prompt: string; targetDomain?: string; maximumOutputTokens?: number }
  | { action: 'answer_demand'; keywords: string[] }
  | { action: 'page_inspection'; url: string; browserProfile?: BrowserProfile; renderJavascript?: boolean }
  | { action: 'content_extraction'; url: string; renderJavascript?: boolean }
  | { action: 'page_screenshot'; url: string; browserProfile?: BrowserProfile; fullPage?: boolean }
  | { action: 'site_crawl'; domain: string; maximumPages: number; startUrl?: string; extractContent?: boolean };

export type IntelligenceAction = IntelligenceRunRequest['action'] | 'site_crawl_refresh';
export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'other';
export type SerpFeature = 'organic' | 'paid' | 'local' | 'video' | 'news' | 'shopping' | 'ai_overview' | 'featured_snippet' | 'people_also_ask' | 'related_searches' | 'knowledge_graph' | 'map' | 'youtube_channel' | 'youtube_playlist' | 'other';

export type EvidenceOrigin =
  | 'search_results_page'
  | 'search_metrics_api'
  | 'app_store_api'
  | 'app_store_page'
  | 'answer_engine_api'
  | 'fetched_page'
  | 'stored_observations'
  | 'derived_estimate';

/** Where a record came from, when it was observed, and what it cannot show. */
export interface EvidenceSource {
  origin: EvidenceOrigin;
  /** Human-readable source label shown beside the record. */
  label: string;
  /** Stable collector or analysis method version, for reproducibility. */
  method: string;
  observedAt: string;
  limitations: string[];
}

export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export interface KeywordEvidence {
  kind: 'keyword'; id: string; keyword: string;
  searchVolume: number | null; cpcLow: number | null; cpcHigh: number | null; competition: number | null;
  intent: KeywordIntent | null;
  source: EvidenceSource;
}
export interface KeywordTrendEvidence {
  kind: 'keyword_trend'; id: string; keyword: string;
  points: Array<{ date: string; value: number | null }>;
  source: EvidenceSource;
}
export interface DomainRankingEvidence {
  kind: 'domain_ranking'; id: string; domain: string; keyword: string;
  position: number | null; url: string | null; observedAt: string;
  history: Array<{ observedAt: string; position: number | null }>;
  searchVolume: number | null; estimatedTraffic: number | null;
  source: EvidenceSource;
}
export interface CompetitorEvidence {
  kind: 'competitor'; id: string; domain: string;
  sharedKeywords: number; averagePosition: number | null;
  observedKeywordCount: number; estimatedTraffic: number | null;
  source: EvidenceSource;
}
export interface SerpEvidence {
  kind: 'serp_result'; id: string; query: string; surface: SearchSurface; position: number; feature: SerpFeature;
  title: string | null; url: string | null; domain: string | null; description: string | null;
  source: EvidenceSource;
}
export interface SerpCoverage {
  surface: SearchSurface; query: string;
  status: 'complete' | 'partial' | 'blocked' | 'unparsed';
  resultsRequested: number; resultsParsed: number;
  featuresDetected: SerpFeature[];
  reason: string | null;
}
export interface CitationEvidence { url: string; domain: string | null; title: string | null }
export interface AnswerEvidence {
  kind: 'answer'; id: string; engine: AnswerEngine; model: string; prompt: string; responseText: string | null;
  webSearchUsed: boolean; citations: CitationEvidence[]; source: EvidenceSource;
}
export type AnswerSentiment = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown';
export interface AnswerVisibilityEvidence {
  kind: 'answer_visibility'; id: string; engine: AnswerEngine; prompt: string; targetDomain: string;
  mentioned: boolean; mentionCount: number; shareOfVoice: number | null; sentiment: AnswerSentiment;
  /** Sentiment is a keyword heuristic, not a measured opinion score. */
  sentimentMethod: 'lexicon_heuristic';
  competingDomains: Array<{ domain: string; mentions: number }>;
  source: EvidenceSource;
}
export interface MarketCategoryEvidence {
  kind: 'market_category'; id: string; domain: string; category: string; categoryLabel: string;
  observedKeywordCount: number; share: number | null; estimatedTraffic: number | null;
  source: EvidenceSource;
}
export interface AppEvidence {
  kind: 'app'; id: string; marketplace: AppMarketplace; appId: string; title: string | null; url: string | null;
  keyword: string | null; position: number | null; sharedKeywords: number | null; observedKeywordCount: number | null;
  source: EvidenceSource;
}
export interface PageIssueEvidence {
  code: string;
  category: 'indexability' | 'metadata' | 'content' | 'structure' | 'links' | 'rendering';
  severity: 'high' | 'medium' | 'low';
  message: string;
  value: string | number | boolean | null;
}
export interface PageEvidence {
  kind: 'page'; id: string; url: string; statusCode: number | null; title: string | null; description: string | null;
  canonicalUrl: string | null; robots: string | null; wordCount: number | null;
  headings: string[];
  contentMarkdown: string | null;
  renderingMode: 'html' | 'rendered';
  screenshotUrl: string | null;
  issues: PageIssueEvidence[];
  source: EvidenceSource;
}
export type IntelligenceEvidence =
  | KeywordEvidence | KeywordTrendEvidence | DomainRankingEvidence | CompetitorEvidence | SerpEvidence
  | AnswerEvidence | AnswerVisibilityEvidence | MarketCategoryEvidence | AppEvidence | PageEvidence;

export interface IntelligenceRunSummary {
  evidenceCount: number; keywordCount: number; resultCount: number; citationCount: number;
  pagesCrawled: number | null; pagesQueued: number | null; unavailableMetricCount: number;
}
export interface IntelligenceRunProgress {
  completed: number;
  total: number | null;
  /** Non-null once the job is queued; the UI polls the run while it is queued or running. */
  updatedAt: string;
}
export interface IntelligenceRun {
  id: string; capability: IntelligenceCapability; action: IntelligenceAction; status: IntelligenceRunStatus;
  statusMessage: string; requestedAt: string; startedAt: string | null; completedAt: string | null;
  request: IntelligenceRunRequest | null;
  source: EvidenceSource;
  progress: IntelligenceRunProgress;
  coverage: SerpCoverage | null;
  unavailable: UnavailableMetric[];
  error: { code: string; message: string } | null;
  summary: IntelligenceRunSummary;
  evidence: IntelligenceEvidence[];
}
export interface IntelligenceActionStatus {
  action: IntelligenceAction;
  capability: IntelligenceCapability;
  available: boolean;
  /** Why the action is unavailable, or the limitation that applies when it is available. */
  reason: string | null;
  sources: string[];
}
export interface IntelligenceCapabilityStatus {
  available: boolean;
  capabilities: IntelligenceCapability[];
  actions: IntelligenceActionStatus[];
  safeguards: { maximumSiteCrawlPages: number; maximumLiveRequestsPerDay: number };
}
