/**
 * A website's Search Console connection. Starts read-only
 * (webmasters.readonly); the write scope is requested only when the
 * customer explicitly enables sitemap submission (spec: "Request the
 * write-capable Google scope only when enabling sitemap submission").
 */
import { nanoid } from 'nanoid';
import { GSC_READONLY_SCOPE, GSC_WRITE_SCOPE, type GoogleConnection, type PropertyType } from '../../shared/indexing';
import { decryptToken, encryptToken, tokenEncryptionSecret } from './token-crypto';
import { exchangeCodeForTokens, fetchGoogleAccountEmail, refreshAccessToken, type GoogleOAuthApp, type RefreshResult } from './search-console-client';

type Database = any;

export interface GoogleConnectionEnv { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; GOOGLE_INDEXING_REDIRECT_URI?: string; GOOGLE_REDIRECT_URI?: string; GOOGLE_TOKEN_ENCRYPTION_KEY?: string; JWT_SECRET?: string }

export function googleOAuthApp(env: GoogleConnectionEnv): GoogleOAuthApp | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_INDEXING_REDIRECT_URI || env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/** Builds the consent URL. `scopes` is readonly-only on first connect, or readonly+write when enabling sitemap submission. */
export function buildConsentUrl(app: GoogleOAuthApp, state: string, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code',
    scope: scopes.join(' '), state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleConnection(
  db: Database, env: GoogleConnectionEnv, websiteId: string, organizationId: string, userId: string, code: string,
): Promise<GoogleConnection> {
  const app = googleOAuthApp(env);
  if (!app) throw new Error('Google OAuth is not configured on this deployment.');
  const secret = tokenEncryptionSecret(env);
  if (!secret) throw new Error('No token-encryption secret is configured on this deployment.');
  const tokens = await exchangeCodeForTokens(code, app);
  if (!tokens) throw new Error('Google did not grant access. Try connecting again.');
  const email = await fetchGoogleAccountEmail(tokens.accessToken);
  if (!email) throw new Error('Could not read the connected Google account.');
  const existing = await db.prepare('SELECT * FROM google_connections WHERE website_id = ?').bind(websiteId).first();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  const grantedScopes = tokens.scope.split(/\s+/).filter(Boolean);

  if (existing) {
    const refreshToken = tokens.refreshToken ? await encryptToken(secret, tokens.refreshToken) : existing.encrypted_refresh_token;
    // Merge with the previously granted scopes rather than overwrite — if this exchange's response
    // ever omits `scope` (not guaranteed across all OAuth responses), a plain overwrite would
    // silently drop an already-granted write scope even though Google's actual consent is unchanged.
    let existingScopes: string[] = [];
    try { existingScopes = JSON.parse(existing.granted_scopes_json || '[]'); } catch { existingScopes = []; }
    const mergedScopes = [...new Set([...existingScopes, ...grantedScopes])];
    await db.prepare(`
      UPDATE google_connections SET google_account_email = ?, encrypted_refresh_token = ?, access_token = ?, access_token_expires_at = ?,
        granted_scopes_json = ?, status = 'connected', last_error = NULL, updated_at = ? WHERE id = ?
    `).bind(email, refreshToken, tokens.accessToken, expiresAt, JSON.stringify(mergedScopes), now, existing.id).run();
    return (await getGoogleConnection(db, websiteId))!;
  }
  if (!tokens.refreshToken) throw new Error('Google did not grant offline access. Try connecting again.');
  const id = `gconn_${nanoid(16)}`;
  const encryptedRefreshToken = await encryptToken(secret, tokens.refreshToken);
  await db.prepare(`
    INSERT INTO google_connections (id, website_id, organization_id, google_account_email, encrypted_refresh_token, access_token, access_token_expires_at, granted_scopes_json, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?)
  `).bind(id, websiteId, organizationId, email, encryptedRefreshToken, tokens.accessToken, expiresAt, JSON.stringify(grantedScopes), userId, now, now).run();
  return (await getGoogleConnection(db, websiteId))!;
}

export async function selectSearchConsoleProperty(db: Database, websiteId: string, selectedProperty: string, propertyType: PropertyType): Promise<GoogleConnection | null> {
  await db.prepare('UPDATE google_connections SET selected_property = ?, property_type = ?, updated_at = ? WHERE website_id = ?')
    .bind(selectedProperty, propertyType, new Date().toISOString(), websiteId).run();
  return getGoogleConnection(db, websiteId);
}

export async function getGoogleConnection(db: Database, websiteId: string): Promise<GoogleConnection | null> {
  const row = await db.prepare('SELECT * FROM google_connections WHERE website_id = ?').bind(websiteId).first();
  return row ? mapConnectionRow(row) : null;
}

/** A valid, non-expired access token for this connection, refreshing it first if needed. Marks the connection needs_reauth on failure. */
export async function getValidAccessToken(db: Database, env: GoogleConnectionEnv, websiteId: string): Promise<string | null> {
  const row = await db.prepare('SELECT * FROM google_connections WHERE website_id = ?').bind(websiteId).first();
  if (!row) return null;
  const expiresAt = row.access_token_expires_at ? Date.parse(String(row.access_token_expires_at)) : 0;
  if (row.access_token && expiresAt > Date.now() + 60_000) return String(row.access_token);
  const app = googleOAuthApp(env);
  const secret = tokenEncryptionSecret(env);
  if (!app || !secret) return null;
  let refreshed: RefreshResult;
  try {
    const refreshToken = await decryptToken(secret, String(row.encrypted_refresh_token));
    refreshed = await refreshAccessToken(refreshToken, app);
  } catch {
    refreshed = { kind: 'transient' };
  }
  if (refreshed.kind === 'ok') {
    await db.prepare('UPDATE google_connections SET access_token = ?, access_token_expires_at = ?, status = ?, last_error = NULL, updated_at = ? WHERE id = ?')
      .bind(refreshed.accessToken, new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(), 'connected', new Date().toISOString(), row.id).run();
    return refreshed.accessToken;
  }
  if (refreshed.kind === 'rejected') {
    // Only a definite rejection from Google means the stored refresh token is actually invalid —
    // a network/5xx/429 failure (kind: 'transient') leaves status and the token alone and just
    // fails this one attempt, so a transient outage never forces an unnecessary reconnect.
    await db.prepare(`UPDATE google_connections SET status = 'needs_reauth', last_error = ?, updated_at = ? WHERE id = ?`)
      .bind('Google access could not be refreshed. Reconnect this website.', new Date().toISOString(), row.id).run();
  }
  return null;
}

/** True once the webmasters (write) scope has been granted — required before sitemap submission is offered. */
export function hasWriteScope(connection: GoogleConnection): boolean {
  return connection.grantedScopes.includes(GSC_WRITE_SCOPE);
}

export function requiredReadScopes(): string[] { return [GSC_READONLY_SCOPE]; }
export function requiredWriteScopes(): string[] { return [GSC_READONLY_SCOPE, GSC_WRITE_SCOPE]; }

function mapConnectionRow(row: any): GoogleConnection {
  let scopes: string[] = [];
  try { scopes = JSON.parse(row.granted_scopes_json || '[]'); } catch { scopes = []; }
  return {
    id: row.id, websiteId: row.website_id, googleAccountEmail: row.google_account_email, grantedScopes: scopes,
    selectedProperty: row.selected_property, propertyType: row.property_type, status: row.status, lastError: row.last_error,
    canSubmitSitemaps: scopes.includes(GSC_WRITE_SCOPE), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
