import { useEffect, useState } from 'react';
import { readStoredJson } from '../storage';
import type {
  SearchPerformanceInsight,
  SearchPerformanceItem,
  SearchPerformanceMetrics,
  SearchPerformanceReadModel,
} from '../../shared/search-performance';

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

function Icon({ name }: { name: 'arrow' | 'alert' | 'globe' }) {
  const paths: Record<string, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a1.5 1.5 0 0 0 1.3 2.3h17.8a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.1 2.4 3 5.4 3 9s-.9 6.6-3 9c-2.1-2.4-3-5.4-3-9s.9-6.6 3-9ZM3 12h18',
  };
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24"><path d={paths[name]} /></svg>;
}

const numberLabel = (value: number): string => value.toLocaleString();
const percentLabel = (ratio: number): string => `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
const positionLabel = (value: number): string => (value > 0 ? value.toFixed(1) : '—');

/** Change against the previous window. Position is not compared here: a lower position is better. */
function changeLabel(current: number, previous: number | undefined): string {
  if (previous === undefined) return 'No previous 28 days';
  if (previous === 0) return current > 0 ? 'New since the previous 28 days' : 'Same as the previous 28 days';
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return 'Same as the previous 28 days';
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}% on the previous 28 days`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function countLabel(count: number, word: string): string {
  return `${numberLabel(count)} ${word}${count === 1 ? '' : 's'}`;
}

function metricsLine(metrics: SearchPerformanceMetrics): string {
  return `${countLabel(metrics.impressions, 'impression')} · ${countLabel(metrics.clicks, 'click')} · ${percentLabel(metrics.ctr)} CTR · position ${positionLabel(metrics.position)}`;
}

const SEVERITY_LABEL: Record<SearchPerformanceInsight['severity'], string> = {
  warning: 'Needs attention',
  opportunity: 'Opportunity',
  info: 'Note',
};

const SCOPE_LABEL: Record<SearchPerformanceInsight['scope'], string> = { site: 'Site', page: 'Page', query: 'Query' };

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="capability-stat"><span>{label}</span><strong>{value}</strong><p>{note}</p></div>;
}

function ItemList({ title, description, items, previous, label }: {
  title: string;
  description: string;
  items: SearchPerformanceItem[];
  previous: SearchPerformanceItem[];
  label: string;
}) {
  const before = new Map(previous.map(item => [item.key, item]));
  return <section className="capability-table-section">
    <div className="section-title"><div><h3>{title}</h3><p>{description}</p></div></div>
    {items.length === 0 ? <p className="quiet">Nothing reported for this window.</p> : <div className="backlink-evidence-list">
      {items.map(item => {
        const prior = before.get(item.key);
        return <article className="backlink-evidence-row" key={item.key}>
          <div className="backlink-evidence-origin"><span>{label}</span><strong>{item.key || '(not provided)'}</strong><small>{metricsLine(item)}</small></div>
          <small>{prior ? `Previous 28 days: ${countLabel(prior.clicks, 'click')}, position ${positionLabel(prior.position)}` : 'Not in the previous 28 days'}</small>
        </article>;
      })}
    </div>}
  </section>;
}

export function SearchPerformanceWorkspace({ websiteId, websiteDomain }: { websiteId: string; websiteDomain: string }) {
  const [model, setModel] = useState<SearchPerformanceReadModel | null>(null);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/search-performance`);
    if (status === 200) setModel(body);
    else setMessage(body?.error || 'Search performance could not be loaded.');
  };

  useEffect(() => {
    setModel(null);
    setMessage('');
    void load();
    // load depends only on websiteId, which is the trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);

  const syncNow = async () => {
    setSyncing(true);
    setMessage('');
    const { status, body } = await apiFetch(`/api/v2/websites/${encodeURIComponent(websiteId)}/search-performance/sync`, { method: 'POST' });
    setMessage(status === 200 ? 'Figures updated from Search Console.' : (body?.error || body?.reason || 'The sync could not be completed.'));
    await load();
    setSyncing(false);
  };

  const header = <div className="section-title"><div>
    <h2>What Google Search shows for {websiteDomain}.</h2>
    <p>Clicks, impressions, queries and pages from Google Search Console for the last 28 complete days, compared with the 28 days before. These are Google's own figures.</p>
  </div></div>;

  if (!model) {
    return <section className="audit-view capability-view search-performance-view">
      {header}
      {message ? <p role="status">{message}</p> : <p className="quiet">Loading search performance…</p>}
    </section>;
  }

  if (!model.connected) {
    return <section className="audit-view capability-view search-performance-view">
      {header}
      <div className="capability-empty"><Icon name="globe" /><p>Connect Google Search Console and choose a property first. This page then fills in from Google's figures.
        <a className="text-action" href={`/site/${encodeURIComponent(websiteDomain)}/indexing`}> Open Indexing <Icon name="arrow" /></a>
      </p></div>
    </section>;
  }

  const current = model.current;
  const previous = model.previous;
  const site: SearchPerformanceMetrics = current?.site ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const priorSite = previous?.site ?? undefined;
  const failed = model.lastSync?.status === 'failed';
  const maxImpressions = Math.max(1, ...model.days.map(day => day.impressions));

  return <section className="audit-view capability-view search-performance-view">
    {header}

    <div className="import-panel">
      <div><h3>{model.property}</h3><p>{model.lastSucceededAt ? `Figures last updated ${dateLabel(model.lastSucceededAt)}.` : 'No figures yet. Sync to pull the last 28 days from Google.'}</p></div>
      <div className="import-panel-actions">
        <button className="button solid small" type="button" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'} <Icon name="arrow" /></button>
        {message && <span role="status">{message}</span>}
      </div>
    </div>

    {failed && <div className="capability-empty"><Icon name="alert" /><p>The last sync failed: {model.lastSync?.error}. The figures below come from the last successful sync.</p></div>}

    {!model.hasData ? <div className="capability-empty"><p>No figures are stored yet. Run a sync to load them.</p></div> : <>
      <div className="capability-stat-band">
        <Stat label="Clicks" value={numberLabel(site.clicks)} note={changeLabel(site.clicks, priorSite?.clicks)} />
        <Stat label="Impressions" value={numberLabel(site.impressions)} note={changeLabel(site.impressions, priorSite?.impressions)} />
        <Stat label="Click-through rate" value={percentLabel(site.ctr)} note={priorSite ? `Previous 28 days: ${percentLabel(priorSite.ctr)}` : 'No previous 28 days'} />
        <Stat label="Average position" value={positionLabel(site.position)} note={priorSite ? `Previous 28 days: ${positionLabel(priorSite.position)}` : 'No previous 28 days'} />
      </div>

      {model.insights.length > 0 && <section className="capability-table-section">
        <div className="section-title"><div><h3>What changed and where to look</h3><p>Each finding quotes the figures it is based on. Small samples produce no finding.</p></div></div>
        <div className="backlink-evidence-list">
          {model.insights.map(insight => <article className="backlink-evidence-row" key={insight.id}>
            <div className="backlink-evidence-origin"><span>{SEVERITY_LABEL[insight.severity]} · {SCOPE_LABEL[insight.scope]}</span><strong>{insight.title}</strong>{insight.item && <small>{insight.item}</small>}</div>
            <p>{insight.detail}</p>
            <small>{metricsLine(insight.metrics)}</small>
          </article>)}
        </div>
      </section>}

      <section className="capability-table-section">
        <div className="section-title"><div><h3>Daily impressions</h3><p>One bar per reporting day. Hover a bar for its clicks and position.</p></div></div>
        <ol aria-label="Daily impressions" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, listStyle: 'none', padding: 0, margin: 0 }}>
          {model.days.map(day => <li
            key={day.day}
            title={`${dayLabel(day.day)}: ${numberLabel(day.impressions)} impressions, ${numberLabel(day.clicks)} clicks, position ${positionLabel(day.position)}`}
            style={{ flex: 1, minWidth: 2, height: `${Math.max(2, (day.impressions / maxImpressions) * 100)}%`, background: 'currentColor', opacity: 0.35, borderRadius: 2 }}
          />)}
        </ol>
        {model.days.length > 0 && <small className="quiet">{dayLabel(model.days[0].day)} to {dayLabel(model.days[model.days.length - 1].day)}</small>}
      </section>

      <ItemList
        title="Queries"
        description="Search terms with the most impressions in the last 28 days, with the previous window beside each."
        items={current?.queries ?? []}
        previous={previous?.queries ?? []}
        label="Query"
      />
      <ItemList
        title="Pages"
        description="Landing pages with the most impressions in the last 28 days."
        items={current?.pages ?? []}
        previous={previous?.pages ?? []}
        label="Page"
      />
      <ItemList
        title="Countries"
        description="Where the impressions came from. Codes are ISO 3166-1 alpha-3, as Google reports them."
        items={current?.countries ?? []}
        previous={previous?.countries ?? []}
        label="Country"
      />
      <ItemList
        title="Devices"
        description="Mobile, desktop and tablet impressions."
        items={current?.devices ?? []}
        previous={previous?.devices ?? []}
        label="Device"
      />
    </>}

    <footer className="quiet">
      <ul>{model.notes.map(note => <li key={note}>{note}</li>)}</ul>
    </footer>
  </section>;
}
