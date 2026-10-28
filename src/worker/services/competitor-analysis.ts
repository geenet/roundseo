// Competitor analysis service
import { nanoid } from 'nanoid';

export interface CompetitorWebsite {
  id: string;
  organizationId: string;
  baseWebsite: string;
  competitorDomain: string;
  competitorUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorMetrics {
  domain: string;
  totalKeywords: number;
  topRankings: number; // in top 10
  averageRank: number;
  estimatedTraffic: number;
  sharedKeywords: number;
  winningKeywords: number; // keywords we rank better for
  losingKeywords: number; // keywords they rank better for
}

export interface KeywordComparison {
  keyword: string;
  ourRank: number;
  theirRank: number;
  difference: number;
  winner: 'us' | 'them' | 'tie';
  searchVolume: number;
}

export async function addCompetitor(
  db: any,
  organizationId: string,
  baseWebsite: string,
  competitorDomain: string,
  competitorUrl: string
): Promise<CompetitorWebsite> {
  const id = `comp_${nanoid(16)}`;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO competitor_websites (
      id, organization_id, base_website, competitor_domain, competitor_url, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, organizationId, baseWebsite, competitorDomain, competitorUrl, true, now, now).run();

  return {
    id,
    organizationId,
    baseWebsite,
    competitorDomain,
    competitorUrl,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listCompetitors(db: any, organizationId: string): Promise<CompetitorWebsite[]> {
  const result = await db.prepare(
    'SELECT * FROM competitor_websites WHERE organization_id = ? AND is_active = TRUE'
  ).bind(organizationId).all();

  return result.results.map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    baseWebsite: row.base_website,
    competitorDomain: row.competitor_domain,
    competitorUrl: row.competitor_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getCompetitorMetrics(
  db: any,
  competitorDomain: string
): Promise<CompetitorMetrics | null> {
  // Get all keywords this competitor ranks for
  const competitorKeywords = await db.prepare(`
    SELECT k.*, kr.rank
    FROM competitor_keywords k
    LEFT JOIN competitor_rankings kr ON k.id = kr.keyword_id
    WHERE k.competitor_domain = ?
    ORDER BY kr.rank ASC
  `).bind(competitorDomain).all();

  if (!competitorKeywords.results || competitorKeywords.results.length === 0) {
    return null;
  }

  const keywords = competitorKeywords.results;
  const topRankings = keywords.filter((k: any) => k.rank && k.rank <= 10).length;
  const avgRank = keywords.reduce((sum: number, k: any) => sum + (k.rank || 100), 0) / keywords.length;
  const estimatedTraffic = keywords.reduce((sum: number, k: any) => sum + estimateTraffic(k.rank || 100, k.search_volume || 0), 0);

  return {
    domain: competitorDomain,
    totalKeywords: keywords.length,
    topRankings,
    averageRank: Math.round(avgRank),
    estimatedTraffic,
    sharedKeywords: 0, // TODO: Calculate shared keywords
    winningKeywords: 0, // TODO: Compare with our rankings
    losingKeywords: 0, // TODO: Compare with our rankings
  };
}

export async function compareKeywords(
  db: any,
  baseWebsiteId: string,
  competitorDomain: string
): Promise<KeywordComparison[]> {
  // Get our keywords and their ranks
  const ourKeywords = await db.prepare(`
    SELECT
      k.keyword,
      k.search_volume,
      (SELECT rank FROM keyword_rankings WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as our_rank
    FROM tracked_keywords k
    WHERE k.website_id = ?
  `).bind(baseWebsiteId).all();

  const comparisons: KeywordComparison[] = [];

  for (const ourKw of ourKeywords.results || []) {
    // Find if competitor ranks for this keyword
    const competitorRank = await db.prepare(`
      SELECT rank FROM competitor_rankings
      WHERE competitor_domain = ? AND keyword LIKE ?
      ORDER BY checked_at DESC LIMIT 1
    `).bind(competitorDomain, `%${ourKw.keyword}%`).first();

    if (competitorRank) {
      const difference = (competitorRank.rank || 100) - (ourKw.our_rank || 100);
      const winner = difference > 0 ? 'us' : difference < 0 ? 'them' : 'tie';

      comparisons.push({
        keyword: ourKw.keyword,
        ourRank: ourKw.our_rank || 100,
        theirRank: competitorRank.rank,
        difference: Math.abs(difference),
        winner,
        searchVolume: ourKw.search_volume,
      });
    }
  }

  return comparisons.sort((a, b) => b.searchVolume - a.searchVolume);
}

export async function getCompetitorAdvantages(
  db: any,
  baseWebsiteId: string,
  competitorDomain: string
): Promise<{ winning: KeywordComparison[]; losing: KeywordComparison[] }> {
  const comparisons = await compareKeywords(db, baseWebsiteId, competitorDomain);

  return {
    winning: comparisons.filter(c => c.winner === 'us').slice(0, 20),
    losing: comparisons.filter(c => c.winner === 'them').slice(0, 20),
  };
}

function estimateTraffic(rank: number, searchVolume: number): number {
  const ctrByRank: Record<number, number> = {
    1: 0.28, 2: 0.15, 3: 0.10, 4: 0.08, 5: 0.07,
    6: 0.05, 7: 0.04, 8: 0.03, 9: 0.02, 10: 0.02,
  };
  const ctr = ctrByRank[Math.min(rank, 10)] || 0.01;
  return Math.round(searchVolume * ctr * 0.3);
}
