import type {
  AnswerEvidence, AnswerSentiment, AnswerVisibilityEvidence, AppEvidence, AppMarketplace,
  CompetitorEvidence, DomainRankingEvidence, EvidenceSource, MarketCategoryEvidence,
} from '../../shared/intelligence';
import { domainOf, normalizeHost } from './html';
import type { StoreApp } from './apps';

export const CTR_METHOD = 'ctr-curve-v1';
export const CATEGORY_METHOD = 'category-lexicon-v1';
export const SENTIMENT_METHOD = 'lexicon_heuristic';

/** Modeled click-through share by organic position (RoundSEO's published model). Positions beyond 10 are not modeled. */
const CTR_BY_POSITION = [0.316, 0.158, 0.11, 0.08, 0.061, 0.047, 0.037, 0.03, 0.025, 0.021];

export function clickThroughShare(position: number): number | null {
  if (!Number.isInteger(position) || position < 1 || position > CTR_BY_POSITION.length) return null;
  return CTR_BY_POSITION[position - 1];
}

/** Modeled monthly clicks for a keyword at a position. Null unless both volume and position are known. */
export function estimateClicks(searchVolume: number | null, position: number | null): number | null {
  if (searchVolume === null || position === null) return null;
  const share = clickThroughShare(position);
  return share === null ? null : Math.round(searchVolume * share);
}

export interface ObservationRow {
  query: string;
  queryKey: string;
  surface: string;
  countryCode: string;
  position: number;
  domain: string | null;
  url: string | null;
  observedAt: string;
}

function groupKey(row: ObservationRow): string {
  return `${row.surface}|${row.countryCode}|${row.queryKey}`;
}

/** The most recent observation set for each query on each surface and market. */
function latestSnapshots(rows: ObservationRow[]): Map<string, ObservationRow[]> {
  const newest = new Map<string, string>();
  for (const row of rows) {
    const current = newest.get(groupKey(row));
    if (!current || row.observedAt > current) newest.set(groupKey(row), row.observedAt);
  }
  const snapshots = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (row.observedAt !== newest.get(groupKey(row))) continue;
    const list = snapshots.get(groupKey(row)) || [];
    list.push(row);
    snapshots.set(groupKey(row), list);
  }
  return snapshots;
}

export function domainRankingsFromObservations(
  domain: string,
  rows: ObservationRow[],
  volumes: Map<string, number | null>,
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
  limit: number,
): DomainRankingEvidence[] {
  const target = normalizeHost(domain);
  const byQuery = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (row.domain !== target) continue;
    const list = byQuery.get(row.queryKey) || [];
    list.push(row);
    byQuery.set(row.queryKey, list);
  }
  return [...byQuery.entries()]
    .map(([queryKey, history]) => {
      const ordered = [...history].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
      const latest = ordered[0];
      const volume = volumes.get(queryKey) ?? null;
      return {
        kind: 'domain_ranking' as const,
        id: idFor('domain-ranking', [target, latest.surface, latest.countryCode, queryKey]),
        domain: target,
        keyword: latest.query,
        position: latest.position,
        url: latest.url,
        observedAt: latest.observedAt,
        history: ordered.slice(0, 24).map(row => ({ observedAt: row.observedAt, position: row.position })),
        searchVolume: volume,
        estimatedTraffic: estimateClicks(volume, latest.position),
        source,
      };
    })
    .sort((left, right) => (left.position ?? 999) - (right.position ?? 999) || left.keyword.localeCompare(right.keyword))
    .slice(0, limit);
}

export function competitorsFromObservations(
  domain: string,
  rows: ObservationRow[],
  volumes: Map<string, number | null>,
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
  limit: number,
): CompetitorEvidence[] {
  const target = normalizeHost(domain);
  const snapshots = latestSnapshots(rows);
  const stats = new Map<string, { shared: Set<string>; positions: number[]; observed: Set<string>; traffic: number | null }>();
  for (const snapshot of snapshots.values()) {
    const queryKey = snapshot[0].queryKey;
    const targetRow = snapshot.find(row => row.domain === target);
    for (const row of snapshot) {
      if (!row.domain || row.domain === target) continue;
      const entry = stats.get(row.domain) || { shared: new Set<string>(), positions: [], observed: new Set<string>(), traffic: null };
      entry.observed.add(queryKey);
      if (targetRow) {
        entry.shared.add(queryKey);
        entry.positions.push(row.position);
        const volume = volumes.get(queryKey) ?? null;
        const clicks = estimateClicks(volume, row.position);
        if (clicks !== null) entry.traffic = (entry.traffic ?? 0) + clicks;
      }
      stats.set(row.domain, entry);
    }
  }
  return [...stats.entries()]
    .filter(([, entry]) => entry.shared.size > 0)
    .map(([competitor, entry]) => ({
      kind: 'competitor' as const,
      id: idFor('competitor', [target, competitor]),
      domain: competitor,
      sharedKeywords: entry.shared.size,
      averagePosition: entry.positions.length ? Math.round((entry.positions.reduce((sum, value) => sum + value, 0) / entry.positions.length) * 10) / 10 : null,
      observedKeywordCount: entry.observed.size,
      estimatedTraffic: entry.traffic,
      source,
    }))
    .sort((left, right) => right.sharedKeywords - left.sharedKeywords || left.domain.localeCompare(right.domain))
    .slice(0, limit);
}

const CATEGORY_LEXICON: Array<{ code: string; label: string; terms: string[] }> = [
  { code: 'software', label: 'Software and SaaS', terms: ['software', 'saas', 'app', 'tool', 'platform', 'api', 'crm', 'plugin'] },
  { code: 'ecommerce', label: 'Retail and ecommerce', terms: ['buy', 'shop', 'price', 'cheap', 'discount', 'store', 'order', 'delivery', 'sale'] },
  { code: 'health', label: 'Health and medical', terms: ['health', 'doctor', 'clinic', 'symptom', 'medicine', 'dental', 'therapy', 'medical'] },
  { code: 'finance', label: 'Finance and insurance', terms: ['loan', 'mortgage', 'insurance', 'bank', 'credit', 'invest', 'tax', 'finance'] },
  { code: 'legal', label: 'Legal services', terms: ['lawyer', 'attorney', 'legal', 'law', 'court', 'litigation'] },
  { code: 'travel', label: 'Travel and hospitality', terms: ['hotel', 'flight', 'travel', 'vacation', 'booking', 'tour', 'resort'] },
  { code: 'education', label: 'Education and training', terms: ['course', 'learn', 'degree', 'university', 'tutorial', 'training', 'certificate'] },
  { code: 'real_estate', label: 'Real estate', terms: ['property', 'rent', 'apartment', 'house', 'realtor', 'listing'] },
  { code: 'food', label: 'Food and restaurants', terms: ['recipe', 'restaurant', 'food', 'pizza', 'menu', 'dinner'] },
  { code: 'automotive', label: 'Automotive', terms: ['car', 'vehicle', 'auto', 'dealer', 'tire', 'engine'] },
  { code: 'marketing', label: 'Marketing and SEO services', terms: ['seo', 'marketing', 'agency', 'ads', 'analytics', 'content', 'advertising'] },
];

/** Classify one keyword by lexicon hits. Ties resolve alphabetically, so the result is deterministic. */
export function classifyKeyword(keyword: string): { code: string; label: string } {
  const tokens = new Set(keyword.toLowerCase().match(/[a-z0-9]+/g) || []);
  let best: { code: string; label: string; hits: number } | null = null;
  for (const category of CATEGORY_LEXICON) {
    const hits = category.terms.filter(term => tokens.has(term)).length;
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && category.code < best.code))) {
      best = { code: category.code, label: category.label, hits };
    }
  }
  return best ? { code: best.code, label: best.label } : { code: 'uncategorized', label: 'Uncategorized' };
}

export function marketCategoriesFromObservations(
  domain: string,
  rows: ObservationRow[],
  volumes: Map<string, number | null>,
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
): MarketCategoryEvidence[] {
  const target = normalizeHost(domain);
  const latest = latestSnapshots(rows);
  const keywordsSeen = new Map<string, { query: string; position: number; queryKey: string }>();
  for (const snapshot of latest.values()) {
    for (const row of snapshot) {
      if (row.domain !== target) continue;
      if (!keywordsSeen.has(row.queryKey)) keywordsSeen.set(row.queryKey, { query: row.query, position: row.position, queryKey: row.queryKey });
    }
  }
  const total = keywordsSeen.size;
  if (total === 0) return [];
  const groups = new Map<string, { label: string; count: number; traffic: number | null }>();
  for (const keyword of keywordsSeen.values()) {
    const category = classifyKeyword(keyword.query);
    const entry = groups.get(category.code) || { label: category.label, count: 0, traffic: null };
    entry.count += 1;
    const clicks = estimateClicks(volumes.get(keyword.queryKey) ?? null, keyword.position);
    if (clicks !== null) entry.traffic = (entry.traffic ?? 0) + clicks;
    groups.set(category.code, entry);
  }
  return [...groups.entries()]
    .map(([code, entry]) => ({
      kind: 'market_category' as const,
      id: idFor('market-category', [target, code]),
      domain: target,
      category: code,
      categoryLabel: entry.label,
      observedKeywordCount: entry.count,
      share: Math.round((entry.count / total) * 1000) / 1000,
      estimatedTraffic: entry.traffic,
      source,
    }))
    .sort((left, right) => right.observedKeywordCount - left.observedKeywordCount || left.category.localeCompare(right.category));
}

/** Competitor apps from the store's ranked results for the target app's seed terms. */
export function appCompetitorsFromSearches(
  marketplace: AppMarketplace,
  targetAppId: string,
  searches: Array<{ term: string; apps: StoreApp[] }>,
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
  limit: number,
): AppEvidence[] {
  const stats = new Map<string, { title: string | null; url: string | null; shared: number; positions: number[]; observed: number }>();
  for (const search of searches) {
    const targetIndex = search.apps.findIndex(app => app.appId === targetAppId);
    for (const [index, app] of search.apps.entries()) {
      if (app.appId === targetAppId) continue;
      const entry = stats.get(app.appId) || { title: app.title, url: app.url, shared: 0, positions: [], observed: 0 };
      entry.observed += 1;
      if (targetIndex !== -1) {
        entry.shared += 1;
        entry.positions.push(index + 1);
      }
      if (!entry.title && app.title) entry.title = app.title;
      stats.set(app.appId, entry);
    }
  }
  return [...stats.entries()]
    .filter(([, entry]) => entry.shared > 0)
    .map(([appId, entry]) => ({
      kind: 'app' as const,
      id: idFor('app-competitor', [marketplace, targetAppId, appId]),
      marketplace,
      appId,
      title: entry.title,
      url: entry.url,
      keyword: null,
      position: entry.positions.length ? Math.round(entry.positions.reduce((sum, value) => sum + value, 0) / entry.positions.length) : null,
      sharedKeywords: entry.shared,
      observedKeywordCount: entry.observed,
      source,
    }))
    .sort((left, right) => (right.sharedKeywords ?? 0) - (left.sharedKeywords ?? 0) || left.appId.localeCompare(right.appId))
    .slice(0, limit);
}

/** Where a target app ranks for each seed term in the store's ordered results. */
export function appRankingsFromSearches(
  marketplace: AppMarketplace,
  targetAppId: string,
  searches: Array<{ term: string; apps: StoreApp[] }>,
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
): AppEvidence[] {
  return searches.map(search => {
    const index = search.apps.findIndex(app => app.appId === targetAppId);
    const match = index === -1 ? null : search.apps[index];
    return {
      kind: 'app' as const,
      id: idFor('app-ranking', [marketplace, targetAppId, search.term]),
      marketplace,
      appId: targetAppId,
      title: match?.title ?? null,
      url: match?.url ?? null,
      keyword: search.term,
      position: index === -1 ? null : index + 1,
      sharedKeywords: null,
      observedKeywordCount: search.apps.length,
      source,
    };
  });
}

/** Answer-engine visibility for one target domain. Sentiment is a labeled lexicon heuristic. */
export function answerVisibility(
  targetDomain: string,
  answers: AnswerEvidence[],
  source: EvidenceSource,
  idFor: (kind: string, parts: unknown[]) => string,
): AnswerVisibilityEvidence[] {
  const target = normalizeHost(targetDomain);
  return answers.map(answer => {
    const counts = new Map<string, number>();
    const add = (domain: string | null, count = 1) => {
      const normalized = domain ? normalizeHost(domain) : null;
      if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + count);
    };
    let citedTargetMentions = 0;
    for (const citation of answer.citations) {
      const domain = domainOf(citation.domain || citation.url);
      if (domain === target) citedTargetMentions += 1;
      else add(domain);
    }
    const responseText = answer.responseText || '';
    for (const match of responseText.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/gi)) {
      const domain = normalizeHost(match[1]);
      if (domain !== target) add(domain);
    }
    const targetMentions = countDomainMentions(responseText, target) + citedTargetMentions;
    if (targetMentions > 0) counts.set(target, targetMentions);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    const competitors = [...counts.entries()]
      .filter(([domain]) => domain !== target)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([domain, mentions]) => ({ domain, mentions }));
    return {
      kind: 'answer_visibility' as const,
      id: idFor('answer-visibility', [target, answer.engine, answer.prompt]),
      engine: answer.engine,
      prompt: answer.prompt,
      targetDomain: target,
      mentioned: targetMentions > 0,
      mentionCount: targetMentions,
      shareOfVoice: total ? Math.round((targetMentions / total) * 1000) / 1000 : null,
      sentiment: answerSentiment(responseText, targetMentions > 0),
      sentimentMethod: SENTIMENT_METHOD,
      competingDomains: competitors,
      source,
    };
  });
}

function countDomainMentions(value: string, domain: string): number {
  const label = domain.split('.')[0];
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const domainCount = value.match(new RegExp(`\\b${escapedDomain}\\b`, 'gi'))?.length || 0;
  if (domainCount || label.length < 4) return domainCount;
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.match(new RegExp(`\\b${escapedLabel}\\b`, 'gi'))?.length || 0;
}

export function answerSentiment(value: string, mentioned: boolean): AnswerSentiment {
  if (!mentioned || !value.trim()) return 'unknown';
  const normalized = value.toLowerCase();
  const positive = (normalized.match(/\b(?:best|excellent|leading|recommended|trusted|strong|helpful|valuable|reliable|popular)\b/g) || []).length;
  const negative = (normalized.match(/\b(?:poor|bad|weak|unreliable|avoid|limited|problem|risk|expensive|worse)\b/g) || []).length;
  if (positive && negative) return 'mixed';
  if (positive) return 'positive';
  if (negative) return 'negative';
  return 'neutral';
}
