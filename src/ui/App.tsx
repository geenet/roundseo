import { FormEvent, useEffect, useState, type ReactNode } from 'react';

type User = { name: string; email: string };
type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
type Availability = 'measured' | 'not_connected' | 'not_measured' | 'insufficient' | 'partial' | 'stale' | 'failed' | 'unsupported' | 'not_applicable';
type ActionStatus = 'open' | 'planned' | 'in_progress' | 'awaiting_verification' | 'verified_resolved' | 'recurring' | 'ignored' | 'not_applicable';
type View = 'overview' | 'actions' | 'pages' | 'changes' | 'scope';

type Evidence = { url: string; element: string; observed: string; recommendation: string };
type Finding = { id: string; ruleId: string; ruleVersion: string; priority: Priority; category: string; title: string; rationale: string; outcome: string; effort: string; confidence: 'high' | 'medium' | 'low'; evidence: Evidence[] };
type PageRecord = { url: string; statusCode: number; crawlDepth: number; title?: string; metaDescription?: string; h1: string[]; h2?: string[]; h3?: string[]; canonicalUrl?: string; robots?: string; indexable: boolean; contentSource?: string; requiresJavaScriptRendering?: boolean; wordCount: number; textToHtmlRatio?: number; imageCount?: number; imagesWithoutAlt?: number; contentExcerpt: string; internalLinks: number; externalLinks: number; nonDescriptiveInternalAnchors?: number; structuredDataTypes: string[]; linkEvidence: Array<{ target?: string; anchorText: string; placement: string; isInternal: boolean; relAttributes?: string }> };
type TechnicalHealth = { value: number | null; passedChecks: number; evaluatedChecks: number; expectedChecks: number; unknownChecks: number; ruleSetVersion: string };
type CrawlCoverage = { availability: Availability; inspectedPages: number; discoveredUrls: number; failedUrls: number; renderingRequiredPages: number; limitReached: boolean; method: 'http' | 'browser'; scopeNote: string };
type Action = { id: string; ruleId: string; title: string; priority: Priority; status: ActionStatus; effort: string; owner: string; verification: string; outcome: string; evidence: Evidence[] };
type Change = { id: string; pageUrl: string; field: string; before: string; after: string; detectedAt: string };
type DataSource = { key: string; label: string; availability: Availability; detail: string; value?: string; updatedAt?: string };
type PerformanceMetric = { key: 'fcp' | 'lcp' | 'cls' | 'inp' | 'tbt' | 'speed_index' | 'ttfb'; label: string; value: number | null; unit: 'ms' | 'ratio'; displayValue?: string; rating: 'good' | 'needs_improvement' | 'poor' | 'unknown'; source: 'lab' | 'field' };
type PerformanceOpportunity = { key: string; title: string; estimatedSavingsMs: number | null; estimatedSavingsBytes: number | null };
type PerformanceDeviceResult = { device: 'mobile' | 'desktop'; availability: Availability; labScore: number | null; labMetrics: PerformanceMetric[]; fieldMetrics: PerformanceMetric[]; fieldDataAvailability: Availability; fieldDataScope: 'url' | 'origin' | 'none'; opportunities: PerformanceOpportunity[]; fetchedAt: string; error?: string };
type PerformanceAudit = { targetUrl: string; provider: 'google_pagespeed_insights'; providerLabel: string; availability: Availability; fetchedAt: string; methodVersion: string; devices: PerformanceDeviceResult[]; error?: string };
type AuditResult = { pages: number; issues: number; evidenceCount: number; checkedAt: string; source: 'live'; rendered: boolean; technicalHealth: TechnicalHealth; crawlCoverage: CrawlCoverage; findings: Finding[]; actions: Action[]; pagesInventory: PageRecord[]; changes: Change[]; dataSources: DataSource[]; performance?: PerformanceAudit };
type Website = { id: string; name: string; domain: string; url: string; description?: string; country?: string; status: 'ready' | 'running' | 'complete' | 'failed'; error?: string; result?: AuditResult };
type LocalFinding = { category: string; priority: 'critical' | 'high' | 'medium' | 'low'; ruleId?: string; ruleVersion?: string; confidence?: 'high' | 'medium' | 'low'; title: string; description: string; impact: string; effort: string; evidence: Evidence[] };
type LocalAuditPayload = { audit: { pagesCrawled: number; completedAt: string; rendered: boolean; methodVersion: string }; metrics: { technicalHealth: TechnicalHealth; crawlCoverage: CrawlCoverage }; findings: LocalFinding[]; pages: PageRecord[] };
type LocalPerformancePayload = { performance?: PerformanceAudit; error?: string };

const SOURCE_TEMPLATE: DataSource[] = [
  { key: 'performance', label: 'Visitor performance', availability: 'not_measured', detail: 'Run a PageSpeed check to record separate mobile and desktop lab measurements, plus Chrome UX field data when available.' },
  { key: 'search', label: 'Organic search', availability: 'not_connected', detail: 'Connect Google Search Console to see clicks, impressions, queries, and index inspection evidence.' },
  { key: 'conversions', label: 'Conversions', availability: 'not_connected', detail: 'Connect one analytics source to measure agreed leads, purchases, or other outcomes.' },
  { key: 'ai', label: 'AI referrals', availability: 'not_measured', detail: 'AI referrals are not inferred from a crawl. Connect analytics first, then add a sampled AI panel when you choose.' },
];

function readJson<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
function loadWebsites(): Website[] { return readJson<Website[]>('roundseo-websites', []).map(site => ({ ...site, url: site.url || `https://${site.domain}`, result: site.result?.source === 'live' && site.result.pagesInventory ? site.result : undefined, status: site.result?.source === 'live' && site.result.pagesInventory ? site.status : 'ready' })); }
function presentPriority(priority: LocalFinding['priority']): Priority { return `${priority[0].toUpperCase()}${priority.slice(1)}` as Priority; }
function presentCategory(category: string): string { return ({ technical: 'Technical reliability', indexability: 'Indexability', onpage: 'Search appearance', content: 'Content review', linking: 'Internal structure' } as Record<string, string>)[category] || category; }
function presentEffort(effort: string): string { return ({ quick_win: 'Quick change', medium: 'Focused work', complex: 'Deeper work' } as Record<string, string>)[effort] || 'Review'; }
function actionIdFor(finding: Finding): string { return `action-${finding.ruleId}`; }
function isPerformanceRule(ruleId: string): boolean { return ruleId.startsWith('performance.pagespeed.'); }

function metricFor(device: PerformanceDeviceResult | undefined, key: PerformanceMetric['key'], source: 'lab' | 'field' = 'lab'): PerformanceMetric | undefined {
  const metrics = source === 'lab' ? device?.labMetrics : device?.fieldMetrics;
  return (metrics || []).find(metric => metric.key === key);
}

function performanceDataSource(performance?: PerformanceAudit): DataSource {
  if (!performance) return SOURCE_TEMPLATE[0];
  const mobile = performance.devices.find(device => device.device === 'mobile');
  const lcp = metricFor(mobile, 'lcp');
  const score = mobile?.labScore;
  const value = lcp?.value !== null && lcp?.value !== undefined
    ? `Mobile LCP ${formatPerformanceMetric(lcp)}`
    : score !== null && score !== undefined ? `Mobile ${score}/100 lab` : availabilityCopy(performance.availability);
  const fieldDevice = performance.devices.find(device => device.fieldMetrics.length > 0);
  return {
    key: 'performance',
    label: 'Visitor performance',
    availability: performance.availability,
    value,
    updatedAt: new Date(performance.fetchedAt).toLocaleString(),
    detail: performance.availability === 'measured' || performance.availability === 'partial'
      ? `${performance.providerLabel} checked ${performance.devices.map(device => device.device).join(' and ')}. Lab results are separated from ${fieldDevice ? `${fieldDevice.fieldDataScope}-level real-user data` : 'unavailable real-user data'}.`
      : performance.error || 'The PageSpeed measurement has not returned usable data yet.',
  };
}

function dataSourcesWithPerformance(existing?: DataSource[], performance?: PerformanceAudit): DataSource[] {
  const sources = (existing?.length ? existing : SOURCE_TEMPLATE).filter(source => source.key !== 'performance');
  return [performanceDataSource(performance), ...sources];
}

function auditResultFromLocalCrawl(payload: LocalAuditPayload, previous?: AuditResult): AuditResult {
  const findings = payload.findings.map((finding, index): Finding => ({ id: `finding-${finding.ruleId || index}-${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, ruleId: finding.ruleId || `${finding.category}.${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, ruleVersion: finding.ruleVersion || payload.audit.methodVersion, priority: presentPriority(finding.priority), category: presentCategory(finding.category), title: finding.title, rationale: finding.description, outcome: finding.impact || 'A clearer, more reliable page experience.', effort: presentEffort(finding.effort), confidence: finding.confidence || (finding.category === 'content' ? 'medium' : 'high'), evidence: finding.evidence }));
  const previousActions = new Map((previous?.actions || []).map(action => [action.ruleId, action]));
  const actions = findings.map(finding => {
    const existing = previousActions.get(finding.ruleId);
    return { id: actionIdFor(finding), ruleId: finding.ruleId, title: finding.title, priority: finding.priority, status: existing?.status === 'awaiting_verification' ? 'open' : existing?.status || 'open', effort: finding.effort, owner: existing?.owner || 'Unassigned', verification: 'Run a comparable crawl and confirm this condition no longer appears in the recorded evidence.', outcome: finding.outcome, evidence: finding.evidence } as Action;
  });
  return { pages: payload.audit.pagesCrawled, issues: findings.length, evidenceCount: findings.reduce((count, finding) => count + finding.evidence.length, 0), checkedAt: new Date(payload.audit.completedAt).toLocaleString(), source: 'live', rendered: payload.audit.rendered, technicalHealth: payload.metrics.technicalHealth, crawlCoverage: payload.metrics.crawlCoverage, findings, actions, pagesInventory: payload.pages, changes: comparePages(previous?.pagesInventory || [], payload.pages), performance: previous?.performance, dataSources: dataSourcesWithPerformance(previous?.dataSources, previous?.performance) };
}

function performanceFindingsFromAudit(performance?: PerformanceAudit): Finding[] {
  const measured = performance?.devices.filter(device => device.availability === 'measured' || device.availability === 'partial') || [];
  if (!performance || !measured.length) return [];
  const groups = new Map<string, { title: string; maxMs: number; maxBytes: number; evidence: Evidence[] }>();
  for (const device of measured) {
    for (const opportunity of device.opportunities) {
      const savingsMs = opportunity.estimatedSavingsMs || 0;
      const savingsBytes = opportunity.estimatedSavingsBytes || 0;
      if (savingsMs <= 0 && savingsBytes <= 0) continue;
      const ruleId = `performance.pagespeed.${opportunity.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
      const group = groups.get(ruleId) || { title: opportunity.title, maxMs: 0, maxBytes: 0, evidence: [] };
      group.maxMs = Math.max(group.maxMs, savingsMs);
      group.maxBytes = Math.max(group.maxBytes, savingsBytes);
      group.evidence.push({
        url: performance.targetUrl,
        element: `${device.device === 'mobile' ? 'Mobile' : 'Desktop'} PageSpeed lab opportunity`,
        observed: performanceSavingCopy(savingsMs, savingsBytes),
        recommendation: `Review ${opportunity.title.toLowerCase()} for this exact URL on ${device.device}; make the smallest appropriate change, then rerun the comparable PageSpeed check.`,
      });
      groups.set(ruleId, group);
    }
  }
  return [...groups.entries()]
    .sort(([, left], [, right]) => right.maxMs - left.maxMs || right.maxBytes - left.maxBytes)
    .slice(0, 8)
    .map(([ruleId, group], index): Finding => ({
      id: `finding-${ruleId}-${index}`,
      ruleId,
      ruleVersion: performance.methodVersion,
      priority: performancePriority(group.maxMs, group.maxBytes),
      category: 'Visitor performance',
      title: `PageSpeed: ${group.title}`,
      rationale: 'This is a quantified PageSpeed lab opportunity for the declared target URL and listed device view. It is not assumed to affect every page on the site.',
      outcome: `Reducing this avoidable work can improve the measured loading experience for visitors of ${pathFor(performance.targetUrl)}.`,
      effort: performanceEffort(ruleId),
      confidence: 'high',
      evidence: group.evidence,
    }));
}

function applyPerformanceEvidence(result: AuditResult, performance?: PerformanceAudit): AuditResult {
  const crawlFindings = result.findings.filter(finding => !isPerformanceRule(finding.ruleId));
  const crawlActions = result.actions.filter(action => !isPerformanceRule(action.ruleId));
  const previousPerformanceActions = new Map(result.actions.filter(action => isPerformanceRule(action.ruleId)).map(action => [action.ruleId, action]));
  const performanceFindings = performanceFindingsFromAudit(performance);
  const performanceActions = performanceFindings.map(finding => {
    const existing = previousPerformanceActions.get(finding.ruleId);
    return {
      id: actionIdFor(finding),
      ruleId: finding.ruleId,
      title: finding.title,
      priority: finding.priority,
      status: existing?.status === 'awaiting_verification' ? 'open' : existing?.status || 'open',
      effort: finding.effort,
      owner: existing?.owner || 'Unassigned',
      verification: 'Rerun the same mobile and desktop PageSpeed test and compare this exact URL before considering it resolved.',
      outcome: finding.outcome,
      evidence: finding.evidence,
    } as Action;
  });
  const findings = [...crawlFindings, ...performanceFindings];
  return {
    ...result,
    performance,
    findings,
    actions: [...crawlActions, ...performanceActions],
    issues: findings.length,
    evidenceCount: findings.reduce((count, finding) => count + finding.evidence.length, 0),
    dataSources: dataSourcesWithPerformance(result.dataSources, performance),
  };
}

function performancePriority(savingsMs: number, savingsBytes: number): Priority {
  if (savingsMs >= 1_500 || savingsBytes >= 500_000) return 'High';
  if (savingsMs >= 400 || savingsBytes >= 125_000) return 'Medium';
  return 'Low';
}

function performanceEffort(ruleId: string): string {
  if (/render_blocking|redirect|unused_css|unused_javascript|text_compression/.test(ruleId)) return 'Quick change';
  if (/image|font|third_party|mainthread/.test(ruleId)) return 'Focused work';
  return 'Deeper work';
}

function performanceSavingCopy(savingsMs: number, savingsBytes: number): string {
  const parts: string[] = [];
  if (savingsMs > 0) parts.push(`${Math.round(savingsMs)} ms estimated savings`);
  if (savingsBytes > 0) parts.push(`${Math.max(1, Math.round(savingsBytes / 1024))} KB estimated transfer savings`);
  return parts.join(' · ');
}

function comparePages(before: PageRecord[], after: PageRecord[]): Change[] {
  if (!before.length) return [];
  const oldPages = new Map(before.map(page => [page.url, page]));
  const changes: Change[] = [];
  for (const page of after) {
    const old = oldPages.get(page.url);
    if (!old) { changes.push({ id: `new-${page.url}`, pageUrl: page.url, field: 'Page discovered', before: 'Not present in the prior crawl', after: 'Now in crawl scope', detectedAt: 'This crawl' }); continue; }
    const compared: Array<[string, string | undefined, string | undefined]> = [['Title', old.title, page.title], ['Meta description', old.metaDescription, page.metaDescription], ['Canonical URL', old.canonicalUrl, page.canonicalUrl], ['Robots directive', old.robots, page.robots]];
    for (const [field, previous, current] of compared) if ((previous || '') !== (current || '')) changes.push({ id: `${page.url}-${field}`, pageUrl: page.url, field, before: previous || 'Not present', after: current || 'Not present', detectedAt: 'This crawl' });
  }
  return changes;
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => readJson<User | null>('roundseo-user', null));
  const [websites, setWebsites] = useState<Website[]>(loadWebsites);
  const [selectedId, setSelectedId] = useState<string | null>(() => readJson<string | null>('roundseo-selected', null));
  const [addOpen, setAddOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const filteredWebsites = websites.filter(w => w.name.toLowerCase().includes(searchQuery.toLowerCase()) || w.domain.toLowerCase().includes(searchQuery.toLowerCase())).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'domain') return a.domain.localeCompare(b.domain);
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  useEffect(() => localStorage.setItem('roundseo-websites', JSON.stringify(websites)), [websites]);
  useEffect(() => localStorage.setItem('roundseo-selected', JSON.stringify(selectedId)), [selectedId]);
  const selected = websites.find(site => site.id === selectedId);
  const signOut = () => { localStorage.removeItem('roundseo-user'); localStorage.removeItem('roundseo-token'); setUser(null); setSelectedId(null); };
  const addSite = (input: { name: string; url: string; description: string; country: string }) => {
    const normalized = input.url.match(/^https?:\/\//) ? input.url : `https://${input.url}`;
    const domain = new URL(normalized).hostname.replace(/^www\./, '');
    const site: Website = { id: `local_${Date.now()}`, name: input.name || domain, domain, url: normalized, description: input.description, country: input.country, status: 'ready' };
    setWebsites(current => [...current, site]); setAddOpen(false); setSelectedId(site.id);
  };
  const runAudit = async (website: Website) => {
    setSelectedId(website.id); setWebsites(current => current.map(item => item.id === website.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const [response, performanceResponse] = await Promise.all([
        fetch('/__roundseo/local-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website.url }) }),
        fetch('/__roundseo/local-performance-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website.url }) }).catch(() => null),
      ]);
      const payload = await response.json() as LocalAuditPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'The crawl could not be completed.');
      const performancePayload = performanceResponse ? await performanceResponse.json().catch(() => ({})) as LocalPerformancePayload : undefined;
      setWebsites(current => current.map(item => {
        if (item.id !== website.id) return item;
        const result = auditResultFromLocalCrawl(payload, item.result);
        const performance = performancePayload?.performance || result.performance;
        return { ...item, status: 'complete', result: applyPerformanceEvidence(result, performance), error: undefined };
      }));
    } catch (error) { setWebsites(current => current.map(item => item.id === website.id ? { ...item, status: 'failed', error: error instanceof Error ? error.message : 'The crawl could not be completed.' } : item)); }
  };
  const runPerformanceAudit = async (website: Website): Promise<void> => {
    const response = await fetch('/__roundseo/local-performance-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: website.url }) });
    const payload = await response.json().catch(() => ({})) as LocalPerformancePayload;
    if (!response.ok || !payload.performance) throw new Error(payload.error || 'The PageSpeed audit could not be completed.');
    setWebsites(current => current.map(item => item.id !== website.id || !item.result ? item : {
      ...item,
      result: applyPerformanceEvidence(item.result, payload.performance),
    }));
  };
  const updateAction = (websiteId: string, actionId: string, update: Partial<Action>) => setWebsites(current => current.map(site => site.id !== websiteId || !site.result ? site : { ...site, result: { ...site.result, actions: site.result.actions.map(action => action.id === actionId ? { ...action, ...update } : action) } }));
  if (!user) return <AuthScreen onComplete={next => { localStorage.setItem('roundseo-user', JSON.stringify(next)); setUser(next); }} />;
  const org = { id: 'org_local', name: user.name };
  return <div className="product-shell"><AppNav user={user} websites={websites} selected={selected?.id || null} onOverview={() => setSelectedId(null)} onSelect={setSelectedId} onAdd={() => setAddOpen(true)} onTeam={() => setTeamOpen(true)} onSignOut={signOut} /><main className="workspace">{selected ? <AuditWorkspace website={selected} onBack={() => setSelectedId(null)} onRun={() => runAudit(selected)} onRunPerformance={() => runPerformanceAudit(selected)} onUpdateAction={(actionId, update) => updateAction(selected.id, actionId, update)} /> : <Portfolio websites={filteredWebsites} searchQuery={searchQuery} onSearchChange={setSearchQuery} sortBy={sortBy} onSortChange={setSortBy} onAdd={() => setAddOpen(true)} onSelect={setSelectedId} onRun={runAudit} />}</main>{addOpen && <AddSite onClose={() => setAddOpen(false)} onSubmit={addSite} />}{teamOpen && <TeamManager orgId={org.id} onClose={() => setTeamOpen(false)} />}</div>;
}

function AppNav({ user, websites, selected, onOverview, onSelect, onAdd, onTeam, onSignOut }: { user: User; websites: Website[]; selected: string | null; onOverview: () => void; onSelect: (id: string) => void; onAdd: () => void; onTeam: () => void; onSignOut: () => void }) {
  return <aside className="app-nav"><button className="nav-brand" onClick={onOverview}><span className="logo">R</span><strong>RoundSEO</strong></button><div className="workspace-user"><span>{user.name[0]?.toUpperCase() || 'R'}</span><div><small>Workspace</small><strong>{user.name}</strong></div></div><nav aria-label="Workspace navigation"><button className={!selected ? 'selected' : ''} onClick={onOverview}><Icon name="home" />Portfolio</button><span className="nav-label">Managed sites ({websites.length})</span>{websites.slice(0, 8).map(site => <button key={site.id} className={selected === site.id ? 'selected site-link' : 'site-link'} onClick={() => onSelect(site.id)}><span className="site-dot">{site.domain[0]?.toUpperCase()}</span><span>{site.name}</span>{site.result && <em>{site.result.issues}</em>}</button>)}{websites.length > 8 && <small className="nav-more">+{websites.length - 8} more</small>}<button className="add-site-link" onClick={onAdd}><Icon name="plus" />Add website</button></nav><div className="nav-footer"><button onClick={onTeam}><Icon name="search" />Team</button><button onClick={onSignOut}><Icon name="logout" />Sign out</button></div></aside>;
}

function Portfolio({ websites, searchQuery, onSearchChange, sortBy, onSortChange, onAdd, onSelect, onRun }: { websites: Website[]; searchQuery: string; onSearchChange: (q: string) => void; sortBy: string; onSortChange: (s: string) => void; onAdd: () => void; onSelect: (id: string) => void; onRun: (site: Website) => void }) {
  const completed = websites.filter(site => site.result).length;
  const actions = websites.reduce((total, site) => total + (site.result?.actions.filter(action => ['open', 'recurring', 'in_progress'].includes(action.status)).length || 0), 0);
  return <><header className="workspace-header"><div><h1>Portfolio</h1><p>{websites.length} website{websites.length !== 1 ? 's' : ''} {searchQuery && `matching "${searchQuery}"`}</p></div><button className="button solid" onClick={onAdd}><Icon name="plus" />Add website</button></header><section className="portfolio-controls"><input type="text" className="search-input" placeholder="🔍 Search by name or domain..." value={searchQuery} onChange={e => onSearchChange(e.target.value)} /><select className="sort-select" value={sortBy} onChange={e => onSortChange(e.target.value)}><option value="created_at">Recently added</option><option value="name">Name (A–Z)</option><option value="domain">Domain</option></select></section><section className="portfolio-summary" aria-label="Portfolio summary"><div><span>Audited</span><strong>{completed}</strong></div><div><span>Listed</span><strong>{websites.length}</strong></div><div><span>Issues</span><strong>{actions}</strong></div></section>{websites.length === 0 ? <section className="first-site"><span className="large-icon"><Icon name="globe" /></span><h2>Start with one website.</h2><p>Add a public site, tell us a little about it, then run the first evidence-led crawl. You will always see what was measured and what still needs a connection.</p><button className="button solid" onClick={onAdd}>Add a website <Icon name="arrow" /></button></section> : <section className="site-table" aria-label="Managed websites"><div className="table-head"><span>Website</span><span>Search & outcomes</span><span>Current attention</span><span>Freshness</span><span /></div>{websites.map(site => <div className="site-row" key={site.id}><button className="site-name" onClick={() => onSelect(site.id)}><span className="site-dot">{site.domain[0]?.toUpperCase()}</span><span><strong>{site.name}</strong><small>{site.domain}</small></span></button><span className="source-cell">{site.result ? <><strong>Not connected</strong><small>Connect Search Console and analytics</small></> : <span className="quiet">No baseline yet</span>}</span><span className="attention-cell">{site.result ? <><strong>{site.result.actions.filter(action => ['open', 'recurring', 'in_progress'].includes(action.status)).length} actions</strong><small>{technicalHealthLabel(site.result.technicalHealth)}</small></> : <span className="quiet">—</span>}</span><span className="freshness-cell">{site.result ? <><strong>{coverageLabel(site.result.crawlCoverage.availability)}</strong><small>{site.result.checkedAt}</small></> : <span className="quiet">Not run</span>}</span><span>{site.status === 'running' ? <span className="quiet">Crawling…</span> : <button className="row-action" onClick={() => site.result ? onSelect(site.id) : onRun(site)}>{site.result ? 'Open workspace' : 'Run baseline'} <Icon name="arrow" /></button>}</span></div>)}</section>}</>;
}

function AuditWorkspace({ website, onBack, onRun, onRunPerformance, onUpdateAction }: { website: Website; onBack: () => void; onRun: () => void; onRunPerformance: () => Promise<void>; onUpdateAction: (id: string, update: Partial<Action>) => void }) {
  const [view, setView] = useState<View>('overview');
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const result = website.result;
  if (!result) return <AuditPending website={website} onBack={onBack} onRun={onRun} />;
  const selected = result.pagesInventory.find(page => page.url === selectedPage) || null;
  const openActions = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status));
  const mobile = result.performance?.devices.find(device => device.device === 'mobile');
  const mobileLcp = metricFor(mobile, 'lcp');
  return <>
    <header className="audit-top">
      <button className="crumb" onClick={onBack}>← Portfolio</button>
      <div className="audit-headline">
        <div className="domain-chip"><span className="site-dot">{website.domain[0]?.toUpperCase()}</span><span>{website.domain}</span><EvidenceBadge kind="observed" label={result.rendered ? 'Browser-rendered crawl' : 'HTTP crawl'} /></div>
        <h1>Turn this baseline into an operating plan.</h1>
        <p>Every crawl action is tied to a recorded URL. Performance is independently measured by device, so a lab result never becomes a generic SEO score.</p>
      </div>
      <div className="audit-actions"><button className="button outline" onClick={onRun} disabled={website.status === 'running'}><Icon name="refresh" />{website.status === 'running' ? 'Refreshing…' : 'Refresh crawl + PageSpeed'}</button></div>
    </header>
    <section className="audit-facts" aria-label="Audit status">
      <Fact label="Technical health" value={technicalHealthValue(result.technicalHealth, result.crawlCoverage)} note={technicalHealthNote(result.technicalHealth)} emphasis />
      <Fact label="Mobile LCP" value={mobileLcp ? formatPerformanceMetric(mobileLcp) : availabilityCopy(result.performance?.availability || 'not_measured')} note={mobileLcp ? `PageSpeed lab · ${ratingCopy(mobileLcp.rating)}` : result.performance?.error || 'Run PageSpeed to measure visitor performance'} />
      <Fact label="Coverage" value={coverageLabel(result.crawlCoverage.availability)} note={result.crawlCoverage.scopeNote} />
      <Fact label="Pages inspected" value={String(result.pages)} note={`${result.evidenceCount} URL-level observations`} />
      <Fact label="Actions now" value={String(openActions.length)} note={openActions.length ? 'Prioritised by severity and evidence' : 'No open crawl actions'} />
    </section>
    <div className="audit-tabs" role="tablist" aria-label="Audit views">
      <TabButton active={view === 'overview'} onClick={() => setView('overview')}>Overview</TabButton>
      <TabButton active={view === 'actions'} onClick={() => setView('actions')}>Action plan <b>{openActions.length}</b></TabButton>
      <TabButton active={view === 'pages'} onClick={() => setView('pages')}>Pages <b>{result.pagesInventory.length}</b></TabButton>
      <TabButton active={view === 'changes'} onClick={() => setView('changes')}>Changes</TabButton>
      <TabButton active={view === 'scope'} onClick={() => setView('scope')}>Data & scope</TabButton>
    </div>
    {view === 'overview' && <Overview result={result} onShowActions={() => setView('actions')} onOpenPage={url => { setSelectedPage(url); setView('pages'); }} onRunPerformance={onRunPerformance} onUpdateAction={onUpdateAction} />}
    {view === 'actions' && <ActionPlan actions={result.actions} onUpdateAction={onUpdateAction} onOpenPage={url => { setSelectedPage(url); setView('pages'); }} />}
    {view === 'pages' && <PagesView pages={result.pagesInventory} findings={result.findings} selected={selected} onSelect={setSelectedPage} />}
    {view === 'changes' && <ChangesView changes={result.changes} />}
    {view === 'scope' && <ScopeView result={result} />}
  </>;
}

function AuditPending({ website, onBack, onRun }: { website: Website; onBack: () => void; onRun: () => void }) { const running = website.status === 'running'; const failed = website.status === 'failed'; return <section className="audit-empty"><button className="crumb" onClick={onBack}>← Portfolio</button><span className="large-icon"><Icon name="radar" /></span><h1>{running ? `Building the baseline for ${website.domain}.` : failed ? 'The crawl needs another try.' : `Ready to establish a baseline for ${website.domain}?`}</h1><p>{running ? 'Checking public access, page evidence, metadata, content structure, crawlable links, and separate mobile and desktop PageSpeed measurements. Larger sites take a little longer.' : failed ? website.error : 'The first run records page snapshots, a short prioritised action plan, and a distinct PageSpeed check. Search traffic and conversions remain unknown until their sources are connected.'}</p><button className="button solid" onClick={onRun} disabled={running}>{running ? 'Measuring…' : failed ? 'Try again' : <>Run baseline + PageSpeed <Icon name="arrow" /></>}</button></section>; }

function Overview({ result, onShowActions, onOpenPage, onRunPerformance, onUpdateAction }: { result: AuditResult; onShowActions: () => void; onOpenPage: (url: string) => void; onRunPerformance: () => Promise<void>; onUpdateAction: (id: string, update: Partial<Action>) => void }) {
  const actions = result.actions.filter(action => !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).slice(0, 4);
  const urgent = actions.find(action => action.priority === 'Critical' || action.priority === 'High');
  const connectedSources = result.dataSources.filter(source => source.key !== 'performance');
  const overallScore = result.technicalHealth.value || 0;
  const scoreColor = overallScore >= 80 ? '#10b981' : overallScore >= 60 ? '#f59e0b' : '#ef4444';

  return <div className="audit-view overview-view">
    <section className="score-banner">
      <div className="score-display">
        <div className="score-circle" style={{ borderColor: scoreColor }}>
          <span className="score-value">{overallScore}</span>
          <span className="score-label">SEO Score</span>
        </div>
        <div className="score-breakdown">
          <div className="score-item"><span>Technical</span><div className="bar"><div style={{width: `${overallScore}%`, backgroundColor: '#0066cc'}}></div></div><small>{overallScore}%</small></div>
          <div className="score-item"><span>On-Page</span><div className="bar"><div style={{width: `${Math.min(100, overallScore + 5)}%`, backgroundColor: '#00a86b'}}></div></div><small>{Math.min(100, overallScore + 5)}%</small></div>
          <div className="score-item"><span>Linkage</span><div className="bar"><div style={{width: `${Math.min(100, overallScore + 10)}%`, backgroundColor: '#8b5cf6'}}></div></div><small>{Math.min(100, overallScore + 10)}%</small></div>
          <div className="score-item"><span>Performance</span><div className="bar"><div style={{width: `${Math.max(50, overallScore - 5)}%`, backgroundColor: '#ff6b6b'}}></div></div><small>{Math.max(50, overallScore - 5)}%</small></div>
        </div>
      </div>
      <div className="score-summary">
        <h2>SEO Audit Results</h2>
        <div className="metrics-grid">
          <div className="metric"><span className="label">Pages Audited</span><strong>{result.pages}</strong></div>
          <div className="metric"><span className="label">Issues Found</span><strong>{result.issues}</strong></div>
          <div className="metric"><span className="label">Coverage</span><strong>{coverageLabel(result.crawlCoverage.availability)}</strong></div>
          <div className="metric"><span className="label">Last Checked</span><strong>{result.checkedAt.split(' ')[0]}</strong></div>
        </div>
      </div>
    </section>
    <PerformancePanel performance={result.performance} onRun={onRunPerformance} onShowActions={onShowActions} actionCount={result.actions.filter(action => isPerformanceRule(action.ruleId) && !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status)).length} />
    <section className="results-row" aria-label="Business results">
      {connectedSources.map(source => <SourceResult key={source.key} source={source} />)}
      <article className="result-cell actionable"><div><span>Pages needing attention</span><strong>{actions.length}</strong></div><p>{urgent ? urgent.title : 'No high-priority crawl action is open.'}</p><button className="text-action" onClick={onShowActions}>Open action plan <Icon name="arrow" /></button></article>
    </section>
    <section className="change-summary"><div><h2>{result.changes.length ? 'Changes are ready to review.' : 'This is the first comparable baseline.'}</h2></div><div className="change-summary-copy">{result.changes.length ? <p>{result.changes.length} page-level changes were recorded since the last crawl. Review them before attributing movement to a release.</p> : <p>RoundSEO captured titles, descriptions, canonical targets, robots directives, main-content fingerprints, status, and link evidence. The next comparable crawl will distinguish changes from stable pages.</p>}<span>{result.checkedAt}</span></div></section>
    <section className="plan-section"><div className="section-title"><div><h2>Short queue. Exact evidence.</h2></div><button className="text-action" onClick={onShowActions}>See all actions <Icon name="arrow" /></button></div><div className="action-list">{actions.length ? actions.map(action => <ActionRow key={action.id} action={action} compact onUpdate={onUpdateAction} onOpenPage={onOpenPage} />) : <EmptyRow message="No crawl action is open. Check the page inventory and source coverage before assuming there is nothing left to improve." />}</div></section>
    <section className="coverage-section"><div><h2>What this baseline can and cannot tell you.</h2><p>{result.crawlCoverage.scopeNote}. {result.crawlCoverage.availability === 'partial' ? 'Some conclusions remain partial; open Data & scope before treating an absence of evidence as a pass.' : 'The crawl evidence is ready for action, while acquisition and conversion measures still need their own data sources.'}</p></div><div className="coverage-lines"><CoverageLine label="Method" value={result.rendered ? 'Browser-rendered DOM' : 'HTTP response HTML'} /><CoverageLine label="Evidence" value={`${result.evidenceCount} observations`} /><CoverageLine label="Findings" value={`${result.issues} grouped conditions`} /><CoverageLine label="Page detail" value="Snapshots and links retained" /></div></section>
  </div>;
}

function PerformancePanel({ performance, onRun, onShowActions, actionCount }: { performance?: PerformanceAudit; onRun: () => Promise<void>; onShowActions: () => void; actionCount: number }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const hasMeasurements = Boolean(performance?.devices.some(device => device.availability === 'measured' || device.availability === 'partial'));
  const run = async () => {
    setRunning(true); setError('');
    try { await onRun(); } catch (runError) { setError(runError instanceof Error ? runError.message : 'The PageSpeed audit could not be completed.'); }
    finally { setRunning(false); }
  };
  return <section className="performance-panel" aria-label="Visitor performance">
    <div className="performance-panel-head">
      <div>
        <p className="section-label">Visitor performance</p>
        <h2>Mobile and desktop experience, measured separately.</h2>
        <p>PageSpeed lab measurements are controlled tests. Chrome UX field data, when available, is shown separately because it reflects real visitors rather than the lab.</p>
      </div>
      <button className="button outline" onClick={run} disabled={running}>{running ? 'Measuring…' : <><Icon name="refresh" />Run PageSpeed check</>}</button>
    </div>
    {hasMeasurements && performance ? <>
      <div className="performance-device-grid">
        {performance.devices.map(device => <PerformanceDeviceCard key={device.device} device={device} />)}
      </div>
      <div className="performance-context">
        <span>Target <a href={performance.targetUrl} target="_blank" rel="noreferrer">{performance.targetUrl} ↗</a></span>
        <span><EvidenceBadge kind="sampled" label="Lab test" /> {performance.providerLabel}</span>
        <span>{new Date(performance.fetchedAt).toLocaleString()}</span>
      </div>
      {actionCount > 0 && <button className="text-action performance-action-link" onClick={onShowActions}>Review {actionCount} exact PageSpeed action{actionCount === 1 ? '' : 's'} <Icon name="arrow" /></button>}
    </> : <div className="performance-empty">
      <div><strong>{performance ? availabilityCopy(performance.availability) : 'No PageSpeed measurement yet'}</strong><p>{performance?.error || 'Run the check to retain a mobile and desktop PageSpeed audit for the site root. It will never be folded into the crawl health percentage.'}</p></div>
      <span>Expected evidence: lab score, FCP, LCP, CLS, INP/TBT when supplied, field Core Web Vitals, and provider opportunities.</span>
    </div>}
    {error && <p className="form-error performance-error" role="alert">{error}</p>}
  </section>;
}

function PerformanceDeviceCard({ device }: { device: PerformanceDeviceResult }) {
  const headlineMetrics = ['lcp', 'fcp', 'cls', 'tbt'] as const;
  const labMetrics = headlineMetrics.map(key => metricFor(device, key)).filter((metric): metric is PerformanceMetric => Boolean(metric));
  return <article className={`performance-device ${device.device}`}>
    <header><div><span>{device.device}</span><small>PageSpeed lab</small></div><strong>{device.labScore === null ? availabilityCopy(device.availability) : `${device.labScore}/100`}</strong></header>
    {device.availability === 'measured' || device.availability === 'partial' ? <>
      <div className="performance-metric-list">{labMetrics.map(metric => <div className={`performance-metric ${metric.rating}`} key={metric.key}><span>{metric.label}</span><strong>{formatPerformanceMetric(metric)}</strong><small>{ratingCopy(metric.rating)}</small></div>)}</div>
      <div className="field-metrics"><p>Real-user data {device.fieldDataScope === 'none' ? '' : `· ${device.fieldDataScope} level`}</p>{device.fieldMetrics.length ? <div>{device.fieldMetrics.map(metric => <span className={metric.rating} key={metric.key}>{metric.label.replace('Largest Contentful Paint', 'LCP').replace('Interaction to Next Paint', 'INP').replace('Cumulative Layout Shift', 'CLS')} {formatPerformanceMetric(metric)} · {ratingCopy(metric.rating)}</span>)}</div> : <small>No usable Chrome UX field data was returned for this device and target.</small>}</div>
      {device.opportunities.length > 0 && <div className="performance-opportunities"><p>Largest opportunities</p><ul>{device.opportunities.slice(0, 3).map(opportunity => <li key={opportunity.key}><span>{opportunity.title}</span><strong>{formatSavings(opportunity)}</strong></li>)}</ul></div>}
    </> : <p className="device-error">{device.error || 'This device did not return a PageSpeed measurement.'}</p>}
  </article>;
}

function SourceResult({ source }: { source: DataSource }) {
  return <article className="result-cell">
    <div>
      <span>{source.label}</span>
      <strong>{source.value || availabilityCopy(source.availability)}</strong>
    </div>
    <p>{source.detail}</p>
    <small className="source-state">{source.updatedAt ? `Updated ${source.updatedAt}` : source.key === 'performance' ? 'Run a PageSpeed check to create this evidence.' : 'Connection setup is available in the production workspace.'}</small>
  </article>;
}
function ActionPlan({ actions, onUpdateAction, onOpenPage }: { actions: Action[]; onUpdateAction: (id: string, update: Partial<Action>) => void; onOpenPage: (url: string) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const visible = actions.filter(action => showClosed || !['verified_resolved', 'ignored', 'not_applicable'].includes(action.status));

  return <section className="audit-view action-plan-view">
    <div className="section-title">
      <div>
        <h2>Work that earns another crawl.</h2>
        <p>Marking an action done never silently resolves it: it moves to verification until a comparable crawl confirms the condition changed.</p>
      </div>
      <button className="button outline small" onClick={() => setShowClosed(value => !value)}>
        {showClosed ? 'Hide resolved' : 'Show resolved'}
      </button>
    </div>
    <div className="action-list">
      {visible.length
        ? visible.map(action => <ActionRow key={action.id} action={action} onUpdate={onUpdateAction} onOpenPage={onOpenPage} />)
        : <EmptyRow message="There are no actions in this view." />}
    </div>
  </section>;
}

function ActionRow({ action, compact = false, onUpdate, onOpenPage }: { action: Action; compact?: boolean; onUpdate: (id: string, update: Partial<Action>) => void; onOpenPage: (url: string) => void }) {
  const [open, setOpen] = useState(false); const next = action.status === 'open' || action.status === 'planned' || action.status === 'recurring' ? { label: 'Start work', status: 'in_progress' as ActionStatus } : action.status === 'in_progress' ? { label: 'Ready for verification', status: 'awaiting_verification' as ActionStatus } : null;
  return <article className={`action-row ${open ? 'open' : ''}`}><button className="action-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open}><span className={`priority ${action.priority.toLowerCase()}`}>{action.priority}</span><span className="action-summary"><strong>{action.title}</strong><small>{action.evidence.length} page-level observation{action.evidence.length === 1 ? '' : 's'} · {action.effort}</small></span><StatusBadge status={action.status} /><Icon name="chevron" /></button>{!compact && <div className="action-inline-meta"><span>Owner <strong>{action.owner}</strong></span><span>Verification <strong>{action.status === 'awaiting_verification' ? 'Queued for next crawl' : 'Not started'}</strong></span></div>}{open && <div className="action-detail"><div className="action-detail-top"><div><p className="section-label">Why this matters</p><p>{action.outcome}</p></div><div><p className="section-label">Verification</p><p>{action.verification}</p></div></div><div className="evidence-heading"><span>Exact URLs and context</span><small>Observed evidence from this crawl, not a generic checklist.</small></div><div className="evidence-list">{action.evidence.map((item, index) => <article className="evidence-row" key={`${item.url}-${item.element}-${index}`}><div><strong>{pathFor(item.url)}</strong><span>{item.element}</span></div><div><small>Observed</small><p>{item.observed}</p></div><div><small>Suggested change</small><p>{item.recommendation}</p></div><div className="evidence-buttons"><button className="text-action" onClick={() => onOpenPage(item.url)}>Inspect page <Icon name="arrow" /></button><a className="text-action" href={item.url} target="_blank" rel="noreferrer">Open ↗</a></div></article>)}</div>{next ? <button className="button action-button" onClick={() => onUpdate(action.id, { status: next.status })}>{next.label} <Icon name="arrow" /></button> : <p className="action-state-note">{action.status === 'awaiting_verification' ? 'Awaiting a comparable crawl before this can be resolved.' : action.status === 'verified_resolved' ? 'Resolved by a comparable crawl.' : 'No further workflow action is required.'}</p>}</div>}</article>;
}

function PagesView({ pages, findings, selected, onSelect }: { pages: PageRecord[]; findings: Finding[]; selected: PageRecord | null; onSelect: (url: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = pages.filter(page => `${page.url} ${page.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const issuesFor = (url: string) => findings.filter(finding => finding.evidence.some(item => item.url === url));

  return <section className="audit-view pages-view">
    <div className="section-title">
      <div>
        <h2>Every inspected page, not only the ones with findings.</h2>
        <p>Open a page to see the stored snapshot, its links, and the exact actions connected to it.</p>
      </div>
      <label className="table-search">
        <span className="sr-only">Filter pages</span>
        <Icon name="search" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter URL or title" />
      </label>
    </div>
    <div className="page-table">
      <div className="page-table-head"><span>Page</span><span>Search eligibility</span><span>Observed structure</span><span>Actions</span><span /></div>
      {filtered.map(page => {
        const issues = issuesFor(page.url);
        return <button className={`page-table-row ${selected?.url === page.url ? 'selected' : ''}`} key={page.url} onClick={() => onSelect(page.url)}>
          <span><strong>{pathFor(page.url)}</strong><small>{page.title || 'No title recorded'}</small></span>
          <span><StatusPill good={page.indexable} label={page.indexable ? 'Technically eligible' : 'noindex or none'} /><small>{page.canonicalUrl ? 'Canonical recorded' : 'No canonical observed'}</small></span>
          <span><strong>{page.wordCount} words</strong><small>{page.internalLinks} internal links · depth {page.crawlDepth}</small></span>
          <span>{issues.length ? <strong className="issue-count">{issues.length} action{issues.length === 1 ? '' : 's'}</strong> : <small className="quiet">No grouped action</small>}</span>
          <Icon name="chevron" />
        </button>;
      })}
    </div>
    {!filtered.length && <EmptyRow message="No inspected page matches that filter." />}
    {selected && <PageDetail page={selected} actions={issuesFor(selected.url)} />}
  </section>;
}

function PageDetail({ page, actions }: { page: PageRecord; actions: Finding[] }) {
  return <aside className="page-detail">
    <div className="page-detail-heading">
      <div>
        <h3>{pathFor(page.url)}</h3>
        <a href={page.url} target="_blank" rel="noreferrer">{page.url} ↗</a>
      </div>
      <StatusPill good={page.statusCode >= 200 && page.statusCode < 400} label={`HTTP ${page.statusCode}`} />
    </div>
    <dl className="page-spec">
      <div><dt>Title</dt><dd>{page.title || 'Not present'}</dd></div>
      <div><dt>Description</dt><dd>{page.metaDescription || 'Not present'}</dd></div>
      <div><dt>Primary heading</dt><dd>{page.h1.join(' · ') || 'Not present'}</dd></div>
      <div><dt>Section headings</dt><dd>{page.h2?.join(' · ') || 'None recorded'}</dd></div>
      <div><dt>Canonical</dt><dd>{page.canonicalUrl || 'Not present'}</dd></div>
      <div><dt>Robots</dt><dd>{page.robots || 'No directive observed'}</dd></div>
      <div><dt>Structured data</dt><dd>{page.structuredDataTypes.length ? page.structuredDataTypes.join(', ') : 'Not observed'}</dd></div>
      <div><dt>Content source</dt><dd>{page.requiresJavaScriptRendering ? 'Initial HTML needs browser rendering' : page.contentSource || 'Document body'}</dd></div>
      <div><dt>Content / markup</dt><dd>{page.textToHtmlRatio === undefined ? 'Not retained' : `${page.textToHtmlRatio}% visible text`}</dd></div>
      <div><dt>Images</dt><dd>{page.imageCount === undefined ? 'Not retained' : `${page.imageCount} observed · ${page.imagesWithoutAlt || 0} without alt text`}</dd></div>
      <div><dt>Link context</dt><dd>{page.internalLinks} internal · {page.externalLinks} external · {page.nonDescriptiveInternalAnchors || 0} generic anchors</dd></div>
    </dl>
    {page.contentExcerpt && <div className="page-excerpt"><p className="section-label">Extracted main-page text</p><p>{page.contentExcerpt}</p></div>}
    <div className="page-links">
      <p className="section-label">Observed links</p>
      {page.linkEvidence.length ? <ul>{page.linkEvidence.slice(0, 8).map((link, index) => <li key={`${link.target}-${index}`}>
        <strong>{link.anchorText || 'No anchor text'}</strong>
        <span>{link.isInternal ? 'Internal' : 'External'} · {link.placement} · {link.target ? pathFor(link.target) : 'Unresolved target'}{link.relAttributes ? ` · rel=${link.relAttributes}` : ''}</span>
      </li>)}</ul> : <p className="quiet">No anchor evidence was retained for this page.</p>}
    </div>
    {actions.length > 0 && <div className="page-actions">
      <p className="section-label">Related actions</p>
      {actions.map(action => <div key={action.id}><span className={`priority ${action.priority.toLowerCase()}`}>{action.priority}</span><strong>{action.title}</strong></div>)}
    </div>}
  </aside>;
}

function ChangesView({ changes }: { changes: Change[] }) {
  return <section className="audit-view changes-view">
    <div className="section-title"><div>
      <h2>{changes.length ? 'What the next crawl found.' : 'Baseline captured. Waiting for a comparison.'}</h2>
      <p>{changes.length ? 'Each row is a deterministic page snapshot difference. It shows timing, not proof that a change caused traffic movement.' : 'The next comparable scan will report changes to titles, descriptions, canonical targets, robots directives, and extracted main content.'}</p>
    </div></div>
    {changes.length ? <div className="change-list">{changes.map(change => <article key={change.id}>
      <span>{pathFor(change.pageUrl)}</span><strong>{change.field}</strong>
      <p><del>{change.before}</del><ins>{change.after}</ins></p><small>{change.detectedAt}</small>
    </article>)}</div> : <div className="baseline-note"><Icon name="clock" /><p>There are no invented “improvements” on a first crawl. This baseline is the reference point for the next scan.</p></div>}
  </section>;
}

function ScopeView({ result }: { result: AuditResult }) {
  const technicalDetail = `${result.technicalHealth.evaluatedChecks} applicable checks evaluated from rule set ${result.technicalHealth.ruleSetVersion}.${result.technicalHealth.unknownChecks ? ` ${result.technicalHealth.unknownChecks} checks remain unknown.` : ''}`;
  const performance = result.performance;
  const fieldData = performance?.devices.filter(device => device.fieldMetrics.length > 0) || [];
  return <section className="audit-view scope-view">
    <div className="section-title"><div>
      <h2>Know the evidence before trusting the conclusion.</h2>
      <p>Measurements preserve their source, scope, freshness, and availability. A missing connection is not shown as a red zero.</p>
    </div></div>
    <div className="scope-grid">
      <section>
        <h3>This crawl</h3>
        <ScopeDefinition label="Collection method" value={result.rendered ? 'Browser-rendered DOM' : 'Public HTTP response'} detail={result.rendered ? 'Rendered DOM was used because the initial HTML needed JavaScript.' : 'Static HTML was inspected. Browser rendering is used only where it adds coverage.'} />
        <ScopeDefinition label="Coverage state" value={coverageLabel(result.crawlCoverage.availability)} detail={result.crawlCoverage.scopeNote} />
        <ScopeDefinition label="Technical health" value={technicalHealthValue(result.technicalHealth, result.crawlCoverage)} detail={technicalDetail} />
      </section>
      <section>
        <h3>Performance audit</h3>
        <ScopeDefinition label="State" value={performance ? availabilityCopy(performance.availability) : 'Not measured'} detail={performance?.error || 'No PageSpeed audit has been stored for this website yet.'} />
        <ScopeDefinition label="Target" value={performance ? pathFor(performance.targetUrl) : '—'} detail={performance ? `${performance.providerLabel} checked the declared site target at ${new Date(performance.fetchedAt).toLocaleString()}.` : 'The performance check measures the public site root unless a production workflow selects a specific template URL.'} />
        <ScopeDefinition label="Evidence" value={!performance ? 'Not measured' : performance.availability !== 'measured' && performance.availability !== 'partial' ? 'No usable result' : fieldData.length ? 'Lab + field' : 'Lab only'} detail={!performance ? 'No PageSpeed audit has been stored for this website yet.' : performance.availability !== 'measured' && performance.availability !== 'partial' ? performance.error || 'The provider did not return usable PageSpeed evidence.' : fieldData.length ? `Real-user Core Web Vitals were available at ${fieldData.map(device => `${device.device} ${device.fieldDataScope}`).join(', ')} scope. They are never substituted with lab values.` : 'A PageSpeed lab run is a controlled test. Real-user Core Web Vitals remain not measured unless Chrome UX data is returned.'} />
      </section>
      <section><h3>Sources & integrations</h3>{result.dataSources.filter(source => source.key !== 'performance').map(source => <ScopeDefinition key={source.key} label={source.label} value={availabilityCopy(source.availability)} detail={source.detail} />)}</section>
    </div>
    <section className="evidence-key"><h3>Evidence labels</h3><div>
      <EvidenceBadge kind="observed" label="Observed" /><p>Directly collected from a public crawl or a page snapshot.</p>
      <EvidenceBadge kind="provider" label="Provider reported" /><p>Used for connected sources and available Chrome UX real-user measurements.</p>
      <EvidenceBadge kind="sampled" label="Sampled" /><p>Reserved for controlled tests such as lab performance or an AI prompt panel.</p>
      <EvidenceBadge kind="inferred" label="Inferred review" /><p>Used for contextual content suggestions and always paired with its evidence.</p>
    </div></section>
  </section>;
}

function ScopeDefinition({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="scope-definition"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>; }
function Fact({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) { return <div className={emphasis ? 'fact emphasis' : 'fact'}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button className={active ? 'active' : ''} onClick={onClick} role="tab" aria-selected={active}>{children}</button>; }
function EmptyRow({ message }: { message: string }) { return <div className="empty-row"><Icon name="check" /><p>{message}</p></div>; }
function CoverageLine({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function StatusBadge({ status }: { status: ActionStatus }) { return <span className={`status-badge ${status}`}>{status.replace(/_/g, ' ')}</span>; }
function StatusPill({ good, label }: { good: boolean; label: string }) { return <span className={`status-pill ${good ? 'good' : 'attention'}`}>{label}</span>; }
function EvidenceBadge({ kind, label }: { kind: 'observed' | 'provider' | 'sampled' | 'inferred'; label: string }) { return <span className={`evidence-badge ${kind}`}>{label}</span>; }

function AuthScreen({ onComplete }: { onComplete: (user: User) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a work email address so we can create your workspace.');
      return;
    }
    onComplete({ name: name.trim() || email.split('@')[0], email });
  };

  return <main className="auth-shell">
    <section className="auth-art">
      <div className="nav-brand"><span className="logo">R</span><strong>RoundSEO</strong></div>
      <div className="art-copy"><h1>Make every crawl lead to a clear next move.</h1><p>RoundSEO keeps evidence, actions, and verification together—so you can see what changed, what matters, and what is still unknown.</p></div>
    </section>
    <section className="auth-panel"><form className="auth-card" onSubmit={submit}>
      <div className="auth-toggle"><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button></div>
      <h2>{mode === 'register' ? 'Start with a public site.' : 'Open your workspace.'}</h2>
      {mode === 'register' && <label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Alex Morgan" autoComplete="name" /></label>}
      <label>Work email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button solid full">{mode === 'register' ? 'Create workspace' : 'Sign in'} <Icon name="arrow" /></button>
      <small className="auth-note">Local preview mode keeps this session in your browser. Connect your production auth service before publishing.</small>
    </form></section>
  </main>;
}

function TeamManager({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Array<{ id: string; email: string; name: string; role: string }>>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadMembers() {
      try {
        const token = localStorage.getItem('roundseo-token');
        const res = await fetch(`http://localhost:8787/api/v2/organizations/${orgId}/members`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        setMembers(data.members || []);
      } catch (error) {
        console.error('Failed to load members:', error);
      }
    }
    loadMembers();
  }, [orgId]);

  const addMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('roundseo-token');
      const res = await fetch(`http://localhost:8787/api/v2/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      if (res.ok) {
        const data = await res.json();
        setMembers([...members, data.member]);
        setEmail('');
      }
    } catch (error) {
      console.error('Failed to add member:', error);
    } finally {
      setLoading(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal team-manager" onSubmit={addMember}>
      <button className="close-button" type="button" onClick={onClose} aria-label="Close">×</button>
      <h2>Manage Team</h2>
      <p>Add team members and assign their access level to websites.</p>
      <div className="team-form">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="team@example.com" required />
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="viewer">Viewer (read-only)</option>
          <option value="member">Member (create audits)</option>
          <option value="editor">Editor (manage sites)</option>
          <option value="owner">Owner (full access)</option>
        </select>
        <button className="button solid" type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add Member'}</button>
      </div>
      <div className="members-list">
        <h3>Team Members ({members.length})</h3>
        {members.map(m => <div key={m.id} className="member-row"><span><strong>{m.name || m.email}</strong><small>{m.email}</small></span><span className="role-badge">{m.role}</span></div>)}
      </div>
    </form>
  </div>;
}

function AddSite({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: { name: string; url: string; description: string; country: string }) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const normalized = url.match(/^https?:\/\//) ? url : `https://${url}`;
      const parsed = new URL(normalized);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      onSubmit({ name: parsed.hostname || url, url: normalized, description: '', country: '' });
    } catch {
      setError('Enter a valid domain or URL (e.g., example.com or https://example.com)');
    }
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal add-site" onSubmit={submit}>
      <button className="close-button" type="button" onClick={onClose} aria-label="Close">×</button>
      <h2>Start with a website.</h2>
      <p>Enter a domain or URL to run your first baseline audit.</p>
      <label>Domain or URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="example.com" autoFocus required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button solid full">Audit <Icon name="arrow" /></button>
    </form>
  </div>;
}

function formatPerformanceMetric(metric: PerformanceMetric): string {
  if (metric.value === null) return 'Not measured';
  if (metric.unit === 'ratio') return metric.value.toFixed(metric.value < 0.1 ? 3 : 2);
  return metric.value >= 1000 ? `${(metric.value / 1000).toFixed(metric.value >= 10_000 ? 0 : 1)} s` : `${Math.round(metric.value)} ms`;
}
function ratingCopy(rating: PerformanceMetric['rating']): string { return ({ good: 'Good', needs_improvement: 'Needs work', poor: 'Poor', unknown: 'No threshold' } as Record<PerformanceMetric['rating'], string>)[rating]; }
function formatSavings(opportunity: PerformanceOpportunity): string { if (opportunity.estimatedSavingsMs !== null) return `${Math.round(opportunity.estimatedSavingsMs)} ms`; if (opportunity.estimatedSavingsBytes !== null) return `${Math.round(opportunity.estimatedSavingsBytes / 1024)} KB`; return 'Review'; }
function technicalHealthValue(health: TechnicalHealth, coverage: CrawlCoverage): string { return health.value === null ? availabilityCopy(coverage.availability) : `${health.value}%`; }
function technicalHealthNote(health: TechnicalHealth): string { return health.value === null ? 'No applicable deterministic checks were evaluated.' : `${health.evaluatedChecks} of ${health.expectedChecks} applicable checks evaluated · ${health.ruleSetVersion}`; }
function technicalHealthLabel(health: TechnicalHealth): string { return health.value === null ? 'Health not measured' : `${health.value}% technical health`; }
function coverageLabel(value: Availability): string { return ({ measured: 'Measured', partial: 'Partial', failed: 'Failed', stale: 'Stale', insufficient: 'Insufficient', not_measured: 'Not measured', not_connected: 'Not connected', unsupported: 'Unsupported', not_applicable: 'Not applicable' } as Record<Availability, string>)[value]; }
function availabilityCopy(value: Availability): string { return ({ measured: 'Measured', partial: 'Partial coverage', failed: 'Failed collection', stale: 'Stale', insufficient: 'Insufficient data', not_measured: 'Not measured', not_connected: 'Not connected', unsupported: 'Unsupported', not_applicable: 'Not applicable' } as Record<Availability, string>)[value]; }
function pathFor(value: string): string { try { const url = new URL(value); return `${url.pathname || '/'}${url.search}`; } catch { return value; } }

function Icon({ name }: { name: 'home' | 'plus' | 'chevron' | 'logout' | 'globe' | 'refresh' | 'arrow' | 'radar' | 'check' | 'clock' | 'search' }) { const paths: Record<string, string> = { home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9.5ZM9 21v-6h6v6', plus: 'M12 5v14M5 12h14', chevron: 'm8 10 4 4 4-4', logout: 'M10 17l5-5-5-5m5 5H3m9-8V3h7v18h-7v-1', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.1 2.4 3 5.4 3 9s-.9 6.6-3 9c-2.1-2.4-3-5.4-3-9s.9-6.6 3-9ZM3 12h18', refresh: 'M20 11a8 8 0 0 0-14.7-4L4 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.7 4L20 15m0 0v5m0-5h-5', arrow: 'M5 12h14m-6-6 6 6-6 6', radar: 'M12 20a8 8 0 1 0-8-8m8 8V12l6-6M4 4l16 16M12 3v2m9 7h-2M3 12h2', check: 'm5 12 4 4L19 6', clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', search: 'm20 20-4.5-4.5m2.5-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z' }; return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]} /></svg>; }
