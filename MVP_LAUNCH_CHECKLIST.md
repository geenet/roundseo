# RoundSEO MVP Launch Checklist

**Target:** Working MVP with Daily Scheduled Audits + Dashboard  
**Stack:** Cloudflare Workers + D1 + R2 + React (Mobile-First)  
**Constraints:** 15-min crawl timeout, 4 parallel workers, Manual + Automatic triggers

---

## Phase 0: Local Dev Setup (Today)

### Prerequisites
- [x] Node.js 18+
- [x] Wrangler installed (`npm ls wrangler`)
- [ ] Cloudflare account (if testing with real D1)

### Setup Steps

**1. Create local D1 database**
```bash
# Create local database
wrangler d1 create roundseo-local --local

# Update wrangler.toml with the database_id returned above
# Under [env.development] section
```

**2. Run migrations**
```bash
# Apply all migrations
wrangler d1 execute roundseo-local --local --file=migrations/001_initial_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/002_crawl_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/003_keywords_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/004_reports_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/005_audit_evidence_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/006_operating_workflow_schema.sql
wrangler d1 execute roundseo-local --local --file=migrations/007_finding_evidence.sql
wrangler d1 execute roundseo-local --local --file=migrations/008_performance_audits.sql
```

**3. Setup environment variables**
```bash
# Copy .env.example to .env
cp .env.example .env

# For local dev, set placeholder values:
echo "GOOGLE_PAGESPEED_API_KEY=test-key-local" >> .env
```

**4. Update wrangler.toml for local dev**
```toml
[env.development]
name = "roundseo-api-dev"

[[env.development.d1_databases]]
binding = "DB"
database_name = "roundseo-local"
database_id = "YOUR_LOCAL_DATABASE_ID"  # from step 1

[[env.development.r2_buckets]]
binding = "R2"
bucket_name = "roundseo-reports-dev"

[env.development.vars]
JWT_SECRET = "dev-secret-key-change-in-production"
API_URL = "http://localhost:8789"
```

**5. Start development server**
```bash
# Terminal 1: Start Wrangler (API Worker)
npm run dev

# Terminal 2: Start Vite (React frontend)
npm run dev:ui
```

---

## Phase 1: Core Functionality (MVP - Week 1)

### Crawling System
- [ ] **Verify crawl worker is operational**
  - Test: `POST http://localhost:8789/api/v2/organizations/:orgId/websites/:websiteId/audits`
  - Should return `{ audit_id, status: 'pending' }`
  
- [ ] **Test crawl timeout (15 minutes max)**
  - Modify `src/worker/crawlers/base.ts` line 44
  - Set timeout: `timeout: options.timeout || 15 * 60 * 1000,`
  - Test with small site (5 pages) first
  
- [ ] **Configure parallel workers**
  - In `wrangler.toml`, update Workers Queue config:
    ```toml
    [[queues.consumers]]
    queue = "roundseo-crawl-jobs"
    max_batch_size = 4  # 4 parallel crawls
    max_retries = 2
    ```

- [ ] **Test end-to-end crawl**
  - Manually trigger audit via API
  - Monitor logs: `wrangler tail`
  - Verify data in D1: `wrangler d1 shell roundseo-local --local`

### Dashboard UI
- [ ] **Complete React Dashboard component**
  - Verify `src/ui/pages/Dashboard.tsx` loads
  - Should show:
    - List of websites
    - Latest audit status
    - Score cards (Technical, On-Page)
    - Top issues (filterable)
  
- [ ] **Implement "Run Audit" button**
  - Calls `POST /api/v2/organizations/:orgId/websites/:websiteId/audits`
  - Shows progress spinner while running
  - Polls `GET /api/v2/organizations/:orgId/websites/:websiteId/audits/:auditId` every 2 seconds
  - Updates dashboard when complete

- [ ] **Mobile-first responsive design**
  - Test on mobile viewport (375px width)
  - Ensure touch-friendly buttons
  - Verify no horizontal scroll

### Authentication
- [ ] **Test signup/login flow**
  - Create test user via `/api/v2/auth/signup`
  - Login via `/api/v2/auth/login`
  - Verify JWT token stored in localStorage
  - Test protected routes (redirect to login if not authenticated)

### Export Functionality
- [ ] **CSV Export**
  - `GET /api/v2/organizations/:orgId/websites/:websiteId/audits/:auditId/export?format=csv`
  - Downloads issues as CSV
  - Columns: URL, Issue Type, Severity, Description

---

## Phase 2: Scheduled Audits (Week 2)

### Daily Automatic Audits
- [ ] **Setup Cron Trigger in Wrangler**
  ```toml
  [triggers]
  crons = ["0 2 * * *"]  # Daily at 2 AM UTC
  ```

- [ ] **Implement Audit Schedule Creation**
  - `POST /api/v2/organizations/:orgId/websites/:websiteId/schedules`
  - Request body: `{ schedule_type: 'daily', frequency: 1, enabled: true }`
  - Should create record in `audit_schedules` table

- [ ] **Implement Scheduler**
  - Modify `src/worker/index.ts` scheduled handler
  - Query `audit_schedules WHERE is_active = TRUE AND next_run_at <= NOW()`
  - Create audit for each website
  - Queue crawl job
  - Update next_run_at (add 1 day for daily)

- [ ] **Test scheduling**
  - Create schedule for a test website
  - Manually trigger: `curl -X POST http://localhost:8789/__scheduled`
  - Verify audit was created and queued

### Manual Audit Triggers
- [ ] **Dashboard button to start audit**
  - Already implemented in Phase 1
  - Should coexist with scheduled audits (idempotency via `idempotencyKey`)

---

## Phase 3: Metrics & Scoring (Week 3)

### Technical Metrics
- [ ] Verify detection of:
  - [ ] HTTP status codes (404, 500, etc.)
  - [ ] Redirect chains
  - [ ] Duplicate title tags
  - [ ] Duplicate meta descriptions
  - [ ] Missing alt text on images
  
  Test: Run audit on test site, verify `technical_issues` table has records

### On-Page Metrics
- [ ] Verify extraction of:
  - [ ] Title length (target: 30-60 chars)
  - [ ] Meta description (target: 120-160 chars)
  - [ ] H1 count (should be 1)
  - [ ] Image count & alt text %
  - [ ] Internal/external link count
  - [ ] Word count
  - [ ] Readability score (Flesch formula)
  
  Test: Run audit, query `onpage_metrics` table, verify all fields populated

### Scoring Algorithm
- [ ] Implement weighted score calculation in `src/worker/crawlers/metrics.ts`
  - Technical (25%): 25 pts max
  - On-Page (25%): 25 pts max
  - Linkage (15%): 15 pts max
  - Performance (35%): 35 pts max (empty for now)
  - Total: 0-100

- [ ] Test scoring:
  - Run audit on site with issues
  - Verify `audits.overall_score` is calculated correctly
  - Verify recommendations are generated

### Recommendations Generation
- [ ] For each detected issue, generate recommendation:
  - Title: "Fix missing alt text on images"
  - Description: "15 images found without alt text"
  - Priority: 'critical' | 'high' | 'medium' | 'low'
  - How to fix: "Add descriptive alt text to all images"
  - Estimated impact: "Improve score by 5 points"

  Store in `recommendations` table

---

## Phase 4: Reporting & Export (Week 4)

### Dashboard Reports
- [ ] **View Audit Results**
  - Display all findings grouped by category
  - Show evidence (affected pages, examples)
  - Mark as "resolved" / "in progress" / "open"

- [ ] **Trend Charts**
  - 30-day score history graph
  - Show how score changes over time
  - Query `audit_history` table

### PDF Export
- [ ] **Generate PDF Report**
  - Endpoint: `GET /api/v2/organizations/:orgId/websites/:websiteId/audits/:auditId/report.pdf`
  - Contents:
    - Executive summary (overall score, top 3 issues)
    - Technical issues breakdown
    - On-page issues breakdown
    - Linkage issues breakdown
    - Page inventory (table of all crawled pages)
  - Store in R2, return signed download URL

- [ ] **Email Report**
  - When audit completes, send summary email to user
  - Include: site name, score, top issues, link to full report
  - Use Mailgun API (or similar)

---

## Testing Checklist

### Unit Tests
- [ ] Scoring algorithm (weights, edge cases)
- [ ] HTML parsing (extract title, meta, headings)
- [ ] URL normalization (trailing slashes, fragments)

### E2E Tests
- [ ] Full audit flow: signup → add website → run audit → view results
- [ ] Scheduled audit: create schedule → verify runs at scheduled time
- [ ] Export: export CSV → verify format → open in Excel

### Performance Tests
- [ ] 50-page site crawl: completes in <15 minutes
- [ ] 4 concurrent crawls: doesn't timeout, all complete successfully
- [ ] Dashboard loads: <2 seconds
- [ ] CSV export: <5 seconds

### Browser Compatibility
- [ ] Chrome (latest)
- [ ] Safari (latest)
- [ ] Firefox (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

---

## Known Issues & Workarounds

### Issue: Wrangler local D1 doesn't persist between runs
**Solution:** Use `--local` flag consistently, or switch to remote D1

### Issue: 15-minute timeout not enough for large sites (500+ pages)
**Solution:** Limit crawl to 50 pages for MVP, add pagination/resumption in Phase 2

### Issue: Duplicate job executions from scheduled audits
**Solution:** Use `idempotencyKey` in audit creation to prevent duplicates

### Issue: Mobile responsive design breaks on very small screens (<320px)
**Solution:** Test on actual devices (iPhone SE, etc.), use CSS media queries

---

## Deployment (When Ready)

### Prerequisites
- [ ] All tests passing
- [ ] No console errors/warnings
- [ ] Wrangler secret set: `wrangler secret put GOOGLE_PAGESPEED_API_KEY`
- [ ] Domain configured in Cloudflare DNS

### Deploy to Production
```bash
# Build
npm run build

# Deploy Worker
wrangler deploy --env production

# Deploy Frontend (if using Cloudflare Pages)
wrangler pages deploy dist --project-name roundseo

# Verify health
curl https://api.yourdomain.com/health
```

---

## Success Metrics

**MVP is ready when:**
- ✅ Can signup and login
- ✅ Can add website and run audit
- ✅ Audit completes in <15 minutes (50 pages)
- ✅ Dashboard shows score + top issues
- ✅ Can export audit as CSV
- ✅ Can schedule daily audits
- ✅ Works on mobile (375px viewport)
- ✅ All 4 workers run in parallel without conflicts

---

**Questions?** Refer to:
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers)
- [D1 Database Docs](https://developers.cloudflare.com/d1)
- [Existing code comments](src/worker/)
