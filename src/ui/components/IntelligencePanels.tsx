import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AnswerEngine,
  AnswerEvidence,
  AnswerVisibilityEvidence,
  AppEvidence,
  AppMarketplace,
  CompetitorEvidence,
  DomainRankingEvidence,
  EvidenceSource,
  IntelligenceAction,
  IntelligenceActionStatus,
  IntelligenceCapability,
  IntelligenceCapabilityStatus,
  IntelligenceEvidence,
  IntelligenceRun,
  IntelligenceRunRequest,
  KeywordEvidence,
  KeywordTrendEvidence,
  MarketCategoryEvidence,
  PageEvidence,
  SearchSurface,
  SerpCoverage,
  SerpEvidence,
  UnavailableMetric,
} from '../../shared/intelligence';
import { normalizeDomain, type KeywordMetric, type SerpResult } from '../../shared/search-intelligence';
import { readStoredJson } from '../storage';

type JsonRecord = Record<string, unknown>;
type IntelligenceClient = {
  status: IntelligenceCapabilityStatus | null;
  loadingHistory: boolean;
  running: boolean;
  error: string;
  evidence: IntelligenceEvidence[];
  runs: IntelligenceRun[];
  currentRun: IntelligenceRun | null;
  actionStatus(action: IntelligenceAction): IntelligenceActionStatus | null;
  run(request: IntelligenceRunRequest): Promise<IntelligenceRun | null>;
  refresh(runId: string): Promise<IntelligenceRun | null>;
  cancel(runId: string): Promise<IntelligenceRun | null>;
  clearCurrent(): void;
};

const DEFAULT_COUNTRY = 'US';
const DEFAULT_LANGUAGE = 'en';
const ANSWER_ENGINES: AnswerEngine[] = ['chatgpt', 'gemini', 'claude', 'perplexity'];
const POLL_INTERVAL_MS = 3_000;
export const KEYWORD_SOURCE_LABEL = 'RoundSEO search intelligence';
export const SERP_SOURCE_LABEL = 'RoundSEO SERP snapshot';

function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function asString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function splitTerms(value: string): string[] { return [...new Set(value.split(/[\n,;]+/).map(term => term.trim()).filter(Boolean))]; }
function safeUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try { const parsed = new URL(raw); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time not recorded' : date.toLocaleString();
}
function percent(value: number | null): string { return value === null ? 'Unavailable' : `${Math.round(value * 100)}%`; }

/** Image sources the Intelligence panels will render: local gateway, signed API assets, and inline PNG/JPEG/WebP. */
export function safeImageSource(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  if (/^\/__roundseo\/intelligence\/websites\/[^/]+\/assets\/[^/?#]+\?expires=\d+&sig=[a-f0-9]{64}$/.test(raw)) return raw;
  const url = safeUrl(raw);
  return url?.startsWith('https:') || (url?.startsWith('http://localhost') ?? false) ? url : null;
}

function parseJson(response: Response): Promise<JsonRecord | null> {
  if (!response.headers.get('content-type')?.includes('application/json')) return Promise.resolve(null);
  return response.json().then(value => isRecord(value) ? value : null).catch(() => null);
}

function authHeaders(): Record<string, string> {
  const token = readStoredJson<string>('roundseo-token', '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function extractRun(body: JsonRecord | null): IntelligenceRun | null {
  if (!body) return null;
  const candidate = isRecord(body.run) ? body.run : null;
  return candidate && typeof candidate.id === 'string' && Array.isArray(candidate.evidence) ? candidate as unknown as IntelligenceRun : null;
}

/**
 * Local-gateway requests are tried first on the development machine. A missing
 * gateway falls through to the Worker API; a mutation is never repeated after
 * a response was lost, so the caller checks saved runs instead.
 */
async function requestJson(localPath: string, productionPath: string, init: RequestInit = {}): Promise<{ response: Response; body: JsonRecord }> {
  const headers = { ...authHeaders(), ...(init.headers || {}) };
  const isMutation = (init.method || 'GET') !== 'GET';
  // The local gateway answers 503 when its database is missing or not migrated; only a
  // successful status response means the gateway can serve this workspace.
  const localStatus = await fetch('/__roundseo/intelligence/status', { headers: { Accept: 'application/json', ...headers } })
    .then(response => response.ok ? parseJson(response).then(body => body !== null) : false)
    .catch(() => false);
  if (localStatus) {
    let response: Response;
    try {
      response = await fetch(`/__roundseo/intelligence${localPath}`, { ...init, headers });
    } catch {
      throw new Error(isMutation ? 'The response was interrupted. Check saved runs before trying again so the request is not repeated.' : 'RoundSEO could not reach the local intelligence service.');
    }
    const body = await parseJson(response);
    if (!body) throw new Error(isMutation ? 'The response was unreadable. Check saved runs before trying again so the request is not repeated.' : 'RoundSEO returned an unreadable intelligence response.');
    return { response, body };
  }
  let response: Response;
  try {
    response = await fetch(`/api/v2${productionPath}`, { ...init, headers });
  } catch {
    throw new Error(isMutation ? 'The response was interrupted. Check saved runs before trying again so the request is not repeated.' : 'RoundSEO could not reach the intelligence service.');
  }
  const body = await parseJson(response);
  if (!body) throw new Error(isMutation ? 'RoundSEO returned an unreadable response. Check saved runs before trying again.' : 'RoundSEO returned an unreadable intelligence response.');
  return { response, body };
}

function errorMessage(body: JsonRecord, fallback: string): string {
  return asString(body.error) || fallback;
}

async function loadEvidence(site: string, capability: IntelligenceCapability): Promise<{ ok: boolean; evidence: IntelligenceEvidence[]; error: string | null }> {
  const evidence: IntelligenceEvidence[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5_000; offset += pageSize) {
    const query = new URLSearchParams({ capability, limit: String(pageSize), offset: String(offset) }).toString();
    const result = await requestJson(`/websites/${site}/evidence?${query}`, `/websites/${site}/intelligence/evidence?${query}`);
    if (!result.response.ok) return { ok: false, evidence, error: errorMessage(result.body, 'Saved intelligence evidence is unavailable.') };
    const page = Array.isArray(result.body.evidence) ? result.body.evidence.filter(isRecord) as unknown as IntelligenceEvidence[] : [];
    evidence.push(...page);
    if (page.length < pageSize) break;
  }
  return { ok: true, evidence, error: null };
}

async function loadHistory(websiteId: string, capability: IntelligenceCapability): Promise<{ status: IntelligenceCapabilityStatus; runs: IntelligenceRun[]; evidence: IntelligenceEvidence[] }> {
  const site = encodeURIComponent(websiteId);
  const runsQuery = new URLSearchParams({ capability, limit: '50' }).toString();
  const [statusResult, runsResult, evidenceResult] = await Promise.all([
    requestJson('/status', '/intelligence/status'),
    requestJson(`/websites/${site}/runs?${runsQuery}`, `/websites/${site}/intelligence/runs?${runsQuery}`),
    loadEvidence(site, capability),
  ]);
  if (!statusResult.response.ok || !isRecord(statusResult.body) || !Array.isArray(statusResult.body.actions)) {
    throw new Error(errorMessage(statusResult.body, 'Search intelligence status is unavailable.'));
  }
  if (!runsResult.response.ok) throw new Error(errorMessage(runsResult.body, 'Saved intelligence runs are unavailable.'));
  if (!evidenceResult.ok) throw new Error(evidenceResult.error || 'Saved intelligence evidence is unavailable.');
  const runs = Array.isArray(runsResult.body.runs) ? runsResult.body.runs as unknown as IntelligenceRun[] : [];
  return { status: statusResult.body as unknown as IntelligenceCapabilityStatus, runs, evidence: evidenceResult.evidence };
}

async function fetchRunDetail(websiteId: string, runId: string): Promise<IntelligenceRun | null> {
  const site = encodeURIComponent(websiteId);
  const run = encodeURIComponent(runId);
  try {
    const result = await requestJson(`/websites/${site}/runs/${run}`, `/websites/${site}/intelligence/runs/${run}`);
    return result.response.ok ? extractRun(result.body) : null;
  } catch {
    return null;
  }
}

function requestKey(kind: 'run' | 'refresh' | 'cancel'): string {
  return `intelligence-${kind}-${crypto.randomUUID()}`;
}

function useIntelligence(websiteId: string, capability: IntelligenceCapability): IntelligenceClient {
  const scope = `${websiteId}:${capability}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [status, setStatus] = useState<IntelligenceCapabilityStatus | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<IntelligenceEvidence[]>([]);
  const [runs, setRuns] = useState<IntelligenceRun[]>([]);
  const [currentRun, setCurrentRun] = useState<IntelligenceRun | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let disposed = false;
    setLoadedScope(null);
    setStatus(null);
    setError('');
    setEvidence([]);
    setRuns([]);
    setCurrentRun(null);
    setLoadingHistory(true);
    void loadHistory(websiteId, capability).then(async history => {
      if (disposed) return;
      const initial = history.runs.find(run => run.status === 'queued' || run.status === 'running') || history.runs[0] || null;
      // Run lists omit evidence, so the selected run's detail is loaded to keep its results after a reload.
      const detail = initial && initial.evidence.length === 0 && initial.summary.evidenceCount > 0 ? await fetchRunDetail(websiteId, initial.id) : null;
      if (disposed) return;
      setStatus(history.status);
      setRuns(history.runs);
      setEvidence(history.evidence);
      setCurrentRun(detail ?? initial);
      setLoadedScope(scope);
    }).catch(reason => {
      if (disposed) return;
      setLoadedScope(scope);
      setError(reason instanceof Error ? reason.message : 'Search intelligence history is unavailable.');
    }).finally(() => { if (!disposed) setLoadingHistory(false); });
    return () => { disposed = true; };
  }, [websiteId, capability, scope]);

  // Queued and running crawls are polled until they reach a terminal state.
  const activeRunId = currentRun && (currentRun.status === 'queued' || currentRun.status === 'running') ? currentRun.id : null;
  useEffect(() => {
    if (!activeRunId) return undefined;
    let disposed = false;
    const timer = window.setTimeout(() => {
      const site = encodeURIComponent(websiteId);
      const run = encodeURIComponent(activeRunId);
      void requestJson(`/websites/${site}/runs/${run}`, `/websites/${site}/intelligence/runs/${run}`)
        .then(result => {
          const next = extractRun(result.body);
          if (!disposed && next && scopeRef.current === scope) mergeRun(next);
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => { disposed = true; window.clearTimeout(timer); };
    // mergeRun is recreated each render; the run identity and status are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, currentRun?.progress.updatedAt, websiteId, scope]);

  const mergeRun = (run: IntelligenceRun) => {
    setCurrentRun(run);
    setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
    setEvidence(current => [...run.evidence, ...current.filter(item => !run.evidence.some(next => next.id === item.id))]);
    return run;
  };

  const perform = async (work: () => Promise<IntelligenceRun>, failure: string): Promise<IntelligenceRun | null> => {
    if (inFlight.current) return null;
    const requestScope = scope;
    inFlight.current = true;
    setRunning(true);
    setError('');
    try {
      const run = await work();
      return scopeRef.current === requestScope ? mergeRun(run) : null;
    } catch (reason) {
      if (scopeRef.current === requestScope) setError(reason instanceof Error ? reason.message : failure);
      return null;
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  };

  const createRun = (request: IntelligenceRunRequest) => perform(async () => {
    const site = encodeURIComponent(websiteId);
    const result = await requestJson(`/websites/${site}/runs`, `/websites/${site}/intelligence/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('run') },
      body: JSON.stringify(request),
    });
    return unwrapRun(result.response, result.body);
  }, 'RoundSEO could not complete this intelligence run.');

  const refresh = (runId: string) => perform(async () => {
    const site = encodeURIComponent(websiteId);
    const run = encodeURIComponent(runId);
    const result = await requestJson(`/websites/${site}/runs/${run}/refresh`, `/websites/${site}/intelligence/runs/${run}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('refresh') },
    });
    return unwrapRun(result.response, result.body);
  }, 'RoundSEO could not refresh this crawl.');

  const cancel = (runId: string) => perform(async () => {
    const site = encodeURIComponent(websiteId);
    const run = encodeURIComponent(runId);
    const result = await requestJson(`/websites/${site}/runs/${run}/cancel`, `/websites/${site}/intelligence/runs/${run}/cancel`, { method: 'POST' });
    return unwrapRun(result.response, result.body);
  }, 'RoundSEO could not cancel this crawl.');

  const loaded = loadedScope === scope;
  return {
    status: loaded ? status : null,
    loadingHistory: !loaded || loadingHistory,
    running,
    error: loaded ? error : '',
    evidence: loaded ? evidence : [],
    runs: loaded ? runs : [],
    currentRun: loaded ? currentRun : null,
    actionStatus: action => status?.actions.find(item => item.action === action) ?? null,
    run: createRun,
    refresh,
    cancel,
    clearCurrent: () => { setCurrentRun(null); setError(''); },
  };
}

function unwrapRun(response: Response, body: JsonRecord): IntelligenceRun {
  if (!response.ok) throw new Error(errorMessage(body, 'RoundSEO could not complete this intelligence run.'));
  const run = extractRun(body);
  if (!run) throw new Error('RoundSEO returned no intelligence run.');
  return run;
}

export function keywordMetricsFromEvidence(evidence: IntelligenceEvidence[]): KeywordMetric[] {
  return evidence.filter((item): item is KeywordEvidence => item.kind === 'keyword').map(item => ({
    id: item.id,
    keyword: item.keyword,
    volume: item.searchVolume,
    difficulty: null,
    cpc: item.cpcLow !== null && item.cpcHigh !== null ? Math.round(((item.cpcLow + item.cpcHigh) / 2) * 100) / 100 : item.cpcHigh ?? item.cpcLow,
    intent: item.intent,
    position: null,
    domain: null,
    landingPage: null,
    checkedAt: item.source.observedAt,
    source: KEYWORD_SOURCE_LABEL,
  }));
}

export function serpResultsFromEvidence(evidence: IntelligenceEvidence[]): SerpResult[] {
  return evidence.filter((item): item is SerpEvidence => item.kind === 'serp_result').flatMap(item => {
    const domain = item.domain || normalizeDomain(item.url);
    if (!domain) return [];
    return [{
      id: item.id,
      keyword: item.query,
      position: item.position,
      url: item.url,
      domain,
      title: item.title,
      resultType: item.feature,
      checkedAt: item.source.observedAt,
      source: SERP_SOURCE_LABEL,
    }];
  });
}

function LimitationList({ source }: { source: EvidenceSource | null }) {
  if (!source) return null;
  return <div className="intelligence-source-note"><strong>{source.label}</strong><span>Observed {dateLabel(source.observedAt)} · method {source.method}</span>{source.limitations.length > 0 && <ul>{source.limitations.map(item => <li key={item}>{item}</li>)}</ul>}</div>;
}

function UnavailableList({ items }: { items: UnavailableMetric[] }) {
  if (!items.length) return null;
  return <div className="intelligence-unavailable" role="note"><strong>Not measured in this run</strong><ul>{items.map((item, index) => <li key={`${item.metric}-${index}`}><span>{item.metric}:</span> {item.reason}</li>)}</ul></div>;
}

function IntelligenceFrame({ client, action, run, title, description, children }: { client: IntelligenceClient; action?: IntelligenceAction; run: IntelligenceRun | null; title: string; description: string; children: ReactNode }) {
  const actionStatus = action ? client.actionStatus(action) : null;
  const capabilityReady = client.status?.available === true;
  const state = client.loadingHistory && !client.status ? 'checking' : actionStatus && !actionStatus.available ? 'unavailable' : capabilityReady ? 'ready' : 'unavailable';
  const label = state === 'ready' ? 'Collection ready' : state === 'unavailable' ? 'Not available here' : state === 'checking' ? 'Checking service' : 'Loading saved evidence';
  return <section className="intelligence-provider-panel import-panel" aria-label={title} aria-busy={client.loadingHistory || client.running}>
    <header className="intelligence-provider-head"><div><h3>{title}</h3><p>{description}</p></div><span className={`intelligence-connection ${state}`} role="status" aria-live="polite">{label}</span></header>
    {actionStatus && !actionStatus.available && <p className="intelligence-service-note" role="status">{actionStatus.reason || 'This workflow is not available on this deployment.'} Saved evidence from earlier runs stays available.</p>}
    {actionStatus?.available && actionStatus.reason && <p className="intelligence-service-note" role="note">{actionStatus.reason}</p>}
    {children}
    {client.running && <p className="intelligence-running" role="status" aria-live="polite">RoundSEO is collecting and checking the results. Keep this page open until the run completes.</p>}
    {client.error && <p className="intelligence-error" role="alert">{client.error}{client.evidence.length > 0 ? ' Saved evidence remains available below.' : ''}</p>}
    {run && <RunMeta run={run} />}
  </section>;
}

function RunMeta({ run }: { run: IntelligenceRun }) {
  const active = run.status === 'queued' || run.status === 'running';
  const progress = run.progress.total === null
    ? `${run.progress.completed} processed so far`
    : `${run.progress.completed} of ${run.progress.total} processed`;
  return <div className="intelligence-run-result">
    <dl className="intelligence-run-meta">
      <div><dt>Status</dt><dd><span className={`intelligence-status ${run.status}`}>{run.status}</span> {run.statusMessage}</dd></div>
      <div><dt>Observed</dt><dd>{dateLabel(run.completedAt || run.requestedAt)}</dd></div>
      <div><dt>Evidence</dt><dd>{run.summary.evidenceCount} record{run.summary.evidenceCount === 1 ? '' : 's'}</dd></div>
      {active || run.action.startsWith('site_crawl') ? <div><dt>Progress</dt><dd>{progress}</dd></div> : null}
      <div><dt>RoundSEO run</dt><dd>{run.id}</dd></div>
    </dl>
    <LimitationList source={run.source} />
    <UnavailableList items={run.unavailable} />
    {run.error && <p className="intelligence-error" role="alert">{run.error.message}</p>}
    {run.coverage && <CoverageNote coverage={run.coverage} />}
  </div>;
}

function CoverageNote({ coverage }: { coverage: SerpCoverage }) {
  const label = ({ complete: 'Complete', partial: 'Partial', blocked: 'Blocked', unparsed: 'Not readable' } as const)[coverage.status];
  return <div className={`intelligence-coverage ${coverage.status}`} role="status"><strong>Coverage: {label}</strong><span>{coverage.resultsParsed} of {coverage.resultsRequested} results read{coverage.featuresDetected.length ? ` · features seen: ${coverage.featuresDetected.map(item => item.replace(/_/g, ' ')).join(', ')}` : ''}</span>{coverage.reason && <small>{coverage.reason}</small>}</div>;
}

type Choice = { value: string; label: string };
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const PAGE_LIMIT_CHOICES = [10, 25, 50, 100, 250, 500, 1000, 2000];

/** Dropdown choices come from the markets the server reports, so an offered market always works. */
function marketChoices(status: IntelligenceCapabilityStatus | null): { countries: Choice[]; languages: Choice[] } {
  const countries = status?.markets?.countries?.length ? status.markets.countries : [DEFAULT_COUNTRY];
  const languages = status?.markets?.languages?.length ? status.markets.languages : [DEFAULT_LANGUAGE];
  const byLabel = (left: Choice, right: Choice) => left.label.localeCompare(right.label);
  return {
    countries: countries.map(code => ({ value: code, label: `${COUNTRY_NAMES.of(code) ?? code} (${code})` })).sort(byLabel),
    languages: languages.map(code => ({ value: code, label: `${LANGUAGE_NAMES.of(code) ?? code} (${code})` })).sort(byLabel),
  };
}

function pageLimitChoices(cap: number): number[] {
  const choices = PAGE_LIMIT_CHOICES.filter(item => item <= cap);
  return choices.includes(cap) ? choices : [...choices, cap].sort((left, right) => left - right);
}

function CountrySelect({ status, value, onChange }: { status: IntelligenceCapabilityStatus | null; value: string; onChange(value: string): void }) {
  return <label>Country<select value={value} onChange={event => onChange(event.target.value)}>{marketChoices(status).countries.map(choice => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select><small>Results, volumes, and store listings use this market.</small></label>;
}

function LanguageSelect({ status, value, onChange }: { status: IntelligenceCapabilityStatus | null; value: string; onChange(value: string): void }) {
  return <label>Language<select value={value} onChange={event => onChange(event.target.value)}>{marketChoices(status).languages.map(choice => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select><small>Keyword metrics are available for the languages listed.</small></label>;
}

function MarketFields({ status, countryCode, languageCode, onCountry, onLanguage }: { status: IntelligenceCapabilityStatus | null; countryCode: string; languageCode: string; onCountry(value: string): void; onLanguage(value: string): void }) {
  return <div className="intelligence-field-grid"><CountrySelect status={status} value={countryCode} onChange={onCountry} /><LanguageSelect status={status} value={languageCode} onChange={onLanguage} /></div>;
}

function validMarket(countryCode: string, languageCode: string): boolean {
  return /^[A-Z]{2}$/.test(countryCode) && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(languageCode.trim());
}

type KeywordMode = 'keyword_discovery' | 'keyword_overview' | 'keyword_metrics_google' | 'keyword_metrics_bing' | 'keyword_trends' | 'domain_rankings' | 'domain_competitors';
const KEYWORD_MODE_ACTION: Record<KeywordMode, IntelligenceAction> = {
  keyword_discovery: 'keyword_discovery',
  keyword_overview: 'keyword_overview',
  keyword_metrics_google: 'keyword_metrics',
  keyword_metrics_bing: 'keyword_metrics',
  keyword_trends: 'keyword_trends',
  domain_rankings: 'domain_rankings',
  domain_competitors: 'domain_competitors',
};

export function KeywordIntelligencePanel({ websiteId, websiteDomain, onResults }: { websiteId: string; websiteDomain: string; onResults(items: KeywordMetric[]): void }) {
  const client = useIntelligence(websiteId, 'keyword_research');
  const [mode, setMode] = useState<KeywordMode>('keyword_discovery');
  const [keywords, setKeywords] = useState('');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE);
  const reported = useRef('');
  useEffect(() => { setMode('keyword_discovery'); setKeywords(''); setCountryCode(DEFAULT_COUNTRY); setLanguageCode(DEFAULT_LANGUAGE); }, [websiteId]);
  const mapped = keywordMetricsFromEvidence(client.evidence);
  useEffect(() => {
    if (client.loadingHistory || !client.status) return;
    const signature = `${websiteId}:${JSON.stringify(mapped)}`;
    if (signature !== reported.current) { reported.current = signature; onResults(mapped); }
  }, [client.loadingHistory, client.status, mapped, onResults, websiteId]);
  const terms = splitTerms(keywords);
  const domainMode = mode === 'domain_rankings' || mode === 'domain_competitors';
  const status = client.actionStatus(KEYWORD_MODE_ACTION[mode]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status?.available) return;
    const market = { countryCode, languageCode: languageCode.trim().toLowerCase() };
    const request: IntelligenceRunRequest = mode === 'keyword_discovery' ? { action: 'keyword_discovery', seeds: terms, limit: 100, ...market }
      : mode === 'keyword_overview' ? { action: 'keyword_overview', keywords: terms, ...market }
        : mode === 'keyword_metrics_google' ? { action: 'keyword_metrics', source: 'google', keywords: terms, ...market }
          : mode === 'keyword_metrics_bing' ? { action: 'keyword_metrics', source: 'bing', keywords: terms, ...market }
            : mode === 'keyword_trends' ? { action: 'keyword_trends', keywords: terms, ...market }
              : mode === 'domain_rankings' ? { action: 'domain_rankings', domain: websiteDomain, countryCode, limit: 100 }
                : { action: 'domain_competitors', domain: websiteDomain, countryCode, limit: 100 };
    await client.run(request);
  };
  const marketValid = domainMode ? /^[A-Z]{2}$/.test(countryCode) : validMarket(countryCode, languageCode);
  const disabled = !status?.available || client.loadingHistory || client.running || !marketValid || (!domainMode && !terms.length);
  return <IntelligenceFrame client={client} action={KEYWORD_MODE_ACTION[mode]} run={client.currentRun} title="Research keywords with RoundSEO" description="Discover related terms, measure search volume and CPC, follow monthly trends, and review where this domain ranks in RoundSEO's own SERP observations.">
    <form className="intelligence-run-form" onSubmit={submit}>
      <div className="intelligence-field-grid">
        <label>Research workflow<select value={mode} onChange={event => setMode(event.target.value as KeywordMode)}>
          <option value="keyword_discovery">Discover keyword ideas</option>
          <option value="keyword_overview">Review keyword opportunities</option>
          <option value="keyword_metrics_google">Refresh Google search metrics</option>
          <option value="keyword_metrics_bing">Refresh Bing search metrics</option>
          <option value="keyword_trends">Explore monthly search trends</option>
          <option value="domain_rankings">Show this domain's observed rankings</option>
          <option value="domain_competitors">Show competing domains in observed SERPs</option>
        </select></label>
        {domainMode ? <label>Target domain<input value={websiteDomain} disabled /><small>Analysis is limited to this website's domain.</small></label>
          : <label>Keywords<textarea value={keywords} onChange={event => setKeywords(event.target.value)} rows={3} placeholder="technical seo audit&#10;seo reporting" /><small>Separate terms with commas or new lines.</small></label>}
      </div>
      <MarketFields status={client.status} countryCode={countryCode} languageCode={languageCode} onCountry={setCountryCode} onLanguage={setLanguageCode} />
      <div className="import-panel-actions"><button className="button solid small" disabled={disabled}>Run keyword research</button><span>{domainMode ? `Target: ${websiteDomain}` : `${terms.length} keyword${terms.length === 1 ? '' : 's'} · ${mapped.length} saved records`}</span></div>
    </form>
    {client.currentRun && <KeywordPreview evidence={client.currentRun.evidence} />}
  </IntelligenceFrame>;
}

function KeywordPreview({ evidence }: { evidence: IntelligenceEvidence[] }) {
  const rows = evidence.flatMap(item => {
    if (item.kind === 'keyword') {
      const keyword = item as KeywordEvidence;
      const details = [
        keyword.searchVolume === null ? null : `${keyword.searchVolume.toLocaleString()} monthly searches`,
        keyword.cpcLow === null && keyword.cpcHigh === null ? null : `CPC $${keyword.cpcLow ?? keyword.cpcHigh}${keyword.cpcHigh !== null && keyword.cpcLow !== null && keyword.cpcHigh !== keyword.cpcLow ? `–$${keyword.cpcHigh}` : ''}`,
        keyword.competition === null ? null : `competition ${keyword.competition}`,
      ].filter(Boolean).join(' · ');
      return [{ id: keyword.id, title: keyword.keyword, details: details || 'Related term from SERP collection. No volume or CPC attached.' }];
    }
    if (item.kind === 'keyword_trend') {
      const trend = item as KeywordTrendEvidence;
      const latest = trend.points[trend.points.length - 1];
      const latestValue = latest?.value === null || latest?.value === undefined ? null : `${latest.value.toLocaleString()} searches in ${latest.date.slice(0, 7)}`;
      return [{ id: trend.id, title: trend.keyword, details: [`${trend.points.length} month${trend.points.length === 1 ? '' : 's'} of history`, latestValue].filter(Boolean).join(' · ') }];
    }
    if (item.kind === 'domain_ranking') {
      const ranking = item as DomainRankingEvidence;
      return [{ id: ranking.id, title: ranking.keyword, details: [ranking.position === null ? null : `position ${ranking.position}`, ranking.estimatedTraffic === null ? 'traffic estimate unavailable' : `about ${ranking.estimatedTraffic.toLocaleString()} modeled clicks/month`, `${ranking.history.length} observation${ranking.history.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') }];
    }
    if (item.kind === 'competitor') {
      const competitor = item as CompetitorEvidence;
      const details = [`${competitor.sharedKeywords} shared keyword${competitor.sharedKeywords === 1 ? '' : 's'}`, competitor.averagePosition === null ? null : `average position ${competitor.averagePosition}`, `${competitor.observedKeywordCount} observed`, competitor.estimatedTraffic === null ? null : `about ${competitor.estimatedTraffic.toLocaleString()} modeled clicks/month`].filter(Boolean).join(' · ');
      return [{ id: competitor.id, title: competitor.domain, details }];
    }
    return [];
  }).slice(0, 12);
  if (!rows.length) return null;
  return <div className="intelligence-evidence-list" aria-label="Keyword evidence preview">{rows.map(row => <div className="intelligence-evidence-row" key={row.id}><strong>{row.title}</strong><small>{row.details}</small></div>)}</div>;
}

export function MarketAndAppIntelligencePanel({ websiteId, websiteDomain }: { websiteId: string; websiteDomain: string }) {
  const market = useIntelligence(websiteId, 'market_intelligence');
  const apps = useIntelligence(websiteId, 'app_intelligence');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE);
  const [appMode, setAppMode] = useState<'app_competitors' | 'app_rankings'>('app_competitors');
  const [marketplace, setMarketplace] = useState<AppMarketplace>('google_play');
  const [appId, setAppId] = useState('');
  const [appKeywords, setAppKeywords] = useState('');
  useEffect(() => {
    setCountryCode(DEFAULT_COUNTRY); setLanguageCode(DEFAULT_LANGUAGE);
    setAppMode('app_competitors'); setMarketplace('google_play'); setAppId(''); setAppKeywords('');
  }, [websiteId]);
  const runMarket = async (event: FormEvent) => {
    event.preventDefault();
    await market.run({ action: 'market_categories', domain: websiteDomain, countryCode, limit: 100 });
  };
  const runApp = async (event: FormEvent) => {
    event.preventDefault();
    if (appMode === 'app_competitors') await apps.run({ action: 'app_competitors', marketplace, appId: appId.trim(), countryCode, limit: 50 });
    else await apps.run({ action: 'app_rankings', marketplace, appId: appId.trim(), countryCode, keywords: splitTerms(appKeywords), limit: 100 });
  };
  const marketRows = (market.currentRun?.evidence || []).filter((item): item is MarketCategoryEvidence => item.kind === 'market_category');
  const appRows = (apps.currentRun?.evidence || []).filter((item): item is AppEvidence => item.kind === 'app');
  const appAction = appMode;
  const appStatus = apps.actionStatus(appAction);
  const appKeywordCount = splitTerms(appKeywords).length;
  return <div className="intelligence-catalog-grid">
    <IntelligenceFrame client={market} action="market_categories" run={market.currentRun} title="Map this domain's market categories" description="Group the keywords RoundSEO has observed for this domain into market categories, with its share of observed keywords.">
      <form className="intelligence-run-form" onSubmit={runMarket}>
        <div className="intelligence-field-grid"><label>Target domain<input value={websiteDomain} disabled /><small>Categories come from this website's stored SERP observations.</small></label><CountrySelect status={market.status} value={countryCode} onChange={setCountryCode} /></div>
        <div className="import-panel-actions"><button className="button solid small" disabled={!market.actionStatus('market_categories')?.available || market.loadingHistory || market.running || !/^[A-Z]{2}$/.test(countryCode)}>Map market categories</button><span>{marketRows.length} categories in the latest run</span></div>
      </form>
      {marketRows.length > 0 && <div className="intelligence-evidence-list" aria-label="Market category evidence">{marketRows.slice(0, 12).map(item => <div className="intelligence-evidence-row" key={item.id}><strong>{item.categoryLabel}</strong><small>{item.observedKeywordCount} keyword{item.observedKeywordCount === 1 ? '' : 's'} · {percent(item.share)} of observed keywords{item.estimatedTraffic === null ? '' : ` · about ${item.estimatedTraffic.toLocaleString()} modeled clicks/month`}</small></div>)}</div>}
    </IntelligenceFrame>
    <IntelligenceFrame client={apps} action={appAction} run={apps.currentRun} title="Research app-market visibility" description="Find competing apps from store search results, or the search terms where a selected app ranks on Google Play or Apple's App Store.">
      <form className="intelligence-run-form" onSubmit={runApp}>
        <div className="intelligence-field-grid">
          <label>Workflow<select value={appMode} onChange={event => setAppMode(event.target.value as typeof appMode)}><option value="app_competitors">Find competing apps</option><option value="app_rankings">Find ranking terms</option></select></label>
          <label>Marketplace<select value={marketplace} onChange={event => setMarketplace(event.target.value as AppMarketplace)}><option value="google_play">Google Play</option><option value="apple_app_store">Apple App Store</option></select></label>
          <label>App ID<input value={appId} onChange={event => setAppId(event.target.value)} maxLength={250} placeholder={marketplace === 'google_play' ? 'com.example.app' : '123456789'} /></label>
          {appMode === 'app_rankings' && <label>Search terms<textarea value={appKeywords} onChange={event => setAppKeywords(event.target.value)} rows={2} placeholder="habit tracker&#10;daily planner" /><small>Separate terms with commas or new lines.</small></label>}
        </div>
        <div className="intelligence-field-grid"><CountrySelect status={apps.status} value={countryCode} onChange={setCountryCode} /><LanguageSelect status={apps.status} value={languageCode} onChange={setLanguageCode} /></div>
        <div className="import-panel-actions"><button className="button solid small" disabled={!appStatus?.available || apps.loadingHistory || apps.running || !appId.trim() || !/^[A-Z]{2}$/.test(countryCode) || (appMode === 'app_rankings' && appKeywordCount === 0)}>Run app research</button><span>{apps.evidence.filter(item => item.kind === 'app').length} saved app records</span></div>
      </form>
      {appRows.length > 0 && <div className="intelligence-evidence-list" aria-label="App intelligence evidence">{appRows.slice(0, 12).map(item => <div className="intelligence-evidence-row" key={item.id}><strong>{item.keyword ? `"${item.keyword}"` : item.title || item.appId}</strong><small>{[item.keyword && item.title ? item.title : null, item.position === null ? null : `position ${item.position}`, item.sharedKeywords === null ? null : `${item.sharedKeywords} shared term${item.sharedKeywords === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || item.appId}</small></div>)}</div>}
    </IntelligenceFrame>
  </div>;
}

export function SerpIntelligencePanel({ websiteId, websiteDomain, onResults }: { websiteId: string; websiteDomain: string; onResults(items: SerpResult[]): void }) {
  const client = useIntelligence(websiteId, 'serp_analysis');
  const [surface, setSurface] = useState<SearchSurface>('google');
  const [query, setQuery] = useState('');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const reported = useRef('');
  useEffect(() => { setSurface('google'); setQuery(''); setCountryCode(DEFAULT_COUNTRY); setLanguageCode(DEFAULT_LANGUAGE); setDevice('desktop'); }, [websiteId]);
  const mapped = serpResultsFromEvidence(client.evidence);
  useEffect(() => {
    if (client.loadingHistory || !client.status) return;
    const signature = `${websiteId}:${JSON.stringify(mapped)}`;
    if (signature !== reported.current) { reported.current = signature; onResults(mapped); }
  }, [client.loadingHistory, client.status, mapped, onResults, websiteId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await client.run({ action: 'serp_snapshot', surface, query: query.trim(), countryCode, languageCode: languageCode.trim().toLowerCase(), device, resultLimit: 20, targetDomain: websiteDomain });
  };
  const status = client.actionStatus('serp_snapshot');
  return <IntelligenceFrame client={client} action="serp_snapshot" run={client.currentRun} title="Capture a SERP snapshot" description="Save ranked results and search features from Google, Maps, Google AI, Bing, or YouTube as dated RoundSEO evidence. Blocked or incomplete pages are shown as such.">
    <form className="intelligence-run-form" onSubmit={submit}>
      <div className="intelligence-field-grid">
        <label>Search surface<select value={surface} onChange={event => setSurface(event.target.value as SearchSurface)}><option value="google">Google organic</option><option value="google_maps">Google Maps</option><option value="google_ai">Google AI results</option><option value="bing">Bing organic</option><option value="youtube">YouTube</option></select></label>
        <label>Query<input value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder={`Search ${websiteDomain}'s market`} /></label>
        <label>Device<select value={device} onChange={event => setDevice(event.target.value as 'desktop' | 'mobile')}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
      </div>
      <MarketFields status={client.status} countryCode={countryCode} languageCode={languageCode} onCountry={setCountryCode} onLanguage={setLanguageCode} />
      <div className="import-panel-actions"><button className="button solid small" disabled={!status?.available || client.loadingHistory || client.running || !query.trim() || !/^[A-Z]{2}$/.test(countryCode) || !languageCode.trim()}>Capture SERP snapshot</button><span>Up to 20 result positions · {mapped.length} saved records</span></div>
    </form>
    {client.currentRun && <SerpPreview evidence={client.currentRun.evidence} />}
  </IntelligenceFrame>;
}

function SerpPreview({ evidence }: { evidence: IntelligenceEvidence[] }) {
  const rows = evidence.filter((item): item is SerpEvidence => item.kind === 'serp_result').slice(0, 20);
  if (!rows.length) return null;
  return <div className="intelligence-evidence-list" aria-label="SERP evidence preview">{rows.map(item => <div className="intelligence-evidence-row" key={item.id}><strong>{item.position}. {item.title || item.domain || 'Untitled result'}</strong><small>{item.feature.replace(/_/g, ' ')}{item.domain ? ` · ${item.domain}` : ''}</small></div>)}</div>;
}

type AnswerMode = 'answer_response' | 'answer_snapshot' | 'answer_demand';
const ENGINE_MODELS: Record<AnswerEngine, string[]> = {
  claude: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  chatgpt: ['gpt-4.1-mini', 'gpt-4.1'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  perplexity: ['sonar', 'sonar-pro'],
};
const DEFAULT_MODELS: Record<AnswerEngine, string> = { chatgpt: 'gpt-4.1-mini', gemini: 'gemini-2.5-flash', claude: 'claude-sonnet-5-5', perplexity: 'sonar' };

export function AnswerEnginePanel({ websiteId, websiteDomain }: { websiteId: string; websiteDomain: string }) {
  const client = useIntelligence(websiteId, 'answer_engine_visibility');
  const [mode, setMode] = useState<AnswerMode>('answer_snapshot');
  const [engine, setEngine] = useState<AnswerEngine>('chatgpt');
  const [prompt, setPrompt] = useState(`What are the best resources for ${websiteDomain}?`);
  const [model, setModel] = useState(DEFAULT_MODELS.chatgpt);
  const [demandKeywords, setDemandKeywords] = useState('');
  useEffect(() => { setMode('answer_snapshot'); setEngine('chatgpt'); setPrompt(`What are the best resources for ${websiteDomain}?`); setModel(DEFAULT_MODELS.chatgpt); setDemandKeywords(''); }, [websiteDomain, websiteId]);
  const responseStatus = client.actionStatus('answer_response');
  const snapshotStatus = client.actionStatus('answer_snapshot');
  const configuredEngines = ANSWER_ENGINES.filter(item => (responseStatus?.sources || []).includes(item) || (snapshotStatus?.sources || []).includes(item));
  const snapshotEngines = ANSWER_ENGINES.filter(item => (snapshotStatus?.sources || []).includes(item));
  const responseEngines = ANSWER_ENGINES.filter(item => (responseStatus?.sources || []).includes(item));
  const activeEngines = mode === 'answer_snapshot' ? snapshotEngines : responseEngines;
  const demandStatus = client.actionStatus('answer_demand');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'answer_demand') {
      await client.run({ action: 'answer_demand', keywords: splitTerms(demandKeywords) });
      return;
    }
    if (mode === 'answer_response') await client.run({ action: 'answer_response', engine, prompt: prompt.trim(), model: model.trim(), targetDomain: websiteDomain, maximumOutputTokens: 1024, useWeb: true });
    else await client.run({ action: 'answer_snapshot', engine, prompt: prompt.trim(), targetDomain: websiteDomain, maximumOutputTokens: 1024 });
  };
  const displayedRun = client.currentRun?.action === mode ? client.currentRun : client.runs.find(run => run.action === mode) || null;
  const answer = displayedRun?.evidence.find((item): item is AnswerEvidence => item.kind === 'answer') || null;
  const visibility = displayedRun?.evidence.find((item): item is AnswerVisibilityEvidence => item.kind === 'answer_visibility') || null;
  const visibilitySamples = client.evidence.filter((item): item is AnswerVisibilityEvidence => item.kind === 'answer_visibility');
  const mentionRate = visibilitySamples.length ? Math.round(visibilitySamples.filter(item => item.mentioned).length / visibilitySamples.length * 100) : null;
  const voiceSamples = visibilitySamples.map(item => item.shareOfVoice).filter((value): value is number => value !== null);
  const averageVoice = voiceSamples.length ? Math.round(voiceSamples.reduce((sum, value) => sum + value, 0) / voiceSamples.length * 100) : null;
  const sentimentSamples = visibilitySamples.map(item => item.sentiment).filter(value => value !== 'unknown');
  const engineChoices = mode === 'answer_snapshot' ? snapshotEngines : responseEngines;
  const formStatus = mode === 'answer_demand' ? demandStatus : mode === 'answer_response' ? responseStatus : snapshotStatus;
  const disabled = !formStatus?.available || client.loadingHistory || client.running
    || (mode !== 'answer_demand' && (!prompt.trim() || !engineChoices.includes(engine)))
    || (mode === 'answer_response' && !model.trim())
    || (mode === 'answer_demand' && splitTerms(demandKeywords).length === 0);
  return <IntelligenceFrame client={client} action={mode} run={displayedRun} title="Run answer-engine research" description="Sample supported answer engines through their official APIs, record the answer and its citations, and track how often this domain is named. Mentions are kept separate from referral traffic.">
    <div className="intelligence-tabs intelligence-mode-tabs" role="group" aria-label="Answer-engine research workflows">{([['answer_snapshot', 'Web-grounded answer'], ['answer_response', 'Model answer'], ['answer_demand', 'AI keyword demand']] as const).map(([key, label]) => <button type="button" aria-pressed={mode === key} className={mode === key ? 'active' : ''} onClick={() => { setMode(key); client.clearCurrent(); const next = key === 'answer_response' ? responseEngines : snapshotEngines; if (key !== 'answer_demand' && next.length && !next.includes(engine)) setEngine(next[0]); }} key={key}>{label}</button>)}</div>
    {configuredEngines.length === 0 && <p className="intelligence-service-note" role="status">No answer engine has an API key configured on this deployment. Saved observations remain available.</p>}
    {visibilitySamples.length > 0 && <div className="intelligence-visibility-band" aria-label="Saved AI visibility summary"><div><span>Saved samples</span><strong>{visibilitySamples.length}</strong></div><div><span>Named in answers</span><strong>{mentionRate === null ? 'Unavailable' : `${mentionRate}%`}</strong></div><div><span>Average share of named domains</span><strong>{averageVoice === null ? 'Unavailable' : `${averageVoice}%`}</strong></div><div><span>Heuristic sentiment</span><strong>{sentimentSamples.at(-1) || 'Unavailable'}</strong></div></div>}
    <form className="intelligence-run-form" onSubmit={submit}>
      {mode !== 'answer_demand' && <div className="intelligence-field-grid"><label>Answer engine<select value={engine} onChange={event => { const next = event.target.value as AnswerEngine; setEngine(next); setModel(DEFAULT_MODELS[next]); }} disabled={!activeEngines.length}>{activeEngines.map(item => <option value={item} key={item}>{({ chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' } as const)[item]}</option>)}</select>{!activeEngines.length && <small>No configured engine for this workflow.</small>}</label>{mode === 'answer_response' && <label>Model<select value={model} onChange={event => setModel(event.target.value)}>{ENGINE_MODELS[engine].map(item => <option value={item} key={item}>{item}</option>)}</select><small>Models offered for the selected engine.</small></label>}</div>}
      {mode === 'answer_demand'
        ? <label>Keywords<textarea value={demandKeywords} onChange={event => setDemandKeywords(event.target.value)} rows={3} placeholder="best crm for startups" /><small>{demandStatus?.reason}</small></label>
        : <label>Prompt<textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} maxLength={2000} /></label>}
      <div className="import-panel-actions"><button className="button solid small" disabled={disabled || mode === 'answer_demand' && !demandStatus?.available}>{mode === 'answer_demand' ? 'Collect AI keyword demand' : 'Sample answer engine'}</button><span>{client.evidence.filter(item => item.kind === 'answer').length} saved answer observations</span></div>
    </form>
    {answer && <AnswerPreview evidence={answer} />}
    {visibility && <AnswerVisibilityPreview evidence={visibility} />}
    {mode === 'answer_demand' && displayedRun && <KeywordPreview evidence={displayedRun.evidence} />}
  </IntelligenceFrame>;
}

function AnswerVisibilityPreview({ evidence }: { evidence: AnswerVisibilityEvidence }) {
  return <section className="intelligence-run-summary" aria-label="AI visibility analysis"><div><strong>{evidence.mentioned ? `${evidence.targetDomain} was named` : `${evidence.targetDomain} was not named`}</strong><span>{evidence.shareOfVoice === null ? 'No other domains named or cited' : `${Math.round(evidence.shareOfVoice * 100)}% of named or cited domains`} · {evidence.sentiment === 'unknown' ? 'Sentiment unavailable' : `${evidence.sentiment} (keyword heuristic)`}</span></div>{evidence.competingDomains.length > 0 && <small>Other named domains: {evidence.competingDomains.slice(0, 5).map(item => item.domain).join(', ')}</small>}</section>;
}

function AnswerPreview({ evidence }: { evidence: AnswerEvidence }) {
  return <><section className="intelligence-answer"><h4>Observed answer · {evidence.engine} · {evidence.model}</h4><p>{evidence.responseText || 'The engine returned no answer text for this prompt.'}</p><small>{evidence.webSearchUsed ? 'Web search was used for this answer.' : 'Web search was not used for this answer.'}</small></section>{evidence.citations.length > 0 && <section className="intelligence-citations"><h4>Returned sources</h4>{evidence.citations.flatMap((citation, index) => { const url = safeUrl(citation.url); return url ? [<a href={url} target="_blank" rel="noreferrer" key={`${url}-${index}`}><strong>{citation.title || citation.domain || 'Source'}</strong><small>{citation.domain || new URL(url).hostname}</small></a>] : []; })}</section>}</>;
}

type PageMode = 'page_inspection' | 'content_extraction' | 'page_screenshot' | 'site_crawl';
const PAGE_MODE_ACTION: Record<PageMode, IntelligenceAction> = {
  page_inspection: 'page_inspection',
  content_extraction: 'content_extraction',
  page_screenshot: 'page_screenshot',
  site_crawl: 'site_crawl',
};

export function PageIntelligencePanel({ websiteId, websiteDomain, websiteUrl }: { websiteId: string; websiteDomain: string; websiteUrl: string }) {
  const client = useIntelligence(websiteId, 'page_intelligence');
  const [mode, setMode] = useState<PageMode>('page_inspection');
  const [url, setUrl] = useState(websiteUrl);
  const [profile, setProfile] = useState<'desktop' | 'mobile' | 'tablet'>('desktop');
  const [renderJavascript, setRenderJavascript] = useState(false);
  const [extractContent, setExtractContent] = useState(false);
  const [maximumPages, setMaximumPages] = useState(100);
  useEffect(() => { setMode('page_inspection'); setUrl(websiteUrl); setProfile('desktop'); setRenderJavascript(false); setExtractContent(false); setMaximumPages(100); }, [websiteId, websiteUrl]);
  const crawlLimit = client.status?.safeguards.maximumSiteCrawlPages ?? 500;
  useEffect(() => { setMaximumPages(value => Math.min(value, crawlLimit)); }, [crawlLimit]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    client.clearCurrent();
    const request: IntelligenceRunRequest = mode === 'page_inspection' ? { action: mode, url: url.trim(), browserProfile: profile, renderJavascript }
      : mode === 'content_extraction' ? { action: mode, url: url.trim(), renderJavascript }
        : mode === 'page_screenshot' ? { action: mode, url: url.trim(), browserProfile: profile, fullPage: true }
          : { action: mode, domain: websiteDomain, maximumPages, startUrl: websiteUrl, extractContent };
    await client.run(request);
  };
  const displayedRun = client.currentRun?.action === mode || (mode === 'site_crawl' && client.currentRun?.action === 'site_crawl_refresh')
    ? client.currentRun
    : client.runs.find(run => run.action === mode || (mode === 'site_crawl' && run.action === 'site_crawl_refresh')) || null;
  const crawlRun = client.runs.find(run => run.action === 'site_crawl' || run.action === 'site_crawl_refresh') || null;
  const page = displayedRun?.evidence.find((item): item is PageEvidence => item.kind === 'page') || null;
  const pages = displayedRun ? displayedRun.evidence.filter((item): item is PageEvidence => item.kind === 'page') : [];
  const status = client.actionStatus(PAGE_MODE_ACTION[mode]);
  const crawlActive = crawlRun?.status === 'queued' || crawlRun?.status === 'running';
  const crawlTerminal = crawlRun !== null && !crawlActive;
  const submitDisabled = !status?.available || client.loadingHistory || client.running || crawlActive
    || (mode === 'site_crawl' ? maximumPages < 1 || maximumPages > crawlLimit : !url.trim());
  return <IntelligenceFrame client={client} action={PAGE_MODE_ACTION[mode]} run={displayedRun} title="Inspect pages with RoundSEO" description="Inspect one page, extract its content, capture a screenshot, or crawl this website's public pages as a durable job. Results stay separate from RoundSEO's audit crawl.">
    <div className="intelligence-tabs intelligence-mode-tabs" role="group" aria-label="Page intelligence workflows">{([['page_inspection', 'Inspect page'], ['content_extraction', 'Extract content'], ['page_screenshot', 'Screenshot'], ['site_crawl', 'Site crawl']] as const).map(([key, label]) => <button type="button" aria-pressed={mode === key} className={mode === key ? 'active' : ''} onClick={() => { setMode(key); client.clearCurrent(); }} key={key}>{label}</button>)}</div>
    <form className="intelligence-run-form" onSubmit={submit}>
      {mode === 'site_crawl'
        ? <div className="intelligence-field-grid"><label>Target domain<input value={websiteDomain} disabled /></label><label>Maximum pages<select value={maximumPages} onChange={event => setMaximumPages(Number(event.target.value))}>{pageLimitChoices(crawlLimit).map(item => <option value={item} key={item}>{item.toLocaleString()} pages</option>)}</select><small>This deployment caps a site crawl at {crawlLimit.toLocaleString()} pages.</small></label><label className="intelligence-check"><input type="checkbox" checked={extractContent} onChange={event => setExtractContent(event.target.checked)} /> Save page content as markdown</label></div>
        : <label>Page URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} /></label>}
      {(mode === 'page_inspection' || mode === 'page_screenshot') && <label>Browser profile<select value={profile} onChange={event => setProfile(event.target.value as typeof profile)}><option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option></select></label>}
      {(mode === 'page_inspection' || mode === 'content_extraction') && <label className="intelligence-check"><input type="checkbox" checked={renderJavascript} onChange={event => setRenderJavascript(event.target.checked)} /> Render JavaScript in the browser runner</label>}
      <div className="import-panel-actions">
        <button className="button solid small" disabled={submitDisabled}>{mode === 'site_crawl' ? 'Start site crawl' : mode === 'content_extraction' ? 'Extract page content' : mode === 'page_screenshot' ? 'Capture screenshot' : 'Inspect page'}</button>
        {mode === 'site_crawl' && crawlActive && crawlRun && <button className="button outline small" type="button" onClick={() => void client.cancel(crawlRun.id)} disabled={client.running}>Cancel crawl</button>}
        {mode === 'site_crawl' && crawlTerminal && crawlRun && <button className="button outline small" type="button" onClick={() => void client.refresh(crawlRun.id)} disabled={client.running || !crawlRun.action.startsWith('site_crawl')}>Refresh crawl</button>}
      </div>
    </form>
    {mode === 'site_crawl' && crawlRun && <CrawlSummary run={crawlRun} pages={pages} />}
    {page && mode !== 'site_crawl' && <PagePreview evidence={page} profile={profile} />}
  </IntelligenceFrame>;
}

function CrawlSummary({ run, pages }: { run: IntelligenceRun; pages: PageEvidence[] }) {
  const issueCount = pages.reduce((sum, page) => sum + page.issues.length, 0);
  return <section className="intelligence-run-summary" aria-label="Site crawl coverage">
    <div><strong>{run.statusMessage}</strong><span>{run.summary.pagesCrawled ?? 0} page{run.summary.pagesCrawled === 1 ? '' : 's'} saved · {issueCount} check{issueCount === 1 ? '' : 's'} flagged</span></div>
    {pages.length > 0 && <div className="intelligence-evidence-list">{pages.slice(0, 50).map(page => <div className="intelligence-evidence-row" key={page.id}><strong>{page.title || page.url}</strong><small>{[page.statusCode === null ? null : `HTTP ${page.statusCode}`, page.wordCount === null ? null : `${page.wordCount} words`, `${page.issues.length} check${page.issues.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small></div>)}</div>}
  </section>;
}

function PagePreview({ evidence, profile }: { evidence: PageEvidence; profile: string }) {
  const image = safeImageSource(evidence.screenshotUrl);
  const pageDetails = [evidence.statusCode === null ? null : `HTTP ${evidence.statusCode}`, evidence.description].filter(Boolean).join(' · ');
  return <>
    <div className="intelligence-evidence-list"><div className="intelligence-evidence-row"><strong>{evidence.title || evidence.url}</strong><small>{pageDetails || 'Page metadata recorded'}{evidence.wordCount === null ? '' : ` · ${evidence.wordCount} words`} · {evidence.renderingMode === 'rendered' ? 'rendered in browser' : 'HTML response'}</small></div></div>
    <LimitationList source={evidence.source} />
    {evidence.issues.length > 0 && <section className="intelligence-page-issues" aria-label="RoundSEO page checks"><h4>Page checks</h4><div className="intelligence-evidence-list">{evidence.issues.slice(0, 20).map((issue, index) => <div className="intelligence-evidence-row" key={`${issue.code}-${index}`}><strong>{issue.message}</strong><small>{[issue.severity, issue.category, issue.value === null ? null : String(issue.value)].filter(Boolean).join(' · ')}</small></div>)}</div></section>}
    {evidence.contentMarkdown && <section className="intelligence-answer"><h4>Extracted content</h4><p>{evidence.contentMarkdown.slice(0, 4000)}</p></section>}
    {image && <figure className="intelligence-screenshot"><img src={image} alt={`RoundSEO ${profile} screenshot of ${evidence.url}`} /><figcaption>Screenshot evidence for {evidence.url}.</figcaption></figure>}
  </>;
}
