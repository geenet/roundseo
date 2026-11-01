import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parsePageMetrics, type PageMetrics } from '../../src/worker/crawlers/parser';
import { evaluateAssurance, AUTOMATED_CONTROL_IDS } from '../../src/worker/crawlers/assurance/engine';
import { calculateSiteMetrics } from '../../src/worker/crawlers/metrics';
const url='https://example.com/';
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A complete and descriptive page title</title><meta name="description" content="A useful and distinct description of this example page, describing what visitors can find and accomplish here."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${url}"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example"}</script></head><body><main><h1>Useful primary heading</h1><h2>Details</h2><p>A substantive explanation for visitors.</p><a href="/details">Product details</a><img src="/photo.png" alt="Product" width="600" height="400"></main></body></html>`;
function healthy():PageMetrics{return {...parsePageMetrics(url,html),statusCode:200,crawlDepth:0};}
type Fixture={id:string;change:(p:PageMetrics)=>void;status?:'unknown'|'review'|'fail';extra?:(p:PageMetrics)=>PageMetrics[]};
const fixtures:Fixture[]=[
 {id:'access.http',change:p=>{p.statusCode=503;}},
 {id:'access.https',change:p=>{p.url='http://example.com/';}},
 {id:'access.indexing',change:p=>{p.isIndexable=false;p.robotsMeta='noindex';},status:'review'},
 {id:'access.rendering',change:p=>{p.requiresJavaScriptRendering=true;},status:'unknown'},
 {id:'access.refresh',change:p=>{p.documentEvidence!.refresh=['0;url=/new'];},status:'review'},
 {id:'access.charset',change:p=>{p.documentEvidence!.charset=[];},status:'review'},
 {id:'metadata.title',change:p=>{p.title=undefined;}},
 {id:'metadata.title_single',change:p=>{p.documentEvidence!.titles.push('<title>Second</title>');}},
 {id:'metadata.title_length',change:p=>{p.title='X';},status:'review'},
 {id:'metadata.title_unique',change:()=>{},extra:p=>[{...healthy(),url:'https://example.com/other',title:p.title}],status:'review'},
 {id:'metadata.description',change:p=>{p.metaDescription=undefined;},status:'review'},
 {id:'metadata.description_single',change:p=>{p.documentEvidence!.descriptions.push('Second description');}},
 {id:'metadata.description_length',change:p=>{p.metaDescription='X';},status:'review'},
 {id:'metadata.description_unique',change:()=>{},extra:p=>[{...healthy(),url:'https://example.com/other',metaDescription:p.metaDescription}],status:'review'},
 {id:'metadata.viewport',change:p=>{p.hasViewport=false;}},
 {id:'metadata.viewport_zoom',change:p=>{p.documentEvidence!.viewport=['user-scalable=no'];},status:'review'},
 {id:'canonical.present',change:p=>{p.canonicalTag=undefined;}},
 {id:'canonical.single',change:p=>{p.documentEvidence!.canonicals.push('https://example.com/other');}},
 {id:'canonical.valid',change:p=>{p.documentEvidence!.canonicals=['http://[bad'];}},
 {id:'canonical.fragment',change:p=>{p.canonicalTag=url+'#fragment';}},
 {id:'canonical.absolute',change:p=>{p.canonicalTag='/';},status:'review'},
 {id:'canonical.head',change:p=>{p.documentEvidence!.canonicalInBody=true;}},
 {id:'canonical.self',change:p=>{p.canonicalIsSelf=false;},status:'review'},
 {id:'canonical.target_indexing',change:p=>{p.canonicalTag='https://example.com/target';},extra:()=>[{...healthy(),url:'https://example.com/target',isIndexable:false}]},
 {id:'canonical.chain',change:p=>{p.canonicalTag='https://example.com/target';},extra:()=>[{...healthy(),url:'https://example.com/target',canonicalTag:'https://example.com/final'}]},
 {id:'content.h1',change:p=>{p.h1Count=0;},status:'review'},
 {id:'content.h1_multiple',change:p=>{p.h1Count=2;},status:'review'},
 {id:'content.outline',change:p=>{p.headingLevels=[1,3];},status:'review'},
 {id:'content.empty',change:p=>{p.wordCount=0;}},
 {id:'content.duplicates',change:()=>{},extra:p=>[{...healthy(),url:'https://example.com/duplicate',mainContentText:p.mainContentText}],status:'review'},
 {id:'content.depth',change:p=>{p.crawlDepth=4;},status:'review'},
 {id:'links.outgoing',change:p=>{p.internalLinks=0;},status:'review'},
 {id:'links.anchor',change:p=>{p.nonDescriptiveInternalAnchors=1;},status:'review'},
 {id:'links.nofollow',change:p=>{p.nofollowInternalLinks=1;},status:'review'},
 {id:'links.incoming',change:p=>{p.url='https://example.com/unlinked';},status:'review'},
 {id:'links.invalid',change:p=>{p.documentEvidence!.invalidHrefs=['javascript:void(0)'];}},
 {id:'links.empty',change:p=>{p.documentEvidence!.emptyAnchors=1;},status:'review'},
 {id:'media.alt',change:p=>{p.imagesWithoutAlt=1;}},
 {id:'media.source',change:p=>{p.documentEvidence!.images[0].src=undefined;}},
 {id:'media.dimensions',change:p=>{p.documentEvidence!.images[0].width=undefined;},status:'review'},
 {id:'international.language',change:p=>{p.lang=undefined;},status:'review'},
 {id:'international.language_valid',change:p=>{p.lang='not_a_language';},status:'review'},
 {id:'international.hreflang_valid',change:p=>{p.documentEvidence!.alternates[0].lang='en_XX';}},
 {id:'international.hreflang_absolute',change:p=>{p.documentEvidence!.alternates[0].href='/relative';}},
 {id:'international.hreflang_unique',change:p=>{p.documentEvidence!.alternates.push({lang:'en',href:url+'different'});}},
 {id:'international.hreflang_return',change:p=>{p.documentEvidence!.alternates=[{lang:'fr',href:url+'fr'}];},extra:()=>{const other=healthy();other.url=url+'fr';other.documentEvidence!.alternates=[];return [other];}},
 {id:'schema.syntax',change:p=>{p.documentEvidence!.jsonld=[{valid:false,nodes:[]}];}},
 {id:'schema.objects',change:p=>{p.documentEvidence!.jsonld=[{valid:true,nodes:[]}];}},
 {id:'schema.type',change:p=>{p.documentEvidence!.jsonld[0].nodes=[{'@context':'https://schema.org',name:'Untyped'}];}},
 {id:'schema.context',change:p=>{p.documentEvidence!.jsonld[0].nodes=[{'@type':'Organization'}];}},
];
describe('complete assurance control contract',()=>{
 it('requires a targeted adversarial case for every executable control',()=>{
  expect(new Set(fixtures.map(f=>f.id))).toEqual(new Set(AUTOMATED_CONTROL_IDS));
  expect(fixtures).toHaveLength(50);
 });
 for(const fixture of fixtures) {
  it(`${fixture.id}: detects targeted condition with URL evidence`,()=>{
   const p=healthy();fixture.change(p);
   const control=evaluateAssurance([p,...(fixture.extra?.(p)||[])]).controls.find(c=>c.id===fixture.id)!;
   expect(control.status).toBe(fixture.status||'fail');
   expect(control.evidence.some(e=>e.url===p.url)).toBe(true);
   expect(control.passed+control.failed+control.unknown+control.notApplicable).toBe(control.denominator);
  });
  it(`${fixture.id}: has a clear or explicitly inapplicable negative control`,()=>{
   const control=evaluateAssurance([healthy()]).controls.find(c=>c.id===fixture.id)!;
   expect(['pass','not_applicable']).toContain(control.status);
  });
 }
 it('never certifies missing documents or disconnected evidence',()=>{
  const empty=evaluateAssurance([]); expect(empty.complete).toBe(false);expect(empty.coveragePercent).toBe(0);
  const legacy=healthy();delete legacy.documentEvidence;
  expect(evaluateAssurance([legacy]).counts.pass).toBe(0);
  const report=evaluateAssurance([healthy()]);
  expect(report.controls.filter(c=>c.group==='External evidence')).toHaveLength(12);
  expect(report.counts.unknown).toBe(12);expect(report.complete).toBe(false);expect(report.verdict).toBe('incomplete');
 });
 it('retains full counts while capping evidence examples',()=>{
  const pages=Array.from({length:125},(_,i)=>({...healthy(),url:`${url}${i}`,statusCode:503}));
  const control=evaluateAssurance(pages).controls.find(c=>c.id==='access.http')!;
  expect(control.failed).toBe(125);expect(control.evidence).toHaveLength(100);expect(control.evidenceTruncated).toBe(true);
 });
 it('threads the ledger through actual crawl metrics',()=>{
  const report=calculateSiteMetrics([healthy()]);expect(report.assurance.controls).toHaveLength(62);
 });
 it('benchmarks defined control breadth against the frozen five-check health baseline',()=>{
  // The previous technical-health aggregate evaluated HTTP, indexing directive,
  // canonical presence, viewport and language. Existing findings outside that
  // aggregate are deliberately not described as absent from the old engine.
  expect(calculateSiteMetrics([healthy()], [{url,depth:0,statusCode:200}]).technicalHealth.evaluatedChecks).toBe(5);
  const baseline=['access.http','access.indexing','canonical.present','metadata.viewport','international.language'];
  const verified=fixtures.filter(f=>{const p=healthy();f.change(p);const c=evaluateAssurance([p,...(f.extra?.(p)||[])]).controls.find(c=>c.id===f.id)!;return c.status===(f.status||'fail');});
  const benchmark={metric:'Executable control breadth in the explicit coverage ledger',baseline:{version:'technical-health-2026.10.5',controls:baseline.length,ids:baseline},current:{version:'agency-controls-1',controls:AUTOMATED_CONTROL_IDS.length,verifiedTargetedCases:verified.length,negativeControls:fixtures.length},ratio:AUTOMATED_CONTROL_IDS.length/baseline.length,claim:'10x the explicitly tracked control dimensions of the previous five-check health aggregate. This is not a 10x defect-detection, ranking, traffic, or overall SEO quality claim.'};
  expect(verified).toHaveLength(50);expect(benchmark.ratio).toBe(10);
  if(process.env.ROUNDSEO_WRITE_EVAL==='1'){mkdirSync('artifacts/seo-evaluation',{recursive:true});writeFileSync('artifacts/seo-evaluation/benchmark.json',JSON.stringify(benchmark,null,2)+'\n');}
 });
});

describe('HTML extraction integration',()=>{
 it.each([
  ['canonical.single','<link rel="canonical" href="https://example.com/other">'],
  ['metadata.title_single','<title>Second title</title>'],
  ['metadata.description_single','<meta name="description" content="Second">'],
  ['schema.syntax','<script type="application/ld+json">{bad}</script>'],
  ['links.invalid','<a href="javascript:void(0)">Jump</a>'],
  ['international.hreflang_valid','<link rel="alternate" hreflang="en_US" href="https://example.com/us">'],
 ])('%s survives real HTML parsing and metrics aggregation',(id,markup)=>{
  const page={...parsePageMetrics(url,html.replace('</head>',markup+'</head>')),statusCode:200,crawlDepth:0};
  expect(calculateSiteMetrics([page]).assurance.controls.find(c=>c.id===id)?.status).toBe('fail');
 });
 it('does not parse templates or script strings as active declarations',()=>{
  const page=parsePageMetrics(url,html.replace('</head>','<template><title>Inert</title></template><script>const example = "<title>Example</title>";</script></head>'));
  expect(page.documentEvidence?.titles).toHaveLength(1);
 });
 it('keeps trailing-slash resources distinct during canonical evaluation',()=>{
  const p=healthy();p.url='https://example.com/product/';p.canonicalTag='https://example.com/product';
  const c=evaluateAssurance([p]).controls.find(c=>c.id==='canonical.target_indexing');expect(c?.status).toBe('unknown');
 });
});

describe('evidence consistency regressions',()=>{
 it('extracts types nested in JSON-LD graphs',()=>{
  const p=parsePageMetrics(url,'<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Example"}]}</script>');
  expect(p.structuredDataTypes).toEqual(['Product']);
  expect(evaluateAssurance([p]).controls.find(c=>c.id==='schema.type')?.status).toBe('pass');
 });
 it('ignores inert title and canonical examples across both finding engines',()=>{
  const p={...parsePageMetrics(url,html.replace('</head>','<script>const x = "<title>Fake</title><link rel=canonical href=/fake>";</script></head>')),statusCode:200};
  expect(p.title).toBe('A complete and descriptive page title');
  expect(p.markupDiagnostics?.map(d=>d.code)).not.toContain('multiple_titles');
  expect(p.markupDiagnostics?.map(d=>d.code)).not.toContain('multiple_canonicals');
 });
 it('routes newly detected hreflang failures into the action evidence workflow',()=>{
  const p=healthy();p.documentEvidence!.alternates=[{lang:'invalid_locale',href:url}];
  const finding=calculateSiteMetrics([p]).findings.find(f=>f.ruleId==='international.hreflang_valid');
  expect(finding?.evidence[0].url).toBe(url);expect(finding?.priority).toBe('medium');
 });
});
