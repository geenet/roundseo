/** Compare finding evidence only on pages inspected by both compatible crawls. */
export type IssueFinding = {
  ruleId: string;
  title: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  category: string;
  evidence: Array<{ url: string }>;
  affectedUrlCount?: number;
  evidenceTruncated?: boolean;
  matchCount?: number;
};

export type IssueSnapshot = {
  checkedAt: string;
  rendered: boolean;
  ruleSetVersion: string;
  method: string;
  pages: Array<{ url: string; statusCode?: number; requiresJavaScriptRendering?: boolean }>;
  findings: IssueFinding[];
};

export type IssueMovement = {
  ruleId: string;
  title: string;
  priority: IssueFinding['priority'];
  category: string;
  newlyObserved: string[];
  noLongerObserved: string[];
  stillObserved: string[];
};

export type IssueComparison = {
  status: 'comparable' | 'unavailable';
  previousAt: string;
  overlappingPages: number;
  excludedRules: number;
  reason?: string;
  rows: IssueMovement[];
  newlyObserved: number;
  noLongerObserved: number;
  stillObserved: number;
};

function comparablePage(page: { url: string; statusCode?: number; requiresJavaScriptRendering?: boolean }): boolean {
  return Boolean(page.url) && !page.requiresJavaScriptRendering && (page.statusCode === undefined || (page.statusCode >= 200 && page.statusCode < 400));
}

function countable(finding: IssueFinding): boolean {
  if (finding.ruleId.startsWith('performance.')) return false;
  if (finding.evidenceTruncated || finding.matchCount !== undefined) return false;
  const observedUrls = new Set(finding.evidence.map(item => item.url).filter(Boolean));
  return observedUrls.size > 0 && (finding.affectedUrlCount === undefined || finding.affectedUrlCount <= observedUrls.size);
}

export function compareAuditIssues(previous: IssueSnapshot, current: IssueSnapshot): IssueComparison {
  const base: IssueComparison = {
    status: 'unavailable', previousAt: previous.checkedAt, overlappingPages: 0,
    excludedRules: 0, rows: [], newlyObserved: 0, noLongerObserved: 0, stillObserved: 0,
  };
  if (previous.ruleSetVersion !== current.ruleSetVersion || previous.rendered !== current.rendered || previous.method !== current.method) {
    return { ...base, reason: 'The crawl method or rule set changed, so issue movement is not comparable.' };
  }
  const oldUrls = new Set(previous.pages.filter(comparablePage).map(page => page.url));
  const overlap = new Set(current.pages.filter(comparablePage).map(page => page.url).filter(url => oldUrls.has(url)));
  if (!overlap.size) return { ...base, reason: 'No successfully inspected page is shared by these two crawls.' };

  const previousByRule = new Map(previous.findings.filter(finding => !finding.ruleId.startsWith('performance.')).map(finding => [finding.ruleId, finding]));
  const currentByRule = new Map(current.findings.filter(finding => !finding.ruleId.startsWith('performance.')).map(finding => [finding.ruleId, finding]));
  const rows: IssueMovement[] = [];
  let excludedRules = 0;
  for (const ruleId of new Set([...previousByRule.keys(), ...currentByRule.keys()])) {
    const before = previousByRule.get(ruleId);
    const after = currentByRule.get(ruleId);
    if ((before && !countable(before)) || (after && !countable(after))) { excludedRules += 1; continue; }
    const oldEvidence = new Set((before?.evidence || []).map(item => item.url).filter(url => overlap.has(url)));
    const newEvidence = new Set((after?.evidence || []).map(item => item.url).filter(url => overlap.has(url)));
    if (!oldEvidence.size && !newEvidence.size) continue;
    const newlyObserved = [...newEvidence].filter(url => !oldEvidence.has(url)).sort();
    const noLongerObserved = [...oldEvidence].filter(url => !newEvidence.has(url)).sort();
    const stillObserved = [...newEvidence].filter(url => oldEvidence.has(url)).sort();
    const finding = after || before!;
    rows.push({ ruleId, title: finding.title, priority: finding.priority, category: finding.category, newlyObserved, noLongerObserved, stillObserved });
  }
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rows.sort((left, right) => order[left.priority] - order[right.priority] || right.newlyObserved.length - left.newlyObserved.length || right.noLongerObserved.length - left.noLongerObserved.length || left.title.localeCompare(right.title));
  return {
    status: 'comparable', previousAt: previous.checkedAt, overlappingPages: overlap.size,
    excludedRules, rows,
    newlyObserved: rows.reduce((sum, row) => sum + row.newlyObserved.length, 0),
    noLongerObserved: rows.reduce((sum, row) => sum + row.noLongerObserved.length, 0),
    stillObserved: rows.reduce((sum, row) => sum + row.stillObserved.length, 0),
  };
}
