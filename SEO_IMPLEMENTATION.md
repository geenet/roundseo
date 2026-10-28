# Google SEO Specification Implementation

**Research date:** 2026-10-28  
**Framework version:** 1.0  
**Implementation model:** Phased approach across 6 delivery phases

This document guides implementation of a comprehensive, evidenced-based Google SEO specification for roundseo.

## Overview

This specification contains:
- **118 scoped rules** across 11 categories
- **20 diagnostic metrics** with observable formulas
- **6 implementation phases** with clear deliverables
- **Evidence-based classification**: requirement, confirmed mechanism, official recommendation, engineering practice

## Quick Start

### Phase 1: Inventory and Baseline (Current)

**Goal:** Establish source of truth for which pages should appear in Search

**Deliverables:**
1. ✅ [Page inventory](#page-inventory) with intended states
2. ⏳ Raw/rendered snapshots for representative routes
3. ⏳ Authorized external-data availability recorded

**Key files:**
- `src/seo/inventory.ts` — Page inventory
- `src/seo/rules.ts` — Rules catalog
- `src/seo/types.ts` — Type definitions

**Action items:**
1. Review and update `pageInventory` in `src/seo/inventory.ts`
2. Document which pages need indexing and why
3. Record publication dates and ownership
4. Run `validateInventory()` to check consistency

### Phase 2: Eligibility and Rendering

Focus on P0 (critical) blockers:
- HTTP access and status codes
- JavaScript rendering completeness
- Mobile content parity
- Noindex/robots.txt consistency

### Phase 3: Canonicalization and Architecture

- Canonical URL consistency
- Redirect mapping
- Sitemap accuracy
- Pagination URL structure

### Phase 4: Page Content and Presentation

- Title and description metadata
- Heading hierarchy
- E-E-A-T signals
- Structured data

### Phase 5: Experience and Measurement

- Core Web Vitals
- Search performance tracking
- Internal link graph health
- User engagement metrics

### Phase 6: Release Evidence and Rollout

- Before/after audit
- URL change manifest
- Rollback procedures
- Remaining work assignment

---

## Page Inventory

Central source of truth: `src/seo/inventory.ts`

Each page declares:
- **page_id**: Stable unique identifier
- **url**: The live page path
- **page_type**: content category (home, article, form, etc.)
- **locale**: Language/region
- **audience_task**: What should users accomplish
- **indexing_intent**: index | noindex | private | redirect | gone
- **intended_canonical**: Preferred URL for canonicalization
- **priority**: high | medium | low (business importance)
- **owner**: Team responsible for the page
- **publication_date**: When first published
- **applicable_features**: Product markup, article, video, etc.

### Example

```typescript
{
  page_id: 'blog-post-seo-101',
  url: '/blog/seo-101',
  page_type: 'article',
  locale: 'en',
  audience_task: 'Learn SEO fundamentals',
  indexing_intent: 'index',
  intended_canonical: 'https://example.com/blog/seo-101',
  priority: 'high',
  owner: 'content-team',
  publication_date: '2026-10-15',
  applicable_features: ['Article', 'NewsArticle']
}
```

### Validation

```typescript
import { validateInventory } from './src/seo/inventory';

const { valid, errors } = validateInventory();
console.log(valid ? '✅ Inventory is valid' : '❌ Issues found:');
errors.forEach(e => console.log(`  - ${e}`));
```

---

## Rules and Automation

### Rule Categories

| Category | Count | Purpose |
|----------|-------|---------|
| **overall** | 6 | Project setup, metrics, priorities |
| **technical** | 35 | Crawling, indexing, HTTP, rendering |
| **on_page** | 7 | Metadata, titles, headings |
| **content_quality** | 11 | Originality, reviews, freshness, AI |
| **off_page** | 8 | Links, reputation, trust |
| **linking** | 10 | Internal links, anchors, navigation |
| **experience** | 8 | Performance, mobile, accessibility |
| **structured_data** | 10 | Rich results, schema, validation |
| **media** | 5 | Images, video, alt text |
| **local** | 3 | Business info, locations |
| **additional** | 5 | AI, news, specialty topics |

### Rule Priority

- **P0**: Critical blockers affecting indexing/crawling (fix first)
- **P1**: Foundational improvements (implement next)
- **P2**: Enhancements and diagnostics (monitor ongoing)

### Evidence Classification

| Type | Meaning | How to treat |
|------|---------|------------|
| **requirement** | Necessary for outcome | Test within scope |
| **confirmed_mechanism** | Google describes using it | Implement sensible practices |
| **official_recommendation** | Google recommends | Usually worthwhile |
| **engineering_practice** | Project convention | Make assumptions explicit |

---

## Verification Framework

### Running Checks

```typescript
import { runChecks, VerificationContext } from './src/seo/verifier';

const context: VerificationContext = {
  url: '/blog/seo-101',
  page: pageInventory[0],
  httpStatus: 200,
  renderedHtml: '<html>...</html>',
};

const findings = await runChecks(context);
findings.forEach(f => {
  console.log(`${f.status.toUpperCase()}: ${f.rule_id} - ${f.observed_evidence}`);
});
```

### Registered Checks

Currently implemented:
- **TECH-001**: Public access for Googlebot
- **TECH-002**: Successful HTTP 200 with content
- **OVERALL-001**: Explicit intended indexing state

### Extending Verification

```typescript
import { registerCheck } from './src/seo/verifier';

registerCheck('CONTENT-003', async (context) => {
  // Check for descriptive page title
  if (!context.renderedHtml?.includes('<title>')) {
    return {
      rule_id: 'CONTENT-003',
      url_or_template: context.url,
      applicable_scope: 'All indexable pages',
      severity: 'high',
      status: 'fail',
      observed_evidence: 'No title element found',
      expected_behavior: 'Every page should have a descriptive <title>',
      source_urls: [
        'https://developers.google.com/search/docs/appearance/title-link'
      ],
      observed_at: new Date().toISOString(),
      verification_coverage: 'automated',
      remediation_owner: 'frontend',
    };
  }
  return null;
});
```

---

## Critical Rules (P0)

These must be addressed before launch:

### TECH-001: Public Access
- Googlebot must reach public pages without auth
- Keep private routes protected
- Check Search Console for 401/403 errors

### TECH-002: Successful Response
- Return HTTP 200 for content
- Avoid blank shells or error pages disguised as success
- Render critical content, not just app chrome

### TECH-006: Remove Noindex
- Accidental `noindex` on indexable pages
- Check both HTML tags and HTTP headers
- Can be inherited from parent routes

### TECH-005: Permit Crawling
- Don't block Googlebot in robots.txt
- Allow access to CSS/JS needed for rendering
- Verify against rendering reports

### CONTENT-016: Prevent Low-Value Scaling
- No mass-produced doorway pages
- No keyword × location combinations without purpose
- Requires editorial decision for programmatic pages

---

## Diagnostic Metrics (20 total)

Key measurements to track:

| Metric | Formula | Target |
|--------|---------|--------|
| **Technical Eligibility** | Important pages passing observable checks / checked | 100% |
| **Indexing Coverage** | Observed indexed URLs / URLs with observations | Trend by template |
| **Canonical Agreement** | Google-selected = intended / observed | Investigate mismatches |
| **Orphan Count** | Important URLs with no incoming links | 0 |
| **Internal Link Integrity** | Errors & loops | 0 critical |
| **Render Completeness** | Content visible in rendered HTML / templates | 100% |
| **Core Web Vitals** | p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 | Official thresholds |
| **Search Visibility** | Impressions & clicks by segment | Qualified growth |
| **CTR** | Clicks / impressions in cohort | No universal target |
| **Freshness** | Overdue time-sensitive reviews | 0 for priority content |

### Measurement Guidelines

- **Field data** = real user observations (preferred)
- **Lab data** = controlled tests (diagnostics only)
- **Missing data** = unknown (not a pass/fail)
- **Third-party scores** = provider metrics (not Google's)

---

## Implementation Principles

### 1. Separate Eligibility, Ranking, and Appearance

- ✅ Test crawling, rendering, indexing eligibility
- ✅ Track search performance and CTR
- ❌ Don't convert rule checklist into probability of ranking

### 2. Preserve Intentional Decisions

- Keep private/noindex/preview routes protected
- Use declared inventory before changing access
- Don't delete low-traffic pages automatically

### 3. Avoid False Numerical Targets

Don't mandate:
- Specific title character count
- Exact word count or keyword density
- Minimum backlink count
- Fixed crawl depth (3 clicks is conventional, not required)
- Article quota or topical authority score

### 4. Distinguish Local Eligibility from Observation

- "No data" ≠ "not indexed"
- Search Console is partial, not exhaustive
- URL Inspection is for inspection, not live testing
- Unavailable account access is unknown, not clean

### 5. Real Review, Not Automation

- E-E-A-T signals must come from genuine work
- Fact-checking, authorship, reviews are editorial
- Generated content needs real human review
- No fake credentials, reviews, or authorities

---

## Sources and References

All rules link to Google's official documentation:

- [Google Search Central](https://developers.google.com/search)
- [Search Console Help](https://support.google.com/webmasters)
- [Web.dev Vitals](https://web.dev/articles/vitals)
- [How Search Works](https://www.google.com/search/howsearchworks)

**Last verified:** 2026-10-28  
**Update cadence:** 90 days (check before major feature changes)

---

## What's Next

1. **Populate inventory** with your actual pages (Phase 1)
2. **Identify P0 blockers** using TECH-* and CONTENT-016 rules
3. **Set up verification** for high-priority pages
4. **Build measurement dashboard** for Phase 5
5. **Review audit report** quarterly

See specific phase guides for detailed implementation steps.

---

**Questions?** Review the Google SEO specification files:
- `google-seo-codex-spec.txt` — Complete readable specification
- `google-seo-rules.json` — Structured rule catalog
