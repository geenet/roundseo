import { describe, expect, it } from 'vitest';
import {
  parsePageAnalyticsRecords,
  parseRetentionCohortRecords,
  summarizePageAnalytics,
  summarizeRetentionCohorts,
} from '../../src/shared/analytics-intelligence';

describe('analytics imports', () => {
  it('updates a renamed page without duplicating a dated snapshot and reads GA export dates', () => {
    const old = parsePageAnalyticsRecords('# GA4 export\npage_path,page_title,views,date\n/pricing,Old pricing title,100,20261031').items;
    const corrected = parsePageAnalyticsRecords('page_path,page_title,views,date\n/pricing,Updated pricing title,200,20261031').items;
    expect(old[0].id).toBe(corrected[0].id);
    const summary = summarizePageAnalytics([...old, ...corrected]);
    expect(summary.totalViews).toBe(200);
    expect(summary.trend[0]).toMatchObject({ date: '2026-10-31', views: 200 });
  });

  it('does not accept negative analytics or impossible retention values', () => {
    expect(parsePageAnalyticsRecords('page_path,views\n/pricing,-10').items).toEqual([]);
    expect(parseRetentionCohortRecords('cohort,day,retention_rate\nweek-one,1,140%').items).toEqual([]);
  });
  it('parses page exports and preserves source metrics instead of manufacturing absent ones', () => {
    const parsed = parsePageAnalyticsRecords(`page title,page path,views,active users,average engagement time,event count,date
"Pricing, plans",/pricing,"1,250",800,"1m 17s",4240,2026-10-31
Homepage,/,900,700,,3100,2026-10-31`, { sourceLabel: 'GA4 export' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ pageTitle: 'Pricing, plans', pagePath: '/pricing', views: 1250, activeUsers: 800, averageEngagementSeconds: 77, eventCount: 4240, source: 'GA4 export' }),
      expect.objectContaining({ pageTitle: 'Homepage', averageEngagementSeconds: null }),
    ]));
  });

  it('rejects page rows that have neither a page identity nor an actual metric', () => {
    const parsed = parsePageAnalyticsRecords(`page title,views
,100
Pricing,`);

    expect(parsed.items).toEqual([]);
    expect(parsed.errors).toEqual([
      'Row 2 needs a page title or page path.',
      'Row 3 has no usable page metric.',
    ]);
  });

  it('uses the latest source snapshot per page and makes aggregation scope explicit', () => {
    const parsed = parsePageAnalyticsRecords(`page path,page title,views,active users,average engagement time,event count,date
/pricing,Pricing,500,400,60,1000,2026-10-01
/pricing,Pricing and plans,700,450,80,1600,2026-10-31
/blog,Budget guide,300,200,42,500,2026-10-31`);
    const summary = summarizePageAnalytics(parsed.items);

    expect(summary).toMatchObject({ pageCount: 2, totalViews: 1000, totalPageActiveUsers: 650, totalEvents: 2100, latestDate: '2026-10-31T00:00:00.000Z' });
    expect(summary.derivedViewsPerActiveUser).toBeCloseTo(1000 / 650, 5);
    expect(summary.averageEngagementSeconds).toBeCloseTo((80 * 450 + 42 * 200) / 650, 5);
    expect(summary.pages.find(page => page.pagePath === '/pricing')).toMatchObject({ pageTitle: 'Pricing and plans', views: 700 });
    expect(summary.trend).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-10-01', views: 500 }),
      expect.objectContaining({ date: '2026-10-31', views: 1000 }),
    ]));
  });
});

describe('retention imports', () => {
  it('normalizes ratio and percent inputs, then produces a cohort-average curve', () => {
    const parsed = parseRetentionCohortRecords(`cohort,day,retention rate,average engagement time,new users,returning users,date
2026-10-01,1,10%,01:30,100,10,2026-10-31
2026-10-08,1,0.05,45s,80,4,2026-10-31
2026-10-01,7,2.5%,20s,100,2,2026-10-31`, { sourceLabel: 'GA4 retention export' });
    const summary = summarizeRetentionCohorts(parsed.items);

    expect(parsed.errors).toEqual([]);
    expect(summary).toMatchObject({ cohortCount: 2, dayOneRetention: 7.5, lastMeasuredDay: 7, latestDate: '2026-10-31T00:00:00.000Z' });
    expect(summary.curve).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 1, retentionRate: 7.5, averageEngagementSeconds: 67.5, cohorts: 2 }),
      expect.objectContaining({ day: 7, retentionRate: 2.5 }),
    ]));
  });
});
