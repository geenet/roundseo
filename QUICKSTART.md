# Quick Start - RoundSEO Local Dev (5 minutes)

This is the **fastest path** to get the API running locally.

---

## Option 1: Use Cloudflare Free Tier (Recommended)

**Why:** This is how Wrangler is designed to work. Cloudflare free tier includes D1.

### Step 1: Create Cloudflare Account (2 min)

```bash
# Go to https://dash.cloudflare.com/sign-up
# Create free account (no credit card needed)
```

### Step 2: Setup Wrangler Authentication (1 min)

```bash
cd /Users/g/code/github/geenet/roundseo
npx wrangler login
# Opens browser to authenticate
# Confirm in browser
```

### Step 3: Create D1 Database

```bash
# Create database on Cloudflare
npx wrangler d1 create roundseo-dev

# You'll see:
# ✅ Successfully created DB 'roundseo-dev'.
# ...
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Step 4: Update wrangler.toml

Copy the `database_id` from above and paste it:

```toml
[env.development]
name = "roundseo-api-dev"

[[env.development.d1_databases]]
binding = "DB"
database_name = "roundseo-dev"
database_id = "PASTE_YOUR_ID_HERE"  # ← FROM STEP 3
```

### Step 5: Run Migrations

```bash
# Apply all database migrations
npx wrangler d1 execute roundseo-dev --file=migrations/001_initial_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/002_crawl_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/003_keywords_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/004_reports_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/005_audit_evidence_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/006_operating_workflow_schema.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/007_finding_evidence.sql --env development
npx wrangler d1 execute roundseo-dev --file=migrations/008_performance_audits.sql --env development
```

### Step 6: Start Dev Server

```bash
# Terminal 1: Start API (Worker)
npm run dev

# Should print:
# ⛅️ wrangler 3.x.x
# ✨ Listening on http://localhost:8787
```

### Step 7: Start React Dev Server (separate terminal)

```bash
# Terminal 2: Start React UI
npm run dev:ui

# Should print:
# Local:   http://localhost:5173/
```

### Step 8: Test

Open http://localhost:5173 in your browser

✅ **Done!** You're running RoundSEO locally.

---

## Option 2: Use Local SQLite (Advanced)

If you don't want to use Cloudflare yet:

1. Install sqlite3: `npm install --save-dev sqlite3`
2. Create local DB: `node scripts/setup-local-db.mjs`
3. Modify `wrangler.toml` to use local bindings (see below)

This is more complex - stick with Option 1 for fastest setup.

---

## Troubleshooting

### "Failed to authenticate"
```bash
# Logout and re-login
npx wrangler logout
npx wrangler login
```

### "Cannot find database_id"
Make sure you:
1. Ran `npx wrangler d1 create roundseo-dev`
2. Copied the database_id correctly
3. Updated `wrangler.toml` in the right environment section

### "API not responding"
1. Make sure `npm run dev` is still running in Terminal 1
2. Check for errors: look at the Terminal 1 output
3. Try: `curl http://localhost:8787/health`

### "React app won't load"
1. Make sure `npm run dev:ui` is running in Terminal 2
2. Make sure port 5173 is not already in use: `lsof -i :5173`
3. Check browser console (F12) for errors

---

## What's Happening

```
Browser (localhost:5173)
    ↓
React App (Vite Dev Server)
    ↓ (API calls to)
API (localhost:8787)
    ↓ (uses)
D1 Database (Cloudflare - but usable locally)
```

---

## Next Steps

1. ✅ Create a user: http://localhost:5173 → Sign Up
2. ✅ Add a website: Create organization → Add site
3. ✅ Run audit: Click "Start Audit"
4. ✅ View results: See score + issues

See `MVP_LAUNCH_CHECKLIST.md` for Phase-by-phase roadmap.

---

**Total time:** ~10 minutes (including Cloudflare signup)  
**Cost:** Free (Cloudflare free tier)
