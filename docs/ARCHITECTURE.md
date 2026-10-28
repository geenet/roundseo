# RoundSEO Architecture

## System Overview

RoundSEO is built on a similar architecture to BONA, optimized for SEO inspection and tracking at scale.

## Core Components

### 1. Frontend (React + TypeScript)
- **Pages**: Organization dashboard, websites list, audit results, recommendations, client reports
- **Components**: Metric cards, audit progress, recommendation cards, report builder
- **Charts**: SEO score trends, keyword ranking charts, performance metrics
- **Auth**: Google OAuth, email/password with session management

### 2. Cloudflare Workers Backend
- **REST API**: All data operations (CRUD for websites, audits, reports)
- **Crawl Manager**: Orchestrates on-demand and scheduled crawls
- **Report Generator**: Creates PDF reports and client-facing dashboards
- **Notifications**: Email notifications for completed audits

### 3. Custom Web Crawlers
- **Lightweight Crawler**: For on-demand audits (real-time)
- **Full Crawler**: For scheduled crawls (background processing)
- **Parser**: Extracts SEO metrics from crawled pages
- **JavaScript Renderer**: For SPA/JavaScript-heavy sites

### 4. Database (D1 - SQLite)
- **Schema**: Organizations, teams, websites, audits, crawls, keywords, reports
- **Migrations**: Version-controlled schema changes
- **Performance**: Indexed queries for fast reporting

### 5. Scheduled Crawling System
- **Durable Objects**: Manage scheduled crawl state
- **Cron Triggers**: Schedule crawls at specified intervals
- **Background Processing**: Run crawls without blocking user requests
- **Notification Queue**: Alert users when crawls complete

## Data Flow

### On-Demand Audit
```
User clicks "Audit Now"
  ↓
API request to /api/v2/audits
  ↓
Worker creates audit record (status: pending)
  ↓
Lightweight crawler starts immediately
  ↓
Crawler extracts SEO metrics
  ↓
Results stored in database
  ↓
Frontend polls for completion
  ↓
Display results and recommendations
```

### Scheduled Crawl
```
Scheduled time arrives
  ↓
Durable Object triggers crawl
  ↓
Full crawler runs in background
  ↓
Pages indexed and metrics calculated
  ↓
Database updated
  ↓
Email notification sent to team
```

## Security Architecture

### Authentication
- **Google OAuth**: Preferred (SSO, verified email)
- **Email/Password**: Fallback with email verification
- **JWT Tokens**: API authentication and session management

### Authorization
- **Row-Level Security**: Teams can only see their own websites/audits
- **Role-Based Access**: Admin/Manager/Analyst/Client roles
- **Client Sharing**: Secure token-based report sharing

### Data Protection
- **HTTPS Only**: All traffic encrypted
- **Database Encryption**: D1 provides encryption at rest
- **API Rate Limiting**: Prevent abuse and crawl overload
- **Audit Logging**: Track who accessed what and when

## Scalability Considerations

### Crawling at Scale
- **Distributed Workers**: Multiple workers can run crawls in parallel
- **Crawl Queue**: Manages crawl ordering to avoid site overload
- **Caching**: Cache crawl results for unchanged pages
- **Incremental Updates**: Only crawl changed sections on rescans

### Database Optimization
- **Partitioning**: Separate tables for different audit types
- **Indexing**: Strategic indexes on frequently queried columns
- **Archive**: Old audit data moved to cold storage

### API Performance
- **Response Caching**: Cache metric calculations
- **Pagination**: Limit result set sizes
- **Lazy Loading**: Load reports on demand

## Integration Points

### Third-Party APIs (Future Phases)
- **Google Search Console**: Rankings and click data
- **Google PageSpeed Insights**: Performance metrics
- **Google Analytics**: Traffic and user behavior
- **Link Data Sources**: Backlink information

## Monitoring & Observability

### Metrics to Track
- Audit completion time
- Crawler errors and failures
- API response times
- Database query performance
- User engagement and feature usage

### Logging
- All errors logged with context
- API request/response logging
- Crawler operation logs
- Notification delivery logs

## Deployment Strategy

### Staging Environment
- Separate Workers environment
- Test D1 database
- Full testing before production

### Production Deployment
- Blue-green deployment
- Gradual rollout
- Health checks after deployment
- Rollback capability

## Future Enhancements

### Phase 2 Features
- Keyword ranking tracking
- Competitor analysis
- Backlink monitoring
- Advanced reporting with trends

### Phase 3 Features
- AI-powered recommendations
- Predictive SEO insights
- Custom metric definitions
- Advanced access controls
