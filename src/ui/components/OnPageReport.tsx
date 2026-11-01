import { useState, type ReactNode } from 'react';
import type { AuditControl } from '../../worker/crawlers/assurance/types';
import './OnPageReport.css';

type Page = {
  url: string; statusCode: number; title?: string; metaDescription?: string;
  h1: string[]; h2?: string[]; h3?: string[]; canonicalUrl?: string; robots?: string;
  indexable: boolean; contentSource?: string; requiresJavaScriptRendering?: boolean;
  wordCount: number; imageCount?: number; imagesWithoutAlt?: number;
  internalLinks: number; externalLinks: number; contentExcerpt: string; structuredDataTypes: string[];
  linkEvidence: Array<{ target?: string; anchorText: string; placement: string; isInternal: boolean; relAttributes?: string }>;
};
type Finding = {
  ruleId: string; title: string; priority: string; rationale: string; confidence: string;
  evidence: Array<{ url: string; element: string; observed: string; recommendation: string; relatedUrls?: string[] }>;
};

const REFERENCES = {
  title: { label: 'Google: title links', url: 'https://developers.google.com/search/docs/appearance/title-link' },
  description: { label: 'Google: snippets and descriptions', url: 'https://developers.google.com/search/docs/appearance/snippet' },
  canonical: { label: 'Google: canonical URLs', url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls' },
  structured: { label: 'Google: structured data', url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' },
  images: { label: 'Google: image and alt-text guidance', url: 'https://developers.google.com/search/docs/appearance/google-images' },
};

function path(url: string): string { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return url; } }
function sourceLink(url: string): ReactNode {
  try {
    const target = new URL(url);
    if (['http:', 'https:'].includes(target.protocol)) return <a href={target.href} target="_blank" rel="noreferrer">{url}</a>;
  } catch { /* Retain invalid declarations as text so they can still be reviewed. */ }
  return <span>{url}</span>;
}
function reference(key: keyof typeof REFERENCES): ReactNode {
  const item = REFERENCES[key];
  return <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>;
}
function Field({ label, value, note, guide }: { label: string; value: ReactNode; note?: string; guide?: keyof typeof REFERENCES }) {
  return <div className="onpage-field"><dt>{label}{guide && reference(guide)}</dt><dd>{value}<small>{note}</small></dd></div>;
}

export default function OnPageReport({ pages, findings, controls = [], checkedAt, rendered, onOpenPage }: {
  pages: Page[]; findings: Finding[]; controls?: AuditControl[]; checkedAt: string; rendered: boolean; onOpenPage: (url: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'findings' | 'metadata' | 'headings'>('all');
  const evidenceFor = (url: string) => findings.filter(finding => finding.evidence.some(item => item.url === url || item.relatedUrls?.includes(url)));
  const visible = pages.filter(page => {
    if (!`${page.url} ${page.title || ''} ${page.metaDescription || ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'metadata') return !page.title?.trim() || !page.metaDescription?.trim();
    if (filter === 'headings') return page.h1.length !== 1;
    if (filter === 'findings') return evidenceFor(page.url).length > 0;
    return true;
  });
  const checks = [
    { label: 'Title recorded', count: pages.filter(page => page.title?.trim()).length },
    { label: 'Description recorded', count: pages.filter(page => page.metaDescription?.trim()).length },
    { label: 'One H1 recorded', count: pages.filter(page => page.h1.length === 1).length },
    { label: 'Canonical recorded', count: pages.filter(page => page.canonicalUrl?.trim()).length },
    { label: 'Schema types recorded', count: pages.filter(page => page.structuredDataTypes.length).length },
  ];
  const exportEvidence = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ checkedAt, method: rendered ? 'Browser-rendered DOM' : 'Response HTML', pages: visible, findings: findings.filter(finding => finding.evidence.some(item => visible.some(page => page.url === item.url))) }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'roundseo-on-page-evidence.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="audit-view onpage-report">
    <div className="section-title"><div><h2>On-page evidence for every inspected URL.</h2><p>Read the exact values saved by the {rendered ? 'browser-rendered crawl' : 'HTML crawl'} on {checkedAt}. Expand a page for its tags, heading text, links, findings, and references.</p></div><button className="button outline small" onClick={exportEvidence} disabled={!visible.length}>Download evidence JSON</button></div>
    <div className="onpage-summary" aria-label="Recorded on-page coverage">{checks.map(check => <div key={check.label}><span>{check.label}</span><strong>{check.count} <small>/ {pages.length} pages</small></strong></div>)}</div>
    <div className="onpage-toolbar"><label>Find a page<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="URL, title or description" /></label><label>Page condition<select aria-label="Page condition" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All inspected pages</option><option value="findings">Pages with findings</option><option value="metadata">Missing title or description</option><option value="headings">No H1 or multiple H1s</option></select></label><span>{visible.length} of {pages.length} pages</span></div>
    <div className="onpage-pages">{visible.map((page, index) => {
      const pageFindings = evidenceFor(page.url);
      const pageControls = controls.filter(control => ['Metadata', 'Content', 'Canonical', 'Links', 'Media', 'Structured data'].includes(control.group) && control.evidence.some(item => item.url === page.url));
      return <details className="onpage-page" key={page.url} open={index === 0 ? true : undefined}>
        <summary><span><strong>{path(page.url)}</strong><small>{page.title || 'No title recorded'}</small></span><span className="onpage-page-state">HTTP {page.statusCode}<small>{pageFindings.length} finding{pageFindings.length === 1 ? '' : 's'} · {page.h1.length} H1</small></span></summary>
        <div className="onpage-page-body"><div className="onpage-source"><div><strong>Source page</strong><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a><small>{page.contentSource || (rendered ? 'Browser-rendered DOM' : 'Response HTML')} · {checkedAt}</small></div><button className="text-action" onClick={() => onOpenPage(page.url)}>Open full page snapshot</button></div>
          {page.requiresJavaScriptRendering && <p className="onpage-limit">This snapshot needs JavaScript rendering. Values below describe only the content retained by this crawl.</p>}
          <dl className="onpage-fields">
            <Field label="Title tag" value={page.title || 'No title recorded'} note={`${[...(page.title || '')].length} characters · title element`} guide="title" />
            <Field label="Meta description" value={page.metaDescription || 'No description recorded'} note={`${[...(page.metaDescription || '')].length} characters · meta[name="description"]`} guide="description" />
            <Field label="Canonical declaration" value={page.canonicalUrl ? sourceLink(page.canonicalUrl) : 'No canonical recorded'} note={'link[rel="canonical"] · declared target from this snapshot'} guide="canonical" />
            <Field label="Robots declaration" value={page.robots || 'No robots directive recorded'} note={`Crawl indexability: ${page.indexable ? 'eligible under the recorded checks' : 'restricted under the recorded checks'}`} />
            <Field label="Structured data types" value={page.structuredDataTypes.length ? page.structuredDataTypes.join(', ') : 'No types recorded'} note="Detected types; review the associated validation controls below." guide="structured" />
            <Field label="Images and alternative text" value={page.imageCount === undefined ? 'Image counts not retained' : `${page.imageCount} images · ${page.imagesWithoutAlt === undefined ? 'alt coverage not retained' : `${page.imagesWithoutAlt} with a missing alt attribute`}`} note="An empty alt can be intentional for a decorative image. Review the image in context." guide="images" />
            <Field label="Text and links" value={`${page.wordCount.toLocaleString()} extracted words · ${page.internalLinks} internal links · ${page.externalLinks} external links`} note="Counts reflect the saved snapshot." />
          </dl>
          <section className="onpage-heading-evidence"><h3>Exact heading text</h3><div>{([['H1', page.h1], ['H2', page.h2], ['H3', page.h3]] as const).map(([label, headings]) => <div key={label}><h4>{label} <span>{headings?.length ?? '—'}</span></h4>{headings === undefined ? <p>Not retained in this snapshot.</p> : headings.length ? <ol>{headings.map((heading, position) => <li key={`${position}-${heading}`}>{heading || '(Empty heading)'}</li>)}</ol> : <p>No {label} recorded.</p>}</div>)}</div></section>
          <section className="onpage-finding-evidence"><h3>Findings and exact observations</h3>{pageFindings.length ? pageFindings.map(finding => <article key={finding.ruleId}><header><strong>{finding.title}</strong><span>{finding.priority} · {finding.confidence} confidence</span></header><p>{finding.rationale}</p><code>{finding.ruleId}</code>{finding.evidence.filter(item => item.url === page.url || item.relatedUrls?.includes(page.url)).map((item, position) => <dl key={position}><div><dt>Element / check</dt><dd>{item.element}</dd></div><div><dt>Observed</dt><dd>{item.observed}</dd></div><div><dt>Suggested action</dt><dd>{item.recommendation}</dd></div>{item.relatedUrls?.length ? <div><dt>Related pages</dt><dd>{item.relatedUrls.map(url => <a href={url} key={url} target="_blank" rel="noreferrer">{url}</a>)}</dd></div> : null}</dl>)}</article>) : <p>No grouped finding is attached to this page. Review the recorded values and any incomplete checks before drawing a conclusion.</p>}</section>
          {pageControls.length > 0 && <section className="onpage-control-evidence"><h3>Evaluated checks and references</h3>{pageControls.map(control => <details key={control.id}><summary>{control.name} <span>Audit-wide {control.status.replace(/_/g, ' ')}</span></summary><p>{control.requirement}</p>{control.evidence.filter(item => item.url === page.url).map((item, position) => <p key={position}>{item.observed}</p>)}<a href={control.source} target="_blank" rel="noreferrer">Source guidance for {control.name}</a></details>)}</section>}
          <details className="onpage-link-evidence"><summary>Stored link and anchor evidence ({page.linkEvidence.length})</summary>{page.linkEvidence.length ? <div>{page.linkEvidence.map((link, position) => <article key={position}><strong>{link.anchorText || '(Empty anchor)'}</strong>{link.target ? <>{sourceLink(link.target)}</> : <span>Target not retained</span>}<small>{link.isInternal ? 'Internal' : 'External'} · {link.placement} · rel: {link.relAttributes || 'not specified'}</small></article>)}</div> : <p>No individual link evidence was retained.</p>}</details>
          {page.contentExcerpt && <details className="onpage-content-evidence"><summary>Stored content excerpt</summary><p>{page.contentExcerpt}</p></details>}
        </div>
      </details>;
    })}{!visible.length && <p className="empty-row">No inspected page matches these filters. Change the filters or run an audit to collect page evidence.</p>}</div>
    <section className="onpage-reference-list"><h3>Reference library</h3><p>Use these primary sources to interpret the stored declarations and plan a change.</p><ul>{Object.values(REFERENCES).map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.label}</a></li>)}</ul></section>
  </section>;
}
