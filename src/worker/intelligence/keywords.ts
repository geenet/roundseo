import { IntelligenceError } from './errors';
import { fetchProviderJson, type IntelligenceFetch } from './http';
import type { GoogleAdsConfig } from './config';

export const KEYWORD_METRICS_METHOD = 'google-ads-keyword-plan-v1';
export const GOOGLE_ADS_API_VERSION = 'v20';
const GOOGLE_ADS_HOST = 'googleads.googleapis.com';
const GOOGLE_OAUTH_HOST = 'oauth2.googleapis.com';
const MAX_KEYWORDS_PER_CALL = 100;

/** Google Ads geo target constant IDs for supported market countries. */
const GEO_TARGETS: Record<string, number> = {
  US: 2840, CA: 2124, GB: 2826, AU: 2036, NZ: 2554, IE: 2372, DE: 2276, FR: 2250, ES: 2724, IT: 2380,
  NL: 2528, PL: 2616, SE: 2752, BR: 2076, MX: 2484, IN: 2356, JP: 2392, SG: 2702,
};

/** Google Ads language criterion IDs for supported languages. */
const LANGUAGE_CRITERIA: Record<string, number> = {
  en: 1000, de: 1001, fr: 1002, es: 1003, it: 1004, ja: 1005, nl: 1010, pt: 1014, pl: 1030,
};

export interface KeywordMetricRecord {
  keyword: string;
  searchVolume: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
  competition: number | null;
  monthlySeries: Array<{ date: string; value: number | null }>;
  observedAt: string;
}

export type KeywordIdeaRecord = KeywordMetricRecord;

export interface KeywordMarket {
  countryCode: string;
  languageCode: string;
}

/** Resolve the Google Ads geo and language criteria, or refuse the market clearly. */
export function googleAdsMarket(market: KeywordMarket): { geo: string; language: string } {
  const country = market.countryCode.toUpperCase();
  const language = market.languageCode.toLowerCase().split('-')[0];
  const geo = GEO_TARGETS[country];
  const criterion = LANGUAGE_CRITERIA[language];
  if (!geo) throw new IntelligenceError(`Keyword metrics are not available for the country code ${country} yet.`, { status: 400, code: 'UNSUPPORTED_MARKET' });
  if (!criterion) throw new IntelligenceError(`Keyword metrics are not available for the language code ${language} yet.`, { status: 400, code: 'UNSUPPORTED_MARKET' });
  return { geo: `geoTargetConstants/${geo}`, language: `languages/${criterion}` };
}

export function isKeywordMarketSupported(market: KeywordMarket): boolean {
  try { googleAdsMarket(market); return true; } catch { return false; }
}

/** Historical monthly search volume, CPC range, and competition for exact keywords. */
export async function fetchKeywordMetrics(
  keywords: string[],
  market: KeywordMarket,
  config: GoogleAdsConfig,
  options: { fetcher?: IntelligenceFetch; now?: () => Date } = {},
): Promise<KeywordMetricRecord[]> {
  const { geo, language } = googleAdsMarket(market);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const accessToken = await googleAdsAccessToken(config, options.fetcher);
  const records: KeywordMetricRecord[] = [];
  for (const batch of chunk(unique(keywords), MAX_KEYWORDS_PER_CALL)) {
    const body = await googleAdsPost(config, accessToken, 'generateKeywordHistoricalMetrics', {
      keywords: batch,
      language,
      geoTargetConstants: [geo],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
    }, options.fetcher);
    for (const item of arrayOf(body.results)) {
      const metrics = recordOf(item.keywordMetrics);
      records.push(toRecord(stringOf(item.text) || '', metrics, observedAt));
    }
  }
  return records;
}

/** Related keyword ideas for seed terms, with the same metrics as fetchKeywordMetrics. */
export async function fetchKeywordIdeas(
  seeds: string[],
  market: KeywordMarket,
  limit: number,
  config: GoogleAdsConfig,
  options: { fetcher?: IntelligenceFetch; now?: () => Date } = {},
): Promise<KeywordIdeaRecord[]> {
  const { geo, language } = googleAdsMarket(market);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const accessToken = await googleAdsAccessToken(config, options.fetcher);
  const body = await googleAdsPost(config, accessToken, 'generateKeywordIdeas', {
    keywordSeed: { keywords: unique(seeds).slice(0, 20) },
    language,
    geoTargetConstants: [geo],
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    includeAdultKeywords: false,
    pageSize: Math.min(1000, Math.max(1, limit)),
  }, options.fetcher);
  return arrayOf(body.results).slice(0, limit).map(item => toRecord(stringOf(item.text) || '', recordOf(item.keywordIdeaMetrics), observedAt));
}

export async function googleAdsAccessToken(config: GoogleAdsConfig, fetcher?: IntelligenceFetch): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });
  const response = await fetchProviderJson(`https://${GOOGLE_OAUTH_HOST}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  }, { fetcher, allowedHosts: [GOOGLE_OAUTH_HOST] });
  const token = stringOf(recordOf(response.body).access_token);
  if (response.status !== 200 || !token) throw new IntelligenceError('The keyword-metrics source rejected its credentials.', { status: 502, code: 'SEARCH_METRICS_AUTH_FAILED' });
  return token;
}

async function googleAdsPost(
  config: GoogleAdsConfig,
  accessToken: string,
  method: 'generateKeywordHistoricalMetrics' | 'generateKeywordIdeas',
  body: Record<string, unknown>,
  fetcher?: IntelligenceFetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId;
  const response = await fetchProviderJson(
    `https://${GOOGLE_ADS_HOST}/${GOOGLE_ADS_API_VERSION}/customers/${config.customerId}:${method}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    { fetcher, allowedHosts: [GOOGLE_ADS_HOST] },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new IntelligenceError('The keyword-metrics source did not return metrics for this request.', { status: 502, code: 'SEARCH_METRICS_UNAVAILABLE' });
  }
  return recordOf(response.body);
}

function toRecord(keyword: string, metrics: Record<string, unknown>, observedAt: string): KeywordMetricRecord {
  const volume = numberOf(metrics.avgMonthlySearches);
  const series = arrayOf(metrics.monthlySearchVolumes).flatMap(item => {
    const year = numberOf(item.year);
    const month = monthNumber(item.month);
    if (year === null || month === null) return [];
    return [{ date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`, value: numberOf(item.monthlySearches) }];
  });
  return {
    keyword,
    searchVolume: volume === null ? null : Math.round(volume),
    cpcLow: microsToUsd(metrics.lowTopOfPageBidMicros),
    cpcHigh: microsToUsd(metrics.highTopOfPageBidMicros),
    competition: numberOf(metrics.competitionIndex),
    monthlySeries: series,
    observedAt,
  };
}

/** Google Ads returns month as an enum name (JANUARY…DECEMBER) or a number. */
function monthNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) return value;
  const names = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const index = typeof value === 'string' ? names.indexOf(value.toUpperCase()) : -1;
  return index === -1 ? null : index + 1;
}

function microsToUsd(value: unknown): number | null {
  const micros = numberOf(value);
  return micros === null ? null : Math.round((micros / 1_000_000) * 100) / 100;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function chunk<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}
