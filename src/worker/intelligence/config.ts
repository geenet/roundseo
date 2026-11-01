import type { AnswerEngine } from '../../shared/intelligence';

/** Server-only configuration. Browser input never reaches these values. */
export interface IntelligenceEnvironment {
  [key: string]: unknown;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_REFRESH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  ROUNDSEO_PERFORMANCE_RUNNER_URL?: string;
  ROUNDSEO_RUNNER_TOKEN?: string;
  INTELLIGENCE_DAILY_REQUEST_LIMIT?: string;
  INTELLIGENCE_MAX_SITE_CRAWL_PAGES?: string;
  INTELLIGENCE_ASSET_SECRET?: string;
  JWT_SECRET?: string;
  R2?: R2Bucket;
}

export interface GoogleAdsConfig {
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface IntelligenceConfig {
  googleAds: GoogleAdsConfig | null;
  runner: { url: string; token: string } | null;
  answerEngines: Partial<Record<AnswerEngine, string>>;
  dailyRequestLimit: number;
  maximumSiteCrawlPages: number;
  assetSecret: string | null;
  assetStore: R2Bucket | null;
}

export const DEFAULT_DAILY_REQUEST_LIMIT = 500;
export const DEFAULT_MAX_SITE_CRAWL_PAGES = 500;
export const HARD_MAX_SITE_CRAWL_PAGES = 2_000;

export function readIntelligenceConfig(env: IntelligenceEnvironment): IntelligenceConfig {
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const developerToken = text(env.GOOGLE_ADS_DEVELOPER_TOKEN);
  const customerId = text(env.GOOGLE_ADS_CUSTOMER_ID)?.replace(/-/g, '') || null;
  const clientId = text(env.GOOGLE_ADS_CLIENT_ID);
  const clientSecret = text(env.GOOGLE_ADS_CLIENT_SECRET);
  const refreshToken = text(env.GOOGLE_ADS_REFRESH_TOKEN);
  const runnerUrl = text(env.ROUNDSEO_PERFORMANCE_RUNNER_URL);
  const runnerToken = text(env.ROUNDSEO_RUNNER_TOKEN);
  const answerEngines: Partial<Record<AnswerEngine, string>> = {};
  for (const [engine, key] of [['claude', text(env.ANTHROPIC_API_KEY)], ['chatgpt', text(env.OPENAI_API_KEY)], ['gemini', text(env.GEMINI_API_KEY)], ['perplexity', text(env.PERPLEXITY_API_KEY)]] as const) {
    if (key) answerEngines[engine] = key;
  }
  return {
    googleAds: developerToken && customerId && clientId && clientSecret && refreshToken
      ? { developerToken, customerId, loginCustomerId: text(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)?.replace(/-/g, '') || null, clientId, clientSecret, refreshToken }
      : null,
    runner: runnerUrl && runnerToken && runnerToken.length >= 24 ? { url: runnerUrl.replace(/\/+$/, ''), token: runnerToken } : null,
    answerEngines,
    dailyRequestLimit: boundedNumber(env.INTELLIGENCE_DAILY_REQUEST_LIMIT, DEFAULT_DAILY_REQUEST_LIMIT, 1, 100_000),
    maximumSiteCrawlPages: boundedNumber(env.INTELLIGENCE_MAX_SITE_CRAWL_PAGES, DEFAULT_MAX_SITE_CRAWL_PAGES, 1, HARD_MAX_SITE_CRAWL_PAGES),
    assetSecret: text(env.INTELLIGENCE_ASSET_SECRET) || text(env.JWT_SECRET),
    assetStore: env.R2 ?? null,
  };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
