// Report generation service
import { nanoid } from 'nanoid';

export interface Report {
  id: string;
  auditId: string;
  websiteId: string;
  organizationId: string;
  reportType: 'full' | 'summary' | 'custom';
  title: string;
  generatedAt: string;
  expiresAt?: string;
  sharedToken?: string;
  isShared: boolean;
  isPasswordProtected: boolean;
  viewCount: number;
  lastViewedAt?: string;
  s3Key?: string;
  createdBy: string;
  createdAt: string;
}

export async function createReport(
  db: any,
  auditId: string,
  websiteId: string,
  organizationId: string,
  createdBy: string,
  reportType: Report['reportType'] = 'full'
): Promise<Report> {
  const id = `report_${nanoid(16)}`;
  const now = new Date().toISOString();
  const title = `SEO Audit Report - ${new Date().toLocaleDateString()}`;

  await db.prepare(`
    INSERT INTO reports (
      id, audit_id, website_id, organization_id, report_type, title,
      generated_at, is_shared, is_password_protected, view_count, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, auditId, websiteId, organizationId, reportType, title,
    now, false, false, 0, createdBy, now
  ).run();

  return {
    id,
    auditId,
    websiteId,
    organizationId,
    reportType,
    title,
    generatedAt: now,
    isShared: false,
    isPasswordProtected: false,
    viewCount: 0,
    createdBy,
    createdAt: now,
  };
}

export async function getReport(db: any, id: string): Promise<Report | null> {
  const report = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  return report ? mapReportRow(report) : null;
}

export async function getReportByToken(db: any, token: string): Promise<Report | null> {
  const report = await db.prepare('SELECT * FROM reports WHERE shared_token = ?').bind(token).first();
  return report ? mapReportRow(report) : null;
}

export async function listReports(db: any, organizationId: string): Promise<Report[]> {
  const result = await db.prepare(
    'SELECT * FROM reports WHERE organization_id = ? ORDER BY created_at DESC'
  ).bind(organizationId).all();
  return result.results.map(mapReportRow);
}

export async function shareReport(
  db: any,
  reportId: string,
  expiresInDays = 30
): Promise<{ token: string; expiresAt: string }> {
  const token = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  await db.prepare(`
    UPDATE reports SET shared_token = ?, is_shared = ?, expires_at = ? WHERE id = ?
  `).bind(token, true, expiresAt.toISOString(), reportId).run();

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function recordReportView(db: any, reportId: string): Promise<void> {
  const now = new Date().toISOString();
  const report = await getReport(db, reportId);

  if (report) {
    await db.prepare(`
      UPDATE reports SET view_count = ?, last_viewed_at = ? WHERE id = ?
    `).bind(report.viewCount + 1, now, reportId).run();
  }
}

function mapReportRow(row: any): Report {
  return {
    id: row.id,
    auditId: row.audit_id,
    websiteId: row.website_id,
    organizationId: row.organization_id,
    reportType: row.report_type,
    title: row.title,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    sharedToken: row.shared_token,
    isShared: row.is_shared,
    isPasswordProtected: row.is_password_protected,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    s3Key: row.s3_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
