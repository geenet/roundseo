/**
 * Deterministic extraction of backlink occurrences and source-page
 * directives. Regex-based, dependency-free, and synchronous so it runs the
 * same way in the Worker and under vitest (mirrors src/worker/crawlers/parser.ts).
 * It only reports what is in the markup; it never infers whether a link
 * "counts" for Google.
 */

export interface RawOccurrence {
  originalHref: string;
  resolvedUrl: string | null;
  anchorText: string | null;
  imageAlt: string | null;
  relTokens: string[];
  elementKind: 'text' | 'image';
  /** Sequential position among extracted anchors; part of the stored locator. */
  index: number;
  /** Stable hash of the text immediately around the element, used to re-identify an occurrence across checks. */
  contextFingerprint: string;
}

export interface SourceDirectives {
  metaRobots: string | null;
  canonical: string | null;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const IMG_RE = /<img\b([^>]*)>/i;

export function extractOccurrences(html: string, documentBaseUrl: string): RawOccurrence[] {
  const cleaned = stripInert(html);
  const baseUrl = resolveDocumentBase(cleaned, documentBaseUrl);
  const occurrences: RawOccurrence[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  ANCHOR_RE.lastIndex = 0;
  while ((match = ANCHOR_RE.exec(cleaned)) !== null) {
    const attributes = match[1] || '';
    const inner = match[2] || '';
    const href = attributeValue(attributes, 'href');
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href.trim())) continue;
    let resolvedUrl: string | null = null;
    try { resolvedUrl = new URL(href.trim(), baseUrl).href; } catch { resolvedUrl = null; }
    const relTokens = (attributeValue(attributes, 'rel') || '').split(/\s+/).map(token => token.trim().toLowerCase()).filter(Boolean);
    const img = IMG_RE.exec(inner);
    const anchorText = stripTags(inner).trim();
    const before = cleaned.slice(Math.max(0, match.index - 80), match.index);
    const after = cleaned.slice(match.index + match[0].length, match.index + match[0].length + 80);
    occurrences.push({
      originalHref: href.trim(),
      resolvedUrl,
      anchorText: anchorText || null,
      imageAlt: img ? attributeValue(img[1] || '', 'alt') || null : null,
      relTokens,
      elementKind: !anchorText && img ? 'image' : 'text',
      index,
      contextFingerprint: fingerprint(`${stripTags(before)}|${anchorText}|${stripTags(after)}`),
    });
    index += 1;
  }
  return occurrences;
}

export function extractSourceDirectives(html: string): SourceDirectives {
  const cleaned = stripInert(html);
  const metaMatch = /<meta\s+[^>]*name\s*=\s*["']robots["'][^>]*>/i.exec(cleaned);
  const canonicalMatch = /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(cleaned);
  return {
    metaRobots: metaMatch ? attributeValue(metaMatch[0], 'content') : null,
    canonical: canonicalMatch ? attributeValue(canonicalMatch[0], 'href') : null,
  };
}

function resolveDocumentBase(html: string, documentUrl: string): string {
  const baseMatch = /<base\b[^>]*>/i.exec(html);
  const baseHref = baseMatch ? attributeValue(baseMatch[0], 'href') : null;
  if (!baseHref) return documentUrl;
  try { return new URL(baseHref, documentUrl).href; } catch { return documentUrl; }
}

function stripInert(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function attributeValue(attributes: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const match = re.exec(attributes);
  return match ? decodeEntities(match[2]) : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** A stable, non-cryptographic fingerprint; used only to re-identify an occurrence's position, never as a security token. */
function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
