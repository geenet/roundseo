import { FormEvent, useEffect, useState } from 'react';
import { readStoredJson } from '../storage';
import type {
  BacklinkCapacity, BacklinkEvent, BacklinkImportPreview, BacklinkList, BacklinkMonitor, BacklinkObservation,
  MatchMode, MonitorCadence, MonitorStatus,
} from '../../shared/backlinks';

/** A raw action_items row, as GET /api/v2/websites/:id/actions returns it (snake_case, unmapped). */
interface DestinationProblem {
  id: string; rule_id: string; title: string; status: string; severity: string; business_impact: string | null; last_seen_at: string;
}

function authHeaders(): Record<string, string> {
  const token = readStoredJson<string>('roundseo-token', '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    return { status: 0, body: { error: 'RoundSEO could not reach the API.' } };
  }
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function firstOrganizationId(): Promise<string | null> {
  const { status, body } = await apiFetch('/api/v2/organizations');
  if (status !== 200) return null;
  return body?.organizations?.[0]?.id || null;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Icon({ name }: { name: 'arrow' | 'check' | 'clock' | 'search' | 'globe' | 'alert' }) {
  const paths: Record<string, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    search: 'm20 20-4.5-4.5m2.5-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.1 2.4 3 5.4 3 9s-.9 6.6-3 9c-2.1-2.4-3-5.4-3-9s.9-6.6 3-9ZM3 12h18',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a1.5 1.5 0 0 0 1.3 2.3h17.8a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z',
  };
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]} /></svg>;
}

export function BacklinksWorkspace({ websiteId }: { websiteId: string }) {
  const [monitors, setMonitors] = useState<BacklinkMonitor[]>([]);
  const [lists, setLists] = useState<BacklinkList[]>([]);
  const [capacity, setCapacity] = useState<BacklinkCapacity | null>(null);
  const [message, setMessage] = useState('');
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ observations: BacklinkObservation[]; events: BacklinkEvent[] } | null>(null);
  const [discoveryReason, setDiscoveryReason] = useState<string | null>(null);
  const [destinationProblems, setDestinationProblems] = useState<DestinationProblem[]>([]);

  const refreshMonitors = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/backlinks?limit=200`);
    if (status === 200) setMonitors(body.monitors || []);
  };
  const refreshLists = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/backlink-lists`);
    if (status === 200) setLists(body.lists || []);
  };
  // The site-wide action plan is a separate, crawl-derived screen that does not read this
  // live table, so a monitored backlink's destination problem (src/worker/backlinks/destination-findings.ts)
  // would otherwise never surface anywhere in the product — show it here, where the evidence came from.
  const refreshDestinationProblems = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/actions`);
    if (status === 200) setDestinationProblems((body.actions || []).filter((action: DestinationProblem) => action.rule_id?.startsWith('backlink_target_') && action.status !== 'verified_resolved' && action.status !== 'ignored' && action.status !== 'not_applicable'));
  };

  useEffect(() => { void refreshMonitors(); void refreshLists(); void refreshDestinationProblems(); }, [websiteId]);
  useEffect(() => {
    (async () => {
      const orgId = await firstOrganizationId();
      if (!orgId) return;
      const { status, body } = await apiFetch(`/api/v2/organizations/${encodeURIComponent(orgId)}/backlinks/usage`);
      if (status === 200) setCapacity(body.capacity);
    })();
  }, []);

  const [sourceUrl, setSourceUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('exact_page');
  const [cadence, setCadence] = useState<MonitorCadence>('weekly');
  const addMonitor = async (event: FormEvent) => {
    event.preventDefault();
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/backlinks`, {
      method: 'POST', body: JSON.stringify({ sourceUrl, expectedTargetUrl: targetUrl, matchMode, cadence }),
    });
    if (status === 200 || status === 201) {
      setMessage('Monitor added. Its first check runs on the next scheduled sweep.');
      setSourceUrl(''); setTargetUrl('');
      await refreshMonitors();
    } else setMessage(body?.error || 'Could not add this monitor.');
  };

  const [csvDraft, setCsvDraft] = useState('');
  const [importPreview, setImportPreview] = useState<BacklinkImportPreview | null>(null);
  const previewImport = async (event: FormEvent) => {
    event.preventDefault();
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/backlinks/imports`, {
      method: 'POST', headers: { 'Idempotency-Key': `import-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify({ csv: csvDraft }),
    });
    if (status === 201) setImportPreview(body.import);
    else setMessage(body?.error || 'Could not read this import.');
  };
  const commitImport = async () => {
    if (!importPreview) return;
    const { status, body } = await apiFetch(`/api/v2/backlinks/imports/${encodeURIComponent(importPreview.importId)}/commit`, { method: 'POST' });
    if (status === 200) {
      setImportPreview(body.import);
      setMessage(`Import committed: ${body.import.acceptedCount} accepted, ${body.import.duplicateCount} duplicate, ${body.import.invalidCount} invalid, ${body.import.overLimitCount} over the workspace limit.`);
      setCsvDraft('');
      await refreshMonitors();
    } else setMessage(body?.error || 'Could not commit this import.');
  };

  const recheck = async (id: string) => {
    const { status, body } = await apiFetch(`/api/v2/backlinks/${encodeURIComponent(id)}/checks`, { method: 'POST' });
    setMessage(status === 202 ? 'Recheck queued.' : (body?.error || 'Could not queue a recheck.'));
  };
  const setStatus = async (id: string, status: MonitorStatus) => {
    const { status: responseStatus, body } = await apiFetch(`/api/v2/backlinks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (responseStatus === 200) await refreshMonitors(); else setMessage(body?.error || 'Could not update this monitor.');
  };
  const openHistory = async (id: string) => {
    setSelectedMonitorId(id);
    const { status, body } = await apiFetch(`/api/v2/backlinks/${encodeURIComponent(id)}/history`);
    if (status === 200) setHistory(body);
  };

  const [newListName, setNewListName] = useState('');
  const createList = async (event: FormEvent) => {
    event.preventDefault();
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/backlink-lists`, { method: 'POST', body: JSON.stringify({ name: newListName }) });
    if (status === 201) { setNewListName(''); await refreshLists(); } else setMessage(body?.error || 'Could not create this list.');
  };
  const [shareLinks, setShareLinks] = useState<Record<string, string>>({});
  const shareList = async (listId: string) => {
    const { status, body } = await apiFetch(`/api/v2/backlink-lists/${encodeURIComponent(listId)}/shares`, { method: 'POST' });
    if (status === 201) setShareLinks(current => ({ ...current, [listId]: `${window.location.origin}/api/v2/backlink-shares/${body.share.sharedToken}` }));
  };

  const runDiscovery = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/discovery-jobs`, { method: 'POST', headers: { 'Idempotency-Key': `discover-${Date.now()}` }, body: JSON.stringify({}) });
    if (status === 202) setDiscoveryReason(body.job.reason || 'No provider is configured.');
  };

  const active = monitors.filter(m => m.status === 'active');
  const confirmedLoss = monitors.filter(m => m.lastConfirmedPresence === 'absent');
  const pendingConfirmation = monitors.filter(m => m.confirmationDueAt);
  const selectedMonitor = monitors.find(m => m.id === selectedMonitorId) || null;

  return <section className="audit-view capability-view backlink-view">
    <div className="section-title"><div>
      <h2>Monitor the backlinks you already know about.</h2>
      <p>Each monitor tracks one source page and the expected target link. A suspected loss needs a second, independent check before it is confirmed — a blocked, timed-out, or truncated attempt never counts as a removal.</p>
    </div></div>

    <div className="capability-stat-band">
      <div className="capability-stat"><span>Active monitors</span><strong>{active.length}</strong><p>{capacity ? `${capacity.used} of ${capacity.limit} workspace slots used.` : 'Loading workspace capacity…'}</p></div>
      <div className="capability-stat"><span>Confirmed losses</span><strong>{confirmedLoss.length}</strong><p>Links confirmed missing after a second independent check.</p></div>
      <div className="capability-stat"><span>Awaiting confirmation</span><strong>{pendingConfirmation.length}</strong><p>Suspected losses waiting on their confirmation recheck.</p></div>
    </div>

    {destinationProblems.length > 0 && <section className="capability-table-section" aria-label="Destination problems">
      <div className="section-title"><div><h3>Valuable destination problems</h3><p>A monitored backlink's target page now has a problem — confirmed by the same check that verifies the link, and joined to the existing action workflow. An intentional noindex or an approved redirect is never flagged here.</p></div></div>
      <div className="compact-ledger">{destinationProblems.map(problem => <div key={problem.id}>
        <strong>{problem.title}</strong>
        <span>{problem.severity} · {dateLabel(problem.last_seen_at)}</span>
      </div>)}</div>
    </section>}

    <form className="import-panel" onSubmit={addMonitor}>
      <div><h3>Add a backlink to monitor.</h3><p>RoundSEO checks the source page for the exact link you expect and keeps a dated history of every check.</p></div>
      <label>Source page (where the link should appear)<input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://news.example/review" required /></label>
      <label>Expected target<input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://your-site.example/pricing" required /></label>
      <div className="import-panel-actions">
        <select value={matchMode} onChange={e => setMatchMode(e.target.value as MatchMode)} aria-label="Match mode">
          <option value="exact_page">Exact page</option>
          <option value="domain_wide">Anywhere on this domain</option>
        </select>
        <select value={cadence} onChange={e => setCadence(e.target.value as MonitorCadence)} aria-label="Check cadence">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="manual">Manual only</option>
        </select>
        <button className="button solid small" type="submit">Add monitor <Icon name="arrow" /></button>
        {message && <span role="status">{message}</span>}
      </div>
    </form>

    {monitors.length > 0 && <section className="backlink-evidence" aria-labelledby="monitor-list-title">
      <div className="section-title"><div><h3 id="monitor-list-title">Monitored backlinks</h3><p>Source-page search evidence is kept separate from link presence; each is its own column below.</p></div></div>
      <div className="backlink-evidence-list">
        {monitors.map(monitor => <article className="backlink-evidence-row" key={monitor.id}>
          <div className="backlink-evidence-origin">
            <span>Source page</span>
            <a href={monitor.sourceUrl} target="_blank" rel="noreferrer">{monitor.sourceUrl}</a>
            <small>Expects: {monitor.expectedTargetUrl} ({monitor.matchMode === 'domain_wide' ? 'anywhere on domain' : 'exact page'})</small>
          </div>
          <dl>
            <div><dt>Presence</dt><dd><PresenceBadge monitor={monitor} /></dd></div>
            <div><dt>Status</dt><dd>{monitor.status}</dd></div>
            <div><dt>Last successful check</dt><dd>{dateLabel(monitor.lastSuccessfulCheckAt)}</dd></div>
            <div><dt>Next check</dt><dd>{dateLabel(monitor.nextCheckAt)}</dd></div>
          </dl>
          <div className="import-panel-actions">
            <button className="button outline small" type="button" onClick={() => recheck(monitor.id)}>Recheck now</button>
            <button className="text-action" type="button" onClick={() => openHistory(monitor.id)}>View history <Icon name="arrow" /></button>
            {monitor.status === 'active'
              ? <button className="text-action" type="button" onClick={() => setStatus(monitor.id, 'paused')}>Pause</button>
              : <button className="text-action" type="button" onClick={() => setStatus(monitor.id, 'active')}>Reactivate</button>}
          </div>
        </article>)}
      </div>
    </section>}

    {selectedMonitor && history && <section className="backlink-detail-grid" aria-label={`History for ${selectedMonitor.sourceUrl}`}>
      <section>
        <h3>Check history</h3>
        {history.observations.length ? <div className="compact-ledger">{history.observations.map(observation => <div key={observation.id}>
          <strong>{dateLabel(observation.attemptedAt)} — {observation.presence}{observation.presenceMethod === 'rendered' ? ' (rendered)' : ''}</strong>
          <span>{observation.fetchOutcome}{observation.httpStatus ? ` · HTTP ${observation.httpStatus}` : ''} · {observation.confirmationState}</span>
        </div>)}</div> : <p className="quiet">No checks recorded yet.</p>}
      </section>
      <section>
        <h3>Change events</h3>
        {history.events.length ? <div className="compact-ledger">{history.events.map(backlinkEvent => <div key={backlinkEvent.id}>
          <strong>{backlinkEvent.eventType.replace(/_/g, ' ')}</strong>
          <span>{dateLabel(backlinkEvent.createdAt)}</span>
        </div>)}</div> : <p className="quiet">No confirmed changes yet.</p>}
      </section>
    </section>}

    <details className="provider-fallback">
      <summary>Import known backlinks from a CSV export</summary>
      <form className="import-panel" onSubmit={previewImport}>
        <div><h3>Import backlink records.</h3><p>CSV, TSV, or semicolon-separated rows. A source-page column is required; a target-page column is optional — rows with no target become candidates until an actual link is found.</p><p className="import-format">Expected headers: source_url, target_url, expected_anchor, expected_rel, notes, placement_date</p></div>
        <label>Backlink export<textarea value={csvDraft} onChange={e => setCsvDraft(e.target.value)} rows={5} placeholder={'source_url,target_url\nhttps://news.example/review,https://your-site.example/seo'} /></label>
        <div className="import-panel-actions"><button className="button solid small" type="submit">Preview import <Icon name="arrow" /></button></div>
      </form>
      {importPreview && <div className="capability-stat-band">
        <div className="capability-stat"><span>Accepted</span><strong>{importPreview.acceptedCount}</strong></div>
        <div className="capability-stat"><span>Duplicate</span><strong>{importPreview.duplicateCount}</strong></div>
        <div className="capability-stat"><span>Invalid / over limit</span><strong>{importPreview.invalidCount + importPreview.overLimitCount}</strong></div>
        {importPreview.status === 'previewed' && <div className="import-panel-actions"><button className="button solid small" type="button" onClick={commitImport}>Commit import <Icon name="check" /></button></div>}
      </div>}
      {importPreview && importPreview.rows.some(row => row.status === 'invalid' || row.status === 'duplicate' || row.status === 'over_limit') && <div className="compact-ledger">
        {importPreview.rows.filter(row => row.status !== 'accepted').map(row => <div key={row.rowIndex}>
          <strong>Row {row.rowIndex + 1}: {row.sourceUrl || 'No source URL supplied'}</strong>
          <span>{row.status}{row.errorMessage ? ` — ${row.errorMessage}` : ''}</span>
        </div>)}
      </div>}
    </details>

    <section className="capability-table-section">
      <div className="section-title"><div><h3>Lists</h3><p>Organize monitors into campaigns or client collections. One monitor in several lists still consumes one active slot.</p></div></div>
      <form className="import-panel-actions" onSubmit={createList}><input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="New list name" required /><button className="button outline small" type="submit">Create list</button></form>
      <div className="backlink-list">{lists.map(list => <div className="backlink-row" key={list.id}>
        <div><strong>{list.name}</strong><small>{list.monitorCount} monitor{list.monitorCount === 1 ? '' : 's'}</small></div>
        <span>{shareLinks[list.id] ? <code>{shareLinks[list.id]}</code> : <button className="text-action" type="button" onClick={() => shareList(list.id)}>Create client share link <Icon name="arrow" /></button>}</span>
      </div>)}
      {!lists.length && <EmptyNote message="No lists yet. Create one to organize monitors for a client report." />}</div>
    </section>

    <section className="capability-empty" aria-label="Backlink discovery">
      <Icon name="search" />
      <p>{discoveryReason || 'Discover new, unknown backlinks from a licensed backlink index.'} <button className="text-action" type="button" onClick={runDiscovery}>Check availability</button></p>
    </section>
  </section>;
}

function PresenceBadge({ monitor }: { monitor: BacklinkMonitor }) {
  if (monitor.confirmationDueAt) return <span className="status-pill attention">Awaiting confirmation</span>;
  if (monitor.lastConfirmedPresence === 'present') return <span className="status-pill good">Present</span>;
  if (monitor.lastConfirmedPresence === 'absent') return <span className="status-pill attention">Confirmed missing</span>;
  return <span className="status-pill">Not yet checked</span>;
}

function EmptyNote({ message }: { message: string }) { return <div className="capability-empty"><Icon name="alert" /><p>{message}</p></div>; }
