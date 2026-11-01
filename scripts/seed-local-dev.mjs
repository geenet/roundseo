#!/usr/bin/env node
/**
 * Creates a local development account, organization, and test websites through
 * the running RoundSEO API, so the web sign-in works without manual setup.
 *
 * Local development only. The credential below is for the local API (wrangler dev
 * or the Worker on ROUNDSEO_API_URL) and is not valid anywhere else.
 *
 * Usage: node scripts/seed-local-dev.mjs
 *   ROUNDSEO_API_URL defaults to http://127.0.0.1:8789.
 */

const API = (process.env.ROUNDSEO_API_URL || 'http://127.0.0.1:8789').replace(/\/+$/, '');
const ACCOUNT = {
  email: 'local-owner@roundseo.test',
  name: 'Local Owner',
  password: 'LocalDev-2026-owner',
};
const ORGANIZATION = { name: 'Local Agency', billingEmail: 'billing@roundseo.test' };
const WEBSITES = [
  { name: 'Example', domain: 'example.com', url: 'https://example.com/' },
  { name: 'IANA', domain: 'iana.org', url: 'https://www.iana.org/' },
  { name: 'HTTPBin', domain: 'httpbin.org', url: 'https://httpbin.org/' },
];

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function signIn() {
  const signup = await call('POST', '/api/v2/auth/signup', { body: ACCOUNT });
  if (signup.status === 201 && signup.json?.token) return signup.json.token;
  const login = await call('POST', '/api/v2/auth/login', { body: { email: ACCOUNT.email, password: ACCOUNT.password } });
  if (login.status === 200 && login.json?.token) return login.json.token;
  throw new Error(`Could not create or sign in the local account (signup ${signup.status}, login ${login.status}).`);
}

const token = await signIn();

const organizations = await call('GET', '/api/v2/organizations', { token });
let organization = organizations.json?.organizations?.[0];
if (!organization) {
  const created = await call('POST', '/api/v2/organizations', { token, body: ORGANIZATION });
  organization = created.json?.organization;
  if (!organization) throw new Error(`Could not create the organization (status ${created.status}).`);
}

const existing = await call('GET', `/api/v2/organizations/${organization.id}/websites`, { token });
const known = new Set((existing.json?.websites || []).map(site => site.domain));
for (const site of WEBSITES) {
  if (known.has(site.domain)) continue;
  const created = await call('POST', `/api/v2/organizations/${organization.id}/websites`, { token, body: site });
  if (created.status !== 201) throw new Error(`Could not create ${site.domain} (status ${created.status}).`);
}

const final = await call('GET', `/api/v2/organizations/${organization.id}/websites`, { token });
console.log(`Local account: ${ACCOUNT.email} (password is defined in scripts/seed-local-dev.mjs)`);
console.log(`Organization: ${organization.name} (${organization.id})`);
for (const site of final.json?.websites || []) console.log(`  website ${site.domain} -> ${site.id}`);
