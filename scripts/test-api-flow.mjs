#!/usr/bin/env node
/**
 * Comprehensive API test suite for RoundSEO
 * Tests the full flow: signup → org → website → audit → results
 */

import http from 'http';

const API_URL = 'http://localhost:8787';
let testsPassed = 0;
let testsFailed = 0;
let token = '';
let orgId = '';
let websiteId = '';
let auditId = '';

// Helper to make API requests
function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test helper
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
    testsFailed++;
  }
}

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

console.log(`\n${colors.blue}🧪 RoundSEO API Test Suite${colors.reset}\n`);

// ============================================
// TEST 1: Health Check
// ============================================
await test('Health check', async () => {
  const res = await apiRequest('GET', '/health');
  if (res.status !== 200 || !res.data.status) throw new Error('Health check failed');
});

// ============================================
// TEST 2: Signup
// ============================================
await test('Signup - create new user', async () => {
  const email = `test${Date.now()}@example.com`;
  const res = await apiRequest('POST', '/api/v2/auth/signup', {
    email,
    name: 'Test User',
    password: 'TestPassword123!',
  });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
  }

  if (!res.data.token) throw new Error('No token returned');
  token = res.data.token;
});

// ============================================
// TEST 3: Get Current User
// ============================================
await test('Get current user via JWT', async () => {
  const res = await apiRequest('GET', '/api/v2/auth/me');
  if (res.status !== 200) throw new Error(`Got ${res.status}: ${JSON.stringify(res.data)}`);
  if (!res.data.user?.id) throw new Error('No user data returned');
});

// ============================================
// TEST 4: Create Organization
// ============================================
await test('Create organization', async () => {
  const res = await apiRequest('POST', '/api/v2/organizations', {
    name: `Test Org ${Date.now()}`,
    billingEmail: 'test@example.com',
  });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Got ${res.status}: ${JSON.stringify(res.data)}`);
  }

  if (!res.data.organization?.id) throw new Error('No organization ID returned');
  orgId = res.data.organization.id;
});

// ============================================
// TEST 5: List Organizations
// ============================================
await test('List organizations', async () => {
  const res = await apiRequest('GET', '/api/v2/organizations');
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  if (!Array.isArray(res.data.organizations)) throw new Error('Expected array');
  if (res.data.organizations.length === 0) throw new Error('No orgs found');
});

// ============================================
// TEST 6: Create Website
// ============================================
await test('Create website', async () => {
  const res = await apiRequest(
    'POST',
    `/api/v2/organizations/${orgId}/websites`,
    {
      name: 'Test Website',
      url: 'https://example.com',
    }
  );

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Got ${res.status}: ${JSON.stringify(res.data)}`);
  }

  if (!res.data.website?.id) throw new Error('No website ID returned');
  websiteId = res.data.website.id;
});

// ============================================
// TEST 7: List Websites
// ============================================
await test('List websites in organization', async () => {
  const res = await apiRequest('GET', `/api/v2/organizations/${orgId}/websites`);
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  if (!Array.isArray(res.data.websites)) throw new Error('Expected array');
});

// ============================================
// TEST 8: Get Website Details
// ============================================
await test('Get website details', async () => {
  const res = await apiRequest('GET', `/api/v2/organizations/${orgId}/websites/${websiteId}`);
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  if (!res.data.website?.id) throw new Error('No website data');
});

// ============================================
// TEST 9: Create Audit
// ============================================
await test('Create audit (start crawl)', async () => {
  const res = await apiRequest(
    'POST',
    `/api/v2/organizations/${orgId}/websites/${websiteId}/audits`,
    { source: 'user' }
  );

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Got ${res.status}: ${JSON.stringify(res.data)}`);
  }

  if (!res.data.audit?.id) throw new Error('No audit ID returned');
  auditId = res.data.audit.id;
  console.log(`      (Audit ID: ${auditId})`);
});

// ============================================
// TEST 10: Get Audit Status (should be running or pending)
// ============================================
await test('Get audit status', async () => {
  const res = await apiRequest('GET', `/api/v2/organizations/${orgId}/audits/${auditId}`);
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  if (!res.data.audit?.status) throw new Error('No status');
  console.log(`      (Status: ${res.data.audit.status})`);
});

// ============================================
// TEST 11: List Audits
// ============================================
await test('List audits for website', async () => {
  const res = await apiRequest('GET', `/api/v2/organizations/${orgId}/websites/${websiteId}/audits`);
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  if (!Array.isArray(res.data.audits)) throw new Error('Expected array');
});

// ============================================
// TEST 12: Database verification
// ============================================
await test('Database contains audit record', async () => {
  const res = await apiRequest('GET', '/api/db-test');
  if (res.status !== 200) throw new Error(`Got ${res.status}`);
  console.log(`      (DB Status: ${res.data.database}, Tables: ${res.data.tables.join(', ')})`);
});

// ============================================
// Summary
// ============================================
console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
console.log(`${colors.green}✅ Tests Passed: ${testsPassed}${colors.reset}`);
console.log(`${colors.red}❌ Tests Failed: ${testsFailed}${colors.reset}`);
console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

if (testsFailed === 0) {
  console.log(`${colors.green}🎉 All tests passed!${colors.reset}`);
  console.log(`\n📋 Created test data:`);
  console.log(`   Organization ID: ${orgId}`);
  console.log(`   Website ID: ${websiteId}`);
  console.log(`   Audit ID: ${auditId}`);
  console.log(`   JWT Token: ${token.substring(0, 20)}...`);
  console.log(`\n💡 Next: Check audit progress in Terminal (API logs)`);
  console.log(`   Then visit: http://localhost:5175/`);
  process.exit(0);
} else {
  console.log(`${colors.red}⚠️  Some tests failed. Check the logs above.${colors.reset}`);
  process.exit(1);
}
