# RoundSEO Development Roadmap - Autonomous Build Plan

## Overview
Complete autonomous development of RoundSEO SEO platform using Cloudflare Workers, D1, R2, React Native, and Expo.

## Technology Stack
- **Compute**: Cloudflare Workers (serverless)
- **Database**: D1 (SQLite)
- **Storage**: R2 (for reports, assets, cached crawls)
- **Durable Objects**: Scheduled crawl orchestration
- **Frontend**: React Native + Expo (cross-platform)
- **Web**: React + Vite
- **Auth**: Cloudflare Access + Google OAuth + Email/JWT

## Phase 1: Infrastructure Foundation ⏳ (In Progress)

### Phase 1A: Database & Schema
**Files to Create**:
- `migrations/001_initial_schema.sql` - Core tables
- `migrations/002_auth_schema.sql` - Auth tables
- `migrations/003_crawl_schema.sql` - Crawl data tables
- `migrations/004_reports_schema.sql` - Report tables

**Tables**:
```sql
-- Organizations (agencies)
- organizations (id, name, slug, owner_id, plan, created_at)

-- Teams
- teams (id, org_id, name, created_at)
- team_members (team_id, user_id, role)

-- Users
- users (id, email, name, auth_method, google_id, password_hash, created_at)
- user_sessions (id, user_id, token, expires_at)

-- Websites
- websites (id, org_id, name, domain, url, crawl_schedule, last_crawled_at)

-- Audits
- audits (id, website_id, type, status, started_at, completed_at)

-- Crawl Data
- pages (audit_id, url, status_code, title, meta_description)
- crawl_errors (audit_id, url, error_code, error_message)

-- Metrics
- seo_metrics (audit_id, website_id, score, indexability_score, onpage_score)
- page_metrics (page_id, word_count, h1_count, mobile_score, desktop_score)

-- Keywords & Rankings
- tracked_keywords (id, website_id, keyword, volume, difficulty)
- keyword_rankings (id, keyword_id, rank, traffic, checked_at)

-- Reports
- reports (id, audit_id, type, generated_at, s3_key, share_token)
- recommendations (id, audit_id, category, priority, title, description)
```

### Phase 1B: Authentication System
**Files to Create**:
- `src/worker/auth/index.ts` - Auth handler
- `src/worker/auth/google.ts` - Google OAuth
- `src/worker/auth/jwt.ts` - JWT management
- `src/worker/auth/middleware.ts` - Auth middleware

**Features**:
- Google OAuth signup/login
- Email/password with verification
- JWT token management
- Session handling
- Team invitations

### Phase 1C: Core API Endpoints
**Files to Create**:
- `src/worker/api/organizations.ts` - Org CRUD
- `src/worker/api/teams.ts` - Team management
- `src/worker/api/websites.ts` - Website CRUD
- `src/worker/api/audits.ts` - Audit endpoints

**Endpoints**:
```
POST /api/v2/auth/google - Google OAuth
POST /api/v2/auth/signup - Email signup
POST /api/v2/auth/login - Email login
GET /api/v2/me - Current user
GET /api/v2/organizations - List orgs
POST /api/v2/organizations - Create org
GET /api/v2/organizations/:id/websites - List websites
POST /api/v2/websites/:id/audits - Start audit
GET /api/v2/audits/:id - Get audit results
```

### Phase 1D: Crawler Infrastructure
**Files to Create**:
- `src/worker/crawlers/base.ts` - Base crawler class
- `src/worker/crawlers/parser.ts` - HTML/page parser
- `src/worker/crawlers/metrics.ts` - SEO metrics calculator
- `src/worker/crawlers/scheduler.ts` - Scheduled crawls (Durable Objects)

**Features**:
- Lightweight on-demand crawler
- Full scheduled crawler
- Respect robots.txt
- JavaScript rendering support
- Metrics extraction

### Phase 1E: React Native + Expo Setup
**Files to Create**:
- `app.json` - Expo config
- `eas.json` - EAS build config
- `src/ui/app/(auth)/index.tsx` - Auth screens
- `src/ui/app/(app)/index.tsx` - App screens
- `src/ui/components/auth/` - Auth components

---

## Phase 2: MVP Features 

### Phase 2A: Dashboard & UI
- Organization dashboard
- Website list and management
- Audit results view
- Recommendation center

### Phase 2B: SEO Analysis
- On-page SEO crawling
- Technical SEO metrics
- Indexability checking
- Internal linking analysis
- Page speed analysis

### Phase 2C: Reporting
- Dashboard reports
- PDF export
- Email delivery
- Share links
- Client access

---

## Phase 3: Advanced Features

### Phase 3A: Keyword Tracking
- Keyword rankings
- Rank tracking history
- Rank change alerts
- Keyword grouping

### Phase 3B: Competitor Analysis
- Competitor keyword tracking
- Competitor backlinks
- Content comparison

### Phase 3C: Content Analysis
- Content length analysis
- Readability scores
- Keyword usage
- Entity extraction

---

## Phase 4: Intelligence & Integration

### Phase 4A: AI Recommendations
- ML-based suggestions
- Predictive insights
- Custom metrics

### Phase 4B: Third-Party Integration
- Google Search Console API
- Google PageSpeed API
- Backlink data sources

---

## Development Guidelines

### Code Organization
```
src/
├── worker/
│   ├── auth/         # Authentication
│   ├── api/          # API endpoints
│   ├── crawlers/     # Web crawling
│   ├── schedulers/   # Scheduled jobs
│   ├── services/     # Business logic
│   └── index.ts      # Entry point
├── ui/
│   ├── app/         # Expo app screens
│   ├── components/  # Reusable components
│   ├── hooks/       # Custom hooks
│   ├── lib/         # Utilities
│   └── main.tsx     # Web entry
└── shared/
    ├── contracts.ts # Types
    └── utils/       # Shared utils
```

### Development Workflow
1. Create database migrations
2. Implement API endpoints
3. Build business logic
4. Create UI components
5. Add tests
6. Deploy to staging
7. Test thoroughly
8. Deploy to production

### Commit Strategy
- Commit after each major component
- Use conventional commits (feat:, fix:, refactor:)
- Include Phase in commit message
- Descriptive commit bodies

### Testing
- Unit tests for logic
- E2E tests for flows
- Crawler tests for accuracy
- API tests for endpoints

---

## Deployment Strategy

### Environments
- **Local**: SQLite + localhost
- **Staging**: Cloudflare Workers + D1
- **Production**: Full Cloudflare stack

### Deployment Commands
```bash
npm run deploy:staging   # Deploy to staging
npm run deploy:prod      # Deploy to production
npm run migrate:up       # Run migrations
npm run seed:dev         # Seed dev data
```

---

## Success Criteria

### Phase 1: ✅
- [x] Database schema complete
- [ ] Auth system working
- [ ] API endpoints functional
- [ ] Crawler can parse pages
- [ ] React Native app boots

### Phase 2: 
- [ ] Dashboard displays metrics
- [ ] Can run audits
- [ ] Results are accurate
- [ ] Reports generate
- [ ] Email notifications work

### Phase 3:
- [ ] Keyword tracking works
- [ ] Competitor analysis works
- [ ] Content analysis accurate
- [ ] Historical trending visible

### Phase 4:
- [ ] AI recommendations generated
- [ ] Third-party APIs integrated
- [ ] Advanced analytics available
- [ ] White-label working

---

## Next Steps

1. **Immediate**: Create database schema and migrations
2. **Week 1**: Build authentication system
3. **Week 2**: Implement core API endpoints
4. **Week 3**: Build crawler infrastructure
5. **Week 4**: Create UI components and screens
6. **Week 5+**: Advanced features and integrations

---

**Build Status**: Autonomous development starting Phase 1A
**Last Updated**: 2026-10-27
**Estimated Completion**: Phase 1 (2 weeks), Phase 2 (3 weeks), Phase 3+ (ongoing)
