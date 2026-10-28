# RoundSEO Deployment Checklist

Complete this checklist before going live with RoundSEO.

## ✅ Pre-Deployment (Week 1)

### Cloudflare Setup
- [ ] Create Cloudflare account
- [ ] Add domain to Cloudflare
- [ ] Update nameservers (or CNAME)
- [ ] Enable SSL/TLS (Full)
- [ ] Create D1 database (`roundseo`)
- [ ] Create R2 bucket (`roundseo-reports`)
- [ ] Note down Account ID, Zone ID, Database ID

### Google OAuth Setup
- [ ] Create Google Cloud project
- [ ] Enable Google+ API
- [ ] Create OAuth 2.0 credentials
- [ ] Set authorized redirect URIs:
  - `https://api.yourdomain.com/api/v2/auth/google/callback`
- [ ] Note Client ID and Client Secret
- [ ] Enable Google PageSpeed Insights API
- [ ] Generate PageSpeed API key

### Local Development
- [ ] Install Node.js 18+
- [ ] Install wrangler CLI: `npm install -g wrangler`
- [ ] Authenticate: `wrangler login`
- [ ] Clone RoundSEO repository
- [ ] Run `npm install`
- [ ] Run `npm run build`
- [ ] Run tests: `npm run test:unit`

## ✅ Configuration (Week 1)

### wrangler.toml Setup
- [ ] Update `account_id` with your Cloudflare Account ID
- [ ] Update `zone_id` with your Zone ID
- [ ] Update all `YOUR_*` placeholders
- [ ] Update domain in routes
- [ ] Update `database_id` for your D1 database
- [ ] Set `JWT_SECRET` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Set `AUTH_SECRET` (generate random value)
- [ ] Set `GOOGLE_CLIENT_ID` from Google Cloud
- [ ] Set `GOOGLE_CLIENT_SECRET` from Google Cloud
- [ ] Set `API_URL` to your domain

### Environment Variables
- [ ] Create `.env.production` file
- [ ] Copy all vars from `.env.example`
- [ ] Fill in all production values
- [ ] **DO NOT commit .env file**
- [ ] Verify no secrets in version control

### Database Preparation
- [ ] Back up production database (if existing)
- [ ] Test migrations locally:
  ```bash
  wrangler d1 execute roundseo --file=migrations/001_initial_schema.sql
  ```
- [ ] Verify schema in local D1

## ✅ Deployment (Week 2)

### Build & Deploy
- [ ] Run final tests: `npm run test:unit`
- [ ] Run build: `npm run build`
- [ ] Check for errors/warnings
- [ ] Make deploy script executable: `chmod +x scripts/deploy.sh`
- [ ] Run deployment: `./scripts/deploy.sh`
- [ ] Select "production" environment
- [ ] Verify successful deployment

### Database Migrations
- [ ] Run migration 001: `wrangler d1 execute roundseo --env production --file=migrations/001_initial_schema.sql`
- [ ] Run migration 002: `wrangler d1 execute roundseo --env production --file=migrations/002_crawl_schema.sql`
- [ ] Run migration 003: `wrangler d1 execute roundseo --env production --file=migrations/003_keywords_schema.sql`
- [ ] Run migration 004: `wrangler d1 execute roundseo --env production --file=migrations/004_reports_schema.sql`
- [ ] Run migration 005: `wrangler d1 execute roundseo --env production --file=migrations/005_audit_evidence_schema.sql`
- [ ] Run migration 006: `wrangler d1 execute roundseo --env production --file=migrations/006_operating_workflow_schema.sql`
- [ ] Run migration 007: `wrangler d1 execute roundseo --env production --file=migrations/007_finding_evidence.sql`
- [ ] Run migration 008: `wrangler d1 execute roundseo --env production --file=migrations/008_performance_audits.sql`
- [ ] Verify tables created:
  ```bash
  wrangler d1 execute roundseo --env production "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table';"
  ```

### API Verification
- [ ] Test health endpoint: `curl https://api.yourdomain.com/health`
- [ ] Test signup endpoint
- [ ] Test login endpoint
- [ ] Test OAuth callback
- [ ] Test create organization
- [ ] Test website CRUD
- [ ] Check response times
- [ ] Monitor error logs

### SSL/TLS
- [ ] Verify HTTPS is enforced
- [ ] Check SSL certificate validity
- [ ] Test with `curl -v https://api.yourdomain.com/health`
- [ ] Verify no mixed content warnings

## ✅ Monitoring Setup (Week 2)

### Cloudflare Analytics
- [ ] Enable Analytics Engine
- [ ] Enable Web Analytics
- [ ] Set up email notifications
- [ ] Configure alert thresholds:
  - High error rate (>5%)
  - Slow response time (>5s)
  - Database errors

### Logging
- [ ] Test logs: `wrangler tail --env production`
- [ ] Verify error logging
- [ ] Check request logging
- [ ] Test database query logging

### Health Checks
- [ ] Database health check working
- [ ] R2 bucket accessible
- [ ] Email service ready (optional)

## ✅ Mobile App Deployment (Week 3)

### iOS App
- [ ] Build iOS app: `eas build --platform ios --profile production`
- [ ] Test on physical device
- [ ] Submit to Apple App Store
- [ ] Wait for review approval
- [ ] Release to App Store

### Android App
- [ ] Build Android app: `eas build --platform android --profile production`
- [ ] Test on physical device
- [ ] Submit to Google Play Store
- [ ] Wait for review approval
- [ ] Release to Play Store

### Web App
- [ ] Build web app: `npm run build:web`
- [ ] Deploy to Cloudflare Pages
- [ ] Test all features
- [ ] Verify API connectivity
- [ ] Test OAuth flow

## ✅ Security Verification (Before Launch)

### API Security
- [ ] HTTPS enforced
- [ ] CORS headers configured
- [ ] Rate limiting working
- [ ] JWT validation working
- [ ] Password hashing verified
- [ ] Session timeout configured

### Data Security
- [ ] Database backed up
- [ ] Backups automated
- [ ] Encryption at rest enabled
- [ ] Encryption in transit enabled
- [ ] Access logs enabled

### Third-Party Integration
- [ ] Google OAuth verified
- [ ] Google PageSpeed API working
- [ ] API keys rotated
- [ ] No keys in logs

## ✅ Performance Verification

### Response Times
- [ ] Health check: <100ms
- [ ] Auth endpoints: <500ms
- [ ] API endpoints: <1s
- [ ] Database queries: <500ms
- [ ] Large crawls: <30s

### Load Testing (Optional)
- [ ] Load test with artillery
- [ ] Test with 100+ concurrent users
- [ ] Monitor memory usage
- [ ] Monitor CPU usage
- [ ] Check for memory leaks

## ✅ Documentation & Knowledge Transfer

### Documentation
- [ ] Verify all docs are up-to-date
- [ ] Create runbook for common tasks
- [ ] Document emergency procedures
- [ ] Document scaling procedures
- [ ] Create troubleshooting guide

### Team Training
- [ ] Brief team on deployment
- [ ] Document access procedures
- [ ] Create admin guide
- [ ] Set up on-call rotation
- [ ] Document escalation procedures

## ✅ Launch Preparation (Day Before)

### Final Checks
- [ ] Run full test suite
- [ ] Verify all integrations
- [ ] Check monitoring alerts
- [ ] Verify backup procedures
- [ ] Check disaster recovery plan

### Communication
- [ ] Notify team of launch
- [ ] Prepare launch announcement
- [ ] Set up status page
- [ ] Prepare support docs
- [ ] Configure support channels

### Rollback Plan
- [ ] Document rollback steps
- [ ] Test rollback procedure
- [ ] Prepare rollback script
- [ ] Identify rollback triggers
- [ ] Brief team on rollback

## ✅ Launch Day

### Deployment Window
- [ ] Schedule maintenance window
- [ ] Notify users (if applicable)
- [ ] Monitor closely
- [ ] Have team on standby
- [ ] Document any issues

### Go Live
- [ ] Execute deployment
- [ ] Verify all systems operational
- [ ] Test critical paths
- [ ] Monitor error rates
- [ ] Monitor performance

### Post-Launch
- [ ] Monitor for 24 hours
- [ ] Check logs regularly
- [ ] Monitor error rates
- [ ] Collect initial feedback
- [ ] Document lessons learned

## ✅ Post-Launch (Week 4)

### Monitoring
- [ ] Daily error rate checks
- [ ] Daily performance checks
- [ ] Weekly backup verification
- [ ] Monthly security audit
- [ ] Quarterly full audit

### Optimization
- [ ] Analyze usage patterns
- [ ] Optimize slow queries
- [ ] Reduce error rates
- [ ] Improve performance
- [ ] Enhance security

### Maintenance
- [ ] Keep dependencies updated
- [ ] Rotate security keys
- [ ] Monitor costs
- [ ] Plan scaling
- [ ] Update documentation

## ✅ Success Criteria

Launch is successful when:
- [x] API responding to requests
- [x] Database operational
- [x] Authentication working
- [x] Mobile apps accessible
- [x] No critical errors
- [x] Performance acceptable
- [x] Security verified
- [x] Team trained
- [x] Monitoring active
- [x] Backups configured

---

## 📞 Support Contacts

**On-Call**: [contact info]  
**Escalation**: [contact info]  
**Status Page**: https://status.yourdomain.com  
**Support Email**: support@yourdomain.com

---

## 🆘 Emergency Procedures

### If API is down:
1. Check Cloudflare status
2. Check wrangler logs
3. Check database status
4. Check R2 status
5. Rollback to last working version

### If database is down:
1. Check database status in Cloudflare
2. Try to connect manually
3. Check backups
4. Restore from backup if needed

### If high error rate:
1. Check logs for errors
2. Identify affected endpoints
3. Check third-party services
4. Scale workers if needed
5. Rollback if necessary

---

**Deployment Target**: Production Cloudflare  
**Launch Date**: [DATE]  
**Checklist Version**: 1.0  
**Last Updated**: 2026-10-27
