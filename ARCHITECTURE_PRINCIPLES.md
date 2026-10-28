# RoundSEO Architecture: API-First, AI-First, MCP-First

## Core Philosophy

Build a system where AI agents are first-class citizens, not afterthoughts.

---

## 1. API-First Architecture

### Principle
**Every feature must be available via API before UI.** The UI is just one client.

### Current State ✅

**Auth APIs**
```
POST   /api/v2/auth/signup          → { user, token }
POST   /api/v2/auth/login           → { user, token }
GET    /api/v2/auth/me              → { user }
```

**Organization APIs**
```
POST   /api/v2/organizations         → { organization }
GET    /api/v2/organizations         → { organizations[] }
```

**Website APIs**
```
POST   /api/v2/organizations/:id/websites              → { website }
GET    /api/v2/organizations/:id/websites              → { websites[] }
GET    /api/v2/websites/search?q=X&sort=Y&limit=Z     → { websites[], total }
```

**Team APIs**
```
GET    /api/v2/organizations/:id/members              → { members[] }
POST   /api/v2/organizations/:id/members              → { member }
```

**Audit APIs**
```
POST   /api/v2/organizations/:id/websites/:id/audits   → { audit }
GET    /api/v2/organizations/:id/audits/:id           → { audit }
GET    /api/v2/organizations/:id/websites/:id/audits   → { audits[] }
POST   /api/v2/audits/calculate-metrics               → { audit_with_scores }
POST   /api/v2/audits/schedules                       → { schedule }
GET    /api/v2/audits/schedules                       → { schedules[] }
```

### Next Steps 📋

Add missing APIs to enable full programmatic control:

```
// Website Management
PATCH  /api/v2/organizations/:id/websites/:id         Update site
DELETE /api/v2/organizations/:id/websites/:id         Archive site

// Audit Management  
PATCH  /api/v2/organizations/:id/audits/:id           Update audit status
GET    /api/v2/organizations/:id/audits/:id/metrics   Get detailed metrics
GET    /api/v2/organizations/:id/audits/:id/recommendations → Get recommendations

// Team Management
PATCH  /api/v2/organizations/:id/members/:id          Update member role
DELETE /api/v2/organizations/:id/members/:id          Remove member

// Bulk Operations
POST   /api/v2/organizations/:id/audits/bulk-create   Schedule 10+ audits at once
POST   /api/v2/organizations/:id/websites/bulk-import Import from CSV

// Analytics
GET    /api/v2/organizations/:id/analytics/summary    Overall metrics
GET    /api/v2/organizations/:id/analytics/trends     Score trends over time
GET    /api/v2/organizations/:id/analytics/team       Team performance stats
```

---

## 2. AI-First Design

### Principle
**Data structures and responses should be designed for AI consumption and reasoning.**

### Current State ✅

**Audit Response Structure**
```json
{
  "id": "audit_xxx",
  "website_id": "site_yyy",
  "overall_score": 67,
  "status": "completed",
  "technical_health": { "value": 67, "evaluatedChecks": 50, "expectedChecks": 60 },
  "crawl_coverage": { "availability": "partial", "pages": 15, "urls_discovered": 150 },
  "actions": [
    {
      "id": "action_1",
      "title": "Fix broken links",
      "priority": "High",
      "effort": "medium",
      "evidence": [ { "url": "...", "issue": "404" } ],
      "recommendation": "Use Link Checker tool to find and fix broken links"
    }
  ],
  "metadata": {
    "crawl_method": "browser-rendered",
    "timestamp": "2026-10-28T15:30:00Z",
    "version": "2026.10.0"
  }
}
```

### AI-Optimized Features

**1. Structured Recommendations**
```json
{
  "id": "rec_123",
  "audit_id": "audit_xxx",
  "category": "technical",
  "title": "Fix broken links",
  "description": "Found 5 broken internal links",
  "affected_pages": 5,
  "impact": "Improves crawlability and user experience",
  "effort": "quick_win",
  "priority": "high",
  "implementation_steps": [
    "1. Use crawl results to identify broken links",
    "2. Update or remove each link",
    "3. Run audit again to verify"
  ]
}
```

**2. Comparison API for Trend Detection**
```
GET /api/v2/organizations/:id/audits/compare?from=2026-09-28&to=2026-10-28
→ {
  "from": { audit_object },
  "to": { audit_object },
  "changes": {
    "score_delta": +5,
    "actions_resolved": 3,
    "actions_new": 2,
    "issues_by_type": { "technical": -2, "onpage": +1 }
  }
}
```

**3. Context-Rich Error Messages**
```json
{
  "error": "invalid_url",
  "message": "The URL provided is not accessible",
  "url": "https://example.com/404",
  "status_code": 404,
  "details": {
    "likely_cause": "Page deleted or moved",
    "suggestion": "Check if page was recently moved or use 301 redirect"
  }
}
```

### Next Steps 📋

**AI-Friendly Response Enhancements:**

1. **Add Reasoning Field**
   ```json
   {
     "finding": "67% technical health",
     "reasoning": "50 of 60 checks passed. Missing: mobile viewport, sitemap.xml",
     "ai_analysis": "The site is crawlable but needs mobile optimization"
   }
   ```

2. **Add Summaries for Each Section**
   ```json
   {
     "audit": { ... },
     "summary": "This site is partially optimized. Primary issues: broken links (5), missing alt text (12). Quick wins: add descriptions to 3 pages.",
     "ai_actionable": "Can be fixed in 2-4 hours with high impact"
   }
   ```

3. **Add Comparable Benchmarks**
   ```json
   {
     "score": 67,
     "percentile": 45,
     "industry_avg": 72,
     "top_performers": 85,
     "improvement_to_top": "Fix technical issues (+10 points) and mobile UX (+8 points)"
   }
   ```

---

## 3. MCP-First Integration

### Principle
**RoundSEO is a first-class Claude tool via Model Context Protocol.**

### Current State ❌

No MCP integration yet. RoundSEO is siloed from Claude agents.

### MCP Tools to Build

**Tool 1: Browser Websites**
```
tool: roundseo_list_websites
input: {
  organization_id: string (required)
  search?: string
  sort_by?: "name" | "score" | "recently_audited"
}
output: {
  websites: [{
    id: string
    name: string
    domain: string
    latest_score: number
    pages_audited: number
    last_audit: string
  }]
}
```

**Tool 2: Get Audit Details**
```
tool: roundseo_get_audit
input: {
  audit_id: string
  include?: ["full_findings", "recommendations", "trends"]
}
output: {
  audit: AuditObject
  findings: Finding[]
  recommendations: Recommendation[]
  ai_summary: string
}
```

**Tool 3: Create Audit**
```
tool: roundseo_start_audit
input: {
  website_id: string
  include_performance?: boolean
}
output: {
  audit_id: string
  status: "pending" | "running"
  estimated_time: "2-5 minutes"
}
```

**Tool 4: Add Website**
```
tool: roundseo_add_website
input: {
  organization_id: string
  domain: string
  name?: string
}
output: {
  website: WebsiteObject
  ready_for_audit: boolean
}
```

**Tool 5: Get Recommendations**
```
tool: roundseo_get_recommendations
input: {
  website_id: string
  priority?: "critical" | "high" | "medium"
  category?: string
}
output: {
  recommendations: Recommendation[]
  total_impact_potential: string
  quick_wins: Recommendation[]
  complex_projects: Recommendation[]
}
```

**Tool 6: Track Audit History**
```
tool: roundseo_audit_history
input: {
  website_id: string
  limit?: 10
}
output: {
  audits: [{
    id: string
    score: number
    date: string
    key_findings: string[]
    improvements: string
  }]
  trend: "improving" | "declining" | "stable"
}
```

### MCP Implementation Roadmap

```yaml
Phase 1: Core Tools (Week 1)
  ✅ List websites
  ✅ Get audit details
  ✅ Get recommendations
  
Phase 2: Create & Modify (Week 2)
  ✓ Create audit
  ✓ Add website
  ✓ Update audit status
  
Phase 3: Analysis Tools (Week 3)
  ✓ Audit history & trends
  ✓ Team analytics
  ✓ Compare audits
  
Phase 4: AI Agent Workflows (Week 4)
  ✓ Multi-step audit workflows
  ✓ Recommendation implementation guidance
  ✓ Team coordination flows
```

### Example Claude Agent Using MCP

```
Claude Agent → MCP Tools → RoundSEO API → Database

Agent: "Audit my top 5 websites and summarize findings"

Steps:
1. roundseo_list_websites(sort_by: "score") 
   → Get top 5 by latest score
2. For each website:
   - roundseo_start_audit(website_id)
   - roundseo_get_recommendations(website_id)
3. Synthesize findings:
   - Common issues across sites
   - Quick wins vs. complex projects
   - Team assignment suggestions
4. Present: "Your top 5 sites need X. Here's a 4-week plan."
```

### MCP Server Implementation

```javascript
// server.mjs
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const tools = [
  {
    name: "roundseo_list_websites",
    description: "List websites in an organization",
    input_schema: {
      type: "object",
      properties: {
        organization_id: { type: "string" },
        search: { type: "string" }
      }
    }
  },
  // ... more tools
];

// Handler
async function handleToolCall(toolName, toolInput) {
  const response = await fetch(
    `http://localhost:8787/api/v2/${toolName.replace("roundseo_", "")}`,
    { 
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.ROUNDSEO_TOKEN}` },
      body: JSON.stringify(toolInput)
    }
  );
  return response.json();
}
```

---

## 4. Integration Example: AI-Powered SEO Analysis

### Workflow
```
1. User (via Claude): "Analyze my 10 websites"
2. Claude calls MCP tools:
   - roundseo_list_websites()
   - roundseo_get_audit() × 10
   - roundseo_get_recommendations() × 10
3. Claude synthesizes:
   - Common patterns across sites
   - Quick wins (1-2 hour fixes)
   - Strategic projects (1-2 week fixes)
4. Claude proposes:
   - Prioritized roadmap
   - Team assignments
   - Timeline and resource allocation
5. User confirms via Claude
6. Claude triggers:
   - roundseo_start_audit() for scheduled runs
   - roundseo_add_website() for new sites
```

### Benefits
- ✅ No context switching (stay in Claude)
- ✅ AI understands SEO context
- ✅ Decisions based on cross-site patterns
- ✅ Automated reporting and planning
- ✅ Natural language interface

---

## 5. Implementation Priority

### Phase 1: API Completeness (This Week)
- [ ] Add PATCH/DELETE endpoints
- [ ] Add bulk import/export
- [ ] Add analytics endpoints
- [ ] Add comparison endpoints

### Phase 2: AI-Optimized Responses (Next Week)
- [ ] Add AI summaries to audits
- [ ] Add structured reasoning
- [ ] Add benchmark data
- [ ] Add trend analysis

### Phase 3: MCP Integration (Week 3)
- [ ] Define 6 core MCP tools
- [ ] Implement MCP server
- [ ] Test Claude agent integration
- [ ] Document for third-party use

### Phase 4: Advanced AI Features (Week 4+)
- [ ] Multi-site strategy planning
- [ ] Automated report generation
- [ ] Team workflow automation
- [ ] Predictive scoring

---

## Design Checklist

### ✅ API-First
- [ ] Every feature has a REST endpoint
- [ ] All responses are JSON
- [ ] Consistent error handling
- [ ] Rate limiting & pagination
- [ ] Full CRUD for all resources

### ✅ AI-First
- [ ] Responses include AI-readable summaries
- [ ] Structured data (not prose descriptions)
- [ ] Comparison/trending data
- [ ] Confidence scores
- [ ] Actionable recommendations

### ✅ MCP-First
- [ ] All features exposed as MCP tools
- [ ] Tools accept structured inputs
- [ ] Tools return structured outputs
- [ ] Tools are composable (can chain them)
- [ ] Documentation for tool discovery

---

## Example: The "Better" Way

### ❌ Old (UI-First)
```
User clicks website → UI fetches data → Shows results
No API → Can't automate → Can't use with Claude
```

### ✅ New (API-First + AI-First + MCP-First)
```
Claude calls MCP tools → APIs return AI-friendly data → Claude reasons → Takes action

Enables:
- Bulk operations (10 sites in 10 seconds)
- AI analysis (pattern detection across portfolio)
- Automation (scheduled intelligence)
- Integration (third-party tools)
```

---

**Adopted:** October 28, 2026  
**Version:** 1.0 - Architecture Principles
