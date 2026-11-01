# Local Development Setup - RoundSEO

**Goal:** Get the Worker API + React UI running locally in 10 minutes

---

## Local sign-in and test data

With the Worker API running on port 8789 (`npx wrangler dev --env development --port 8789`) and
the migrations applied, create the local development account, organization, and test websites:

```bash
node scripts/seed-local-dev.mjs
```

The script is idempotent and writes no secrets to disk. Its local-only credential is defined in
`scripts/seed-local-dev.mjs`. Sign in on the web app with that email and password. The session
token is stored in the browser, and the account's websites appear in the portfolio.

If the API is unreachable, sign-in keeps a local session in the browser. Intelligence stays
unavailable in that mode because it needs the API token.

---

## 1. Install Dependencies

```bash
cd /Users/g/code/github/geenet/roundseo
npm install
```

---

## 2. Create Local D1 Database

```bash
# Create local database (no Cloudflare account needed)
wrangler d1 create roundseo-local --local

# You'll see output like:
# ✅ Successfully created DB "roundseo-local"
# Database ID: xxxxxxxxxxxxx
```

**Copy the Database ID** and update `wrangler.toml`:

```toml
[env.development]
name = "roundseo-api-dev"

[[env.development.d1_databases]]
binding = "DB"
database_name = "roundseo-local"
database_id = "xxxxxxxxxxxxxxx"  # PASTE YOUR ID HERE
```

---

## 3. Run Migrations

Apply all database schema migrations:

```bash
# Run each migration in order
for file in migrations/*.sql; do
  echo "Applying $file..."
  wrangler d1 execute roundseo-local --local --file="$file"
done
```

Or run them individually:

```bash
wrangler d1 execute roundseo-local --local --file=migrations/001_initial_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/002_crawl_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/003_keywords_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/004_reports_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/005_audit_evidence_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/006_operating_workflow_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/007_finding_evidence.sql
wrangler d1 execute roundseo-local --local --file=migrations/008_performance_audits.sql
wrangler d1 execute roundseo-local --local --file=migrations/009_dataforseo_runs.sql
wrangler d1 execute roundseo-local --local --file=migrations/010_intelligence_platform.sql
wrangler d1 execute roundseo-local --local --file=migrations/011_native_intelligence.sql
```

**Verify migrations worked:**

```bash
wrangler d1 shell roundseo-local --local

# In the shell, try:
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM websites;
SELECT COUNT(*) FROM audits;

# Type .quit to exit
```

---

## 4. Setup Environment Variables

```bash
# Copy template
cp .env.example .env

# Local browser tests do not need a Google PageSpeed API key.
```

---

## 5. Start Development Servers

**Terminal 1: Start Wrangler (API Server)**

```bash
npm run dev

# You'll see:
# ⛅ wrangler (version 3.x.x) 
# ✨ Listening on http://localhost:8787
# Your Worker is available at: http://localhost:8787
```

Test the API is running:

```bash
curl http://localhost:8787/health
# Should return: {"status":"ok","timestamp":"2026-10-28T..."}
```

**Terminal 2: Start Vite (React UI)**

```bash
npm run dev

# You'll see:
# Local:   http://localhost:5173/
# Press h + enter to show help
```

---

## 6. Test the Flow

### 6.1 Create a User (Sign Up)

```bash
curl -X POST http://localhost:8787/api/v2/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }'

# Response:
# {"user":{"id":"xxx","email":"test@example.com"},"token":"eyJ..."}
```

Save the token for next steps.

### 6.2 Create an Organization

```bash
TOKEN="eyJ..."  # from signup

curl -X POST http://localhost:8787/api/v2/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agency",
    "billingEmail": "billing@agency.com"
  }'

# Response:
# {"organization":{"id":"org_xxx","name":"My Agency"}}
```

Save the `organization.id`.

### 6.3 Add a Website

```bash
ORG_ID="org_xxx"
TOKEN="eyJ..."

curl -X POST http://localhost:8787/api/v2/organizations/$ORG_ID/websites \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example Site",
    "url": "https://example.com"
  }'

# Response:
# {"website":{"id":"site_xxx","name":"Example Site","url":"https://example.com"}}
```

Save the `website.id`.

### 6.4 Run an Audit

```bash
WEBSITE_ID="site_xxx"
ORG_ID="org_xxx"
TOKEN="eyJ..."

curl -X POST http://localhost:8787/api/v2/organizations/$ORG_ID/websites/$WEBSITE_ID/audits \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "user"
  }'

# Response:
# {"audit":{"id":"audit_xxx","status":"pending","createdAt":"2026-10-28T..."}}
```

### 6.5 Check Audit Progress

```bash
AUDIT_ID="audit_xxx"
ORG_ID="org_xxx"
TOKEN="eyJ..."

# Check status (run this every 10 seconds)
curl -X GET http://localhost:8787/api/v2/organizations/$ORG_ID/audits/$AUDIT_ID \
  -H "Authorization: Bearer $TOKEN"

# Response while running:
# {"audit":{"id":"audit_xxx","status":"running","progress":{"pagesCrawled":5,"totalPages":12}}}

# After 2-5 minutes (depending on site size):
# {"audit":{"id":"audit_xxx","status":"completed","findings":[...],"score":82}}
```

---

## 7. View in Browser

Open http://localhost:5173 and:

1. Sign up with test email
2. Create organization
3. Add website
4. Click "Run Audit"
5. Wait for crawl to complete
6. View dashboard with score + issues

---

## 8. Monitor Logs

In Terminal 1, you'll see real-time logs:

```
[Crawl Worker] Fetching: https://example.com/page1
[Crawl Worker] Found 5 links
[Metrics Worker] Analyzing page 1/12...
[Audit Complete] Overall score: 82/100
```

To see more details:

```bash
wrangler tail

# Stream all logs from the Worker
# Press Ctrl+C to stop
```

---

## 9. Inspect Database

```bash
# Open D1 shell
wrangler d1 shell roundseo-local --local

# Query examples
SELECT id, email FROM users;
SELECT id, name, url FROM websites;
SELECT id, status, overall_score FROM audits;
SELECT * FROM technical_issues WHERE audit_id = 'audit_xxx';
SELECT * FROM onpage_metrics WHERE audit_id = 'audit_xxx';

# Exit with .quit
```

---

## 10. Common Issues

### ❌ "ENOENT: no such file or directory" when running migrations

**Solution:** Make sure you're in the project root:

```bash
cd /Users/g/code/github/geenet/roundseo
wrangler d1 execute roundseo-local --local --file=migrations/001_initial_schema.sql
```

### ❌ "D1_BINDING" error in Wrangler logs

**Solution:** Make sure `wrangler.toml` has the correct database ID:

```toml
[[env.development.d1_databases]]
binding = "DB"
database_name = "roundseo-local"
database_id = "YOUR_ACTUAL_ID"  # Check this
```

### ❌ Crawl never completes (stuck on "running")

**Solution:** 
1. Check logs in Terminal 1: `wrangler tail`
2. Look for error messages (network timeout, DNS issues)
3. Test with smaller sites first (5-10 pages)
4. Verify internet connection can reach the target domain

### ❌ React UI doesn't load, shows "Cannot connect to API"

**Solution:**
1. Make sure Wrangler is running (`npm run dev` in Terminal 1)
2. Check that API server is on `http://localhost:8787` (not 8789)
3. Check CORS headers in API response
4. Open browser DevTools (F12) → Network tab → check request/response

### ❌ "JWT token is invalid or expired"

**Solution:** The token is only valid for 1 hour. Re-login:

```bash
curl -X POST http://localhost:8787/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}'
```

---

## Next Steps

Once local dev is running:

1. ✅ **Test the core flow** (signup → add website → run audit)
2. ✅ **Verify crawl completes** in <15 minutes (test with example.com first)
3. ✅ **Check dashboard** displays score + issues
4. ✅ **Export CSV** and verify format
5. 🔄 **Setup scheduled audits** (see MVP_LAUNCH_CHECKLIST.md Phase 2)

---

## Troubleshooting Commands

```bash
# Check wrangler version
wrangler --version

# Check Node version (should be 18+)
node --version

# List local databases
wrangler d1 list --local

# Clear all local D1 data and start fresh
rm .wrangler/state/d1
wrangler d1 create roundseo-local --local

# Watch for file changes during development
npm run dev -- --watch
```

---

## Performance Tips

**For faster crawling during testing:**
- Test with small sites first (5-10 pages)
- Set `maxPages: 10` in crawl options (temp for testing)
- Disable Lighthouse API calls (Phase 2+)

**For faster React builds:**
- Run `npm run build` once to see build size
- Check `npm run check` to catch TypeScript errors early

---

Still stuck? Check:
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [D1 Docs](https://developers.cloudflare.com/d1/)
- Project `/src` folder code comments
