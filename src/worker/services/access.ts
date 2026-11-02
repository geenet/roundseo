/**
 * Tenant boundary checks shared by every authenticated resource route.
 * An organization owner or a member of any team in the organization can
 * access its resources. Returning false lets routes respond with 404 and
 * avoids exposing whether another tenant's record exists.
 */
type Database = any;

export async function canAccessOrganization(db: Database, userId: string, organizationId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT organization.id
    FROM organizations organization
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE organization.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, organizationId, userId).first();
  return Boolean(row);
}

export async function canAccessWebsite(db: Database, userId: string, websiteId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT website.id
    FROM websites website
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE website.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, websiteId, userId).first();
  return Boolean(row);
}

/** Provider calls spend shared organization balance, so read-only/client team
 * members may inspect saved evidence but cannot start a paid request. */
export async function canRunWebsiteIntelligence(db: Database, userId: string, websiteId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT website.id
    FROM websites website
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE website.id = ?
      AND (organization.owner_id = ? OR member.role IN ('admin', 'manager'))
    LIMIT 1
  `).bind(userId, websiteId, userId).first();
  return Boolean(row);
}

export async function canAccessAudit(db: Database, userId: string, auditId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT audit.id
    FROM audits audit
    JOIN websites website ON website.id = audit.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE audit.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, auditId, userId).first();
  return Boolean(row);
}

export async function canAccessCrawlJob(db: Database, userId: string, jobId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT job.id
    FROM crawl_jobs job
    JOIN organizations organization ON organization.id = job.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE job.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, jobId, userId).first();
  return Boolean(row);
}

export async function canAccessAction(db: Database, userId: string, actionId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT action.id
    FROM action_items action
    JOIN websites website ON website.id = action.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE action.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, actionId, userId).first();
  return Boolean(row);
}

export async function canAccessBacklinkMonitor(db: Database, userId: string, monitorId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT monitor.id
    FROM backlink_monitors monitor
    JOIN organizations organization ON organization.id = monitor.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE monitor.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, monitorId, userId).first();
  return Boolean(row);
}

export async function canAccessBacklinkList(db: Database, userId: string, listId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT list.id
    FROM backlink_lists list
    JOIN websites website ON website.id = list.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE list.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, listId, userId).first();
  return Boolean(row);
}

export async function canAccessBacklinkImport(db: Database, userId: string, importId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT imp.id
    FROM backlink_imports imp
    JOIN websites website ON website.id = imp.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE imp.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, importId, userId).first();
  return Boolean(row);
}

export async function canAccessIndexingInventoryItem(db: Database, userId: string, inventoryId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT item.id
    FROM indexing_inventory item
    JOIN websites website ON website.id = item.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE item.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, inventoryId, userId).first();
  return Boolean(row);
}

export async function canAccessPageIdentity(db: Database, userId: string, pageIdentityId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT identity.id
    FROM page_identities identity
    JOIN websites website ON website.id = identity.website_id
    JOIN organizations organization ON organization.id = website.organization_id
    LEFT JOIN teams team ON team.organization_id = organization.id
    LEFT JOIN team_members member ON member.team_id = team.id AND member.user_id = ?
    WHERE identity.id = ? AND (organization.owner_id = ? OR member.user_id IS NOT NULL)
    LIMIT 1
  `).bind(userId, pageIdentityId, userId).first();
  return Boolean(row);
}
