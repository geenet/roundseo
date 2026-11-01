import type { DocumentEvidence } from './engine';
// Inspect active markup, excluding comments and script/template payloads.
const attr = (tag: string, name: string): string | undefined => {
 const match=new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i').exec(tag);
 return match ? match[1] ?? match[2] ?? match[3] : undefined;
};
export function extractDocumentEvidence(html:string):DocumentEvidence {
 html=html.replace(/<!--[\s\S]*?-->/g,'');
 const jsonld:DocumentEvidence['jsonld']=[];
 const collect=(value:unknown):Array<Record<string,unknown>>=>{
  if(Array.isArray(value))return value.flatMap(collect);
  if(!value || typeof value!=='object')return [];
  const node=value as Record<string,unknown>;
  return [node,...(Array.isArray(node['@graph'])?node['@graph'].flatMap(collect):[])];
 };
 for(const script of html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[]){
  const end=script.indexOf('>'); if(attr(script.slice(0,end+1),'type')?.toLowerCase()!=='application/ld+json')continue;
  try{jsonld.push({valid:true,nodes:collect(JSON.parse(script.slice(end+1).replace(/<\/script\s*>$/i,'')))});}catch{jsonld.push({valid:false,nodes:[]});}
 }
 const active=html.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 const tags=(name:string)=>active.match(new RegExp(`<${name}\\b[^>]*>`,'gi'))||[];
 const metas=tags('meta'); const links=tags('link');
 const canonical=(tag:string)=>attr(tag,'rel')?.toLowerCase().split(/\s+/).includes('canonical');
 const headEnd=active.search(/<\/head\s*>/i);
 const canonicalInBody=headEnd>=0 && links.some(tag=>canonical(tag) && active.indexOf(tag)>headEnd);
 let emptyAnchors=0;const invalidHrefs:string[]=[];
 for(const anchor of active.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)||[]){
  const opening=anchor.slice(0,anchor.indexOf('>')+1); const href=attr(opening,'href');
  if(href!==undefined && /^\s*(?:javascript:|data:)/i.test(href))invalidHrefs.push(href);
  else if(href && !/^(?:#|mailto:|tel:)/i.test(href)){try{new URL(href,'https://audit.invalid');}catch{invalidHrefs.push(href);}}
  const text=anchor.replace(/<[^>]*>/g,'').trim();
  if(!text && !attr(opening,'aria-label') && !attr(opening,'aria-labelledby') && !(anchor.match(/<img\b[^>]*>/gi)||[]).some(img=>Boolean(attr(img,'alt'))))emptyAnchors++;
 }
 return {
  titles:active.match(/<title\b[^>]*>[\s\S]*?<\/title>/gi)||[],
  descriptions:metas.filter(t=>attr(t,'name')?.toLowerCase()==='description').map(t=>attr(t,'content')||''),
  canonicals:links.filter(canonical).map(t=>attr(t,'href')||''),canonicalInBody,
  viewport:metas.filter(t=>attr(t,'name')?.toLowerCase()==='viewport').map(t=>attr(t,'content')||''),
  refresh:metas.filter(t=>attr(t,'http-equiv')?.toLowerCase()==='refresh').map(t=>attr(t,'content')||''),
  charset:metas.flatMap(t=>attr(t,'charset')?[attr(t,'charset')!]:attr(t,'http-equiv')?.toLowerCase()==='content-type'?[attr(t,'content')||'']:[]),
  baseHref:attr(tags('base')[0]||'','href'),
  images:tags('img').map(t=>({src:attr(t,'src')||attr(t,'srcset'),alt:attr(t,'alt'),width:attr(t,'width'),height:attr(t,'height'),loading:attr(t,'loading')})),
  alternates:links.filter(t=>attr(t,'rel')?.toLowerCase().split(/\s+/).includes('alternate') && attr(t,'hreflang')!==undefined).map(t=>({lang:attr(t,'hreflang')||'',href:attr(t,'href')||''})),
  jsonld,invalidHrefs,emptyAnchors,htmlBytes:new TextEncoder().encode(html).length,
 };
}
