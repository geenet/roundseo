import { describe, expect, it } from 'vitest';
import { compareAuditIssues, type IssueFinding, type IssueSnapshot } from '../../src/shared/audit-issue-intelligence';

function finding(ruleId: string, urls: string[], overrides: Partial<IssueFinding> = {}): IssueFinding {
  return { ruleId, title: ruleId, priority: 'High', category: 'Search appearance', evidence: urls.map(url => ({ url })), ...overrides };
}

function snapshot(pages: string[], findings: IssueFinding[], overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return { checkedAt: '2026-10-01', rendered: false, ruleSetVersion: '2026.10.6', method: 'http', pages: pages.map(url => ({ url, statusCode: 200 })), findings, ...overrides };
}

describe('comparable audit issue movement', () => {
  it('counts new, absent and continuing observations only on pages inspected in both crawls', () => {
    const oldRun = snapshot(['/shared-a', '/shared-b', '/old-only'], [finding('title', ['/shared-a', '/shared-b', '/old-only'])]);
    const newRun = snapshot(['/shared-a', '/shared-b', '/new-only'], [finding('title', ['/shared-b']), finding('description', ['/shared-a', '/new-only'])]);
    const comparison = compareAuditIssues(oldRun, newRun);

    expect(comparison).toMatchObject({ status: 'comparable', overlappingPages: 2, newlyObserved: 1, noLongerObserved: 1, stillObserved: 1 });
    expect(comparison.rows.find(row => row.ruleId === 'description')?.newlyObserved).toEqual(['/shared-a']);
    expect(comparison.rows.find(row => row.ruleId === 'title')).toMatchObject({ noLongerObserved: ['/shared-a'], stillObserved: ['/shared-b'] });
  });

  it('does not call a finding absent when a sample is capped or the collection method changed', () => {
    const oldRun = snapshot(['/shared'], [finding('title', ['/shared'])]);
    const capped = snapshot(['/shared'], [finding('title', ['/different'], { evidenceTruncated: true, affectedUrlCount: 200 })]);
    expect(compareAuditIssues(oldRun, capped)).toMatchObject({ status: 'comparable', excludedRules: 1, noLongerObserved: 0 });
    expect(compareAuditIssues(oldRun, snapshot(['/shared'], [], { rendered: true }))).toMatchObject({ status: 'unavailable', noLongerObserved: 0 });
  });

  it('refuses a comparison when the crawls have no successfully inspected URL in common', () => {
    const result = compareAuditIssues(snapshot(['/a'], [finding('title', ['/a'])]), snapshot(['/b'], []));
    expect(result).toMatchObject({ status: 'unavailable', overlappingPages: 0, noLongerObserved: 0 });
  });
});
