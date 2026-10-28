// Organization service
import { nanoid } from 'nanoid';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: 'starter' | 'professional' | 'enterprise';
  billingEmail: string;
  createdAt: string;
  updatedAt: string;
}

export async function createOrganization(
  db: any,
  ownerId: string,
  name: string,
  billingEmail: string
): Promise<Organization> {
  const id = `org_${nanoid(16)}`;
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO organizations (id, name, slug, owner_id, plan, billing_email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, name, slug, ownerId, 'starter', billingEmail, now, now).run();

  return { id, name, slug, ownerId, plan: 'starter', billingEmail, createdAt: now, updatedAt: now };
}

export async function getOrganization(db: any, id: string): Promise<Organization | null> {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').bind(id).first();
  if (!org) return null;
  return mapOrgRow(org);
}

export async function listOrganizations(db: any, userId: string): Promise<Organization[]> {
  const orgs = await db.prepare(`
    SELECT DISTINCT organization.*
    FROM organizations organization
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE organization.owner_id = ? OR member.user_id IS NOT NULL
    ORDER BY organization.created_at ASC
  `).bind(userId, userId).all();
  return orgs.results.map(mapOrgRow);
}

export async function updateOrganization(db: any, id: string, updates: Partial<Organization>): Promise<Organization | null> {
  const now = new Date().toISOString();
  const org = await getOrganization(db, id);
  if (!org) return null;

  const updated = { ...org, ...updates, updatedAt: now };
  await db.prepare(`
    UPDATE organizations SET name = ?, plan = ?, billing_email = ?, updated_at = ? WHERE id = ?
  `).bind(updated.name, updated.plan, updated.billingEmail, now, id).run();

  return updated;
}

function mapOrgRow(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_id,
    plan: row.plan,
    billingEmail: row.billing_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
