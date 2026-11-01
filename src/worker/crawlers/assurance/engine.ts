import type { PageMetrics } from '../parser';
import type { AuditAssurance, AuditControl, ControlGroup, ControlStatus } from './types';
export const ASSURANCE_VERSION = 'agency-controls-1';
export interface DocumentEvidence {
  titles: string[]; descriptions: string[]; canonicals: string[]; canonicalInBody: boolean;
  viewport: string[]; refresh: string[]; charset: string[]; baseHref?: string;
  images: Array<{ src?: string; alt?: string; width?: string; height?: string; loading?: string }>;
  alternates: Array<{ lang: string; href: string }>;
  jsonld: Array<{ valid: boolean; nodes: Array<Record<string, unknown>> }>;
  invalidHrefs: string[]; emptyAnchors: number; htmlBytes: number;
}
type Context = { pages: PageMetrics[]; rendered?: boolean };
type Outcome = { status: ControlStatus; observed: string };
type Definition = Pick<AuditControl, 'id' | 'name' | 'group' | 'severity' | 'basis' | 'requirement' | 'source'> & { evaluate: (page: PageMetrics, context: Context) => Outcome };
const source = (path: string) => `https://developers.google.com/search/docs/${path}`;
const sources: Record<ControlGroup, string> = {
  Access: source('essentials/technical'), Metadata: source('appearance/title-link'), Canonical: source('crawling-indexing/consolidate-duplicate-urls'),
  Content: source('fundamentals/creating-helpful-content'), Links: source('crawling-indexing/links-crawlable'), Media: source('appearance/google-images'),
  International: source('specialty/international/localized-versions'), 'Structured data': source('appearance/structured-data/sd-policies'), 'External evidence': source('essentials'),
};
const result = (bad: boolean, observed: unknown, review = false): Outcome => ({ status: bad ? review ? 'review' : 'fail' : 'pass', observed: String(observed) });
const na = (observed: string): Outcome => ({ status: 'not_applicable', observed });
const unknown = (observed: string): Outcome => ({ status: 'unknown', observed });
const resolved = (value: string | undefined, base: string): URL | undefined => { try { const url = new URL(value || '', base); return value && ['http:', 'https:'].includes(url.protocol) ? url : undefined; } catch { return undefined; } };
// Trailing slashes and query strings identify potentially distinct resources.
const key = (value: string) => { const url = new URL(value); url.hash = ''; return url.href; };
const doc = (p: PageMetrics) => p.documentEvidence!;
const same = (a: string, b: string) => key(a) === key(b);
const schemaNodes = (p: PageMetrics) => doc(p).jsonld.flatMap(block => block.nodes);
const defs: Definition[] = [];
function add(id: string, name: string, group: ControlGroup, severity: AuditControl['severity'], basis: AuditControl['basis'], requirement: string, evaluate: Definition['evaluate']) {
  defs.push({ id, name, group, severity, basis, requirement, evaluate, source: sources[group] });
}
add('access.http', 'Successful content response', 'Access', 'critical', 'technical', 'Serve HTTP 200 for an intended content URL.', p => p.statusCode === undefined ? unknown('HTTP status not retained') : result(p.statusCode !== 200, `HTTP ${p.statusCode}`));
add('access.https', 'HTTPS transport', 'Access', 'high', 'recommendation', 'Serve public content over HTTPS.', p => result(new URL(p.url).protocol !== 'https:', p.url));
add('access.indexing', 'Indexing directive review', 'Access', 'high', 'manual', 'Confirm every exclusion against declared indexing intent.', p => result(!p.isIndexable, p.robotsMeta || 'No exclusion directive observed', true));
add('access.rendering', 'Main content available for inspection', 'Access', 'high', 'technical', 'Render the page before evaluating an application shell.', (p,c) => p.requiresJavaScriptRendering && !c.rendered ? unknown('Application shell requires browser rendering') : result(false, `${p.wordCount} extracted words`));
add('access.refresh', 'Meta refresh redirects', 'Access', 'medium', 'recommendation', 'Review refresh redirects and prefer an appropriate HTTP redirect.', p => result(doc(p).refresh.length > 0, doc(p).refresh.join(' | ') || 'None observed', true));
add('access.charset', 'Character encoding declaration', 'Access', 'low', 'project_policy', 'Declare UTF-8 consistently in HTML; confirm response headers separately.', p => result(!doc(p).charset.some(v => /utf-8/i.test(v)), doc(p).charset.join(' | ') || 'No HTML encoding declaration', true));
add('metadata.title', 'Nonempty page title', 'Metadata', 'high', 'recommendation', 'Publish a descriptive title.', p => result(!p.title, p.title || 'Missing title'));
add('metadata.title_single', 'Single title declaration', 'Metadata', 'medium', 'project_policy', 'Publish one title declaration.', p => result(doc(p).titles.length > 1, `${doc(p).titles.length} title tags`));
add('metadata.title_length', 'Title length review', 'Metadata', 'low', 'project_policy', 'Review titles outside 25–65 characters; this is not a Google limit.', p => !p.title ? na('Title absent; see title control') : result(p.title.length < 25 || p.title.length > 65, `${p.title.length} characters`, true));
add('metadata.title_unique', 'Distinct titles across inspected pages', 'Metadata', 'medium', 'recommendation', 'Distinguish page titles by page purpose.', (p,c) => !p.title ? na('Title absent') : result(c.pages.some(other => other.url !== p.url && other.title?.toLowerCase().trim() === p.title?.toLowerCase().trim()), p.title, true));
add('metadata.description', 'Nonempty meta description', 'Metadata', 'medium', 'recommendation', 'Provide a useful page-specific summary.', p => result(!p.metaDescription, p.metaDescription || 'Missing description', true));
add('metadata.description_single', 'Single meta description declaration', 'Metadata', 'low', 'project_policy', 'Keep one meta description declaration.', p => result(doc(p).descriptions.length > 1, `${doc(p).descriptions.length} declarations`));
add('metadata.description_length', 'Description length review', 'Metadata', 'low', 'project_policy', 'Review summaries outside 70–170 characters; display length varies.', p => !p.metaDescription ? na('Description absent') : result(p.metaDescription.length < 70 || p.metaDescription.length > 170, `${p.metaDescription.length} characters`, true));
add('metadata.description_unique', 'Distinct meta descriptions', 'Metadata', 'low', 'recommendation', 'Summarize each page distinctly.', (p,c) => !p.metaDescription ? na('Description absent') : result(c.pages.some(other => other.url !== p.url && other.metaDescription === p.metaDescription), p.metaDescription, true));
add('metadata.viewport', 'Mobile viewport declaration', 'Metadata', 'medium', 'project_policy', 'Include a viewport declaration; this alone does not establish mobile usability.', p => result(!p.hasViewport, doc(p).viewport.join(' | ') || 'Missing viewport'));
add('metadata.viewport_zoom', 'Viewport permits zoom', 'Metadata', 'low', 'project_policy', 'Do not disable user zoom.', p => !doc(p).viewport.length ? na('Viewport absent') : result(doc(p).viewport.some(v => /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i.test(v)), doc(p).viewport.join(' | '), true));
add('canonical.present', 'Canonical declaration present', 'Canonical', 'medium', 'recommendation', 'Declare the preferred URL for indexable content.', p => !p.isIndexable ? na('Page excludes indexing') : result(!p.canonicalTag, p.canonicalTag || 'Missing canonical'));
add('canonical.single', 'Single canonical declaration', 'Canonical', 'high', 'recommendation', 'Avoid multiple canonical declarations.', p => result(doc(p).canonicals.length > 1, `${doc(p).canonicals.length} canonical tags`));
add('canonical.valid', 'Valid HTTP canonical target', 'Canonical', 'high', 'technical', 'Use a valid HTTP(S) URL.', p => !doc(p).canonicals.length ? na('No canonical declaration') : result(doc(p).canonicals.some(v => !resolved(v,p.url)), doc(p).canonicals.join(' | ') || 'Empty href'));
add('canonical.fragment', 'Canonical without fragment', 'Canonical', 'medium', 'recommendation', 'Use a canonical without a URL fragment.', p => !p.canonicalTag ? na('Canonical absent') : result(Boolean(resolved(p.canonicalTag,p.url)?.hash), p.canonicalTag));
add('canonical.absolute', 'Absolute canonical URL', 'Canonical', 'low', 'recommendation', 'Use an absolute canonical URL to avoid resolution mistakes.', p => !p.canonicalTag ? na('Canonical absent') : result(!/^https?:\/\//i.test(p.canonicalTag), p.canonicalTag, true));
add('canonical.head', 'Canonical declared in document head', 'Canonical', 'high', 'technical', 'Place HTML canonical link elements in the head.', p => result(doc(p).canonicalInBody, doc(p).canonicalInBody ? 'Canonical found after closing head' : 'No body canonical observed'));
add('canonical.self', 'Nonself canonical review', 'Canonical', 'medium', 'manual', 'Validate intentional deduplication against page purpose.', p => !p.canonicalTag ? na('Canonical absent') : result(p.canonicalIsSelf === false, p.canonicalTag, true));
add('canonical.target_indexing', 'Canonical target indexing compatibility', 'Canonical', 'high', 'technical', 'Do not nominate an observed noindex target for indexable content.', (p,c) => {
 const target=resolved(p.canonicalTag,p.url); if(!target) return na('No usable canonical'); const page=c.pages.find(other=>same(other.url,target.href));
 return !page ? unknown(`Target not inspected: ${target.href}`) : result(p.isIndexable && !page.isIndexable, `${target.href}: ${page.robotsMeta || 'no exclusion'}`);
});
add('canonical.chain', 'Canonical chain review', 'Canonical', 'medium', 'recommendation', 'Point directly to the preferred canonical.', (p,c) => {
 const target=resolved(p.canonicalTag,p.url); if(!target) return na('No usable canonical'); const page=c.pages.find(other=>same(other.url,target.href));
 if(!page) return unknown(`Target not inspected: ${target.href}`); const next=resolved(page.canonicalTag,page.url);
 return !next ? unknown('Target has no usable canonical') : result(!same(next.href,target.href), `${p.url} → ${target.href} → ${next.href}`);
});
add('content.h1', 'Primary heading present', 'Content', 'medium', 'recommendation', 'Make the primary page topic apparent.', p => result(p.h1Count === 0, `${p.h1Count} H1 headings`, true));
add('content.h1_multiple', 'Primary heading hierarchy review', 'Content', 'low', 'project_policy', 'Review competing primary headings; multiple H1s are not inherently invalid.', p => result(p.h1Count > 1, `${p.h1Count} H1 headings`, true));
add('content.outline', 'Logical heading hierarchy', 'Content', 'low', 'project_policy', 'Review skipped heading levels for usability.', p => result(p.headingLevels.some((v,i,a)=>i>0 && v>a[i-1]+1), p.headingLevels.join(' → '), true));
add('content.empty', 'Nonempty extracted main content', 'Content', 'high', 'technical', 'Inspect real main content rather than an empty document.', p => result(p.wordCount === 0, `${p.wordCount} words`));
add('content.duplicates', 'Exact main-content duplication review', 'Content', 'medium', 'manual', 'Compare purpose before consolidation; duplication alone is not a penalty.', (p,c) => result(c.pages.some(other=>other.url!==p.url && Boolean(p.mainContentText) && p.mainContentText===other.mainContentText), p.contentFingerprint, true));
add('content.depth', 'Deep route discovery review', 'Content', 'low', 'project_policy', 'Review important pages deeper than three observed link hops.', p => p.crawlDepth === undefined ? unknown('Depth not retained') : result(p.crawlDepth>3, `${p.crawlDepth} hops`, true));
add('links.outgoing', 'Internal navigation available', 'Links', 'medium', 'manual', 'Review pages without internal anchor links.', p => result(p.internalLinks===0, `${p.internalLinks} internal links`, true));
add('links.anchor', 'Descriptive internal link text', 'Links', 'low', 'recommendation', 'Use meaningful link labels in context.', p => result(p.nonDescriptiveInternalAnchors>0, `${p.nonDescriptiveInternalAnchors} generic internal anchors`, true));
add('links.nofollow', 'Internal nofollow review', 'Links', 'low', 'manual', 'Check whether internal nofollow matches the intended link policy.', p => result(p.nofollowInternalLinks>0, `${p.nofollowInternalLinks} internal nofollow links`, true));
add('links.incoming', 'Incoming links in inspected graph', 'Links', 'medium', 'manual', 'Review routes not linked by any other inspected page.', (p,c) => new URL(p.url).pathname==='/' ? na('Root route') : result(!c.pages.some(other=>other.url!==p.url && other.links.some(link=>link.target && same(link.target,p.url))), 'Incoming links evaluated within inspected graph only', true));
add('links.invalid', 'Usable anchor destinations', 'Links', 'medium', 'technical', 'Replace malformed or noncrawlable script href destinations.', p => result(doc(p).invalidHrefs.length>0, doc(p).invalidHrefs.join(' | ') || 'No invalid destinations'));
add('links.empty', 'Accessible anchor labels', 'Links', 'low', 'project_policy', 'Supply text, an accessible name or image alt for links.', p => result(doc(p).emptyAnchors>0, `${doc(p).emptyAnchors} unnamed anchors`, true));
add('media.alt', 'Image alt attribute present', 'Media', 'medium', 'recommendation', 'Describe meaningful images; keep alt empty for decoration.', p => !p.imageCount ? na('No images') : result(p.imagesWithoutAlt>0, `${p.imagesWithoutAlt} missing alt attributes`));
add('media.source', 'Image source available', 'Media', 'medium', 'technical', 'Supply src or srcset on image elements.', p => !p.imageCount ? na('No images') : result(doc(p).images.some(i=>!i.src), `${doc(p).images.filter(i=>!i.src).length} images without source`));
add('media.dimensions', 'Image dimensions declared', 'Media', 'low', 'project_policy', 'Review missing width/height; CSS may reserve equivalent space.', p => !p.imageCount ? na('No images') : result(doc(p).images.some(i=>!i.width || !i.height), `${doc(p).images.filter(i=>!i.width || !i.height).length} images without dimensions`, true));
add('international.language', 'Document language declared', 'International', 'low', 'project_policy', 'Declare document language for accessibility; Google detects language from content.', p => result(!p.lang, p.lang || 'Missing html lang', true));
add('international.language_valid', 'Valid document language tag', 'International', 'low', 'project_policy', 'Use a valid BCP 47 document language.', p => !p.lang ? na('Language absent') : result(!validLanguage(p.lang), p.lang, true));
add('international.hreflang_valid', 'Valid hreflang labels', 'International', 'medium', 'technical', 'Use supported language and optional region labels, or x-default.', p => !doc(p).alternates.length ? na('No hreflang') : result(doc(p).alternates.some(a=>!validHreflang(a.lang)), doc(p).alternates.map(a=>a.lang).join(', ')));
add('international.hreflang_absolute', 'Absolute hreflang destinations', 'International', 'medium', 'technical', 'Use fully qualified HTTP(S) alternate URLs.', p => !doc(p).alternates.length ? na('No hreflang') : result(doc(p).alternates.some(a=>!/^https?:\/\//i.test(a.href) || !resolved(a.href,p.url)), doc(p).alternates.map(a=>a.href).join(' | ')));
add('international.hreflang_unique', 'Unambiguous alternate per locale', 'International', 'medium', 'technical', 'Map each locale to one alternate destination.', p => !doc(p).alternates.length ? na('No hreflang') : result(new Set(doc(p).alternates.map(a=>a.lang.toLowerCase())).size!==doc(p).alternates.length, doc(p).alternates.map(a=>a.lang).join(', ')));
add('international.hreflang_return', 'Reciprocal hreflang links', 'International', 'high', 'technical', 'Ensure inspected alternate pages link back to this URL.', (p,c) => {
 if(!doc(p).alternates.length) return na('No hreflang'); let missing=0; let untested=0;
 for(const a of doc(p).alternates){const target=resolved(a.href,p.url); const other=target && c.pages.find(x=>same(x.url,target.href)); if(!other?.documentEvidence) untested++; else if(!other.documentEvidence.alternates.some(back=>{const u=resolved(back.href,other.url);return u && same(u.href,p.url);})) missing++;}
 return missing ? result(true, `${missing} alternates missing return links`) : untested ? unknown(`${untested} alternate destinations uninspected`) : result(false,'All inspected alternates link back');
});
add('schema.syntax', 'Parseable JSON-LD', 'Structured data', 'high', 'technical', 'Publish valid JSON in every JSON-LD block.', p => !doc(p).jsonld.length ? na('No JSON-LD') : result(doc(p).jsonld.some(b=>!b.valid), `${doc(p).jsonld.filter(b=>!b.valid).length} invalid JSON-LD blocks`));
add('schema.objects', 'JSON-LD object or graph structure', 'Structured data', 'medium', 'technical', 'Publish objects or arrays of objects rather than scalar JSON.', p => !doc(p).jsonld.length ? na('No JSON-LD') : result(doc(p).jsonld.some(b=>b.valid && !b.nodes.length), `${schemaNodes(p).length} structured data nodes`));
add('schema.type', 'Structured data types declared', 'Structured data', 'medium', 'technical', 'Give non-reference structured data nodes a type.', p => !schemaNodes(p).length ? na('No parsed nodes') : result(schemaNodes(p).some(n=>!n['@type'] && Object.keys(n).some(k=>!['@id','@context','@graph'].includes(k))), `${schemaNodes(p).filter(n=>n['@type']).length} typed nodes`));
add('schema.context', 'Schema vocabulary declared', 'Structured data', 'medium', 'technical', 'Declare the schema.org context at the document or graph level.', p => !doc(p).jsonld.length ? na('No JSON-LD') : result(doc(p).jsonld.some(block=>block.valid && !block.nodes.some(n=>/https?:\/\/schema.org\/?$/.test(String(n['@context'])))), 'Context checked on parsed JSON-LD nodes'));

export const AUTOMATED_CONTROL_IDS = Object.freeze(defs.map(d=>d.id));
const manualRequirements = [
 ['inventory', 'Declared URL inventory', 'CMS/router inventory with explicit index, noindex, private, redirect or gone intent.'],
 ['robots', 'Verified robots.txt behavior', 'User-agent-aware robots response and path evaluation, including resource access.'],
 ['sitemap', 'Sitemap reconciliation', 'Parsed sitemap URLs joined to declared inventory, canonical and indexing intent.'],
 ['googlebot', 'Verified Googlebot access', 'Verified Googlebot server logs and Search Console live inspection.'],
 ['index_coverage', 'Google indexing coverage', 'Search Console indexing and Google-selected canonical evidence.'],
 ['render_parity', 'Raw, rendered and mobile parity', 'Comparable raw, desktop and mobile snapshots for each template.'],
 ['field_cwv', 'Real-user Core Web Vitals', 'Device-specific p75 LCP, INP and CLS with sufficient field samples.'],
 ['rich_results', 'Rich-result eligibility', 'Type-specific required properties, content parity and Rich Results validation.'],
 ['intent', 'Query and task satisfaction', 'Target query/task mapping and accountable human content review.'],
 ['authority', 'Authority and link quality', 'Connected backlink evidence, provenance and manual link-policy review.'],
 ['local', 'Local business accuracy', 'Applicability decision, verified business profiles and location consistency.'],
 ['outcomes', 'Organic acquisition and conversion', 'Search Console and analytics with agreed conversion definitions and comparable periods.'],
] as const;
export function evaluateAssurance(pages: PageMetrics[], options: { rendered?: boolean } = {}): AuditAssurance {
 const context: Context={pages,...options};
 const controls: AuditControl[]=defs.map(def=>{
  const outcomes=pages.map(page=> !page.inspectionComplete || !page.documentEvidence ? unknown('Full document evidence unavailable; recrawl required') : page.requiresJavaScriptRendering && !options.rendered && ['Content','Links','Media'].includes(def.group) ? unknown('Browser rendering required') : def.evaluate(page,context));
  const count=(status:ControlStatus)=>outcomes.filter(o=>o.status===status).length;
  const status:ControlStatus=count('fail')?'fail':count('unknown')||!pages.length?'unknown':count('review')?'review':count('pass')?'pass':'not_applicable';
  const selected=outcomes.map((o,i)=>({...o,url:pages[i].url})).filter(o=>o.status!=='pass' && o.status!=='not_applicable');
  const {evaluate:_,...definition}=def;
  return {...definition,status,passed:count('pass'),failed:count('fail')+count('review'),unknown:count('unknown'),notApplicable:count('not_applicable'),denominator:pages.length,evidence:(selected.length ? selected : outcomes.slice(0,1).map((o,i)=>({...o,url:pages[i].url}))).slice(0,100).map(o=>({url:o.url,observed:o.observed})),evidenceTruncated:selected.length>100};
 });
 for(const [id,name,requirement] of manualRequirements) controls.push({id:`external.${id}`,name,group:'External evidence',severity:'high',basis:'manual',status:'unknown',passed:0,failed:0,unknown:1,notApplicable:0,denominator:1,evidence:[],evidenceTruncated:false,requirement,source:sources['External evidence']});
 const counts=Object.fromEntries(['pass','fail','review','unknown','not_applicable'].map(status=>[status,controls.filter(c=>c.status===status).length])) as AuditAssurance['counts'];
 const evaluatedInstances=controls.reduce((n,c)=>n+c.passed+c.failed,0); const unknownInstances=controls.reduce((n,c)=>n+c.unknown,0);
 const applicableInstances=evaluatedInstances+unknownInstances;
 return {version:ASSURANCE_VERSION,scope:'All registered controls across inspected HTML documents and observed internal graph. External evidence requirements are explicit and remain unknown until verified.',controls,counts,evaluatedInstances,unknownInstances,applicableInstances,coveragePercent:applicableInstances?Math.round(evaluatedInstances/applicableInstances*1000)/10:null,complete:counts.unknown===0,verdict:controls.some(c=>c.status==='fail' && ['critical','high'].includes(c.severity))?'blocked':counts.unknown?'incomplete':counts.fail||counts.review?'review_required':'clear'};
}
function validLanguage(value:string):boolean {try {return Intl.getCanonicalLocales(value).length===1;}catch{return false;}}
function validHreflang(value:string):boolean {return value.toLowerCase()==='x-default' || /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(value) && validLanguage(value);}
