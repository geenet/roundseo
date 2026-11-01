# Local Development Setup - Full Local SQLite

**Goal:** Run RoundSEO entirely locally with persistent SQLite database (no Cloudflare needed)

---

## Quick Start (5 minutes)

### 1️⃣ Setup Database

```bash
cd /Users/g/code/github/geenet/roundseo

# Create local SQLite database with all migrations
npm run dev:setup-db

# Expected output:
# ✅ Database: .local/roundseo-dev.db
# ✅ 28 tables created
```

### 2️⃣ Start API Server (Terminal 1)

```bash
npm run dev:api

# Expected output:
# ⛅️ wrangler 3.x.x
# ✨ Listening on http://localhost:8787
```

### 3️⃣ Start React UI (Terminal 2)

```bash
npm run dev:ui

# Expected output:
# Local:   http://localhost:5173/
```

### 4️⃣ Open in Browser

Open http://localhost:5173 in your browser

---

## Next: Test the Full Flow

### Create Account

```bash
# In browser:
1. Click "Sign Up"
2. Enter: test@example.com / Password123!
3. Click "Sign Up"
```

### Add Website

```bash
# In browser:
1. Click "Create Organization"
2. Enter: "My Company"
3. Create first website: "example.com"
```

### Run Audit

```bash
# In browser:
1. Click "Run Audit"
2. Watch progress in sidebar
3. After ~2-5 minutes, results appear
```

---

## Database Management

### View Database

```bash
# Open SQLite shell
sqlite3 .local/roundseo-dev.db

# List tables
.tables

# Check users
SELECT id, email FROM users;

# Check websites
SELECT id, name, url FROM websites;

# Check audits
SELECT id, status, overall_score FROM audits;

# Exit
.quit
```

### Reset Database

```bash
npm run dev:reset-db
```

This deletes the database and recreates it with fresh migrations.

---

## Troubleshooting

### ❌ "wrangler not found"

```bash
# Use npx instead
npx wrangler dev --env development
```

### ❌ "Database locked" error

The database file is being accessed by another process.

```bash
# Find and kill process using .local/roundseo-dev.db
lsof | grep roundseo-dev.db
kill -9 <PID>

# Or just close your databases shells and restart servers
```

### ❌ "Cannot connect to API"

1. Make sure Terminal 1 is running: `npm run dev:api`
2. Check it's on port 8787: http://localhost:8787/health
3. Check browser console (F12) for errors

### ❌ "React won't load"

1. Make sure Terminal 2 is running: `npm run dev:ui`
2. Port 5173 in use? 
   ```bash
   lsof -i :5173
   kill -9 <PID>
   ```

### ❌ "Sign up fails"

Check API server logs (Terminal 1) for errors. Look for:
- "user already exists"
- "invalid password"
- Database errors

### ❌ "Audit never completes"

1. Check API logs for crawl errors
2. Check website is accessible from your network
3. Try a smaller site first (example.com)
4. Check timeout: API has 15-minute limit

---

## API Endpoints (for testing with curl)

### Health Check

```bash
curl http://localhost:8787/health
```

### Database Test

```bash
curl http://localhost:8787/api/db-test
```

### Sign Up

```bash
curl -X POST http://localhost:8787/api/v2/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123!"
  }'

# Response:
# {"user":{"id":"...","email":"test@example.com"},"token":"eyJ..."}
```

Save the token for authenticated requests:

```bash
TOKEN="eyJ..."

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/v2/auth/me
```

---

## File Structure

```
.local/
  roundseo-dev.db          ← Your local database file (persistent)

src/
  worker/                  ← API server code
    index.ts               ← Entry point
    api/                   ← API routes
    services/              ← Business logic
    crawlers/              ← Crawling logic
    auth/                  ← Authentication
  ui/                      ← React UI code
    App.tsx
    pages/
    components/

scripts/
  setup-local-sqlite.mjs   ← Database setup
  dev-local.mjs            ← Alternative dev server

wrangler.toml              ← Wrangler config (local dev section)
```

---

## Environment Variables

These are set automatically in `wrangler.toml` for development:

```
JWT_SECRET=dev-secret-key-12345-change-in-production
GOOGLE_CLIENT_ID=test-client-id
GOOGLE_CLIENT_SECRET=test-client-secret
API_URL=http://localhost:8787
DATABASE_URL=.local/roundseo-dev.db
NODE_ENV=development
```

You can override them by creating `.env.development.local`:

```bash
# .env.development.local
JWT_SECRET=your-secret-key
# etc
```

---

## Tips & Tricks

### Clear Browser Storage

If the app is confused about authentication:

```javascript
// In browser console (F12)
localStorage.clear()
sessionStorage.clear()
// Refresh page
```

### View API Traffic

Enable network tab in DevTools (F12 → Network tab) to see:
- API requests and responses
- Status codes
- Response times
- Headers

### Real-time Logs

Terminal 1 shows API logs in real-time. Look for:

```
[API] POST /api/v2/auth/signup
[Auth] User created: user_id
[API] Audit started: audit_id
[Crawl] Fetching: https://example.com
```

### Test Different Sites

Try these sites for testing:

| Site | Pages | Time | Notes |
|------|-------|------|-------|
| example.com | ~1 | <30s | Very small, fast |
| github.com | ~50 | ~2m | Medium size |
| wikipedia.org | ~100 | ~5m | Large site |

---

## Next Steps

### Direct audit URLs

Each completed site audit has focused, refresh-safe routes. For `dadaphone.com`, use:

- `/site/dadaphone.com/overview`
- `/site/dadaphone.com/audit`
- `/site/dadaphone.com/pageload`
- `/site/dadaphone.com/action-plan`
- `/site/dadaphone.com/pages`
- `/site/dadaphone.com/changes`
- `/site/dadaphone.com/data-scope`

Selecting a page adds its exact URL as a `page` query parameter to the Pages route, so a page inspection can also be reopened directly.

### Browser performance tests

New HTTP crawls and queued audit jobs default to a maximum depth of 50, with a 500-URL request budget. The local browser-rendered fallback also allows depth 50 but retains its 30-page budget. Existing reports retain the scope recorded when they ran; run a new audit to use the new settings. Depth is a limit on discovery paths, not a guarantee of full-site coverage or a target page count.

New content comparisons use up to 60,000 characters of extracted main text per page, retaining 900-character excerpts for the report. Similarity uses three-word phrase overlap and is a review signal, not a content-quality verdict. Cross-page findings include conflicting canonical targets, two-page canonical loops, source/anchor evidence for links to noindex pages, and pages without incoming links from the inspected set. Links from uninspected pages remain unknown.

The local Vite app runs its own Chromium performance tests; no Google PageSpeed API key is required. The test uses a simulated mobile profile and a desktop profile, records loading timings and request evidence, and identifies real-user metrics as unavailable. Chromium must be installed for Playwright (`npx playwright install chromium`). Local audit jobs survive a page refresh while the development server is running; restarting that server interrupts them.

The API worker can also call the standalone RoundSEO browser runner. Start it with `ROUNDSEO_RUNNER_TOKEN` set to a secret of at least 24 characters, then run `npm run performance:runner`. It listens on `127.0.0.1:8788` by default. To connect a hosted Worker, expose the runner through an authenticated HTTPS endpoint and configure `ROUNDSEO_PERFORMANCE_RUNNER_URL` to its `/audit` URL and `ROUNDSEO_RUNNER_TOKEN` as a Worker secret. Do not expose the unauthenticated development server. The Worker reports the test as unavailable until a runner is configured.

1. ✅ Setup database & start servers
2. ✅ Create account & website
3. ✅ Run first audit
4. 🔄 Check MVP_LAUNCH_CHECKLIST.md for Phase 1-4 roadmap
5. 🚀 When ready to deploy, see QUICKSTART.md (Cloudflare setup)

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Database corrupted | `npm run dev:reset-db` |
| Servers won't start | Check all ports (8787, 5173) are free |
| Slow crawling | Some websites are slow to respond |
| Auth token expired | Logout & login again |
| CORS errors | Check API is running on right port |

---

## Still Stuck?

Check these files:
- `ROUNDSEO_SPECIFICATION.md` - Technical architecture
- `MVP_LAUNCH_CHECKLIST.md` - Feature roadmap
- `src/worker/index.ts` - API server entry point
- `src/worker/api/router.ts` - All API routes

Or check the error logs in Terminal 1 (API server).

---

**Happy developing! 🚀**
