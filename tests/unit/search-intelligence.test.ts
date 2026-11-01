import { describe, expect, it } from 'vitest';
import {
  buildPpcSeoOpportunities,
  clusterKeywordMetrics,
  compareCompetitorKeywords,
  groupKeywordIdeas,
  parseBacklinkRecords,
  parseKeywordMetrics,
  parseSerpResults,
  summarizeBacklinks,
  summarizeRankTracking,
  summarizeSerpResults,
  type KeywordMetric,
} from '../../src/shared/search-intelligence';

function keywordRecord(overrides: Partial<KeywordMetric> & Pick<KeywordMetric, 'id' | 'keyword'>): KeywordMetric {
  return {
    id: overrides.id,
    keyword: overrides.keyword,
    volume: overrides.volume ?? null,
    difficulty: overrides.difficulty ?? null,
    cpc: overrides.cpc ?? null,
    intent: overrides.intent ?? null,
    position: overrides.position ?? null,
    domain: overrides.domain ?? 'roundseo.example',
    landingPage: overrides.landingPage ?? null,
    checkedAt: overrides.checkedAt ?? null,
    source: overrides.source ?? 'test import',
  };
}

describe('search intelligence imports', () => {
  it('parses quoted keyword metrics without inventing any omitted inputs', () => {
    const parsed = parseKeywordMetrics(`keyword,volume,difficulty,cpc,intent,position,date
"technical seo audit","1,200",32,4.8,commercial,14,2026-10-31`, { defaultDomain: 'roundseo.example', sourceLabel: 'test export' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual([expect.objectContaining({
      keyword: 'technical seo audit',
      volume: 1200,
      difficulty: 32,
      cpc: 4.8,
      position: 14,
      intent: 'commercial',
      domain: 'roundseo.example',
      source: 'test export',
    })]);
  });

  it('keeps missing keyword metrics null instead of replacing them with a proxy value', () => {
    const parsed = parseKeywordMetrics('keyword\nsite audit checklist', { defaultDomain: 'roundseo.example' });

    expect(parsed.items[0]).toMatchObject({ volume: null, difficulty: null, cpc: null, position: null, checkedAt: null });
  });

  it('groups only terms with a substantial shared topical token set', () => {
    const clusters = clusterKeywordMetrics([
      keywordRecord({ id: 'one', keyword: 'technical seo audit', volume: 1200, difficulty: 32 }),
      keywordRecord({ id: 'two', keyword: 'seo audit checklist', volume: 300, difficulty: 28 }),
      keywordRecord({ id: 'three', keyword: 'backlink checker', volume: 500, difficulty: 48 }),
    ]);
    const auditCluster = clusters.find(cluster => cluster.keywords.some(record => record.keyword === 'technical seo audit'));

    expect(auditCluster).toMatchObject({ keywordCount: 2, totalVolume: 1500, averageDifficulty: 30 });
    expect(auditCluster?.keywords.map(record => record.keyword)).toEqual(expect.arrayContaining(['technical seo audit', 'seo audit checklist']));
  });

  it('groups focus ideas from supplied terms and leaves volume unknown when no source supplied it', () => {
    const ideas = groupKeywordIdeas([
      keywordRecord({ id: 'seed', keyword: 'seo audit', volume: 1200 }),
      keywordRecord({ id: 'match', keyword: 'best seo audit tool', volume: 450 }),
      keywordRecord({ id: 'question', keyword: 'how to do an seo audit' }),
      keywordRecord({ id: 'related', keyword: 'technical seo checklist', volume: 300 }),
      keywordRecord({ id: 'unrelated', keyword: 'backlink checker', volume: 900 }),
    ], 'seo audit');

    expect(ideas.matching.map(item => item.keyword)).toEqual(['best seo audit tool']);
    expect(ideas.questions).toEqual([expect.objectContaining({ keyword: 'how to do an seo audit', volume: null })]);
    expect(ideas.sharedWords.map(item => item.keyword)).toEqual(['technical seo checklist']);
  });
});

describe('search intelligence calculations', () => {
  it('keeps import identities stable across reordered and corrected rows', () => {
    const original = parseKeywordMetrics('keyword,position,date\nseo audit,12,2026-10-31\nbacklinks,8,2026-10-31', { defaultDomain: 'site.test' }).items;
    const reordered = parseKeywordMetrics('keyword,position,date\nbacklinks,8,2026-10-31\nseo audit,9,2026-10-31', { defaultDomain: 'site.test' }).items;
    expect(original.find(row => row.keyword === 'seo audit')?.id).toBe(reordered.find(row => row.keyword === 'seo audit')?.id);
    const oldLink = parseBacklinkRecords('referring_page,target_page,rel\nhttps://a.test/page,https://site.test/,follow').items[0];
    const correctedLink = parseBacklinkRecords('referring_page,target_page,rel\nhttps://a.test/page,https://site.test/,nofollow').items[0];
    expect(oldLink.id).toBe(correctedLink.id);
  });

  it('compares each competitor domain instead of discarding all but one', () => {
    const rows = parseKeywordMetrics('keyword,domain,position\nseo audit,site.test,10\nseo audit,first.test,3\nseo audit,second.test,6').items;
    expect(compareCompetitorKeywords(rows, 'site.test').map(row => row.competitorDomain).sort()).toEqual(['first.test', 'second.test']);
  });
  it('calculates rank movement from two dated source records only', () => {
    const summary = summarizeRankTracking([
      keywordRecord({ id: 'audit-old', keyword: 'technical seo audit', position: 14, checkedAt: '2026-10-01', volume: 1200 }),
      keywordRecord({ id: 'audit-new', keyword: 'technical seo audit', position: 8, checkedAt: '2026-10-31', volume: 1200 }),
      keywordRecord({ id: 'links-old', keyword: 'backlink checker', position: 4, checkedAt: '2026-10-01' }),
      keywordRecord({ id: 'links-new', keyword: 'backlink checker', position: 7, checkedAt: '2026-10-31' }),
      keywordRecord({ id: 'new', keyword: 'site audit template', position: 15, checkedAt: '2026-10-31' }),
    ], 'roundseo.example');

    expect(summary).toMatchObject({ measuredKeywords: 3, improved: 1, declined: 1, new: 1 });
    expect(summary.movers.find(mover => mover.keyword === 'technical seo audit')).toMatchObject({ change: 6, direction: 'improved' });
    expect(summary.movers.find(mover => mover.keyword === 'backlink checker')).toMatchObject({ change: -3, direction: 'declined' });
  });

  it('summarizes imported SERP result types and domains', () => {
    const parsed = parseSerpResults(`keyword,position,url,result_type,title,date
technical seo audit,1,https://roundseo.example/audit,organic,Audit guide,2026-10-31
technical seo audit,2,https://ads.example/landing,paid,Advertiser,2026-10-31
backlink checker,1,https://roundseo.example/backlinks,organic,Backlink guide,2026-10-31`);
    const summary = summarizeSerpResults(parsed.items);

    expect(summary).toMatchObject({ queryCount: 2, resultCount: 3, paidResultCount: 1 });
    expect(summary.domains.find(domain => domain.domain === 'roundseo.example')).toMatchObject({ resultCount: 2, organicCount: 2, bestPosition: 1 });
  });

  it('labels unmatched competitor rows as missing imported site data, not non-ranking', () => {
    const gaps = compareCompetitorKeywords([
      keywordRecord({ id: 'ours', keyword: 'technical seo audit', domain: 'roundseo.example', position: 12, checkedAt: '2026-10-31', volume: 1200 }),
      keywordRecord({ id: 'theirs', keyword: 'technical seo audit', domain: 'competitor.example', position: 3, checkedAt: '2026-10-31', volume: 1200 }),
      keywordRecord({ id: 'only-theirs', keyword: 'seo report generator', domain: 'competitor.example', position: 2, checkedAt: '2026-10-31' }),
    ], 'roundseo.example');

    expect(gaps.find(gap => gap.keyword === 'technical seo audit')).toMatchObject({ status: 'competitor_ahead', positionGap: 9, competitorDomain: 'competitor.example' });
    expect(gaps.find(gap => gap.keyword === 'seo report generator')).toMatchObject({ status: 'not_in_imported_site_rows', ourPosition: null });
  });

  it('creates PPC / SEO decision cues only for supplied positive CPC values', () => {
    const opportunities = buildPpcSeoOpportunities([
      keywordRecord({ id: 'bridge', keyword: 'technical seo audit', cpc: 4.8, position: 14, volume: 1200 }),
      keywordRecord({ id: 'protect', keyword: 'backlink checker', cpc: 2.1, position: 4, volume: 500 }),
      keywordRecord({ id: 'complete', keyword: 'seo report generator', cpc: 3.2, position: null }),
      keywordRecord({ id: 'undated', keyword: 'seo audit template', cpc: 1.6, position: 18 }),
      keywordRecord({ id: 'dated', keyword: 'seo audit template', cpc: 1.6, position: 5, checkedAt: '2026-10-31' }),
      keywordRecord({ id: 'excluded', keyword: 'free seo audit', cpc: null, position: 2 }),
    ], 'roundseo.example', parseSerpResults(`keyword,position,url,result_type
technical seo audit,1,https://roundseo.example/audit,organic
technical seo audit,2,https://ads.example/audit,paid`).items);

    expect(opportunities).toHaveLength(4);
    expect(opportunities.find(item => item.keyword === 'technical seo audit')).toMatchObject({ recommendation: 'bridge_to_organic', paidResultCount: 1 });
    expect(opportunities.find(item => item.keyword === 'backlink checker')).toMatchObject({ recommendation: 'protect_organic' });
    expect(opportunities.find(item => item.keyword === 'seo report generator')).toMatchObject({ recommendation: 'complete_rank_data' });
    expect(opportunities.find(item => item.keyword === 'seo audit template')).toMatchObject({ position: 5, recommendation: 'protect_organic' });
  });

  it('parses backlink source, target, anchor, and rel fields into a real profile summary', () => {
    const parsed = parseBacklinkRecords(`referring_page,target_page,anchor_text,rel,first_seen
https://news.example/review,https://roundseo.example/audit,RoundSEO audit,follow,2026-10-01
https://news.example/guide,https://roundseo.example/audit,SEO audit tool,nofollow,2026-10-02`);
    const summary = summarizeBacklinks(parsed.items);

    expect(parsed.errors).toEqual([]);
    expect(summary).toMatchObject({ referringPages: 2, referringDomains: 1, follow: 1, nofollow: 1 });
    expect(summary.anchors.map(anchor => anchor.value)).toEqual(expect.arrayContaining(['RoundSEO audit', 'SEO audit tool']));
  });
});
