// Website service
import { nanoid } from 'nanoid';
import { isPublicCrawlUrl } from '../crawlers/base';

export interface Website {
  id: string;
  organizationId: string;
  name: string;
  domain: string;
  url: string;
  crawlSchedule: 'never' | 'daily' | 'weekly' | 'monthly';
  crawlDelay: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastCrawledAt?: string;
}

export interface SiteSetupInput {
  businessDescription?: string;
  targetCountries?: string[];
  targetLanguages?: string[];
  conversionGoals?: string[];
  importantPages?: string[];
  excludedPaths?: string[];
  privatePaths?: string[];
  intendedPublicPaths?: string[];
  aliases?: string[];
}

export async function createWebsite(
  db: any,
  organizationId: string,
  name: string,
  _domain: string,
  url: string,
  setup: SiteSetupInput = {}
): Promise<Website> {
  const id = `web_${nanoid(16)}`;
  const now = new Date().toISOString();
  const normalizedUrl = normalizePublicWebsiteUrl(url);
  const normalizedDomain = new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, '');

  await db.prepare(`
    INSERT INTO websites (id, organization_id, name, domain, url, crawl_schedule, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, organizationId, name, normalizedDomain, normalizedUrl, 'weekly', true, now, now).run();

  await db.prepare(`
    INSERT INTO site_profiles (
      website_id, business_description, target_countries_json, target_languages_json,
      conversion_goals_json, important_pages_json, excluded_paths_json, private_paths_json,
      intended_public_paths_json, aliases_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    setup.businessDescription || null,
    JSON.stringify(setup.targetCountries || []),
    JSON.stringify(setup.targetLanguages || []),
    JSON.stringify(setup.conversionGoals || []),
    JSON.stringify(setup.importantPages || []),
    JSON.stringify(setup.excludedPaths || []),
    JSON.stringify(setup.privatePaths || []),
    JSON.stringify(setup.intendedPublicPaths || []),
    JSON.stringify(setup.aliases || []),
    now,
  ).run();

  const origin = new URL(normalizedUrl).origin;
  await db.prepare(`
    INSERT INTO site_hosts (id, website_id, origin, hostname, is_preferred, is_included, is_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(`host_${nanoid(16)}`, id, origin, new URL(normalizedUrl).hostname, true, true, false, now, now).run();

  return { id, organizationId, name, domain: normalizedDomain, url: normalizedUrl, crawlSchedule: 'weekly', crawlDelay: 1, isActive: true, createdAt: now, updatedAt: now };
}

export async function updateSiteProfile(db: any, websiteId: string, setup: SiteSetupInput): Promise<any | null> {
  const website = await getWebsite(db, websiteId);
  if (!website) return null;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO site_profiles (
      website_id, business_description, target_countries_json, target_languages_json,
      conversion_goals_json, important_pages_json, excluded_paths_json, private_paths_json,
      intended_public_paths_json, aliases_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(website_id) DO UPDATE SET
      business_description = COALESCE(excluded.business_description, site_profiles.business_description),
      target_countries_json = excluded.target_countries_json,
      target_languages_json = excluded.target_languages_json,
      conversion_goals_json = excluded.conversion_goals_json,
      important_pages_json = excluded.important_pages_json,
      excluded_paths_json = excluded.excluded_paths_json,
      private_paths_json = excluded.private_paths_json,
      intended_public_paths_json = excluded.intended_public_paths_json,
      aliases_json = excluded.aliases_json,
      updated_at = excluded.updated_at
  `).bind(
    websiteId,
    setup.businessDescription || null,
    JSON.stringify(setup.targetCountries || []),
    JSON.stringify(setup.targetLanguages || []),
    JSON.stringify(setup.conversionGoals || []),
    JSON.stringify(setup.importantPages || []),
    JSON.stringify(setup.excludedPaths || []),
    JSON.stringify(setup.privatePaths || []),
    JSON.stringify(setup.intendedPublicPaths || []),
    JSON.stringify(setup.aliases || []),
    now,
  ).run();
  return db.prepare('SELECT * FROM site_profiles WHERE website_id = ?').bind(websiteId).first();
}

export async function getWebsite(db: any, id: string): Promise<Website | null> {
  const web = await db.prepare('SELECT * FROM websites WHERE id = ?').bind(id).first();
  return web ? mapWebRow(web) : null;
}

export async function listWebsites(db: any, organizationId: string): Promise<Website[]> {
  const result = await db.prepare('SELECT * FROM websites WHERE organization_id = ?').bind(organizationId).all();
  return result.results.map(mapWebRow);
}

export async function updateWebsite(db: any, id: string, updates: Partial<Website>): Promise<Website | null> {
  const now = new Date().toISOString();
  const web = await getWebsite(db, id);
  if (!web) return null;

  const nextUrl = updates.url ? normalizePublicWebsiteUrl(updates.url) : web.url;
  const updated = { ...web, ...updates, updatedAt: now, url: nextUrl, domain: updates.url ? new URL(nextUrl).hostname.toLowerCase().replace(/^www\./, '') : web.domain };
  await db.prepare(`
    UPDATE websites SET name = ?, domain = ?, url = ?, crawl_schedule = ?, is_active = ?, updated_at = ? WHERE id = ?
  `).bind(updated.name, updated.domain, updated.url, updated.crawlSchedule, updated.isActive, now, id).run();

  return updated;
}

function normalizePublicWebsiteUrl(value: string): string {
  if (!isPublicCrawlUrl(value)) throw new Error('Only public HTTP or HTTPS website origins can be added.');
  const parsed = new URL(value);
  parsed.hash = '';
  return parsed.href;
}

function mapWebRow(row: any): Website {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    domain: row.domain,
    url: row.url,
    crawlSchedule: row.crawl_schedule,
    crawlDelay: row.crawl_delay,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCrawledAt: row.last_crawled_at,
  };
}
