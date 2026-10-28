// HTML parser for the evidence a practical SEO audit needs.
// This intentionally keeps extraction dependency-free so it can run in a Worker.

export interface ExtractedLink {
  href: string;
  target?: string;
  anchorText: string;
  isInternal: boolean;
  isNofollow: boolean;
  isDescriptive: boolean;
  placement: 'navigation' | 'header' | 'footer' | 'aside' | 'main' | 'unknown';
  relAttributes?: string;
}

export interface PageMetrics {
  url: string;
  inspectionComplete: boolean;
  statusCode?: number;
  crawlDepth?: number;
  title?: string;
  titleLength?: number;
  metaDescription?: string;
  metaDescLength?: number;
  h1Count: number;
  h1Text: string[];
  h2Count: number;
  h2Text: string[];
  h3Count: number;
  headingsCount: number;
  headingLevels: number[];
  contentSource: 'main' | 'article' | 'body' | 'document';
  mainContentExcerpt: string;
  requiresJavaScriptRendering: boolean;
  wordCount: number;
  textToHtmlRatio: number;
  readabilityScore: number;
  contentFingerprint: string;
  imageCount: number;
  imagesWithoutAlt: number;
  internalLinks: number;
  externalLinks: number;
  nofollowInternalLinks: number;
  nonDescriptiveInternalAnchors: number;
  links: ExtractedLink[];
  canonicalTag?: string;
  canonicalIsSelf?: boolean;
  robotsMeta?: string;
  lang?: string;
  hasViewport: boolean;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  ogTags: Record<string, string>;
  isIndexable: boolean;
  mobileFriendly?: boolean;
}

const GENERIC_ANCHORS = new Set(['click here', 'here', 'learn more', 'read more', 'more', 'this', 'link']);

export function parsePageMetrics(url: string, html: string, options: { responseHeaders?: Record<string, string> } = {}): PageMetrics {
  const primaryContent = extractPrimaryContent(html);
  const cleanText = extractVisibleText(primaryContent.html);
  const baseUrl = new URL(url);
  const title = firstTagText(html, 'title');
  const metaDescription = findMetaContent(html, 'name', 'description');
  const canonicalTag = findLinkHref(html, 'canonical');
  const robotsMeta = [findMetaContent(html, 'name', 'robots'), options.responseHeaders?.['x-robots-tag']]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(', ') || undefined;
  const h1Text = allTagText(primaryContent.html, 'h1');
  const h2Text = allTagText(primaryContent.html, 'h2');
  const h3Text = allTagText(primaryContent.html, 'h3');
  const words = cleanText ? cleanText.split(/\s+/).filter(Boolean) : [];
  const links = extractLinks(html, baseUrl);
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const structuredDataTypes = extractStructuredDataTypes(html);
  const normalizedCanonical = canonicalTag ? normalizeUrl(canonicalTag, baseUrl) : undefined;
  const normalizedUrl = normalizeUrl(url, baseUrl);
  const robots = robotsMeta?.toLowerCase() || '';
  const requiresJavaScriptRendering = needsJavaScriptRendering(html, words.length);

  return {
    url,
    inspectionComplete: true,
    title,
    titleLength: title?.length,
    metaDescription,
    metaDescLength: metaDescription?.length,
    h1Count: h1Text.length,
    h1Text,
    h2Count: h2Text.length,
    h2Text,
    h3Count: h3Text.length,
    headingsCount: h1Text.length + h2Text.length + h3Text.length,
    headingLevels: extractHeadingLevels(primaryContent.html),
    contentSource: primaryContent.source,
    mainContentExcerpt: cleanText.slice(0, 900),
    requiresJavaScriptRendering,
    wordCount: words.length,
    textToHtmlRatio: primaryContent.html.length ? Math.round((cleanText.length / primaryContent.html.length) * 100) : 0,
    readabilityScore: calculateReadability(cleanText),
    contentFingerprint: fingerprint(normalizeText(cleanText)),
    imageCount: images.length,
    imagesWithoutAlt: images.filter(image => !/\salt\s*=\s*(["'])[^"']*\1/i.test(image)).length,
    internalLinks: links.filter(link => link.isInternal).length,
    externalLinks: links.filter(link => !link.isInternal).length,
    nofollowInternalLinks: links.filter(link => link.isInternal && link.isNofollow).length,
    nonDescriptiveInternalAnchors: links.filter(link => link.isInternal && !link.isDescriptive).length,
    links,
    canonicalTag,
    canonicalIsSelf: normalizedCanonical === normalizedUrl,
    robotsMeta,
    lang: extractLang(html),
    hasViewport: hasMetaName(html, 'viewport'),
    hasStructuredData: structuredDataTypes.length > 0 || /\bitemtype\s*=/i.test(html),
    structuredDataTypes,
    ogTags: extractOpenGraphTags(html),
    isIndexable: !/\b(noindex|none)\b/.test(robots),
  };
}

export function calculatePageScore(metrics: PageMetrics): number {
  let score = 100;
  if (!metrics.title) score -= 13;
  else if ((metrics.titleLength || 0) < 25 || (metrics.titleLength || 0) > 65) score -= 4;
  if (!metrics.metaDescription) score -= 10;
  else if ((metrics.metaDescLength || 0) < 70 || (metrics.metaDescLength || 0) > 170) score -= 3;
  if (!metrics.requiresJavaScriptRendering && metrics.h1Count !== 1) score -= 8;
  if (!metrics.requiresJavaScriptRendering && metrics.wordCount < 250) score -= 8;
  if (!metrics.requiresJavaScriptRendering && metrics.textToHtmlRatio < 10) score -= 4;
  if (metrics.imageCount > 0 && metrics.imagesWithoutAlt > 0) score -= Math.min(10, metrics.imagesWithoutAlt * 2);
  if (metrics.inspectionComplete && !metrics.canonicalTag) score -= 5;
  if (metrics.inspectionComplete && !metrics.hasViewport) score -= 5;
  if (metrics.inspectionComplete && !metrics.lang) score -= 3;
  if (!metrics.requiresJavaScriptRendering && metrics.internalLinks === 0) score -= 5;
  if (!metrics.isIndexable) score -= 35;
  return Math.max(0, Math.min(100, score));
}

function extractLinks(html: string, baseUrl: URL): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(html)) !== null) {
    const attributes = match[1];
    const href = decodeHtml(attributeValue(attributes, 'href') || '').trim();
    const anchorText = normalizeText(stripTags(match[2]));
    if (!href || href.startsWith('#') || /^(javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      const target = new URL(href, baseUrl).href;
      const isInternal = new URL(target).hostname === baseUrl.hostname;
      const isNofollow = /\brel\s*=\s*(["'])[^"']*\bnofollow\b[^"']*\1/i.test(attributes);
      links.push({
        href,
        target,
        anchorText,
        isInternal,
        isNofollow,
        isDescriptive: anchorText.length > 2 && !GENERIC_ANCHORS.has(anchorText.toLowerCase()),
        placement: classifyLinkPlacement(html, match.index),
        relAttributes: attributeValue(attributes, 'rel'),
      });
    } catch {
      links.push({ href, anchorText, isInternal: false, isNofollow: false, isDescriptive: true, placement: classifyLinkPlacement(html, match.index), relAttributes: attributeValue(attributes, 'rel') });
    }
  }
  return links;
}

function classifyLinkPlacement(html: string, position: number): ExtractedLink['placement'] {
  const tagToPlacement: Record<string, ExtractedLink['placement']> = {
    main: 'main',
    nav: 'navigation',
    header: 'header',
    footer: 'footer',
    aside: 'aside',
  };
  const stack: ExtractedLink['placement'][] = [];
  const tags = html.slice(0, position).match(/<\/?(?:main|nav|header|footer|aside)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /<\/?\s*([a-z]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !tagToPlacement[name]) continue;
    const placement = tagToPlacement[name];
    if (/^<\s*\//.test(tag)) {
      const index = stack.lastIndexOf(placement);
      if (index !== -1) stack.splice(index, 1);
    } else if (!/\/>\s*$/.test(tag)) {
      stack.push(placement);
    }
  }
  return stack[stack.length - 1] || 'unknown';
}

function extractVisibleText(html: string): string {
  return normalizeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function firstTagText(html: string, tag: string): string | undefined { return allTagText(html, tag)[0]; }
function allTagText(html: string, tag: string): string[] { const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'); const output: string[] = []; let match: RegExpExecArray | null; while ((match = expression.exec(html)) !== null) { const value = normalizeText(stripTags(match[1])); if (value) output.push(value); } return output; }
function stripTags(value: string): string { return value.replace(/<[^>]+>/g, ' '); }
function normalizeText(value: string): string { return decodeHtml(value).replace(/\s+/g, ' ').trim(); }
function decodeHtml(value: string): string { return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'"); }
function attributeValue(attributes: string, name: string): string | undefined { const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes); if (quoted) return quoted[2]; const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(attributes); return unquoted?.[1]; }
function findMetaContent(html: string, attribute: string, value: string): string | undefined { const tags = html.match(/<meta\b[^>]*>/gi) || []; for (const tag of tags) { if (attributeValue(tag, attribute)?.toLowerCase() === value.toLowerCase()) { const content = attributeValue(tag, 'content'); if (content) return decodeHtml(content).trim(); } } return undefined; }
function hasMetaName(html: string, name: string): boolean { return (html.match(/<meta\b[^>]*>/gi) || []).some(tag => attributeValue(tag, 'name')?.toLowerCase() === name.toLowerCase()); }
function findLinkHref(html: string, rel: string): string | undefined { const tags = html.match(/<link\b[^>]*>/gi) || []; for (const tag of tags) { const values = attributeValue(tag, 'rel')?.toLowerCase().split(/\s+/) || []; if (values.includes(rel.toLowerCase())) { const href = attributeValue(tag, 'href'); if (href) return decodeHtml(href).trim(); } } return undefined; }
function extractLang(html: string): string | undefined { const match = /<html\b([^>]*)>/i.exec(html); return match ? attributeValue(match[1], 'lang')?.trim() : undefined; }
function extractOpenGraphTags(html: string): Record<string, string> { const tags: Record<string, string> = {}; const expression = /<meta\b[^>]*\bproperty\s*=\s*(["'])og:([^"']+)\1[^>]*>/gi; let match: RegExpExecArray | null; while ((match = expression.exec(html)) !== null) { const tag = match[0]; const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag); if (content) tags[match[2]] = decodeHtml(content[2]); } return tags; }
function extractStructuredDataTypes(html: string): string[] { const output = new Set<string>(); const expression = /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi; let match: RegExpExecArray | null; while ((match = expression.exec(html)) !== null) { try { const parsed = JSON.parse(match[2]); const rows = Array.isArray(parsed) ? parsed : [parsed]; for (const row of rows) { const type = row?.['@type']; if (Array.isArray(type)) type.forEach((value: unknown) => typeof value === 'string' && output.add(value)); else if (typeof type === 'string') output.add(type); } } catch { /* Keep crawling if malformed JSON-LD is found. */ } } return Array.from(output); }
function normalizeUrl(value: string, baseUrl: URL): string { const url = new URL(value, baseUrl); url.hash = ''; if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, ''); return url.href; }
function fingerprint(text: string): string { let hash = 2166136261; for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
function calculateReadability(text: string): number { const words = text.match(/[A-Za-zÀ-ÿ0-9'-]+/g) || []; const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length); const syllables = words.reduce((total, word) => total + Math.max(1, (word.toLowerCase().match(/[aeiouyà-ÿ]+/g) || []).length), 0); const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / Math.max(1, words.length)); return Math.max(0, Math.min(100, Math.round(score))); }
function extractPrimaryContent(html: string): { html: string; source: PageMetrics['contentSource'] } { const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html); if (main) return { html: main[1], source: 'main' }; const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html); if (article) return { html: article[1], source: 'article' }; const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html); const candidate = body?.[1] || html; return { html: candidate.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '), source: body ? 'body' : 'document' }; }
function extractHeadingLevels(html: string): number[] { const levels: number[] = []; const expression = /<h([1-6])\b[^>]*>/gi; let match: RegExpExecArray | null; while ((match = expression.exec(html)) !== null) levels.push(Number(match[1])); return levels; }
function needsJavaScriptRendering(html: string, visibleWordCount: number): boolean { const scripts = (html.match(/<script\b/gi) || []).length; const appShell = /<(?:div|main)\b[^>]*(?:id\s*=\s*["'](?:root|app|__next|__nuxt)["']|data-reactroot)/i.test(html); const moduleScript = /<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html); return visibleWordCount < 80 && (appShell || (moduleScript && scripts >= 2)); }
