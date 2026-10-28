# SEO Implementation Phase Guides

**Framework:** Google SEO Specification (2026-10-28)  
**Status:** Phase 1 infrastructure complete

---

## Phase 1: Inventory and Baseline ✅ IN PROGRESS

**Duration:** 2-3 weeks  
**Owner:** Product + Engineering  
**Success criteria:** Complete inventory with explicit states, no conflicts

### Phase 1 Deliverables

#### 1. **Route and Template Inventory**

Complete the page inventory in `src/seo/inventory.ts`:

- [ ] Home page
- [ ] About/company pages
- [ ] Product/service pages
- [ ] Blog/content pages
- [ ] Authentication routes (mark `private`)
- [ ] Admin section (mark `private`)
- [ ] API endpoints (decide index/noindex/gone)
- [ ] Search results (usually `noindex`)
- [ ] Filters/facets (decide per facet)
- [ ] Error pages (404, 500 - decide state)

**For each page, record:**
- Unique page ID
- Live URL pattern
- Purpose and audience task
- Who owns this page
- Publication date (if applicable)
- Intended indexing state
- Preferred canonical URL

**Tool:** Use the `validateInventory()` function to check:

```bash
npm test src/seo/__tests__/seo.test.ts
```

#### 2. **Raw/Rendered Content Snapshots**

Create a snapshot folder for representative pages:

```
/docs/seo-snapshots/
  /2026-10-28/
    home-raw.html
    home-rendered.html
    about-raw.html
    about-rendered.html
    blog-article-raw.html
    blog-article-rendered.html
```

**How to collect:**
1. Curl the raw HTML: `curl -A "Mozilla/5.0" https://example.com/page > page-raw.html`
2. Load in browser, wait for JS to finish, save: `CMD+S` or `Page Source with Rendering`
3. Compare text content, metadata, and structure

**What to check:**
- Does main content appear in both?
- Are titles/descriptions present?
- Are internal links crawlable?
- Are images embedded (not CSS backgrounds)?

#### 3. **Authorized External Data**

Document which external services you'll use for measurement:

```typescript
// src/seo/config.ts
export const externalServices = {
  searchConsole: {
    enabled: true,
    property: 'https://example.com',
    access: 'authorized', // authorized | unknown | denied
    lastChecked: '2026-10-28',
  },
  googleAnalytics: {
    enabled: true,
    property: 'G-XXXXXXXXXX',
    canReadMetrics: true,
  },
  crux: {
    enabled: true,
    available: true, // CrUX only available for 28+ daily queries
  },
  businessProfile: {
    enabled: false,
    reason: 'Not a local business',
  },
};
```

**What to record:**
- Search Console access and verified properties
- GA4 property for organic/organic click tracking
- CrUX data availability (28+ daily searches)
- Schema.org structured data support
- Any blocked tools or APIs

### Phase 1 Checklist

- [ ] All important URLs in inventory
- [ ] Explicit indexing_intent for each
- [ ] `validateInventory()` returns zero errors
- [ ] Owner assigned for each page
- [ ] High-priority pages marked
- [ ] Snapshots taken for 5-10 representative routes
- [ ] External services documented
- [ ] SEO team reviews and approves

### Phase 1 Outputs

```
✅ src/seo/inventory.ts           Page inventory source of truth
✅ src/seo/types.ts               Type definitions
✅ src/seo/rules.ts               Rules catalog (from JSON)
✅ docs/seo-snapshots/            Representative route snapshots
✅ docs/EXTERNAL_SERVICES.md      External tool access matrix
✅ SEO_IMPLEMENTATION.md           This guide
```

---

## Phase 2: Eligibility and Rendering

**Duration:** 3-4 weeks  
**Owner:** Engineering + QA  
**Focus:** P0 blockers — fix crawlability and rendering

### Phase 2 Rules Focus

#### Technical Eligibility (TECH-001 through TECH-007)

- [x] **TECH-001**: Googlebot can access public pages
  - No 401/403 on public routes
  - No WAF blocks
  - Check `Search Console > Crawl Stats`

- [x] **TECH-002**: HTTP 200 with real content
  - Not blank app shells
  - Not error pages disguised as 200
  - Minimum ~500 bytes of indexable text

- [x] **TECH-003**: 404/410 for genuinely missing pages
  - Not 200 with "sorry" message
  - Not redirect to home
  - Check `Search Console > Coverage > Excluded > Soft 404`

- [x] **TECH-004**: Monitor server health
  - Track 5xx, 429, DNS failures
  - Alert on >5% of Googlebot requests failing
  - Measure against baseline

- [x] **TECH-005**: robots.txt doesn't block important content
  - Verify `GET /robots.txt` returns valid UTF-8 text
  - Check file size < 500 KiB
  - Audit Disallow rules against intended pages

- [x] **TECH-006**: Remove accidental noindex
  - Check `<meta name="robots" content="noindex">`
  - Check `X-Robots-Tag: noindex` header
  - Search Console > URL Inspection > Indexability

- [x] **TECH-007**: Allow crawl of noindex pages
  - Don't block in robots.txt
  - Must return 200, not 403
  - Let Google read the directive

### JavaScript Rendering (TECH-015 through TECH-020)

- [x] **TECH-015**: Verify critical content renders
  - Use `Search Console > URL Inspection > View Rendered HTML`
  - Compare with raw HTML
  - Main text, headings, links must be present

- [x] **TECH-016**: Prefer server rendering for public pages
  - SSR/SSG for acquisition pages
  - Hydration is OK
  - Client-only rendering acceptable for authenticated apps

- [x] **TECH-017**: Don't rely on JavaScript to remove noindex
  - Put correct state in initial HTML
  - Google may not render after seeing noindex
  - Include metadata in server response

- [x] **TECH-018**: Keep canonical consistent
  - Initial HTML canonical matches rendered
  - No JavaScript that changes it
  - Use same canonical on paginated variants

- [x] **TECH-019**: Version JS/CSS assets
  - Use content hash or fingerprint: `app-abc123.js`
  - Changed content = new URL
  - Prevents serving stale code

- [x] **TECH-020**: Keep content independent of interactions
  - Main text loads without clicking
  - Links discoverable without interaction
  - Expandable sections OK if content pre-loaded

### Mobile & Content (TECH-021 through TECH-025)

- [x] **TECH-021**: Maintain mobile content parity
  - Mobile version has same main content
  - Same meaningful headings and links
  - Same images and metadata
  - Google uses mobile version for indexing

- [x] **TECH-022**: Keep resources under fetch limits
  - HTML/JS/CSS: < 2 MB uncompressed each
  - PDFs: < 64 MB uncompressed
  - Put critical content early
  - Monitor with `measurement/resource-sizes.ts`

### Phase 2 Implementation Steps

1. **Run P0 checks**
   ```bash
   npm test -- --grep "TECH-00[1-7]"
   ```

2. **Test crawlability**
   - Use Search Console Fetch as Google
   - Check `Crawl Stats` dashboard
   - Verify no 5xx errors

3. **Test rendering**
   - Use `URL Inspection > View rendered HTML`
   - Check 10 important templates
   - Verify content appears in rendered version

4. **Mobile testing**
   - Emulate mobile in DevTools
   - Verify content still loads
   - Check responsive layout

5. **Create CI gate**
   ```typescript
   // src/seo/checks/p0-eligibility.test.ts
   describe('P0 Eligibility', () => {
     // Automated checks fail deployment if not met
   });
   ```

### Phase 2 Deliverables

- [ ] Zero P0 blockers on high-priority pages
- [ ] HTTP status codes correct
- [ ] robots.txt valid and < 500 KiB
- [ ] No accidental noindex on public pages
- [ ] Content renders correctly
- [ ] Mobile version has parity
- [ ] CI/CD gate for P0 compliance
- [ ] Crawl health dashboard

---

## Phase 3: Canonicalization and Architecture

**Duration:** 3-4 weeks  
**Owner:** Product + Engineering  
**Focus:** URL consistency, sitemaps, pagination

### Key Rules

- **TECH-008**: Valid robots.txt
- **TECH-009**: Align canonicalization signals
- **TECH-010**: Self-referential canonical
- **TECH-011**: Inspect Google's chosen canonical
- **TECH-012**: Keep sitemaps focused
- **TECH-013**: Respect sitemap limits (50k URLs, 50 MB)
- **TECH-025**: Expose crawlable pagination
- **TECH-028**: Map redirects to relevant destinations
- **TECH-029**: Minimize redirect chains
- **TECH-030**: Retain migration redirects (≥1 year)
- **TECH-031**: Distinct URLs for language variants
- **TECH-032**: Implement valid hreflang

### Deliverables

- [ ] Canonical policy document
- [ ] Redirect mapping (old → new)
- [ ] Sitemap generation logic
- [ ] Pagination URL structure
- [ ] Language/region alternate mapping (if applicable)
- [ ] Zero redirect chains > 1 hop
- [ ] Search Console canonical agreement report

---

## Phase 4: Page Content and Presentation

**Duration:** 4-6 weeks  
**Owner:** Content + Engineering  
**Focus:** Metadata, quality, E-E-A-T

### Key Rules

- **CONTENT-001**: Match pages to user tasks (editorial review)
- **CONTENT-002**: Natural topic vocabulary
- **CONTENT-003**: Descriptive titles (no generic/duplicate)
- **CONTENT-004**: Clear main heading (H1)
- **CONTENT-005**: Useful meta descriptions
- **CONTENT-006**: Consistent language (title/body match locale)
- **CONTENT-009**: Publish original value (editorial review)
- **CONTENT-010**: Substantiate factual claims
- **CONTENT-011**: Show accountable authorship
- **CONTENT-012**: Update when topic changes
- **CONTENT-013**: Keep dates honest
- **CONTENT-015**: Review AI-generated content
- **CONTENT-020**: Generate markup from shared data
- **CONTENT-021**: Validate structured data

### Deliverables

- [ ] Title/description audit (automated + manual)
- [ ] Heading hierarchy review
- [ ] E-E-A-T signals (authorship, expertise, evidence)
- [ ] Structured data schema (Article, Organization, etc.)
- [ ] Editorial review workflow
- [ ] Content freshness review log
- [ ] AI generation review process (if applicable)

---

## Phase 5: Experience and Measurement

**Duration:** Ongoing  
**Owner:** Analytics + Engineering  
**Focus:** Performance, user metrics, ranking tracking

### Key Metrics

1. **Core Web Vitals** (TECH experience layer)
   - LCP ≤ 2.5s (75th percentile)
   - INP ≤ 200ms
   - CLS ≤ 0.1

2. **Search Performance**
   - Impressions & clicks by page
   - CTR by position (position and query matter)
   - Average position (informational, not absolute)

3. **Internal Link Health**
   - Orphan pages (no incoming internal links): 0
   - Broken links: 0
   - Redirect chains > 1 hop: 0

4. **Crawl Efficiency**
   - Crawl latency: publication to crawl time
   - Useful crawl %: pages visited vs infrastructure/assets
   - Crawl budget utilization

### Deliverables

- [ ] Search Console integration
- [ ] Core Web Vitals dashboard (field data)
- [ ] Search CTR analysis by template
- [ ] Internal link graph
- [ ] Crawl efficiency report (if >1M pages)
- [ ] Ranking tracking for target queries
- [ ] Quarterly audit report

---

## Phase 6: Release Evidence and Remaining Work

**Duration:** 1-2 weeks (rollout)  
**Owner:** Product + Engineering + Marketing  
**Focus:** Before/after validation, rollback plan

### Deliverables

- [ ] Before/after audit summary
- [ ] Coverage by rule category
- [ ] URL change manifest (if applicable)
- [ ] Rollback procedure
- [ ] Remaining P1/P2 work in backlog
- [ ] Owner assignments for ongoing maintenance
- [ ] Success metrics baseline

### Rollout Checklist

- [ ] Staging environment passes all P0 checks
- [ ] Production snapshot taken
- [ ] Rollback procedure tested
- [ ] Alert thresholds configured
- [ ] Metrics dashboard live
- [ ] Team trained on tools/processes
- [ ] 24-hour monitoring schedule

---

## Ongoing Maintenance

### Quarterly Reviews

- [ ] Review rule documentation (90-day source check)
- [ ] Update P2 items in backlog
- [ ] Audit trending metrics
- [ ] Check for regressions

### Weekly Monitoring

- [ ] Search Console alerts
- [ ] Core Web Vitals trend
- [ ] Crawl errors and coverage
- [ ] Broken link detection

### Annual Review

- [ ] Full SEO audit against all 118 rules
- [ ] Competitive landscape review
- [ ] Feature parity assessment
- [ ] Architecture evolution planning

---

## Rules by Phase

| Rule | Phase | Category |
|------|-------|----------|
| OVERALL-001 | 1 | Inventory |
| TECH-001 to 007 | 2 | Eligibility |
| TECH-008 to 034 | 3 | Architecture |
| CONTENT-001 to 006 | 4 | Content |
| CONTENT-007 to 031 | 4 | Quality & SD |
| UX-001 to 008 | 5 | Performance |
| LINK-001 to 010 | 5 | Linking |
| OFFPAGE-001 to 008 | 5 | Off-Page |
| All | 6 | Reporting |

---

## Tools and Resources

- **Search Console**: https://search.google.com/search-console
- **URL Inspection**: Check indexability, canonical, rendering
- **Rich Results Test**: Validate structured data
- **PageSpeed Insights**: Core Web Vitals + lab
- **Mobile Friendly Test**: Responsive layout check
- **Google Analytics 4**: Organic traffic & behavior
- **Schema.org**: Structured data vocabulary
- **Lighthouse**: Lab performance testing

---

## Success Criteria by Phase

| Phase | Criterion |
|-------|-----------|
| 1 | 100% of important URLs have explicit state; zero inventory conflicts |
| 2 | Zero P0 blockers on high-priority pages; 100% correct HTTP status |
| 3 | Zero redirect chains > 1 hop; 100% canonical consistency |
| 4 | 100% of high-priority pages reviewed; metadata accurate |
| 5 | Core Web Vitals meet good thresholds; tracking dashboard live |
| 6 | Before/after audit complete; rollback procedure tested; ongoing owners assigned |

---

## Questions & Escalation

- **Inventory conflicts**: Product team decision
- **Canonicalization strategy**: Product + Engineering
- **Content quality gates**: Editorial leadership
- **Performance targets**: CTO approval
- **Launch readiness**: Product Manager sign-off
