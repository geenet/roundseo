# P0 Critical Rules Checklist

**Priority:** Must fix before launch  
**Scope:** Rules that block indexing or crawling  
**Verification:** Automated + manual checks required

---

## TECH-001: Public Access for Googlebot ⚠️

**Status:** MANUAL REVIEW REQUIRED

### The Rule
Googlebot must reach intended public pages without:
- Login/authentication walls
- WAF challenges
- Geo-blocking
- Rate limiting (don't throttle crawlers)

### How to Check

#### 1. Verify with Search Console
```
Search Console → Settings → Crawlers & User-Agents
Search Console → Crawl Stats → 2xx vs 4xx/5xx
```

Look for:
- 5xx errors → fix server issues
- 403 Forbidden → check if public or intentional
- 401 Unauthorized → should only be on /admin, /auth routes

#### 2. Fetch as Google (Fetch & Render)
```
Search Console → URL Inspection
1. Type a public URL
2. Click "Test live URL"
3. Check "Can Google access this page?"
```

Expected: ✅ "URL is accessible"

#### 3. Check robots.txt
```
GET /robots.txt
```

Should NOT contain:
```
Disallow: /          # blocks everything!
Disallow: /*         # blocks everything!
```

### Remediation

If Googlebot is blocked:

**Case 1: Public page blocked by mistake**
```nginx
# Remove from robots.txt
Disallow: /public-page  ← DELETE THIS
```

**Case 2: WAF blocking crawlers**
```nginx
# Whitelist Googlebot in your WAF/firewall
# Verify with DNS: google-bot-ip-verify.com
# IP ranges: https://developers.google.com/search/docs/crawling-indexing/googlebot
```

**Case 3: Authentication on public page**
```typescript
// Allow indexable pages without login
@app.get('/public-page')
async publicPage() {
  // Return content without requiring auth
}

// Protect actual private pages
@app.get('/admin/*')
@requireAuth
async adminPage() {
  // Only for authenticated users
}
```

### ✅ Verification Passed When
- [ ] Search Console shows no 401/403 on public routes
- [ ] Fetch as Google succeeds on 5 public pages
- [ ] robots.txt doesn't block important content
- [ ] No WAF blocking legitimate crawler IPs

---

## TECH-002: Successful Content Response ⚠️

**Status:** AUTOMATED CHECK AVAILABLE

### The Rule
```
GET /page → HTTP 200 + real content (not blank shell)
```

### How to Check

#### 1. HTTP Status
```bash
curl -I https://example.com/
# Expected: HTTP/1.1 200 OK
```

NOT acceptable:
- 200 with empty body (`Content-Length: 0`)
- 200 with only app chrome (no content)
- Error page with status 200

#### 2. Content Size
```bash
curl https://example.com/ | wc -c
# Should be > 500 bytes of real text content
```

#### 3. Manual Inspection
Open in browser:
- [ ] Page displays main content
- [ ] No blank screen for 5+ seconds
- [ ] No "loading..." spinner forever
- [ ] Content is actual text, not app error

### Automated Test

```typescript
// src/seo/checks/tech-002.test.ts
describe('TECH-002: Successful Content Response', () => {
  test('important pages return 200 with content', async () => {
    const pages = getHighPriorityPages();
    
    for (const page of pages) {
      const res = await fetch(page.url);
      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBeGreaterThan(500);
      
      const html = await res.text();
      expect(html.length).toBeGreaterThan(500);
      expect(html).toMatch(/<h1|<h2|<p|<main/i); // has semantic content
    }
  });
});
```

### Remediation

**Problem: Blank app shell**

```typescript
// ❌ BAD: Returns shell, content loads via JS
@app.get('/page')
render() {
  return `<div id="app"></div>`;  // No content!
}

// ✅ GOOD: Render on server
@app.get('/page')
async render() {
  const data = await loadData();
  return renderToString(
    <Page data={data} />
  );
}
```

**Problem: Content in comment-only area**

```html
<!-- 
Your actual content hidden here by mistake
This doesn't count!
-->
<div id="app"></div>

<!-- ✅ FIX: Make content visible -->
<main>
  <h1>Page Title</h1>
  <p>Actual indexable content here</p>
</main>
```

### ✅ Verification Passed When
- [ ] 5 important pages return HTTP 200
- [ ] Each has > 500 bytes of text content
- [ ] Content visible without JS (verify with `curl`)
- [ ] No "blank app shell" pattern

---

## TECH-005: Permit Crawling of Important Content ⚠️

**Status:** REQUIRES AUDIT

### The Rule
robots.txt shouldn't block:
- Important pages
- CSS/JS needed to render
- Images in content

### robots.txt DO's and DON'Ts

#### ❌ BLOCKS EVERYTHING (Very Bad)
```
User-agent: *
Disallow: /
```

#### ❌ BLOCKS ALL CRAWLING (Bad)
```
User-agent: Googlebot
Disallow: /
```

#### ✅ GOOD: Blocks only what's private
```
User-agent: *
Disallow: /admin/
Disallow: /user/profile/
Disallow: /api/
Disallow: /search*

# But allow important pages:
# (default is to allow)
```

#### ✅ EXPLICIT ALLOW (Even Better)
```
User-agent: *
Disallow: /admin/
Disallow: /api/

# Allow assets needed for rendering
Allow: /static/
Allow: /images/
```

### How to Verify

#### 1. Check what's blocked
```bash
curl https://example.com/robots.txt
```

#### 2. Use robots.txt checker
```
https://www.robotstxt.org/
```

Enter your site, paste /robots.txt, see what's blocked

#### 3. Test in Search Console
```
Search Console → Settings → Crawl budget
Look for:
  - Blocked by robots.txt (should be intentional)
  - Crawled pages (should include public content)
```

#### 4. Automated check

```typescript
// src/seo/checks/tech-005.test.ts
test('robots.txt allows important content', async () => {
  const robotsTxt = await fetch('https://example.com/robots.txt')
    .then(r => r.text());
  
  // Important pages should NOT be in Disallow list
  expect(robotsTxt).not.toMatch(/Disallow: \//);  // Don't block everything
  expect(robotsTxt).not.toMatch(/Disallow: \*$/); // Don't block all paths
  
  // Verify file size
  expect(robotsTxt.length).toBeLessThan(500 * 1024); // < 500 KiB
});
```

### ✅ Verification Passed When
- [ ] robots.txt is valid text file (not 404)
- [ ] File size < 500 KiB
- [ ] Doesn't block public pages
- [ ] Allows access to CSS/JS assets
- [ ] Search Console shows no "blocked by robots.txt"

---

## TECH-006: Remove Accidental Noindex ⚠️

**Status:** AUTOMATED CHECK AVAILABLE

### The Rule
Only pages you intend to exclude should have noindex

### Where noindex Can Hide

#### 1. HTML Meta Tag
```html
<head>
  <meta name="robots" content="noindex">
</head>
```

#### 2. HTTP Header
```
X-Robots-Tag: noindex
```

#### 3. Inherited from Parent
```
<!-- Home page: /
<meta name="robots" content="noindex">
-->

<!-- Then /blog inherits noindex! -->
```

### How to Check

#### 1. View Page Source
```
Right-click → View Page Source → Search for "noindex"
```

#### 2. Check HTTP Headers
```bash
curl -I https://example.com/page
# Look for: X-Robots-Tag: ...
```

#### 3. Search Console URL Inspection
```
Search Console → URL Inspection
Type URL → Scroll to "Indexing"
Look for "Excluded" reason
```

If reason is "Noindex tag (robots meta tag)":
- [ ] Is this intentional?
- [ ] If NO: remove the tag
- [ ] If YES: all good ✅

#### 4. Automated Check

```typescript
// src/seo/checks/tech-006.test.ts
test('public pages should not have noindex', async () => {
  const publicPages = getByIndexingIntent('index');
  
  for (const page of publicPages) {
    const res = await fetch(page.url);
    const html = await res.text();
    
    // Should NOT contain noindex
    expect(html).not.toMatch(
      /<meta\s+name=["']?robots["']?\s+content=["']?.*noindex/i
    );
    
    // Should NOT have header
    expect(res.headers['x-robots-tag'])
      .not.toContain('noindex');
  }
});
```

### Remediation

#### Problem: Accidental noindex in template

```html
<!-- ❌ All pages inherit noindex -->
<head>
  <meta name="robots" content="noindex">
  <% if (page.isDraft) { %>
    <!-- Try to override in JS -->
  <% } %>
</head>

<!-- ✅ FIX: Only add noindex when needed -->
<head>
  <% if (page.isDraft || !page.shouldIndex) { %>
    <meta name="robots" content="noindex">
  <% } %>
</head>
```

#### Problem: Old deployment still blocking

If you removed noindex but Search Console still shows "Excluded":
1. Google saw the old version
2. Will re-crawl to check the directive
3. This can take days/weeks
4. Use `Search Console → URL Inspection → Request Indexing` to speed up

### ✅ Verification Passed When
- [ ] No public pages have `<meta name="robots" content="noindex">`
- [ ] No public pages return `X-Robots-Tag: noindex` header
- [ ] Search Console shows public pages as "Crawled - currently not indexed" (not "Excluded")
- [ ] Intentional noindex pages are documented

---

## TECH-017: Don't Rely on JavaScript to Remove Noindex ⚠️

**Status:** AUTOMATED CHECK

### The Rule
If initial HTML has noindex, Google may not bother rendering to check

```html
<!-- ❌ BAD: Noindex in initial HTML -->
<meta name="robots" content="noindex">
<script>
  // Try to fix with JS
  document.head.innerHTML = document.head.innerHTML
    .replace('noindex', '');
</script>

<!-- ✅ GOOD: Correct state in initial HTML -->
<meta name="robots" content="index, follow">
```

### Why It Matters

1. Google crawls → sees HTML → reads "noindex"
2. Google stops! Doesn't render.
3. JavaScript never runs
4. Page never indexed

### How to Check

```bash
# Get raw HTML (what Google sees first)
curl https://example.com/page > page.html

# Search for noindex
grep -i "noindex" page.html
# Should be empty for public pages
```

### Automated Check

```typescript
test('initial HTML has correct robots directive', async () => {
  const pages = getByIndexingIntent('index');
  
  for (const page of pages) {
    const res = await fetch(page.url);
    const rawHtml = await res.text();
    
    // Should NOT have noindex
    expect(rawHtml).not.toMatch(/content=["']?.*noindex/i);
    
    // Should NOT have nofollow unless intentional
    // (follow links in content)
  }
});
```

### ✅ Verification Passed When
- [ ] Initial HTML never has accidental noindex
- [ ] If page has noindex, it's intentional + documented
- [ ] JavaScript doesn't try to change robots directives

---

## CONTENT-016: Prevent Scaled Low-Value Publishing ⚠️

**Status:** MANUAL REVIEW REQUIRED

### The Rule
Don't create:
- Doorway pages (exists only to funnel users)
- Location × keyword spam pages
- Thin copies of same content
- Automated low-value scaling

### Red Flags

```
❌ /services-denver/  (identical to /services/, just changed city)
❌ /blog-{keyword}-{location}/  (auto-generated for every combo)
❌ /product-{color}/  (one page per color, no unique content)
❌ AI-generated filler pages (not reviewed, not original)
```

### How to Check

#### 1. Similarity Detection

```typescript
// src/seo/checks/content-016.test.ts
test('pages have distinct valuable purpose', async () => {
  const pages = pageInventory.filter(p => p.indexing_intent === 'index');
  
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      // Get content
      const content1 = await fetch(pages[i].url).then(r => r.text());
      const content2 = await fetch(pages[j].url).then(r => r.text());
      
      // Extract main text (remove boilerplate)
      const text1 = extractMainContent(content1);
      const text2 = extractMainContent(content2);
      
      // Similarity should be < 80% (allow minor overlap)
      const similarity = calculateSimilarity(text1, text2);
      
      if (similarity > 0.9) {
        console.warn(
          `Pages ${pages[i].url} and ${pages[j].url} are ${similarity}% similar`
        );
      }
    }
  }
});
```

#### 2. Automated Generation Check

```
Look for patterns:
  /services/[city]/           - Manual or auto?
  /blog/[keyword]/            - Manual or auto?
  /product/[sku]/[color]/     - Manual or auto?
```

If programmatic:
- Verify each variation has unique value
- Is [city] version distinct? (local details, hours, team)
- Is [keyword] version distinct? (different approach, examples)

#### 3. Editorial Review

For each generated page family:

```markdown
Page family: /services/[city]/
- Generator: CMS template expansion
- Distinct content per city: YES
  - Local business name
  - Local team bios
  - Local case studies
  - Local reviews
  - Local hours/address
- Required review before publish: YES
- Business value: YES (local leads)

DECISION: ✅ ALLOWED - each page has distinct value
```

vs.

```markdown
Page family: /furniture-[color]-[size]/
- Generator: Product auto-expander
- Distinct content: NO
  - All pages say "Beautiful [color] [size] furniture"
  - Same images, rotated
  - Same description template
  - No user reviews
  - Same price/stock info
- Business value: Unclear
- Cannibalizes main product page

DECISION: ❌ BLOCKED - merge to single product page
```

### ✅ Verification Passed When
- [ ] No mass-produced identical pages
- [ ] Each generated page has documented distinct value
- [ ] Editorial approval required before programmatic generation
- [ ] Similarity check < 80% for distinct pages
- [ ] No keyword × location spam pages without location-specific content

---

## Summary: P0 Critical Rules

| Rule | Check | Status | Blocking Launch? |
|------|-------|--------|------------------|
| TECH-001 | Googlebot access | ⚠️ | YES |
| TECH-002 | HTTP 200 content | ⚠️ | YES |
| TECH-005 | robots.txt allows content | ⚠️ | YES |
| TECH-006 | No accidental noindex | ⚠️ | YES |
| TECH-017 | JS doesn't remove noindex | ⚠️ | YES |
| CONTENT-016 | No low-value scaling | ⚠️ | YES |

---

## Next Steps

1. **Run automated checks** for each P0 rule
2. **Document findings** in `P0_AUDIT.md`
3. **Fix blockers** before launch
4. **Re-verify** before shipping
5. **Monitor** Search Console for post-launch issues

Use the embedded test suite:
```bash
npm test src/seo/__tests__/seo.test.ts
```

Fix any failing tests before proceeding to Phase 2.
