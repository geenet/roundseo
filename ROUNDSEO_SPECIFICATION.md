# RoundSEO Comprehensive Specification

**Version:** 1.0  
**Status:** Pivot/Redesign - Complete Feature Set  
**Target Users:** Mixed (Small Business Owners + SEO Agencies)  
**Last Updated:** 2026-10-28

---

## Executive Summary

RoundSEO is an automated SEO audit platform that crawls websites and measures across 8 dimensions of SEO health. The system provides:
- **Simple Dashboard** for business owners (pass/fail scores, top issues)
- **Professional Reports** for agencies (detailed metrics, trend tracking, exportable data)
- **Real-time Crawling** that discovers metrics automatically (no manual setup)

---

## Part 1: Metrics & Measurements

### 1️⃣ PERFORMANCE (PageSpeed & Core Web Vitals)

**What we measure:**
| Metric | Source | Display | Target |
|--------|--------|---------|--------|
| **LCP** (Largest Contentful Paint) | PageSpeed Insights API | seconds | <2.5s (good) |
| **FID** (First Input Delay) | PageSpeed Insights API | milliseconds | <100ms (good) |
| **CLS** (Cumulative Layout Shift) | PageSpeed Insights API | decimal | <0.1 (good) |
| **Page Load Time** | Crawler timing | seconds | <3s |
| **Total Page Size** | Crawler HTTP headers | MB | <5MB |
| **Number of Requests** | Crawler count | count | <80 requests |
| **First Contentful Paint** | PageSpeed Insights API | milliseconds | <1.8s |
| **Time to Interactive (TTI)** | PageSpeed Insights API | seconds | <3.8s |
| **Performance Score** | PageSpeed Insights API | 0-100 | >90 = good |

**How crawler collects:**
- Use Lighthouse API (PageSpeed Insights) for Core Web Vitals
- Browser automation (Puppeteer/Playwright) to measure actual load times
- HTTP headers analysis for resource sizes
- Network waterfall analysis for request count

**Display to users:**
- SMB: "Your site loads in 2.1s (Good ✅) - faster than 78% of websites"
- Agency: Detailed chart showing trends over 30/90 days, broken down by device (mobile/desktop)

---

### 2️⃣ TECHNICAL (Code Health & Errors)

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **JavaScript Errors** | Browser console monitoring | count | 0 errors |
| **404 Errors** | HTTP status codes | list of broken links | 0 pages |
| **403 Forbidden** | HTTP status codes | count & list | 0 pages |
| **500 Server Errors** | HTTP status codes | count & list | 0 pages |
| **Redirect Chains** | Follow all 301/302/307 | longest chain length | <2 redirects |
| **Mixed Content (HTTP/HTTPS)** | Resource protocol check | count | 0 mixed |
| **HTML Validation** | HTML5 validator | error count | 0 errors |
| **CSS Errors** | CSS parser | error count | 0 errors |
| **Orphaned Pages** | No internal/external links to page | count | 0 pages |
| **Duplicate Content (Technical)** | Exact URL duplicates | count | 0 duplicates |
| **Response Time (Server)** | Time to first byte (TTFB) | milliseconds | <600ms |
| **SSL Certificate** | SSL checker | valid/expired/self-signed | valid |
| **Robots.txt** | Parse robots.txt | valid/invalid/missing | present & valid |
| **Sitemap.xml** | Parse sitemap.xml | valid/invalid/missing | present & valid |

**How crawler collects:**
- Browser DevTools Protocol for JavaScript errors
- HTTP status code tracking on every crawled page
- Redirect chain analysis during crawl
- HTML/CSS parsing with standard validators
- SSL certificate verification via OpenSSL

**Display to users:**
- SMB: "No critical errors ✅ | 2 warnings 🟡 (see details)"
- Agency: Filterable table with severity, page affected, how to fix

---

### 3️⃣ ON-PAGE (Page Structure & Meta)

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **Title Tags** | Parse HTML `<title>` | present/length/quality | 30-60 chars, unique |
| **Meta Descriptions** | Parse HTML `<meta name="description">` | present/length | 120-160 chars, unique |
| **H1 Tags** | Count H1 elements | count & content | 1 per page |
| **H2-H6 Structure** | Heading hierarchy analysis | structure diagram | logical flow |
| **Image Alt Text** | Parse img alt attributes | % with alt text | 100% |
| **Image Optimization** | Image size vs dimensions | average size | <200KB per image |
| **Open Graph Tags** | Parse OG meta tags | present/valid | all key OG tags |
| **Twitter Card Tags** | Parse Twitter meta tags | present/valid | all key Twitter tags |
| **Structured Data (Schema.org)** | Parse JSON-LD & microdata | schema types detected | relevant schemas |
| **Canonical Tags** | Parse link rel="canonical" | present/correct | one per page |
| **Internal Links** | Count & analyze href | total count, anchor text quality | >5 internal links |
| **External Links** | Count & check status | total, broken count | quality links only |
| **Keywords in Content** | Simple keyword extraction | primary keyword prominence | in H1, first 100 words |
| **Readability** | Flesch Reading Ease | score | 50-70 (high school level) |
| **Word Count** | Count visible text | words on page | >300 words |

**How crawler collects:**
- DOM parsing for all HTML elements
- Keyword extraction via NLP (simple TF-IDF or keyword library)
- Image analysis via image header reading
- Readability scoring using Flesch Reading Ease formula
- Structured data validation using schema.org validator

**Display to users:**
- SMB: "8/10 pages well-optimized ✅ | Fix missing alt text (2 pages)"
- Agency: Page-by-page checklist with before/after examples, specific recommendations

---

### 4️⃣ ON-PAGE LINKAGE (Internal Structure & Duplication)

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **Pages Crawled** | Count all discovered pages | total count | baseline metric |
| **Crawl Depth** | Max distance from homepage | levels | <4 levels |
| **Orphaned Pages** | Pages with no internal links | list | 0 pages |
| **Duplicate Title Tags** | Group by title | count of duplicates | unique titles |
| **Duplicate Meta Descriptions** | Group by description | count of duplicates | unique descriptions |
| **Duplicate Content (Boilerplate)** | Fuzzy text matching | % similarity threshold | <80% match |
| **URL Parameters** | Identify session/tracking params | count of param variations | clean URLs |
| **Trailing Slashes** | Consistency check | mixed/not mixed | consistent |
| **URL Length** | Analyze URL structure | average/max length | <100 characters |
| **Indexable Pages** | Check robots.txt & meta noindex | count crawlable | maximize indexation |
| **Link Anchor Text Diversity** | Analyze anchor text | top anchor phrases | varied, descriptive |
| **Outbound Link Quality** | Check external link domains | avg domain authority | link to quality sites |
| **Broken Internal Links** | Track 404s on internal refs | count | 0 broken |

**How crawler collects:**
- Graph-based crawl tracking (BFS/DFS from homepage)
- Text similarity hashing (simhash, cosine similarity)
- URL parsing and pattern analysis
- robots.txt and meta tag parsing

**Display to users:**
- SMB: "Site structure is clean ✅ | 14 pages found | All pages reachable"
- Agency: Site structure visualization (tree/graph), heatmap of content similarity, recommended consolidation targets

---

### 5️⃣ OFF-PAGE: BACKLINKS (External Link Profile)

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **Total Backlinks** | Third-party data (Ahrefs-like API) | count | baseline |
| **Referring Domains** | Unique domains with links | count | quality > quantity |
| **Domain Authority of Backlinks** | DA score of linking domains | average DA | >20 DA |
| **Spam Score** | Mozbar/Ahrefs spam analysis | score | <5% spam |
| **Backlink Anchor Text** | Analyze link anchor phrases | top anchors | brand & target KWs |
| **Link Types** | Follow/nofollow, dofollow ratio | % dofollow | >80% dofollow |
| **Link Velocity** | New links gained per month | trend | consistent growth |
| **Broken Backlinks** | Check HTTP status of backlinks | count of 404s | fix/redirect pointing sites |
| **Competitor Backlinks** | Compare to top 3 competitors | gap analysis | benchmark comparison |
| **Link Sources** | Categorize (blogs, directories, news) | breakdown | editorial > directories |

**How crawler collects:**
- Partner API integration (Ahrefs, Moz, Semrush, or your own backlink index)
- Crawl external referring domains for domain metrics
- Anchor text extraction from HTTP Referrer headers (limited, use API)
- Manual backlink discovery via search operators (optional)

**Display to users:**
- SMB: "350 backlinks from 45 sites ✅ | Growing 12/month | All from quality sources"
- Agency: Link profile visualizer, competitor gap analysis, suspicious link detector, disavow list generator

---

### 6️⃣ OFF-PAGE: SEARCH TRAFFIC & RANKINGS

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **Organic Search Traffic** | GSC or third-party API | monthly sessions | baseline |
| **Target Keywords Ranking** | Rank tracking API | avg position | <3 for money KWs |
| **Keyword Visibility** | % of search visibility | score | baseline |
| **Long-tail Keywords** | Low-volume high-conversion KWs | count & traffic | focus area |
| **Keyword Intent Match** | Map keywords to content | alignment % | 100% match |
| **Click-Through Rate (CTR)** | GSC data | CTR % | >5% is good |
| **Impressions vs Clicks** | GSC data | ratio | aim for clicks |
| **Keyword Growth** | New ranking keywords/month | trend | positive trend |
| **Seasonal Trends** | Traffic patterns over time | graph | identify patterns |
| **Featured Snippet Presence** | Rank tracking + SERP analysis | pages with snippets | maximize |
| **Search Visibility vs Competitors** | Ahrefs/Semrush visibility | % gap | benchmark |

**How crawler collects:**
- Google Search Console API (free, owned-site data)
- Rank tracking API (SEMrush, Ahrefs, Moz)
- SERP feature detection (featured snippet, PAA, carousel, etc.)
- Competitor SERP analysis via programmatic scraping

**Display to users:**
- SMB: "Ranking for 127 keywords | Top 10: 23 keywords | Trending up 📈"
- Agency: Keyword dashboard with position tracking, new opportunities, declining rankings alert, intent mapping

---

### 7️⃣ OFF-PAGE: SOCIAL MEDIA PRESENCE

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **Social Media Profiles Found** | URL analysis + API search | count of profiles | all major platforms |
| **Social Followers/Likes** | Platform APIs or scraping | aggregate count | baseline metric |
| **Engagement Rate** | Calculate (likes + comments) / followers | % | >2% is good |
| **Share Button Presence** | Check for social share buttons | present/absent | present on content |
| **Open Graph Tags** | Validate OG tags for sharing | complete/missing | all tags present |
| **Social Mentions** | Monitor brand mentions | count/sentiment | positive trend |
| **Social Referral Traffic** | Analytics integration (GA4) | traffic from social | baseline |
| **Link Presence in Bio** | Check social profile bios | website linked | linked |

**How crawler collects:**
- Social media API integrations (Facebook Graph, Twitter API, LinkedIn, Instagram)
- URL parsing to find social profile links from website
- Sentiment analysis via NLP (optional)
- GA4 API integration for actual referral traffic

**Display to users:**
- SMB: "Found 5 active profiles | 12.5K total followers | Bio links to site ✅"
- Agency: Social audit with profile health score, engagement trends, competitor comparison

---

### 8️⃣ OFF-PAGE: AI ENGINE INDEXING

**What we measure:**
| Metric | How Detected | Display | Target |
|--------|--------------|---------|--------|
| **ChatGPT Knowledge Cutoff Inclusion** | Manual check / API inference | indexed/not indexed | indexed |
| **Perplexity AI Index Status** | Domain check in Perplexity | indexed/not indexed | indexed |
| **Google Gemini Availability** | Domain search in Gemini | indexed/not indexed | indexed |
| **Anthropic Claude Knowledge** | Check Claude's knowledge | indexed/not indexed | indexed |
| **Opt-out Status** | Check robots.txt + meta tags | opted in/out | opted in |
| **Content Freshness for AI** | Last crawl date by AI indexers | date | recent |
| **AI Engine Traffic Attribution** | Direct from analytics | sessions from AI chatbots | baseline |
| **Policy Compliance** | Check terms against AI policies | compliant/non-compliant | compliant |

**How crawler collects:**
- Manual verification + documented lists of AI-indexed sites
- robots.txt analysis (check for AI-specific user agents)
- API calls to AI services (where available)
- Analytics integration to track AI referral traffic
- Monitor public announcements from AI companies on indexed domains

**Display to users:**
- SMB: "Your site is indexed in 4 AI engines ✅ | No opt-out configured | Last updated 15 days ago"
- Agency: AI indexing tracker, opt-out recommendations, opportunity analysis (potential new traffic channel)

---

## Part 2: Display & User Experience

### Dashboard for Small Business Owners (SMB)

**Home / Overview Page:**
```
┌─────────────────────────────────────────┐
│  🔍 ROUNDSEO AUDIT: yoursite.com        │
│  Last scanned: 2 hours ago              │
└─────────────────────────────────────────┘

┌─────────┬─────────┬─────────┬─────────┐
│ OVERALL │TECHNICAL│ON-PAGE │BACKLINKS│
│  SCORE  │  SCORE  │ SCORE  │ SCORE   │
│   78/100│  92/100 │ 68/100 │ 75/100  │
│   Good  │Excellent│  Fair  │  Good   │
└─────────┴─────────┴─────────┴─────────┘

🔴 CRITICAL ISSUES (3)
  • 12 pages with missing alt text
  • Duplicate meta descriptions (8 pages)
  • 1 orphaned page with no links

🟡 WARNINGS (5)
  • 2 redirect chains (should be direct)
  • Page load time: 3.2s (target: <3s)
  • 15 broken internal links

✅ PASSING (12)
  • No JavaScript errors
  • All HTTP 200 responses
  • Valid SSL certificate
  • Robots.txt present
  • Sitemap.xml present
  • All H1 tags present

📈 TRENDING
  • Backlinks: +8 this month 📈
  • Keywords ranking: +3 new keywords
  • Organic traffic: 1,200 visitors last month

[🔧 FIX CRITICAL ISSUES] [📊 DETAILED REPORT]
```

**Per-Category Deep Dive:**
- Click category to see detailed breakdown
- Simple explanations: "This means..." + "How to fix: ..."
- Actionable tasks with priority (P0/P1/P2)
- Links to specific pages needing fixes

### Professional Reports for Agencies

**Report Features:**
1. **Executive Summary** (PDF-able)
   - One-page overview with key metrics
   - Month-over-month comparison
   - Top 3 issues + opportunities

2. **Detailed Metrics Sheets** (per category)
   - Full data export (CSV/Excel)
   - Historical charts (30/90/365 day trends)
   - Comparison to industry benchmarks
   - Competitor benchmark overlay

3. **Issue Tracker**
   - Filterable table (severity, category, page)
   - Custom filters (date, issue type, status)
   - Bulk actions (tag, assign, mark resolved)
   - Export issue list

4. **Scheduled Reports**
   - Weekly/monthly auto-generated reports
   - Email delivery
   - Client portal access
   - White-label option

### Mobile-First Design
- Responsive charts/tables
- Touch-friendly navigation
- Downloadable reports for offline review
- SMS alerts for critical issues (opt-in)

---

## Part 3: Technical Architecture & Blueprint

### System Architecture Overview (Cloudflare)

```
┌─────────────────────────────────────────────────────────────────┐
│                  ROUNDSEO on CLOUDFLARE                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND (React Native / Cloudflare Pages)          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │SMB Dashboard │  │Agency Portal │  │Mobile App    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         CLOUDFLARE WORKERS (TypeScript/REST API)                │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ • POST /audit/start → Creates job & returns job_id        │ │
│ │ • GET /audit/:id → Fetch audit progress & results         │ │
│ │ • GET /site/:domain → Site dashboard data                 │ │
│ │ • POST /report/:audit-id → Generate PDF                   │ │
│ │ • GET /export/:audit-id/:format → CSV/JSON export         │ │
│ │ • Middleware: Auth, CORS, rate limiting                   │ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         ↙                    ↓                      ↘
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ CRAWL WORKER     │  │ METRIC WORKERS   │  │ REPORT WORKER    │
│ (Durable Object) │  │ (Parallel)       │  │                  │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ • Fetch page     │  │ • Performance    │  │ • Aggregate data │
│ • Parse HTML     │  │   metrics        │  │ • Generate PDF   │
│ • Extract links  │  │ • Technical      │  │ • Create CSV     │
│ • Follow crawl   │  │   checks         │  │ • Store in R2    │
│ • Store raw data │  │ • On-page        │  │ • Send email     │
│ • Track progress │  │   analysis       │  │                  │
│   in Durable     │  │ • Content NLP    │  │                  │
│   Object         │  │ • Link analysis  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
         ↓                    ↓                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE D1 (SQLite)                       │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ users | sites | audits | metrics | issues | reports       ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE KV (Cache Layer)                    │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ site_config | crawl_progress | audit_results | user_prefs ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE R2 (Storage)                      │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ /reports/{audit_id}.pdf | /exports/{audit_id}.csv         ││
│  │ /screenshots/{page_url}.png | /raw_crawl/{audit_id}.json   ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│            CLOUDFLARE WORKERS QUEUE (Job Processing)            │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ audit_queue → [crawl_job] → [metric_jobs] → [report_job]  ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Architecture Decisions

**Why Cloudflare for MVP:**
✅ **No servers to manage** - Workers scale automatically  
✅ **Cheap/Free** - Pay only for what you use  
✅ **Global edge** - Users worldwide get fast responses  
✅ **Simple tech stack** - No Docker, no Kubernetes  
✅ **Built-in caching** - KV for instant lookups  
✅ **Durable Objects** - Stateful crawl progress tracking  

**How it works together:**
1. User initiates audit via React frontend
2. POST to Worker API → creates Durable Object instance
3. Durable Object queues crawl jobs to Workers Queue
4. Parallel crawl workers fetch pages, store in D1
5. Metric workers process data & calculate scores
6. Report worker generates PDF, stores in R2
7. Frontend polls progress via GET API
8. User downloads/views results from D1 + R2

### Data Collection Flow (Cloudflare Workers)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER INITIATES AUDIT (React Frontend)                        │
│    POST /api/audit/start { domain: "example.com" }              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. API WORKER Creates Audit Record & Durable Object             │
│    ├─ Create audit record in D1 (status: "running")             │
│    ├─ Generate audit_id                                         │
│    ├─ Instantiate Durable Object (crawl state machine)          │
│    ├─ Queue crawl job to Workers Queue                          │
│    └─ Return audit_id to frontend                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. CRAWL WORKER (from Queue)                                    │
│    [Runs in parallel for 4-8 concurrent crawls]                 │
│    ├─ Dequeue crawl job { audit_id, site_id, domain }          │
│    ├─ Fetch homepage with fetch() API                           │
│    ├─ Parse HTML with Cheerio                                   │
│    ├─ Extract all <a href> links                                │
│    ├─ Filter: internal links only, max 50 pages                 │
│    ├─ For each page:                                            │
│    │  ├─ Fetch page                                             │
│    │  ├─ Record HTTP status, load time                          │
│    │  ├─ Extract: <title>, <meta name="description">           │
│    │  ├─ Extract: <h1>, <h2>, <h3> tags                        │
│    │  ├─ Extract: <img> tags (count, check alt)                 │
│    │  ├─ Extract: <a> tags (internal vs external)              │
│    │  ├─ Extract: <link rel="canonical">                       │
│    │  ├─ Extract: <script>, check for errors (in console logs) │
│    │  ├─ Check for <meta name="robots" content="noindex">      │
│    │  ├─ Parse <script type="application/ld+json">             │
│    │  ├─ Store all data in D1 (crawl_pages table)              │
│    │  └─ Update Durable Object progress                         │
│    │                                                            │
│    └─ When all pages done, mark crawl complete in D1            │
│                                                                 │
│    [Parallel: These run while crawl is happening]               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4A. TECHNICAL METRICS WORKER (After crawl data in D1)           │
│    ├─ Query crawl_pages from D1 for this audit                  │
│    ├─ For each page:                                            │
│    │  ├─ Detect issues:                                         │
│    │  │  ├─ 404 errors → store in technical_issues             │
│    │  │  ├─ 500 errors → store in technical_issues             │
│    │  │  ├─ Redirect chains → detect & warn                    │
│    │  │  ├─ Duplicate titles → group & flag                    │
│    │  │  ├─ Duplicate meta descriptions → flag                 │
│    │  │  ├─ Missing alt text on images → count                 │
│    │  │  └─ SSL issues (HTTPS enforcement) → flag              │
│    │                                                            │
│    └─ Generate technical_score (0-100)                          │
└─────────────────────────────────────────────────────────────────┘
         ↓ (all in parallel)
┌─────────────────────────────────────────────────────────────────┐
│ 4B. ON-PAGE METRICS WORKER (After crawl data in D1)             │
│    ├─ For each crawl_pages record:                              │
│    │  ├─ Analyze title: length (30-60), uniqueness             │
│    │  ├─ Analyze meta desc: length (120-160), uniqueness       │
│    │  ├─ Count H1 (should be 1), H2, H3                        │
│    │  ├─ Count images, calculate % with alt text               │
│    │  ├─ Count internal/external links                         │
│    │  ├─ Count words on page                                    │
│    │  ├─ Calculate readability (Flesch formula)                 │
│    │  ├─ Detect schema types (Article, Product, etc)           │
│    │  ├─ Check Open Graph tags                                 │
│    │  └─ Store in onpage_metrics table                          │
│    │                                                            │
│    └─ Generate onpage_score (0-100)                             │
└─────────────────────────────────────────────────────────────────┘
         ↓ (all in parallel)
┌─────────────────────────────────────────────────────────────────┐
│ 4C. LINKAGE ANALYSIS WORKER (After crawl data in D1)            │
│    ├─ Build graph of pages crawled                              │
│    ├─ Calculate crawl depth (max distance from homepage)        │
│    ├─ Find orphaned pages (no internal links pointing to them)  │
│    ├─ Detect duplicate content:                                 │
│    │  ├─ Hash visible text on each page (simhash)              │
│    │  ├─ Find pages with >80% similar content                  │
│    │  └─ Group into clusters                                    │
│    │                                                            │
│    └─ Store analysis in link_analysis table                     │
└─────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. SCORE AGGREGATION WORKER (After all metrics done)            │
│    ├─ Read all metrics from D1                                  │
│    ├─ Calculate weighted scores:                                │
│    │  ├─ Technical (25%): 25 pts max                           │
│    │  ├─ On-Page (25%): 25 pts max                             │
│    │  ├─ Performance (25%): 25 pts max (Phase 2)               │
│    │  └─ Linkage (15%): 15 pts max                             │
│    │                                                            │
│    ├─ Generate recommendations:                                │
│    │  ├─ For each issue: suggest fix, impact estimate          │
│    │  ├─ Priority: critical, high, medium, low                 │
│    │  └─ Store in recommendations table                         │
│    │                                                            │
│    └─ Update audit record:                                      │
│        ├─ Set overall_score                                     │
│        ├─ Set individual scores                                 │
│        └─ Mark status: "completed"                              │
└─────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. REPORT GENERATION WORKER (Optional, on-demand)               │
│    ├─ Query audit + all metrics from D1                         │
│    ├─ Generate HTML report template                             │
│    ├─ Create PDF (using Playwright/PDF library)                 │
│    ├─ Upload PDF to R2                                          │
│    ├─ Return signed R2 URL                                      │
│    └─ Store report record in D1                                 │
└─────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. FRONTEND POLLS FOR RESULTS                                   │
│    ├─ GET /api/audit/:id (every 2 sec)                        │
│    ├─ Display progress: "Crawling... 12/50 pages"              │
│    ├─ When status = "completed":                                │
│    │  ├─ Stop polling                                           │
│    │  ├─ Display dashboard with scores                          │
│    │  ├─ Show issues list                                       │
│    │  └─ Show "Download PDF" / "Export CSV" buttons             │
│    └─                                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key differences from traditional architecture:**
- ✅ No long-running servers (Workers have 30s timeout, use Durable Objects for state)
- ✅ All workers can run in parallel (multiple audits at once)
- ✅ Progress tracked in Durable Object (not database polling)
- ✅ Results cached in D1 for instant re-access
- ✅ Reports generated on-demand and stored in R2
- ✅ Workers Queue ensures no jobs are lost

### Technology Stack (Cloudflare-First)

**Compute & Orchestration:**
- Cloudflare Workers (TypeScript) - API, crawling, metrics calculation
- Cloudflare Durable Objects (state management, job locks, progress tracking)

**Database:**
- Cloudflare D1 (SQLite) - all structured data (audits, metrics, users)
- Cloudflare KV - cache & quick lookups (site configs, recent results)

**Storage:**
- Cloudflare R2 - audit reports (PDF), exports (CSV), screenshots

**Frontend:**
- React Native (web + mobile apps)
- Cloudflare Pages (host static frontend)
- Wrangler for local dev/deployment

**Crawling & Analysis:**
- Cheerio (HTML parsing - runs in Worker)
- Undici or fetch API (HTTP requests in Worker)
- Lighthouse CI API (PageSpeed data - only for performance metrics in Phase 2)

**Job Queue:**
- Durable Objects (for state) + Workers Queues (FIFO job processing)
- OR Cron triggers in Workers (scheduled audits)

**CI/CD:**
- GitHub Actions → Wrangler deploy
- Automated worker tests

---

### Database Schema (Cloudflare D1 / SQLite)

```sql
-- Users & Sites
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  company TEXT,
  plan TEXT DEFAULT 'free', -- free, pro, agency
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  domain TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  last_audit_id TEXT
);

-- Audits (crawl session)
CREATE TABLE audits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed
  started_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER,
  total_pages_found INTEGER DEFAULT 0,
  pages_crawled INTEGER DEFAULT 0,
  overall_score INTEGER,
  performance_score INTEGER,
  technical_score INTEGER,
  onpage_score INTEGER,
  error_message TEXT
);

-- Raw crawl data (pages discovered)
CREATE TABLE crawl_pages (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id),
  url TEXT NOT NULL,
  status_code INTEGER,
  page_title TEXT,
  page_size_kb INTEGER,
  load_time_ms INTEGER,
  crawled_at INTEGER DEFAULT (unixepoch())
);

-- Performance metrics (per audit, aggregate)
CREATE TABLE performance_metrics (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE REFERENCES audits(id),
  avg_load_time_ms INTEGER,
  total_page_size_kb INTEGER,
  avg_requests INTEGER,
  lcp_ms INTEGER, -- from Lighthouse (Phase 2)
  fid_ms INTEGER,
  cls REAL,
  ttfb_ms INTEGER,
  performance_score INTEGER
);

-- Technical issues detected
CREATE TABLE technical_issues (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id),
  issue_type TEXT NOT NULL, -- js_error, 404, 500, redirect_chain, duplicate_title, etc
  severity TEXT NOT NULL, -- critical, warning, info
  page_url TEXT NOT NULL,
  description TEXT,
  count INTEGER DEFAULT 1,
  first_seen INTEGER DEFAULT (unixepoch())
);

-- On-page analysis (per page)
CREATE TABLE onpage_metrics (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id),
  page_url TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  h1_count INTEGER,
  h1_text TEXT,
  h2_count INTEGER,
  image_count INTEGER,
  images_with_alt INTEGER,
  internal_links INTEGER,
  external_links INTEGER,
  word_count INTEGER,
  readability_score REAL,
  has_schema BOOLEAN,
  schema_types TEXT, -- comma-separated
  canonical_tag TEXT,
  og_tags_count INTEGER
);

-- Link analysis
CREATE TABLE link_analysis (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE REFERENCES audits(id),
  total_pages INTEGER,
  crawl_depth INTEGER, -- max distance from homepage
  orphaned_pages INTEGER,
  duplicate_titles INTEGER,
  duplicate_descriptions INTEGER,
  duplicate_content_groups INTEGER, -- pages with >80% similar content
  avg_internal_links_per_page INTEGER
);

-- Recommendations / Issues to fix
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id),
  category TEXT NOT NULL, -- performance, technical, onpage, linkage
  priority TEXT NOT NULL, -- critical, high, medium, low
  title TEXT NOT NULL,
  description TEXT,
  affected_count INTEGER,
  estimated_impact TEXT,
  how_to_fix TEXT,
  resources_url TEXT,
  status TEXT DEFAULT 'open' -- open, in_progress, resolved
);

-- Report/Export tracking
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id),
  format TEXT NOT NULL, -- pdf, csv, json
  file_path TEXT, -- path in R2
  generated_at INTEGER DEFAULT (unixepoch()),
  file_size_kb INTEGER
);

-- Audit history (for trend tracking - Phase 2)
CREATE TABLE audit_history (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  audit_id TEXT NOT NULL REFERENCES audits(id),
  score_date INTEGER DEFAULT (unixepoch()), -- for charting trends
  overall_score INTEGER,
  performance_score INTEGER,
  technical_score INTEGER,
  onpage_score INTEGER
);
```

**Schema Notes:**
- Using TEXT IDs (ulid/uuid) instead of auto-increment for distributed consistency
- INTEGER timestamps (unixepoch) for SQLite compatibility
- Denormalized scores in audits table for quick dashboard queries
- Recommendations linked to audit for bulk fetching
- Separate `audit_history` for 30/90 day trend charts (add data after each audit)

---

## Part 4: Implementation Roadmap (Cloudflare MVP First)

### Phase 1: Core Platform (Weeks 1-3)
**Deploy on:** Cloudflare Workers + D1 + R2  
**Metrics:** Technical, On-Page (no external APIs)  
**Crawl Limit:** First 50 pages per site, 15 min timeout per crawl

**Build:**
- [ ] D1 database schema setup (migrations)
- [ ] Cloudflare Pages React frontend (login, site list, dashboard)
- [ ] Worker API endpoints
  - POST /api/audit/start (create audit job)
  - GET /api/audit/:id (fetch results)
  - GET /api/site/:domain (dashboard data)
  - GET /api/export/:id (CSV export)
- [ ] Crawl Worker (Durable Object)
  - Fetch pages with fetch API
  - Parse HTML with Cheerio
  - Extract: titles, meta tags, headings, images, links
  - Store in D1 (crawl_pages table)
  - Track progress in Durable Object state
- [ ] Technical Metrics Worker
  - Detect: 404s, 500s, redirects, duplicate titles
  - HTML validation (basic regex)
  - SSL check (basic)
  - Store issues in D1
- [ ] On-Page Worker
  - Analyze: title quality, meta desc, H1, images, alt text
  - Word count, readability (Flesch formula)
  - Schema detection
  - Store metrics in D1
- [ ] Score Calculator
  - Combine all metrics into 0-100 score
  - Generate recommendations
- [ ] Basic Dashboard
  - Score cards (Technical, On-Page)
  - Issue list (filterable)
  - Last audit info
- [ ] CSV Export (D1 → formatted CSV → R2)

**Deliverable:** Working audit for Performance + Technical + On-Page metrics

---

### Phase 2: Linkage Analysis (Weeks 4-5)
**Metrics Added:** On-Page Linkage

**Build:**
- [ ] Link Analysis Worker
  - Graph-based crawl tracking (build sitemap)
  - Detect orphaned pages
  - Find duplicate content (simhash)
  - Calculate crawl depth
- [ ] Site Structure Visualization
  - React component to render site tree/graph
  - Link counts per page
  - Content similarity heatmap
- [ ] Duplicate Content Detection
  - Store page text hashes
  - Find clusters of similar content
  - Recommend consolidation

---

### Phase 3: Performance Metrics (Weeks 6-7)
**Metrics Added:** Performance (PageSpeed)

**Build:**
- [ ] Lighthouse API integration (PageSpeed Insights)
  - Add to crawl worker: call Lighthouse API for each page
  - Extract: LCP, FID, CLS, load time, TTI
  - Store performance_metrics in D1
- [ ] Performance scoring
  - Aggregate Core Web Vitals across pages
  - Calculate avg/worst case
- [ ] Performance troubleshooting
  - Show slowest pages
  - Resource count analysis
  - Recommendations per page

---

### Phase 4: Reporting & Polish (Weeks 8-9)
**Add:** PDF Reports, Email Delivery

**Build:**
- [ ] PDF Report Generator
  - Use Playwright or PDF library in Worker
  - Generate: cover page, summary, issues, pages needing work
  - Upload to R2
  - Return signed URL to user
- [ ] Email notifications
  - Send audit complete notification
  - Include audit summary + link to results
  - Use Mailgun API (free tier)
- [ ] Scheduled audits
  - Allow users to schedule weekly/monthly audits
  - Use Cloudflare Cron Workers

---

### Phase 5: Future - Third-Party APIs
**When ready, add:**
- Backlinks (integrate Ahrefs/Semrush API)
- Search rankings (rank tracking API)
- Google Search Console integration
- Social media APIs
- AI engine indexing checks

**Note:** MVP is fully functional without these. Add them when scaling beyond 50-page crawls.

---

## Part 5: Scoring & Weighting Algorithm

```
OVERALL SCORE = 100 points total

Performance Score (20 points) [25%]
  - Core Web Vitals (LCP/FID/CLS): 8 pts
  - Page Load Time: 6 pts
  - Resource Optimization: 4 pts
  - Server Response Time: 2 pts

Technical Score (25 points) [25%]
  - No JavaScript Errors: 6 pts
  - No HTTP Errors (404/500): 8 pts
  - Valid HTML/CSS: 5 pts
  - SSL/Security: 3 pts
  - Redirect Chains: 2 pts
  - Robots.txt & Sitemap: 1 pt

On-Page Metrics Score (20 points) [25%]
  - Title/Meta Tags: 5 pts
  - Heading Structure: 4 pts
  - Image Optimization: 4 pts
  - Content Quality (word count, readability): 4 pts
  - Structured Data: 3 pts

Linkage Score (15 points) [15%]
  - No Orphaned Pages: 5 pts
  - No Duplicate Content: 5 pts
  - Internal Link Strategy: 5 pts

Off-Page Score (20 points) [10%]
  - Backlink Profile Quality: 8 pts
  - Search Visibility: 7 pts
  - Social/AI Presence: 5 pts

Bonus/Penalties: ±5 points
  - Rapid improvement: +2 to +5 pts
  - Critical security issues: -5 pts
  - Recent penalties detected: -3 pts

EXAMPLE:
Performance: 18/20 (90%)
Technical: 22/25 (88%)
On-Page: 17/20 (85%)
Linkage: 12/15 (80%)
Off-Page: 15/20 (75%)
Bonus: 0

TOTAL = 18 + 22 + 17 + 12 + 15 = 84/100 (B Grade)
```

---

## Part 6: Cloudflare Dev Environment Setup

### Local Development Stack
```
Project Structure:
roundseo/
├── wrangler.toml           # Cloudflare config
├── src/
│   ├── worker/
│   │   ├── api.ts          # Main API handler
│   │   ├── crawl.ts        # Crawl logic
│   │   ├── metrics.ts      # Score calculation
│   │   └── durable.ts      # Durable Object for crawl state
│   │
│   ├── frontend/           # React Native / React app
│   │   ├── pages/
│   │   ├── components/
│   │   └── styles/
│   │
│   └── lib/
│       ├── db.ts           # D1 client
│       ├── storage.ts      # R2 client
│       ├── parsers.ts      # HTML parsing helpers
│       └── metrics.ts      # Scoring algorithms
│
├── schema.sql              # D1 migrations
├── package.json
└── .env.example
```

### Week 1: Foundation & Scaffolding
- [ ] `npm create cloudflare@latest` — scaffold Wrangler project
- [ ] Setup wrangler.toml with:
  - [ ] D1 database binding
  - [ ] R2 storage binding
  - [ ] Workers Queue binding
  - [ ] Durable Object binding
- [ ] Create D1 database locally: `wrangler d1 create roundseo-db`
- [ ] Run schema.sql migrations
- [ ] Setup React frontend in `/src/frontend`
  - [ ] Create pages: Login, Dashboard, Site List
  - [ ] Setup Tailwind CSS
  - [ ] Setup authentication (JWT or session)
- [ ] Create basic Worker API skeleton
  - [ ] POST /api/audit/start
  - [ ] GET /api/audit/:id
  - [ ] GET /api/site/:domain

### Week 2: Core Crawling
- [ ] Implement Crawl Durable Object
  - [ ] State machine: pending → running → complete
  - [ ] Track: pages_crawled, current_page, progress_percent
  - [ ] Fetch homepage with fetch() API
  - [ ] Parse HTML with Cheerio
  - [ ] Queue individual page crawl jobs
- [ ] Implement crawl_pages table storage
  - [ ] Parse & store: URL, status, title, meta, links
  - [ ] Calculate page_size_kb and load_time_ms
- [ ] Setup Durable Object storage
  - [ ] Store crawl state for progress tracking
  - [ ] Allow frontend polling via GET /api/audit/:id
- [ ] Test locally with `wrangler dev`

### Week 3: Metrics Processing
- [ ] Technical Metrics Worker
  - [ ] Detect 404/500 errors
  - [ ] Flag duplicate titles/descriptions
  - [ ] Count issues, store in technical_issues
  - [ ] Score: issues → negative points
- [ ] On-Page Metrics Worker
  - [ ] Title/meta analysis (length, uniqueness)
  - [ ] H1/H2/H3 validation
  - [ ] Image alt text percentage
  - [ ] Word count & readability (Flesch formula)
  - [ ] Schema detection
  - [ ] Store in onpage_metrics
- [ ] Linkage Analysis Worker
  - [ ] Build page graph (BFS from homepage)
  - [ ] Detect orphaned pages
  - [ ] Detect duplicate content (simhash)
  - [ ] Store in link_analysis
- [ ] Score Calculator
  - [ ] Combine scores using weighting formula
  - [ ] Update audit.overall_score
  - [ ] Generate 5-10 top recommendations

### Week 4: Dashboard & Export
- [ ] Dashboard React component
  - [ ] Display overall_score + category scores
  - [ ] Issues list (technical, on-page, linkage)
  - [ ] Filter by severity & category
  - [ ] "Run New Audit" button
- [ ] CSV Export
  - [ ] Query D1 for audit data
  - [ ] Format as CSV (pages, issues, recommendations)
  - [ ] Store in R2, return signed URL
- [ ] Auth & User Management
  - [ ] Signup/login in Worker (hash password with bcrypt)
  - [ ] JWT token creation
  - [ ] Protect API endpoints with auth middleware
  - [ ] Store users in D1

---

## Success Metrics for RoundSEO

**For Platform:**
- ✅ Zero false positives on critical issues (98%+ accuracy)
- ✅ Crawl time: <5 min for 50 pages, <20 min for 500 pages
- ✅ API uptime: 99.9%
- ✅ Metric calculation <30s after crawl completes

**For Users:**
- ✅ SMBs: Can understand issues without SEO knowledge
- ✅ Agencies: Can use data in client reports immediately
- ✅ Actionable: 100% of issues have "how to fix" guidance

---

## Open Questions / Decisions Needed

1. **Crawl Frequency:** How often should we re-audit? (daily, weekly, monthly?)
2. **Historical Data:** How long to keep audit history? (90 days, 1 year, unlimited?)
3. **Third-Party APIs:** Which backlink/rank tracking service to integrate first?
4. **Pricing Model:** Free tier limits? (e.g., 5 sites, 1 audit/month?)
5. **Mobile Crawling:** Separate mobile scores or combined score?
6. **AI Indexing:** Real-time checks or periodic checks?
7. **Competitor Data:** Do we want to offer competitor benchmarking from day 1?

---

## References & Standards

- Google Core Web Vitals: https://web.dev/vitals/
- Schema.org: https://schema.org
- HTML5 Validation: https://validator.w3.org
- Open Graph Protocol: https://ogp.me
- SEO Best Practices: https://developers.google.com/search/docs

---

**Document Status:** Ready for engineering kickoff  
**Next Step:** Prioritize features, assign team, estimate capacity
