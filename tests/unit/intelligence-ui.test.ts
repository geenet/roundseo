import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnswerVisibilityEvidence, EvidenceSource, IntelligenceEvidence, KeywordEvidence, SerpEvidence } from '../../src/shared/intelligence';
import { keywordMetricsFromEvidence, safeImageSource, serpResultsFromEvidence } from '../../src/ui/components/IntelligencePanels';

const source: EvidenceSource = {
  origin: 'search_metrics_api',
  label: 'Google Ads Keyword Plan',
  method: 'google-ads-keyword-plan-v1',
  observedAt: '2026-11-01T12:00:00.000Z',
  limitations: ['Volumes are monthly averages for the selected market.'],
};

describe('keyword evidence in the workspace', () => {
  it('maps source-reported volume and CPC, and leaves difficulty empty rather than inventing it', () => {
    const evidence: KeywordEvidence = {
      kind: 'keyword', id: 'k1', keyword: 'crm software', searchVolume: 1900, cpcLow: 1.2, cpcHigh: 4.5, competition: 42, intent: null, source,
    };
    const [metric] = keywordMetricsFromEvidence([evidence]);
    expect(metric).toMatchObject({ keyword: 'crm software', volume: 1900, cpc: 2.85, difficulty: null, position: null, domain: null, checkedAt: source.observedAt });
  });

  it('keeps related terms without volume as unmeasured rows instead of zeros', () => {
    const evidence: KeywordEvidence = { kind: 'keyword', id: 'k2', keyword: 'seo audit checklist', searchVolume: null, cpcLow: null, cpcHigh: null, competition: null, intent: null, source: { ...source, origin: 'search_results_page' } };
    expect(keywordMetricsFromEvidence([evidence])[0]).toMatchObject({ volume: null, cpc: null });
  });

  it('ignores non-keyword evidence when building keyword rows', () => {
    const visibility: AnswerVisibilityEvidence = { kind: 'answer_visibility', id: 'v1', engine: 'claude', prompt: 'p', targetDomain: 'example.com', mentioned: false, mentionCount: 0, shareOfVoice: null, sentiment: 'unknown', sentimentMethod: 'lexicon_heuristic', competingDomains: [], source };
    expect(keywordMetricsFromEvidence([visibility as IntelligenceEvidence])).toEqual([]);
  });
});

describe('SERP evidence in the workspace', () => {
  it('maps results that carry a domain and skips rows without one', () => {
    const withDomain: SerpEvidence = { kind: 'serp_result', id: 's1', query: 'seo audit', surface: 'google', position: 1, feature: 'organic', title: 'Guide', url: 'https://www.example.com/guide', domain: 'example.com', description: null, source: { ...source, origin: 'search_results_page' } };
    const withoutDomain: SerpEvidence = { ...withDomain, id: 's2', url: 'not a url', domain: null };
    const rows = serpResultsFromEvidence([withDomain, withoutDomain]);
    expect(rows.map(row => [row.id, row.domain, row.resultType, row.checkedAt])).toEqual([['s1', 'example.com', 'organic', source.observedAt]]);
  });
});

describe('screenshot sources', () => {
  it('accepts the local gateway asset path only with a 64-character signature', () => {
    const signature = 'a'.repeat(64);
    expect(safeImageSource(`/__roundseo/intelligence/websites/site-1/assets/asset-1?expires=1793000000&sig=${signature}`)).toMatch(/^\/__roundseo/);
    expect(safeImageSource('/__roundseo/intelligence/websites/site-1/assets/asset-1?expires=1793000000&sig=short')).toBeNull();
  });

  it('accepts signed HTTPS asset URLs and inline PNG data, and refuses script and plain relative URLs', () => {
    expect(safeImageSource('https://api.example.com/api/v2/websites/site-1/intelligence/assets/a?expires=1&sig=b')).toMatch(/^https:/);
    expect(safeImageSource('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImageSource('javascript:alert(1)')).toBeNull();
    expect(safeImageSource('/api/v2/websites/site-1/intelligence/assets/a')).toBeNull();
  });
});

describe('workspace copy', () => {
  it('describes native collection and never presents a paid search-data spend step', () => {
    const panels = readFileSync('src/ui/components/IntelligencePanels.tsx', 'utf8');
    expect(panels).not.toMatch(/confirmSpend|SpendCheck|Paid search-data|spend credits/i);
    expect(panels).toMatch(/Not measured in this run/);
    expect(panels).toMatch(/Cancel crawl/);
  });
});
