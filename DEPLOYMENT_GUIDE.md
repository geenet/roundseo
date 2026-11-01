# RoundSEO Deployment Guide

Complete guide to deploy RoundSEO to production on Cloudflare.

## Prerequisites

- Cloudflare account (free or paid)
- Google Cloud project with OAuth credentials
- Node.js 18+ installed
- Git configured
- npm or yarn

## Step 1: Cloudflare Setup

### 1.1 Create D1 Database

```bash
# Install wrangler CLI
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Create D1 database
wrangler d1 create roundseo-prod
```

This will output a database ID. Save it for later.

### 1.2 Create R2 Bucket

```bash
# Create R2 bucket for reports
wrangler r2 bucket create roundseo-reports
```

### 1.3 Create Workers Namespace

In Cloudflare dashboard:
1. Go to Workers & Pages
2. Create application
3. Select "Create Worker"
4. Name: `roundseo-api`

## Step 2: Environment Configuration

### 2.1 Create `.env.production`

```bash
# Copy example to production
cp .env.example .env.production
```

### 2.2 Fill in Production Values

```env
# Cloudflare
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
DATABASE_ID=your-d1-database-id
R2_BUCKET_NAME=roundseo-reports

# Authentication
JWT_SECRET=generate-random-32-char-string
AUTH_SECRET=generate-random-32-char-string

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v2/auth/google/callback

# API Configuration
API_URL=https://api.yourdomain.com
INTERNAL_TOKEN=generate-random-token-for-internal-calls

# Email (optional)
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-key
```

### 2.3 Generate Secure Values

```bash
# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate INTERNAL_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 3: Database Migration

### 3.1 Run Migrations

```bash
# Navigate to project directory
cd /Users/g/code/github/geenet/roundseo

# Run all migrations in order
wrangler d1 execute roundseo-prod --file=migrations/001_initial_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/002_crawl_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/003_keywords_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/004_reports_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/005_audit_evidence_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/006_operating_workflow_schema.sql
wrangler d1 execute roundseo-prod --file=migrations/007_finding_evidence.sql
wrangler d1 execute roundseo-prod --file=migrations/008_performance_audits.sql
# 009 is the historical run-ledger table. Keep its file name so deployed migration history matches.
wrangler d1 execute roundseo-prod --file=migrations/009_dataforseo_runs.sql
wrangler d1 execute roundseo-prod --file=migrations/010_intelligence_platform.sql
wrangler d1 execute roundseo-prod --file=migrations/011_native_intelligence.sql
```

### 3.2 Verify Migrations

```bash
# Check tables were created
wrangler d1 execute roundseo-prod "SELECT name FROM sqlite_master WHERE type='table';"
```

## Step 4: Google OAuth Setup

### 4.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Set authorized redirect URIs:
   - `https://api.yourdomain.com/api/v2/auth/google/callback`
   - `http://localhost:8789/api/v2/auth/google/callback` (for dev)

### 4.2 Get Credentials

From Google Cloud Console:
- Copy Client ID → `GOOGLE_CLIENT_ID`
- Copy Client Secret → `GOOGLE_CLIENT_SECRET`

### 4.3 Connect the RoundSEO browser runner

Run `npm run performance:runner` on a host with Chromium and set a strong `ROUNDSEO_RUNNER_TOKEN` on that host. Expose its `/audit` endpoint over HTTPS, configure `ROUNDSEO_PERFORMANCE_RUNNER_URL` on the Worker, and store the same token as a Worker secret:

```bash
wrangler secret put ROUNDSEO_RUNNER_TOKEN --env production
```

## Step 5: Build & Deploy

### 5.1 Install Dependencies

```bash
npm install
```

### 5.2 Build Project

```bash
npm run build
```

### 5.3 Configure wrangler.toml

Create `wrangler.toml`:

```toml
name = "roundseo-api"
main = "src/worker/index.ts"
compatibility_date = "2024-01-01"
account_id = "your-account-id"

[env.production]
name = "roundseo-api-prod"
routes = [
  { pattern = "api.yourdomain.com/*", zone_id = "your-zone-id" }
]

[[d1_databases]]
binding = "DB"
database_name = "roundseo-prod"
database_id = "your-database-id"

[[r2_buckets]]
binding = "R2"
bucket_name = "roundseo-reports"

[env.production.vars]
JWT_SECRET = "your-jwt-secret"
GOOGLE_CLIENT_ID = "your-client-id"
GOOGLE_CLIENT_SECRET = "your-client-secret"
GOOGLE_REDIRECT_URI = "https://api.yourdomain.com/api/v2/auth/google/callback"
API_URL = "https://api.yourdomain.com"

[env.production.vars.r2_bucket]
name = "roundseo-reports"
```

### 5.4 Deploy Worker

```bash
# Deploy to production
wrangler deploy --env production
```

### 5.5 Test Worker

```bash
# Check health endpoint
curl https://api.yourdomain.com/health

# Should respond with:
# {"status":"ok","timestamp":"2026-10-27T..."}
```

## Step 6: Deploy Mobile App

### 6.1 Configure Expo

Create/update `eas.json`:

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.yourdomain.com",
        "EXPO_PUBLIC_GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com"
      }
    }
  }
}
```

### 6.2 Build for iOS

```bash
eas build --platform ios --profile production
```

### 6.3 Build for Android

```bash
eas build --platform android --profile production
```

### 6.4 Submit to App Stores

```bash
# Submit to Apple App Store
eas submit --platform ios

# Submit to Google Play
eas submit --platform android
```

## Step 7: Web Frontend

### 7.1 Build Web

```bash
npm run build:web
```

### 7.2 Deploy to Cloudflare Pages

```bash
# Install Pages CLI
npm install -g wrangler

# Deploy
wrangler pages deploy dist
```

## Step 8: Verification

### 8.1 Test API Endpoints

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

# Test organizations
curl https://api.yourdomain.com/api/v2/organizations \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 8.2 Test OAuth Flow

1. Navigate to login page
2. Click "Continue with Google"
3. Verify redirect to Google
4. Verify callback to your app
5. Verify token received

### 8.3 Test Database

```bash
# Query users table
wrangler d1 execute roundseo-prod \
  "SELECT COUNT(*) as user_count FROM users;"
```

## Step 9: Monitoring & Logging

### 9.1 Enable Cloudflare Analytics

1. Go to Workers dashboard
2. Click on your worker
3. Enable "Analytics Engine"

### 9.2 Set Up Error Tracking

```bash
# Monitor worker errors
wrangler tail --env production
```

### 9.3 Configure Alerts

In Cloudflare dashboard:
1. Notifications → Create notification
2. Set up alerts for:
   - High error rate
   - Slow response times
   - Database errors

## Step 10: Maintenance

### 10.1 Backup Database

```bash
# Export database
wrangler d1 execute roundseo-prod \
  ".mode csv" ".output backup.csv" \
  "SELECT * FROM users;"
```

### 10.2 Monitor Performance

```bash
# View analytics
wrangler analytics-engine list
```

### 10.3 Update Code

```bash
# Pull latest
git pull origin main

# Deploy new version
npm run build
wrangler deploy --env production
```

### 10.4 Database Maintenance

```bash
# Vacuum database
wrangler d1 execute roundseo-prod "VACUUM;"

# Analyze query performance
wrangler d1 execute roundseo-prod "ANALYZE;"
```

## Rollback Procedure

### If Deployment Fails

```bash
# Rollback to previous version
wrangler rollback --env production

# Or manually redeploy previous commit
git checkout previous-commit-hash
npm run build
wrangler deploy --env production
```

## Troubleshooting

### Issue: Database Connection Fails

**Solution**: Verify DATABASE_ID in wrangler.toml matches created database.

```bash
wrangler d1 list
```

### Issue: OAuth Redirect URI Mismatch

**Solution**: Ensure redirect URI matches exactly in both Google Cloud and .env:

```bash
# In Google Cloud: https://api.yourdomain.com/api/v2/auth/google/callback
# In .env: GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v2/auth/google/callback
```

### Issue: R2 Bucket Access Denied

**Solution**: Check bucket permissions in Cloudflare:

```bash
# Verify bucket exists
wrangler r2 bucket list

# Check binding in wrangler.toml
cat wrangler.toml | grep -A 2 "r2_buckets"
```

### Issue: High Worker Latency

**Solution**: Optimize database queries:

```bash
# Check slow queries
wrangler d1 execute roundseo-prod \
  "SELECT COUNT(*) FROM pages WHERE audit_id = 'slow';" --timing
```

## Performance Optimization

### 1. Enable Caching

Add cache headers to responses:

```typescript
response.headers.set('Cache-Control', 'public, max-age=3600');
```

### 2. Database Optimization

Add indexes for common queries:

```sql
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_audits_status ON audits(status);
```

### 3. R2 Caching

Use CloudFlare Cache to serve reports:

```typescript
response.headers.set('Cache-Control', 'public, max-age=86400');
```

## Security Checklist

- [x] JWT_SECRET is random 32+ characters
- [x] GOOGLE_CLIENT_SECRET is never in version control
- [x] HTTPS is enforced
- [x] CORS headers are restricted
- [x] Rate limiting is enabled
- [x] Database backups configured
- [x] Monitoring alerts set up
- [x] Error logs are reviewed
- [x] API keys are rotated regularly

## Post-Deployment

1. Monitor error rates for 24 hours
2. Verify all endpoints are working
3. Test mobile apps on devices
4. Monitor database performance
5. Set up automated backups
6. Configure monitoring alerts
7. Document any issues
8. Plan scaling strategy

## Support & Updates

- Check Cloudflare status: https://www.cloudflarestatus.com
- Review logs: `wrangler tail --env production`
- Monitor workers: Cloudflare Dashboard → Workers
- Update dependencies: `npm update`

---

**Deployment Status**: ✅ Production Ready
**Last Updated**: 2026-10-27
