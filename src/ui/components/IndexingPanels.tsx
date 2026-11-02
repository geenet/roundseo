import { FormEvent, useEffect, useState } from 'react';
import { readStoredJson } from '../storage';
import type { GoogleConnection, IndexingAction, IndexingCoverage, IndexingInventoryItem } from '../../shared/indexing';

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

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function percentLabel(value: number | null): string { return value === null ? 'Unavailable' : `${Math.round(value * 100)}%`; }

function Icon({ name }: { name: 'arrow' | 'check' | 'globe' | 'alert' }) {
  const paths: Record<string, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.1 2.4 3 5.4 3 9s-.9 6.6-3 9c-2.1-2.4-3-5.4-3-9s.9-6.6 3-9ZM3 12h18',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a1.5 1.5 0 0 0 1.3 2.3h17.8a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z',
  };
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]} /></svg>;
}

export function IndexingWorkspace({ websiteId }: { websiteId: string }) {
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [coverage, setCoverage] = useState<IndexingCoverage | null>(null);
  const [inventory, setInventory] = useState<IndexingInventoryItem[]>([]);
  const [actions, setActions] = useState<IndexingAction[]>([]);
  const [message, setMessage] = useState('');

  const refreshAll = async () => {
    const [connectionRes, coverageRes, inventoryRes, actionsRes] = await Promise.all([
      apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/google-connection`),
      apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/indexing`),
      apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/indexing/inventory?limit=100`),
      apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/indexing/actions`),
    ]);
    if (connectionRes.status === 200) setConnection(connectionRes.body.connection);
    if (coverageRes.status === 200) setCoverage(coverageRes.body.coverage);
    if (inventoryRes.status === 200) setInventory(inventoryRes.body.items || []);
    if (actionsRes.status === 200) setActions(actionsRes.body.actions || []);
  };

  useEffect(() => { void refreshAll(); }, [websiteId]);

  const connectGoogle = async (withWrite: boolean) => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/google-connection/start${withWrite ? '?scope=write' : ''}`);
    if (status === 200 && body?.url) window.location.href = body.url;
    else setMessage(body?.error || 'Google is not configured on this deployment.');
  };

  const [sitesOpen, setSitesOpen] = useState(false);
  const [sites, setSites] = useState<Array<{ siteUrl: string; permissionLevel: string }>>([]);
  const loadSites = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/google-connection/sites`);
    if (status === 200) { setSites(body.sites || []); setSitesOpen(true); } else setMessage(body?.error || 'Reconnect Google access for this website.');
  };
  const selectProperty = async (siteUrl: string) => {
    const propertyType = siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix';
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/google-connection/property`, { method: 'POST', body: JSON.stringify({ selectedProperty: siteUrl, propertyType }) });
    if (status === 200) { setConnection(body.connection); setSitesOpen(false); } else setMessage(body?.error || 'Could not select this property.');
  };

  const [urlDraft, setUrlDraft] = useState('');
  const addInventory = async (event: FormEvent) => {
    event.preventDefault();
    const urls = urlDraft.split(/\s+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return;
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/indexing/inventory`, { method: 'POST', body: JSON.stringify({ urls, source: 'manual' }) });
    if (status === 201) { setUrlDraft(''); await refreshAll(); } else setMessage(body?.error || 'Could not add these pages.');
  };

  const inspect = async (url: string) => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/inspection-jobs`, { method: 'POST', body: JSON.stringify({ url, reason: 'manual' }) });
    setMessage(status === 202 ? 'Inspection queued.' : (body?.error || 'Could not queue this inspection.'));
    if (status === 202) await refreshAll();
  };

  const [sitemapUrl, setSitemapUrl] = useState('');
  const submitSitemap = async (event: FormEvent) => {
    event.preventDefault();
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/sitemap-submissions`, { method: 'POST', body: JSON.stringify({ sitemapUrl }) });
    setMessage(status === 201 ? 'Sitemap submitted.' : (body?.reason || body?.error || 'Google did not accept this sitemap.'));
    if (status === 201) { setSitemapUrl(''); await refreshAll(); }
  };

  const handoff = async (inventoryId: string) => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/indexing/handoff`, { method: 'POST', body: JSON.stringify({ inventoryId }) });
    if (status === 200 && body.inspectionResultLink) window.open(body.inspectionResultLink, '_blank', 'noreferrer');
    else setMessage('Inspect this page first — Google only returns a Search Console link once it has been inspected.');
  };

  return <section className="audit-view capability-view indexing-view">
    <div className="section-title"><div>
      <h2>Know what Google has actually indexed.</h2>
      <p>Four separate facts, never merged into one status: whether a page contains a link, whether it looks technically indexable, whether Google reports it indexed, and whether RoundSEO asked a search engine to look.</p>
    </div></div>

    {!connection && <div className="capability-empty"><Icon name="globe" /><p>Connect Google Search Console to inspect index status for this website. RoundSEO starts with read-only access.
      <button className="text-action" type="button" onClick={() => connectGoogle(false)}> Connect Google <Icon name="arrow" /></button></p></div>}

    {connection && !connection.selectedProperty && <div className="capability-empty"><Icon name="alert" /><p>Connected as {connection.googleAccountEmail}. Choose which Search Console property this website maps to.
      <button className="text-action" type="button" onClick={loadSites}> Choose property <Icon name="arrow" /></button></p>
      {sitesOpen && <div className="backlink-list">{sites.map(site => <div className="backlink-row" key={site.siteUrl}><div><strong>{site.siteUrl}</strong><small>{site.permissionLevel}</small></div><span><button className="button outline small" type="button" onClick={() => selectProperty(site.siteUrl)}>Use this property</button></span></div>)}</div>}
    </div>}

    {connection?.selectedProperty && <>
      <div className="capability-stat-band">
        <div className="capability-stat"><span>Intended pages</span><strong>{coverage?.intendedCount ?? 0}</strong><p>Pages RoundSEO intends to be indexed.</p></div>
        <div className="capability-stat"><span>Indexed of inspected</span><strong>{percentLabel(coverage?.indexedShareOfInspected ?? null)}</strong><p>{coverage ? `${coverage.inspectedCount} inspected, ${coverage.uninspectedCount} not yet inspected.` : 'Loading…'}</p></div>
        <div className="capability-stat"><span>Google inspection quota</span><strong>{coverage ? `${coverage.quota.used}/${coverage.quota.limit}` : '—'}</strong><p>Resets {coverage ? dateLabel(coverage.quota.resetAt) : ''}.</p></div>
      </div>

      <form className="import-panel" onSubmit={addInventory}>
        <div><h3>Add pages to the intended-index inventory.</h3><p>One URL per line. Priority pages are inspected before the rotation sweep.</p></div>
        <label>Page URLs<textarea value={urlDraft} onChange={e => setUrlDraft(e.target.value)} rows={3} placeholder={'https://your-site.example/\nhttps://your-site.example/pricing'} /></label>
        <div className="import-panel-actions"><button className="button solid small" type="submit">Add pages <Icon name="arrow" /></button>{message && <span role="status">{message}</span>}</div>
      </form>

      {inventory.length > 0 && <section className="capability-table-section">
        <div className="section-title"><div><h3>Inventory and coverage</h3><p>Google's stored result for this property and URL — not a fresh, live crawl.</p></div></div>
        <div className="backlink-evidence-list">{inventory.map(item => <article className="backlink-evidence-row" key={item.id}>
          <div className="backlink-evidence-origin"><span>Page</span><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a><small>{item.isPriority ? 'Priority' : 'Rotation'} · from {item.source}</small></div>
          <dl>
            <div><dt>Google verdict</dt><dd>{item.latestObservation ? item.latestObservation.verdict.replace('_', ' ') : 'Not yet checked'}</dd></div>
            <div><dt>Coverage reason</dt><dd>{item.latestObservation?.coverageReason || 'Unknown, not checked, or connection required'}</dd></div>
            <div><dt>Google's last crawl</dt><dd>{dateLabel(item.latestObservation?.googleCrawlTime)}</dd></div>
            <div><dt>RoundSEO checked</dt><dd>{dateLabel(item.latestObservation?.checkedAt)}</dd></div>
          </dl>
          <div className="import-panel-actions">
            <button className="button outline small" type="button" onClick={() => inspect(item.url)}>Inspect now</button>
            <button className="text-action" type="button" onClick={() => handoff(item.id)}>Open in Search Console <Icon name="arrow" /></button>
          </div>
        </article>)}</div>
      </section>}

      <details className="provider-fallback">
        <summary>Submit a sitemap</summary>
        <form className="import-panel" onSubmit={submitSitemap}>
          <div><h3>Submit a sitemap for crawling.</h3><p>Assists discovery; acceptance is never itself an indexed result — only a later inspection is. Enabling this grants Google's additional, write-capable scope.</p></div>
          {!connection.canSubmitSitemaps
            ? <div className="import-panel-actions"><button className="button outline small" type="button" onClick={() => connectGoogle(true)}>Enable sitemap submission <Icon name="arrow" /></button></div>
            : <>
                <label>Sitemap URL<input value={sitemapUrl} onChange={e => setSitemapUrl(e.target.value)} placeholder="https://your-site.example/sitemap.xml" required /></label>
                <div className="import-panel-actions"><button className="button solid small" type="submit">Submit sitemap <Icon name="check" /></button></div>
              </>}
        </form>
      </details>

      {actions.length > 0 && <section className="capability-table-section">
        <div className="section-title"><div><h3>Action log</h3></div></div>
        <div className="compact-ledger">{actions.map(action => <div key={action.id}>
          <strong>{action.actionType.replace(/_/g, ' ')} — {action.submissionState}</strong>
          <span>{dateLabel(action.createdAt)}</span>
        </div>)}</div>
      </section>}
    </>}
  </section>;
}
