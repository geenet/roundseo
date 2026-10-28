# 🚀 RoundSEO Go Live Guide

**Status**: Ready for Production Deployment  
**Date**: 2026-10-27  
**Target**: Cloudflare Infrastructure

---

## Quick Start (30 minutes)

### 1. Prepare Cloudflare (5 min)

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create roundseo

# Create R2 bucket
wrangler r2 bucket create roundseo-reports
```

Save the Database ID from output.

### 2. Configure wrangler.toml (5 min)

Edit `wrangler.toml`:

```toml
account_id = "YOUR_ACCOUNT_ID"        # From Cloudflare dashboard
zone_id = "YOUR_ZONE_ID"              # From Cloudflare dashboard
database_id = "DATABASE_ID"           # From d1 create output

[env.production.vars]
JWT_SECRET = "RANDOM_32_CHARS"
GOOGLE_CLIENT_ID = "FROM_GOOGLE_CLOUD"
GOOGLE_CLIENT_SECRET = "FROM_GOOGLE_CLOUD"
GOOGLE_REDIRECT_URI = "https://api.yourdomain.com/api/v2/auth/google/callback"
API_URL = "https://api.yourdomain.com"
```

### 3. Deploy (10 min)

```bash
# Build
npm install
npm run build

# Deploy
wrangler deploy --env production
```

### 4. Run Migrations (5 min)

```bash
# Apply all migrations
wrangler d1 execute roundseo --env production --file=migrations/001_initial_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/002_crawl_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/003_keywords_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/004_reports_schema.sql
```

### 5. Verify (5 min)

```bash
# Test health endpoint
curl https://api.yourdomain.com/health

# Should respond with:
# {"status":"ok","timestamp":"..."}
```

**Done!** 🎉

---

## Detailed Deployment Steps

### Step 1: Google Cloud Setup (15 min)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project: "RoundSEO"
3. Enable APIs:
   - Google+ API
   - PageSpeed Insights API
4. Create OAuth credentials:
   - Type: Web application
   - Authorized redirect URIs:
     - `https://api.yourdomain.com/api/v2/auth/google/callback`
5. Create API key for PageSpeed

**Save**: Client ID, Client Secret, API Key

### Step 2: Cloudflare Setup (20 min)

```bash
# Install and login
npm install -g wrangler
wrangler login

# Get account info
wrangler whoami  # Shows Account ID

# Create database
wrangler d1 create roundseo
# Saves database_id

# Create bucket
wrangler r2 bucket create roundseo-reports

# List resources
wrangler d1 list
wrangler r2 bucket list
```

### Step 3: Configure Project (10 min)

**Edit wrangler.toml:**

```bash
# Replace these values:
account_id = "YOUR_ACCOUNT_ID"
zone_id = "YOUR_ZONE_ID"
database_id = "YOUR_DB_ID"

# Generate secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output goes into JWT_SECRET

# Add Google credentials
GOOGLE_CLIENT_ID = "..."
GOOGLE_CLIENT_SECRET = "..."
```

### Step 4: Build & Deploy (10 min)

```bash
# Install dependencies
npm install

# Build
npm run build

# Deploy worker
wrangler deploy --env production

# Deploy to staging first (recommended)
wrangler deploy --env staging
```

### Step 5: Database Setup (10 min)

```bash
# Run migrations in order
wrangler d1 execute roundseo --env production --file=migrations/001_initial_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/002_crawl_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/003_keywords_schema.sql
wrangler d1 execute roundseo --env production --file=migrations/004_reports_schema.sql

# Verify
wrangler d1 execute roundseo --env production "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table';"
# Should show: table_count = 30+
```

### Step 6: API Testing (10 min)

```bash
# Test health
curl https://api.yourdomain.com/health

# Test signup
curl -X POST https://api.yourdomain.com/api/v2/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User",
    "password": "TestPassword123"
  }'

# Should return auth token
```

### Step 7: Mobile App Deployment

```bash
# Build iOS
eas build --platform ios --profile production

# Build Android
eas build --platform android --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

### Step 8: Web App Deployment

```bash
# Build
npm run build:web

# Deploy to Cloudflare Pages
wrangler pages deploy dist
```

### Step 9: Monitoring Setup

```bash
# Enable logging
wrangler tail --env production

# Watch for errors
# Monitor Cloudflare Analytics dashboard
```

---

## Architecture After Go Live

```
Users
  ↓
iOS/Android App (Expo)
  ↓
https://api.yourdomain.com
  ↓
Cloudflare Worker (Worker)
  ↓
D1 Database (SQLite)
R2 Storage (Reports)
Durable Objects (Scheduling)
  ↓
Google APIs (OAuth, PageSpeed)
```

---

## What Gets Deployed

### Backend
- ✅ Worker API (20+ endpoints)
- ✅ Authentication system
- ✅ Web crawler
- ✅ Report generation
- ✅ Monitoring & logging

### Database
- ✅ 30+ tables
- ✅ Proper indexes
- ✅ Relationships
- ✅ Seed data (optional)

### Frontend
- ✅ React Native app (iOS/Android)
- ✅ Web app (React)
- ✅ 10+ screens
- ✅ Authentication flow

### Services
- ✅ Google OAuth
- ✅ Google PageSpeed API
- ✅ Email notifications
- ✅ Report sharing

---

## Verification Checklist

After deployment, verify:

- [ ] Health endpoint responds: `curl https://api.yourdomain.com/health`
- [ ] Can signup: `POST /api/v2/auth/signup`
- [ ] Can login: `POST /api/v2/auth/login`
- [ ] Can create org: `POST /api/v2/organizations`
- [ ] Database has tables: `wrangler d1 execute roundseo --env production "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table';"`
- [ ] Logs show requests: `wrangler tail --env production`
- [ ] No errors in Cloudflare dashboard
- [ ] HTTPS working
- [ ] Mobile app connects

---

## Monitoring Commands

```bash
# Live logs
wrangler tail --env production

# Database query
wrangler d1 execute roundseo --env production "SELECT COUNT(*) FROM users;"

# List routes
wrangler routes list

# Analytics
wrangler analytics-engine list
```

---

## Troubleshooting

### "Database not found"
```bash
wrangler d1 list
# Verify database_id in wrangler.toml
```

### "OAuth redirect mismatch"
- Check Google Cloud OAuth settings
- Verify GOOGLE_REDIRECT_URI in wrangler.toml
- Should be: `https://api.yourdomain.com/api/v2/auth/google/callback`

### "Worker deploy failed"
```bash
# Check build
npm run build

# Check configuration
cat wrangler.toml

# Try again
wrangler deploy --env production
```

### "Migration failed"
```bash
# Check database exists
wrangler d1 list

# Run migration with details
wrangler d1 execute roundseo --env production --file=migrations/001_initial_schema.sql
```

---

## Post-Launch Tasks

### Day 1
- [ ] Monitor error rates
- [ ] Test all endpoints
- [ ] Verify database working
- [ ] Check logs for issues

### Week 1
- [ ] Monitor performance
- [ ] Collect user feedback
- [ ] Fix any issues
- [ ] Optimize slow queries

### Month 1
- [ ] Monitor costs
- [ ] Check scaling needs
- [ ] Optimize performance
- [ ] Plan improvements

---

## Rollback Plan

If something goes wrong:

```bash
# Stop accepting traffic
wrangler publish --route 'api.yourdomain.com/*' --status 503

# Rollback to previous version
# Redeploy previous commit
git checkout HEAD~1
npm run build
wrangler deploy --env production

# Or restore from backup
# See DEPLOYMENT_GUIDE.md for backup restore
```

---

## Support & Monitoring

### Logs
```bash
wrangler tail --env production
```

### Alerts
- Set up Cloudflare alerts
- Monitor error rates
- Monitor response times
- Monitor database CPU

### Status
- Status page: https://status.yourdomain.com
- Cloudflare dashboard: https://dash.cloudflare.com
- Worker logs: `wrangler tail --env production`

---

## Success Metrics

✅ **You're live when:**
- API responds to health check
- Authentication works
- Database operational
- Mobile apps connect
- No critical errors
- Performance acceptable

---

## Next Steps

1. **Monitor** - Watch logs and errors for 24 hours
2. **Optimize** - Improve slow endpoints
3. **Scale** - Add more workers if needed
4. **Iterate** - Add features based on feedback
5. **Maintain** - Regular backups and updates

---

## 📞 Need Help?

- **Deployment Issues**: See DEPLOYMENT_GUIDE.md
- **Architecture**: See PROJECT_COMPLETION_SUMMARY.md
- **Monitoring**: See FINAL_STATUS.md
- **Troubleshooting**: See DEPLOYMENT_CHECKLIST.md

---

**Status**: 🚀 Ready to Go Live  
**Estimated Time**: 1-2 hours for complete deployment  
**Complexity**: Medium (straightforward with checklist)  
**Risk Level**: Low (staging environment recommended first)

Good luck! 🎉
