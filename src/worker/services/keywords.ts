// Keyword tracking service
import { nanoid } from 'nanoid';

export interface TrackedKeyword {
  id: string;
  websiteId: string;
  keyword: string;
  searchVolume: number;
  difficulty: number;
  intent: 'commercial' | 'informational' | 'navigational';
  isTracked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KeywordRanking {
  id: string;
  keywordId: string;
  websiteId: string;
  rank: number;
  positionChange: number | null;
  trafficEstimate: number | null;
  checkedAt: string;
}

export interface KeywordTrend {
  keyword: string;
  currentRank: number | null;
  previousRank: number | null;
  change: number | null;
  trend: 'up' | 'down' | 'stable' | 'unknown';
  searchVolume: number;
  traffic: number | null;
}

export async function trackKeyword(
  db: any,
  websiteId: string,
  keyword: string,
  searchVolume = 0,
  difficulty = 0,
  intent: 'commercial' | 'informational' | 'navigational' = 'informational'
): Promise<TrackedKeyword> {
  const id = `kw_${nanoid(16)}`;
  const now = new Date().toISOString();

  // Check if already tracked
  const existing = await db.prepare(
    'SELECT id FROM tracked_keywords WHERE website_id = ? AND keyword = ?'
  ).bind(websiteId, keyword).first();

  if (existing) {
    return getKeyword(db, existing.id) as Promise<TrackedKeyword>;
  }

  await db.prepare(`
    INSERT INTO tracked_keywords (id, website_id, keyword, search_volume, difficulty, intent, is_tracked, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, websiteId, keyword, searchVolume, difficulty, intent, true, now, now).run();

  return { id, websiteId, keyword, searchVolume, difficulty, intent, isTracked: true, createdAt: now, updatedAt: now };
}

export async function getKeyword(db: any, id: string): Promise<TrackedKeyword | null> {
  const kw = await db.prepare('SELECT * FROM tracked_keywords WHERE id = ?').bind(id).first();
  return kw ? mapKeywordRow(kw) : null;
}

export async function listWebsiteKeywords(db: any, websiteId: string): Promise<TrackedKeyword[]> {
  const result = await db.prepare(
    'SELECT * FROM tracked_keywords WHERE website_id = ? AND is_tracked = TRUE ORDER BY search_volume DESC'
  ).bind(websiteId).all();
  return result.results.map(mapKeywordRow);
}

export async function recordRanking(
  db: any,
  keywordId: string,
  websiteId: string,
  rank: number,
  trafficEstimate: number | null = null
): Promise<KeywordRanking> {
  const id = `rank_${nanoid(16)}`;
  const now = new Date().toISOString();

  // Get previous rank for position change
  const previousRanking = await db.prepare(
    'SELECT rank FROM keyword_rankings WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).bind(keywordId).first();

  const positionChange = previousRanking ? previousRanking.rank - rank : null;

  await db.prepare(`
    INSERT INTO keyword_rankings (id, keyword_id, website_id, rank, position_change, traffic_estimate, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, keywordId, websiteId, rank, positionChange, trafficEstimate, now).run();

  // Record in history
  if (previousRanking) {
    await db.prepare(`
      INSERT INTO keyword_history (id, keyword_id, rank_before, rank_after, change_date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`hist_${nanoid(16)}`, keywordId, previousRanking.rank, rank, now).run();
  }

  return { id, keywordId, websiteId, rank, positionChange, trafficEstimate, checkedAt: now };
}

export async function getKeywordTrends(db: any, websiteId: string): Promise<KeywordTrend[]> {
  const keywords = await db.prepare(`
    SELECT k.*,
           (SELECT rank FROM keyword_rankings WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as current_rank,
           (SELECT rank FROM keyword_rankings WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1) as previous_rank
    FROM tracked_keywords k
    WHERE k.website_id = ? AND k.is_tracked = TRUE
    ORDER BY k.search_volume DESC LIMIT 50
  `).bind(websiteId).all();

  return keywords.results.map((k: { keyword: string; current_rank: number | null; previous_rank: number | null; search_volume: number }) => {
    const currentRank = k.current_rank ?? null;
    const previousRank = k.previous_rank ?? null;
    const change = previousRank !== null && currentRank !== null ? previousRank - currentRank : null;
    const trend = change === null ? 'unknown' : change > 0 ? 'up' : change < 0 ? 'down' : 'stable';

    return {
      keyword: k.keyword,
      currentRank,
      previousRank,
      change,
      trend,
      searchVolume: k.search_volume,
      traffic: null,
    };
  });
}

export async function getKeywordHistory(db: any, keywordId: string, days = 30): Promise<KeywordRanking[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.prepare(`
    SELECT * FROM keyword_rankings
    WHERE keyword_id = ? AND checked_at >= ?
    ORDER BY checked_at ASC
  `).bind(keywordId, since).all();

  return result.results.map((row: any) => ({
    id: row.id,
    keywordId: row.keyword_id,
    websiteId: row.website_id,
    rank: row.rank,
    positionChange: row.position_change,
    trafficEstimate: row.traffic_estimate,
    checkedAt: row.checked_at,
  }));
}

function mapKeywordRow(row: any): TrackedKeyword {
  return {
    id: row.id,
    websiteId: row.website_id,
    keyword: row.keyword,
    searchVolume: row.search_volume,
    difficulty: row.difficulty,
    intent: row.intent,
    isTracked: row.is_tracked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
