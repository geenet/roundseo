/**
 * Source-bound search intelligence helpers.
 *
 * These utilities intentionally analyse only supplied records. They do not
 * estimate volume, traffic, authority, rankings, or CPC when a source did
 * not provide it. The UI can therefore keep crawl observations, imports, and
 * missing data visibly separate.
 */

export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'other';
export type SerpResultType =
  | 'organic'
  | 'paid'
  | 'local'
  | 'video'
  | 'news'
  | 'shopping'
  | 'ai_overview'
  | 'featured_snippet'
  | 'people_also_ask'
  | 'related_searches'
  | 'knowledge_graph'
  | 'map'
  | 'youtube_channel'
  | 'youtube_playlist'
  | 'other';
export type LinkAttribute = 'follow' | 'nofollow' | 'unknown';

export type KeywordMetric = {
  id: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: KeywordIntent | null;
  position: number | null;
  domain: string | null;
  landingPage: string | null;
  checkedAt: string | null;
  source: string | null;
};

export type SerpResult = {
  id: string;
  keyword: string;
  position: number;
  url: string | null;
  domain: string;
  title: string | null;
  resultType: SerpResultType;
  checkedAt: string | null;
  source: string | null;
};

export type BacklinkRecord = {
  id: string;
  referringPage: string | null;
  referringDomain: string;
  targetPage: string | null;
  anchorText: string | null;
  linkAttribute: LinkAttribute;
  firstSeen: string | null;
  source: string | null;
};

export type ImportParseResult<T> = { items: T[]; errors: string[] };

export type KeywordCluster = {
  id: string;
  label: string;
  keywords: KeywordMetric[];
  keywordCount: number;
  totalVolume: number | null;
  knownVolumeKeywords: number;
  averageDifficulty: number | null;
  knownDifficultyKeywords: number;
  intents: KeywordIntent[];
};

export type KeywordIdeas = {
  matching: KeywordMetric[];
  questions: KeywordMetric[];
  sharedWords: KeywordMetric[];
};

export type RankMovement = {
  keyword: string;
  currentPosition: number;
  previousPosition: number | null;
  change: number | null;
  direction: 'improved' | 'declined' | 'unchanged' | 'new';
  checkedAt: string;
  previousCheckedAt: string | null;
  volume: number | null;
  landingPage: string | null;
};

export type RankTrackingSummary = {
  measuredKeywords: number;
  improved: number;
  declined: number;
  unchanged: number;
  new: number;
  movers: RankMovement[];
};

export type SerpDomainSummary = {
  domain: string;
  resultCount: number;
  organicCount: number;
  paidCount: number;
  bestPosition: number;
};

export type SerpSummary = {
  queryCount: number;
  resultCount: number;
  paidResultCount: number;
  resultTypes: Array<{ type: SerpResultType; count: number }>;
  domains: SerpDomainSummary[];
};

export type CompetitorKeywordGap = {
  keyword: string;
  competitorDomain: string;
  competitorPosition: number;
  ourPosition: number | null;
  positionGap: number | null;
  status: 'competitor_ahead' | 'we_lead' | 'tie' | 'not_in_imported_site_rows';
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
};

export type PpcSeoOpportunity = {
  keyword: string;
  position: number | null;
  volume: number | null;
  cpc: number;
  difficulty: number | null;
  intent: KeywordIntent | null;
  paidResultCount: number | null;
  recommendation: 'protect_organic' | 'bridge_to_organic' | 'complete_rank_data';
};

type DelimitedTable = { headers: string[]; rows: string[][] };

const STOP_WORDS = new Set('a an and are as at be by for from how in is it of on or the to what when where which with'.split(' '));
const HEADER_ALIASES = {
  keyword: ['keyword', 'keywords', 'query', 'search_term', 'term'],
  volume: ['volume', 'search_volume', 'monthly_volume', 'searches'],
  difficulty: ['difficulty', 'keyword_difficulty', 'seo_difficulty', 'kd', 'sd'],
  cpc: ['cpc', 'cost_per_click', 'avg_cpc', 'cost_per_click_usd'],
  intent: ['intent', 'search_intent'],
  position: ['position', 'rank', 'organic_position', 'current_position', 'google_position'],
  domain: ['domain', 'website', 'site', 'competitor', 'competitor_domain'],
  landingPage: ['url', 'landing_page', 'landing_url', 'target_url', 'page'],
  checkedAt: ['checked_at', 'date', 'snapshot_date', 'updated_at', 'last_updated'],
  source: ['source', 'provider', 'data_source'],
  referringPage: ['referring_page', 'source_url', 'referrer_url', 'backlink_url', 'referring_url'],
  referringDomain: ['referring_domain', 'source_domain', 'referrer_domain'],
  targetPage: ['target_page', 'destination_url', 'target_url', 'landing_page'],
  anchorText: ['anchor_text', 'anchor', 'link_text'],
  linkAttribute: ['rel', 'link_attribute', 'follow_status'],
  firstSeen: ['first_seen', 'discovered_at', 'first_found'],
  resultType: ['result_type', 'type', 'serp_type'],
  title: ['title', 'result_title'],
} as const;

function normaliseHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function stableId(prefix: string, values: Array<string | number | null | undefined>): string {
  const source = values.map(value => String(value ?? '')).join('|');
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function countOutsideQuotes(value: string, character: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      if (quoted && value[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && current === character) count += 1;
  }
  return count;
}

function delimiterFor(value: string): string {
  const firstLine = value.split(/\r?\n/).find(line => line.trim()) || '';
  const candidates = [',', '\t', ';'];
  return candidates.sort((left, right) => countOutsideQuotes(firstLine, right) - countOutsideQuotes(firstLine, left))[0];
}

function parseRows(value: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && current === delimiter) {
      row.push(field.trim());
      field = '';
      continue;
    }
    if (!quoted && (current === '\n' || current === '\r')) {
      if (current === '\r' && value[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += current;
  }
  row.push(field.trim());
  if (row.some(cell => cell.length > 0)) rows.push(row);
  return rows;
}

function parseDelimitedTable(value: string): DelimitedTable {
  const lines = value.split(/\r?\n/);
  while (lines.length && (!lines[0].trim() || lines[0].trimStart().startsWith('#'))) lines.shift();
  const content = lines.join('\n');
  const rows = parseRows(content, delimiterFor(content));
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

function headerIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex(header => aliases.includes(normaliseHeader(header)));
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] || '').trim() : '';
}

function toNumber(value: string): number | null {
  const source = value.trim().replace(/[$€£\s,]/g, '');
  if (!source) return null;
  const match = source.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'b' ? 1_000_000_000 : 1;
  return amount * multiplier;
}

function dateValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeDomain(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeKeyword(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function keywordTokens(value: string): string[] {
  return [...new Set((normalizeKeyword(value).match(/[\p{L}\p{N}]+/gu) || []).map(token => token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token).filter(token => token.length > 1 && !STOP_WORDS.has(token)))];
}

function normalizeIntent(value: string): KeywordIntent | null {
  const source = value.trim().toLowerCase();
  if (!source) return null;
  if (source.includes('inform')) return 'informational';
  if (source.includes('commercial') || source.includes('investig')) return 'commercial';
  if (source.includes('transaction') || source.includes('purchase') || source.includes('buy')) return 'transactional';
  if (source.includes('navig')) return 'navigational';
  return 'other';
}

function numericField(raw: string, label: string, rowNumber: number, errors: string[], allowed: (value: number) => boolean): number | null {
  if (!raw) return null;
  const value = toNumber(raw);
  if (value === null || !allowed(value)) {
    errors.push(`Row ${rowNumber}: ${label} must be a valid number.`);
    return null;
  }
  return value;
}

function keywordHeaderIndices(headers: string[]) {
  return {
    keyword: headerIndex(headers, HEADER_ALIASES.keyword),
    volume: headerIndex(headers, HEADER_ALIASES.volume),
    difficulty: headerIndex(headers, HEADER_ALIASES.difficulty),
    cpc: headerIndex(headers, HEADER_ALIASES.cpc),
    intent: headerIndex(headers, HEADER_ALIASES.intent),
    position: headerIndex(headers, HEADER_ALIASES.position),
    domain: headerIndex(headers, HEADER_ALIASES.domain),
    landingPage: headerIndex(headers, HEADER_ALIASES.landingPage),
    checkedAt: headerIndex(headers, HEADER_ALIASES.checkedAt),
    source: headerIndex(headers, HEADER_ALIASES.source),
  };
}

export function parseKeywordMetrics(value: string, options: { defaultDomain?: string; sourceLabel?: string } = {}): ImportParseResult<KeywordMetric> {
  const table = parseDelimitedTable(value);
  if (!table.headers.length) return { items: [], errors: ['No rows were found in this import.'] };
  const indices = keywordHeaderIndices(table.headers);
  if (indices.keyword < 0) return { items: [], errors: ['Expected a keyword, query, or search term column in the first row.'] };
  const errors: string[] = [];
  const items: KeywordMetric[] = [];
  const defaultDomain = normalizeDomain(options.defaultDomain);
  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2;
    const keyword = valueAt(row, indices.keyword);
    if (!keyword) {
      errors.push(`Row ${rowNumber}: keyword is required.`);
      continue;
    }
    const rawDate = valueAt(row, indices.checkedAt);
    const checkedAt = dateValue(rawDate);
    if (rawDate && !checkedAt) errors.push(`Row ${rowNumber}: date could not be read.`);
    const rawDomain = valueAt(row, indices.domain);
    const domain = rawDomain ? normalizeDomain(rawDomain) : defaultDomain;
    if (rawDomain && !domain) errors.push(`Row ${rowNumber}: domain could not be read.`);
    const rawLandingPage = valueAt(row, indices.landingPage);
    const landingPage = rawLandingPage ? normalizeUrl(rawLandingPage) : null;
    if (rawLandingPage && !landingPage) errors.push(`Row ${rowNumber}: landing page must be an http(s) URL.`);
    const volume = numericField(valueAt(row, indices.volume), 'volume', rowNumber, errors, number => number >= 0);
    const difficulty = numericField(valueAt(row, indices.difficulty), 'difficulty', rowNumber, errors, number => number >= 0 && number <= 100);
    const cpc = numericField(valueAt(row, indices.cpc), 'CPC', rowNumber, errors, number => number >= 0);
    const position = numericField(valueAt(row, indices.position), 'position', rowNumber, errors, number => number > 0);
    const source = valueAt(row, indices.source) || options.sourceLabel || null;
    items.push({
      id: stableId('keyword', [normalizeKeyword(keyword), domain, checkedAt, source]),
      keyword: keyword.trim(),
      volume,
      difficulty,
      cpc,
      intent: normalizeIntent(valueAt(row, indices.intent)),
      position,
      domain,
      landingPage,
      checkedAt,
      source,
    });
  }
  return { items, errors };
}

function normalizeSerpType(value: string): SerpResultType {
  const source = value.trim().toLowerCase();
  if (source.includes('ai_overview') || source.includes('ai overview')) return 'ai_overview';
  if (source.includes('featured_snippet') || source.includes('featured snippet')) return 'featured_snippet';
  if (source.includes('people_also_ask') || source.includes('people also ask')) return 'people_also_ask';
  if (source.includes('related_search') || source.includes('related search')) return 'related_searches';
  if (source.includes('knowledge_graph') || source.includes('knowledge graph')) return 'knowledge_graph';
  if (source.includes('youtube_channel')) return 'youtube_channel';
  if (source.includes('youtube_playlist')) return 'youtube_playlist';
  if (source.includes('organic')) return 'organic';
  if (source.includes('paid') || source.includes('ad')) return 'paid';
  if (source === 'map' || source.includes('maps')) return 'map';
  if (source.includes('local')) return 'local';
  if (source.includes('video')) return 'video';
  if (source.includes('news')) return 'news';
  if (source.includes('shop')) return 'shopping';
  return 'other';
}

export function parseSerpResults(value: string, options: { sourceLabel?: string } = {}): ImportParseResult<SerpResult> {
  const table = parseDelimitedTable(value);
  if (!table.headers.length) return { items: [], errors: ['No rows were found in this import.'] };
  const indices = keywordHeaderIndices(table.headers);
  const titleIndex = headerIndex(table.headers, HEADER_ALIASES.title);
  const resultTypeIndex = headerIndex(table.headers, HEADER_ALIASES.resultType);
  if (indices.keyword < 0 || indices.position < 0 || (indices.landingPage < 0 && indices.domain < 0)) {
    return { items: [], errors: ['Expected keyword, position, and either URL or domain columns in the first row.'] };
  }
  const errors: string[] = [];
  const items: SerpResult[] = [];
  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2;
    const keyword = valueAt(row, indices.keyword);
    const position = numericField(valueAt(row, indices.position), 'position', rowNumber, errors, number => number > 0);
    const rawUrl = valueAt(row, indices.landingPage);
    const url = rawUrl ? normalizeUrl(rawUrl) : null;
    const rawDomain = valueAt(row, indices.domain);
    const domain = rawDomain ? normalizeDomain(rawDomain) : normalizeDomain(url);
    if (!keyword || position === null || !domain) {
      if (!keyword) errors.push(`Row ${rowNumber}: keyword is required.`);
      if (!domain) errors.push(`Row ${rowNumber}: result domain could not be read.`);
      continue;
    }
    if (rawUrl && !url) errors.push(`Row ${rowNumber}: URL must be an http(s) URL.`);
    const rawDate = valueAt(row, indices.checkedAt);
    const checkedAt = dateValue(rawDate);
    if (rawDate && !checkedAt) errors.push(`Row ${rowNumber}: date could not be read.`);
    const source = valueAt(row, indices.source) || options.sourceLabel || null;
    items.push({
      id: stableId('serp', [normalizeKeyword(keyword), position, domain, normalizeSerpType(valueAt(row, resultTypeIndex)), checkedAt, source]),
      keyword: keyword.trim(),
      position,
      url,
      domain,
      title: valueAt(row, titleIndex) || null,
      resultType: normalizeSerpType(valueAt(row, resultTypeIndex)),
      checkedAt,
      source,
    });
  }
  return { items, errors };
}

function linkAttribute(value: string): LinkAttribute {
  const source = value.trim().toLowerCase();
  if (!source) return 'unknown';
  if (source.includes('nofollow') || source.includes('no follow')) return 'nofollow';
  if (source.includes('follow')) return 'follow';
  return 'unknown';
}

export function parseBacklinkRecords(value: string, options: { sourceLabel?: string } = {}): ImportParseResult<BacklinkRecord> {
  const table = parseDelimitedTable(value);
  if (!table.headers.length) return { items: [], errors: ['No rows were found in this import.'] };
  const headerLooksKnown = Object.values(HEADER_ALIASES).flat().some(alias => table.headers.some(header => normaliseHeader(header) === alias));
  const headers = headerLooksKnown ? table.headers : ['referring_page', 'target_page', 'anchor_text', 'rel', 'first_seen', 'source'];
  const rows = headerLooksKnown ? table.rows : [table.headers, ...table.rows];
  const indices = {
    referringPage: headerIndex(headers, HEADER_ALIASES.referringPage),
    referringDomain: headerIndex(headers, HEADER_ALIASES.referringDomain),
    targetPage: headerIndex(headers, HEADER_ALIASES.targetPage),
    anchorText: headerIndex(headers, HEADER_ALIASES.anchorText),
    linkAttribute: headerIndex(headers, HEADER_ALIASES.linkAttribute),
    firstSeen: headerIndex(headers, HEADER_ALIASES.firstSeen),
    source: headerIndex(headers, HEADER_ALIASES.source),
  };
  const errors: string[] = [];
  const items: BacklinkRecord[] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = headerLooksKnown ? index + 2 : index + 1;
    const rawReferringPage = valueAt(row, indices.referringPage);
    const referringPage = rawReferringPage ? normalizeUrl(rawReferringPage) : null;
    const rawReferringDomain = valueAt(row, indices.referringDomain);
    const referringDomain = rawReferringDomain ? normalizeDomain(rawReferringDomain) : normalizeDomain(referringPage);
    if (!referringDomain) {
      errors.push(`Row ${rowNumber}: a referring page or referring domain is required.`);
      continue;
    }
    if (rawReferringPage && !referringPage) errors.push(`Row ${rowNumber}: referring page must be an http(s) URL.`);
    const rawTargetPage = valueAt(row, indices.targetPage);
    const targetPage = rawTargetPage ? normalizeUrl(rawTargetPage) : null;
    if (rawTargetPage && !targetPage) errors.push(`Row ${rowNumber}: target page must be an http(s) URL.`);
    const rawDate = valueAt(row, indices.firstSeen);
    const firstSeen = dateValue(rawDate);
    if (rawDate && !firstSeen) errors.push(`Row ${rowNumber}: first-seen date could not be read.`);
    const source = valueAt(row, indices.source) || options.sourceLabel || null;
    items.push({
      id: stableId('backlink', [referringPage, referringDomain, targetPage, valueAt(row, indices.anchorText), source]),
      referringPage,
      referringDomain,
      targetPage,
      anchorText: valueAt(row, indices.anchorText) || null,
      linkAttribute: linkAttribute(valueAt(row, indices.linkAttribute)),
      firstSeen,
      source,
    });
  }
  return { items, errors };
}

function quality(record: KeywordMetric): number {
  return [record.volume, record.difficulty, record.cpc, record.position, record.intent, record.domain, record.landingPage, record.checkedAt].filter(value => value !== null).length;
}

function metricTimestamp(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -1;
}

function newer(left: KeywordMetric, right: KeywordMetric): KeywordMetric {
  const leftTime = metricTimestamp(left.checkedAt);
  const rightTime = metricTimestamp(right.checkedAt);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  return quality(left) >= quality(right) ? left : right;
}

export function dedupeKeywordMetrics(records: KeywordMetric[]): KeywordMetric[] {
  const unique = new Map<string, KeywordMetric>();
  for (const record of records) {
    const key = `${normalizeKeyword(record.keyword)}|${normalizeDomain(record.domain) || ''}`;
    unique.set(key, unique.has(key) ? newer(unique.get(key)!, record) : record);
  }
  return [...unique.values()];
}

/** Lexical ideas only: these groups do not imply search volume or semantic similarity. */
export function groupKeywordIdeas(records: KeywordMetric[], focus: string): KeywordIdeas {
  const phrase = normalizeKeyword(focus);
  const focusTokens = new Set(keywordTokens(focus));
  const ideas: KeywordIdeas = { matching: [], questions: [], sharedWords: [] };
  if (!phrase || !focusTokens.size) return ideas;
  const byTerm = new Map<string, KeywordMetric>();
  for (const record of records) {
    const term = normalizeKeyword(record.keyword);
    if (term === phrase || !keywordTokens(record.keyword).some(token => focusTokens.has(token))) continue;
    const existing = byTerm.get(term);
    byTerm.set(term, existing ? newer(existing, record) : record);
  }
  for (const record of byTerm.values()) {
    const term = normalizeKeyword(record.keyword);
    if (/^(who|what|when|where|why|how|which|can|could|does|do|is|are|should|will)\b/i.test(term) || term.endsWith('?')) ideas.questions.push(record);
    else if (term.includes(phrase)) ideas.matching.push(record);
    else ideas.sharedWords.push(record);
  }
  for (const group of Object.values(ideas)) group.sort((left, right) => (right.volume ?? -1) - (left.volume ?? -1) || left.keyword.localeCompare(right.keyword));
  return ideas;
}

function overlap(left: string[], right: string[]): number {
  const rightTokens = new Set(right);
  return left.filter(token => rightTokens.has(token)).length;
}

function shouldCluster(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return false;
  const shared = overlap(left, right);
  return shared > 0 && shared / Math.min(left.length, right.length) >= 0.6;
}

function clusterLabel(records: KeywordMetric[]): string {
  const tokenCounts = new Map<string, number>();
  for (const record of records) for (const token of keywordTokens(record.keyword)) tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  const common = [...tokenCounts.entries()]
    .filter(([, count]) => count / records.length >= 0.6)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 3);
  if (common.length) return common.join(' ');
  return [...records].sort((left, right) => (right.volume ?? -1) - (left.volume ?? -1) || left.keyword.localeCompare(right.keyword))[0]?.keyword || 'Unlabelled cluster';
}

export function clusterKeywordMetrics(records: KeywordMetric[]): KeywordCluster[] {
  const unique = dedupeKeywordMetrics(records);
  const parents = unique.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const tokenLists = unique.map(record => keywordTokens(record.keyword));
  for (let left = 0; left < unique.length; left += 1) for (let right = left + 1; right < unique.length; right += 1) if (shouldCluster(tokenLists[left], tokenLists[right])) join(left, right);
  const grouped = new Map<number, KeywordMetric[]>();
  for (const [index, record] of unique.entries()) grouped.set(find(index), [...(grouped.get(find(index)) || []), record]);
  return [...grouped.values()].map(group => {
    const volumes = group.map(record => record.volume).filter((value): value is number => value !== null);
    const difficulties = group.map(record => record.difficulty).filter((value): value is number => value !== null);
    const label = clusterLabel(group);
    return {
      id: stableId('cluster', group.map(record => record.keyword).sort()),
      label,
      keywords: [...group].sort((left, right) => (right.volume ?? -1) - (left.volume ?? -1) || left.keyword.localeCompare(right.keyword)),
      keywordCount: group.length,
      totalVolume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
      knownVolumeKeywords: volumes.length,
      averageDifficulty: difficulties.length ? Math.round((difficulties.reduce((sum, value) => sum + value, 0) / difficulties.length) * 10) / 10 : null,
      knownDifficultyKeywords: difficulties.length,
      intents: [...new Set(group.map(record => record.intent).filter((value): value is KeywordIntent => value !== null))].sort(),
    };
  }).sort((left, right) => (right.totalVolume ?? -1) - (left.totalVolume ?? -1) || right.keywordCount - left.keywordCount || left.label.localeCompare(right.label));
}

function isOwned(record: KeywordMetric, domain: string): boolean {
  return normalizeDomain(record.domain) === normalizeDomain(domain);
}

function latestRows(records: KeywordMetric[]): KeywordMetric[] {
  const byKeyword = new Map<string, KeywordMetric[]>();
  for (const record of records) {
    const key = `${normalizeKeyword(record.keyword)}|${normalizeDomain(record.domain) || ''}`;
    byKeyword.set(key, [...(byKeyword.get(key) || []), record]);
  }
  return [...byKeyword.values()].map(rows => [...rows].sort((left, right) => metricTimestamp(right.checkedAt) - metricTimestamp(left.checkedAt) || quality(right) - quality(left))[0]);
}

export function summarizeRankTracking(records: KeywordMetric[], domain: string): RankTrackingSummary {
  const grouped = new Map<string, KeywordMetric[]>();
  for (const record of records) {
    if (!isOwned(record, domain) || record.position === null || !record.checkedAt) continue;
    const key = normalizeKeyword(record.keyword);
    grouped.set(key, [...(grouped.get(key) || []), record]);
  }
  const movers: RankMovement[] = [];
  for (const rows of grouped.values()) {
    const dated = [...rows].sort((left, right) => metricTimestamp(right.checkedAt) - metricTimestamp(left.checkedAt));
    const current = dated[0];
    const previous = dated.find(record => record.checkedAt !== current.checkedAt) || null;
    const change = previous ? previous.position! - current.position! : null;
    movers.push({
      keyword: current.keyword,
      currentPosition: current.position!,
      previousPosition: previous?.position ?? null,
      change,
      direction: change === null ? 'new' : change > 0 ? 'improved' : change < 0 ? 'declined' : 'unchanged',
      checkedAt: current.checkedAt!,
      previousCheckedAt: previous?.checkedAt ?? null,
      volume: current.volume ?? previous?.volume ?? null,
      landingPage: current.landingPage ?? previous?.landingPage ?? null,
    });
  }
  movers.sort((left, right) => Math.abs(right.change || 0) - Math.abs(left.change || 0) || left.currentPosition - right.currentPosition || left.keyword.localeCompare(right.keyword));
  return {
    measuredKeywords: movers.length,
    improved: movers.filter(mover => mover.direction === 'improved').length,
    declined: movers.filter(mover => mover.direction === 'declined').length,
    unchanged: movers.filter(mover => mover.direction === 'unchanged').length,
    new: movers.filter(mover => mover.direction === 'new').length,
    movers,
  };
}

export function summarizeSerpResults(records: SerpResult[]): SerpSummary {
  const typeCounts = new Map<SerpResultType, number>();
  const domains = new Map<string, SerpResult[]>();
  for (const record of records) {
    typeCounts.set(record.resultType, (typeCounts.get(record.resultType) || 0) + 1);
    domains.set(record.domain, [...(domains.get(record.domain) || []), record]);
  }
  return {
    queryCount: new Set(records.map(record => normalizeKeyword(record.keyword))).size,
    resultCount: records.length,
    paidResultCount: records.filter(record => record.resultType === 'paid').length,
    resultTypes: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
    domains: [...domains.entries()].map(([domain, rows]) => ({
      domain,
      resultCount: rows.length,
      organicCount: rows.filter(row => row.resultType === 'organic').length,
      paidCount: rows.filter(row => row.resultType === 'paid').length,
      bestPosition: Math.min(...rows.map(row => row.position)),
    })).sort((left, right) => right.resultCount - left.resultCount || left.bestPosition - right.bestPosition || left.domain.localeCompare(right.domain)),
  };
}

function firstKnownMetric(records: KeywordMetric[], field: 'volume' | 'difficulty' | 'cpc'): number | null {
  return records.map(record => record[field]).find((value): value is number => value !== null) ?? null;
}

export function compareCompetitorKeywords(records: KeywordMetric[], domain: string): CompetitorKeywordGap[] {
  const ownDomain = normalizeDomain(domain);
  if (!ownDomain) return [];
  const groups = new Map<string, KeywordMetric[]>();
  for (const record of records) {
    if (record.position === null || !normalizeDomain(record.domain)) continue;
    const key = normalizeKeyword(record.keyword);
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  const gaps: CompetitorKeywordGap[] = [];
  for (const rows of groups.values()) {
    const ours = latestRows(rows.filter(record => normalizeDomain(record.domain) === ownDomain))[0] || null;
    const competitorRows = latestRows(rows.filter(record => normalizeDomain(record.domain) !== ownDomain));
    for (const competitor of competitorRows) {
      const positionGap = ours ? ours.position! - competitor.position! : null;
      gaps.push({
        keyword: competitor.keyword,
        competitorDomain: competitor.domain!,
        competitorPosition: competitor.position!,
        ourPosition: ours?.position ?? null,
        positionGap,
        status: !ours ? 'not_in_imported_site_rows' : positionGap! > 0 ? 'competitor_ahead' : positionGap! < 0 ? 'we_lead' : 'tie',
        volume: firstKnownMetric(rows, 'volume'),
        difficulty: firstKnownMetric(rows, 'difficulty'),
        cpc: firstKnownMetric(rows, 'cpc'),
      });
    }
  }
  return gaps.sort((left, right) => {
    const severity = (gap: CompetitorKeywordGap) => gap.status === 'not_in_imported_site_rows' ? 3 : gap.status === 'competitor_ahead' ? 2 : gap.status === 'tie' ? 1 : 0;
    return severity(right) - severity(left) || (right.positionGap ?? 0) - (left.positionGap ?? 0) || (right.volume ?? -1) - (left.volume ?? -1) || left.keyword.localeCompare(right.keyword);
  });
}

export function buildPpcSeoOpportunities(records: KeywordMetric[], domain: string, serpResults: SerpResult[]): PpcSeoOpportunity[] {
  const ownRows = latestRows(records.filter(record => isOwned(record, domain) && record.cpc !== null && record.cpc > 0));
  const serpByKeyword = new Map<string, SerpResult[]>();
  for (const result of serpResults) {
    const key = normalizeKeyword(result.keyword);
    serpByKeyword.set(key, [...(serpByKeyword.get(key) || []), result]);
  }
  return ownRows.map(record => {
    const queryResults = serpByKeyword.get(normalizeKeyword(record.keyword));
    const recommendation: PpcSeoOpportunity['recommendation'] = record.position === null ? 'complete_rank_data' : record.position <= 10 ? 'protect_organic' : 'bridge_to_organic';
    return {
      keyword: record.keyword,
      position: record.position,
      volume: record.volume,
      cpc: record.cpc!,
      difficulty: record.difficulty,
      intent: record.intent,
      paidResultCount: queryResults ? queryResults.filter(result => result.resultType === 'paid').length : null,
      recommendation,
    };
  }).sort((left, right) => {
    const priority = (opportunity: PpcSeoOpportunity) => opportunity.recommendation === 'bridge_to_organic' ? 2 : opportunity.recommendation === 'protect_organic' ? 1 : 0;
    return priority(right) - priority(left) || right.cpc - left.cpc || (right.volume ?? -1) - (left.volume ?? -1) || left.keyword.localeCompare(right.keyword);
  });
}

export function summarizeBacklinks(records: BacklinkRecord[]) {
  const count = (values: Array<string | null>) => [...new Map(values.filter((value): value is string => Boolean(value?.trim())).map(value => [value, 0])).keys()].map(value => ({ value, count: values.filter(candidate => candidate === value).length })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  return {
    referringPages: records.filter(record => record.referringPage).length,
    referringDomains: new Set(records.map(record => record.referringDomain)).size,
    follow: records.filter(record => record.linkAttribute === 'follow').length,
    nofollow: records.filter(record => record.linkAttribute === 'nofollow').length,
    unknown: records.filter(record => record.linkAttribute === 'unknown').length,
    domains: count(records.map(record => record.referringDomain)),
    anchors: count(records.map(record => record.anchorText)),
    targets: count(records.map(record => record.targetPage)),
  };
}
