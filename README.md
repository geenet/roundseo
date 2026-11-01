# RoundSEO

SEO inspection, tracking, and optimization recommendations platform for agencies managing multiple websites.

## Overview

RoundSEO is a comprehensive SEO management platform that helps digital agencies:
- **Inspect & Audit**: Real-time and scheduled SEO audits with custom crawlers
- **Track Rankings**: Monitor keyword rankings and SEO performance over time
- **Get Recommendations**: Actionable on-page and off-page optimization suggestions
- **Manage Teams**: Multi-user teams with role-based access control
- **Client Reporting**: Professional client-facing reports and dashboards
- **Multi-Site**: Manage multiple client websites from a single account

## Architecture

Similar stack to BONA:
- **Frontend**: React + TypeScript with React Native Web
- **Backend**: Cloudflare Workers (serverless)
- **Database**: D1 (SQLite on Cloudflare) + Durable Objects
- **Crawling**: Custom web crawler + scheduled crawl system
- **API**: REST API for all data operations

## Key Features

### MVP (Phase 1) - Core SEO Metrics
- **On-page SEO**: Title tags, meta descriptions, heading hierarchy, keyword usage
- **Technical SEO**: Mobile-friendliness, page speed, Core Web Vitals, robots.txt, XML sitemap
- **Indexability**: Meta robots, canonicals, noindex detection, crawl errors
- **Internal Linking**: Link structure analysis, orphaned pages, anchor text quality
- **Basic Reporting**: Dashboard overview, recommendations dashboard, audit reports

### Phase 2 - Advanced Features
- **Keyword Tracking**: Monitor keyword rankings across search engines
- **Competitor Analysis**: Track competitor keywords and backlinks
- **Backlink Tracking**: Monitor referring domains and link quality
- **Content Analysis**: Content length, readability, entity optimization
- **Advanced Reporting**: Client-facing PDFs, scheduled reports, trend analysis

## Technology Stack

### Core
- Node.js 18+
- TypeScript
- React 18
- Cloudflare Workers
- D1 (SQLite)
- Durable Objects (for scheduled crawls)

### Build & Tools
- Vite (bundler)
- Vitest (unit tests)
- Playwright (E2E tests)
- Wrangler (Cloudflare CLI)

### Authentication
- Google OAuth SSO
- Email/password with JWT
- Team-based access control

### RoundSEO Intelligence API

RoundSEO collects and analyzes its own search intelligence: SERP snapshots,
keyword and market analysis, app-store visibility, answer-engine sampling,
and page inspection and crawls. Runs and their evidence are scoped to a
website and stored in D1. Each action reports its own availability, and any
metric without a configured source is returned as unavailable rather than
estimated. See [`docs/INTELLIGENCE_API.md`](docs/INTELLIGENCE_API.md) for the
endpoints and sources, or the
[`OpenAPI 3.1 contract`](docs/openapi/intelligence.yaml) for generated clients.

## Project Structure

```
roundseo/
├── src/
│   ├── ui/                 # React frontend
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable components
│   │   ├── charts/        # SEO metric visualizations
│   │   ├── lib/           # Utilities, API client, routing
│   │   └── styles/        # Global styles
│   ├── worker/            # Cloudflare Workers backend
│   │   ├── api/          # API endpoints
│   │   ├── crawlers/     # Web crawling logic
│   │   ├── schedulers/   # Scheduled crawl management
│   │   └── handlers/     # Request handlers
│   ├── shared/            # Shared types and contracts
│   │   ├── contracts.ts  # API contracts
│   │   ├── crawl-types.ts # Crawling types
│   │   └── seo-metrics.ts # SEO metric definitions
│   └── migrations/        # Database migrations
├── tests/
│   ├── unit/             # Unit tests
│   ├── e2e/              # End-to-end tests
│   └── crawlers/         # Crawler tests
├── docs/                 # Documentation
├── migrations/           # D1 migrations
├── package.json
├── wrangler.jsonc        # Workers config
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm
- Cloudflare account
- wrangler CLI

### Installation

```bash
# Clone and setup
git clone https://github.com/geenet/roundseo.git
cd roundseo
npm install

# Configure environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your configuration

# Run locally
npm run dev

# Build for production
npm run build

# Deploy to Cloudflare
npm run deploy
```

## Development

### Running Tests
```bash
npm run test:unit          # Unit tests
npm run test:e2e          # E2E tests
npm run test:crawlers     # Crawler tests
npm run test:regression   # Regression suite
```

### Code Quality
```bash
npm run check             # UI/platform guards and TypeScript across all source files
npm run build             # Production build
```

## Data Model

### Core Entities
- **Organizations**: Account holder (agency)
- **Teams**: Team within organization with role-based access
- **Websites**: Client websites managed by organization
- **Audits**: SEO audit results (on-demand or scheduled)
- **Crawls**: Individual website crawl data
- **Rankings**: Keyword ranking tracking
- **Recommendations**: Generated SEO recommendations

## API Design

RESTful API following BONA patterns:
- `/api/v2/organizations/` - Organization management
- `/api/v2/teams/` - Team management
- `/api/v2/websites/` - Website management
- `/api/v2/audits/` - SEO audits
- `/api/v2/crawls/` - Crawl data
- `/api/v2/recommendations/` - SEO recommendations
- `/api/v2/reports/` - Report generation

## Authentication & Authorization

### Auth Methods
- Google OAuth (primary)
- Email/password with email verification
- Team invitations

### Role-Based Access
- **Admin**: Full access to organization
- **Manager**: Can manage websites and teams
- **Analyst**: View-only access with reporting
- **Client**: View own reports (client-facing)

## Crawling Strategy

### On-Demand Crawls
- User initiates audit
- Returns results in real-time
- Stores crawl data for future comparisons

### Scheduled Crawls
- Configurable per website (daily/weekly/monthly)
- Uses Durable Objects for persistence
- Background processing with results notifications

### Crawler Features
- Respects robots.txt and crawl delays
- JavaScript rendering support (for SPA sites)
- Link following and depth limits
- Data extraction and validation

## Reporting & Clients

### Dashboard Views
- Organization overview (all websites)
- Website dashboard (specific site metrics)
- Recommendation center (prioritized actions)
- Keyword rankings (tracked keywords)

### Client Reports
- Professional PDF reports
- Email delivery scheduling
- Shareable report links
- White-label options

## Security

- OAuth for authentication
- JWT for API access
- Team-based row-level security
- Data encryption at rest and in transit
- Regular security audits

## Performance

- Lazy-loaded components
- Cached crawl data
- Optimized database queries
- CDN delivery via Cloudflare
- Scheduled crawls run during off-peak hours

## Contributing

Follows same conventions as BONA project.

## License

Proprietary - GeeNet 2026

## Support

For questions or issues, contact: support@roundseo.com
