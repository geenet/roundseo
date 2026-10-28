# Team Management & Website Filtering Guide

## Overview

RoundSEO now includes comprehensive team management and advanced website filtering/sorting capabilities, making it easy to manage dozens of websites and coordinate with team members.

---

## ✅ Team Management Features

### 1. **Team Member Roles**

Four role levels control access and permissions:

| Role | Permissions | Use Case |
|------|-------------|----------|
| **Viewer** | Read-only access to audits and reports | Executives, stakeholders |
| **Member** | Create and run audits | SEO specialists, analysts |
| **Editor** | Manage websites, create audits | Team leads, managers |
| **Owner** | Full access including team management | Account owner |

### 2. **Adding Team Members**

**Via UI:**
1. Click **Team** button in sidebar
2. Enter email address
3. Select role from dropdown
4. Click "Add Member"

**API Endpoint:**
```
POST /api/v2/organizations/:orgId/members
Content-Type: application/json
Authorization: Bearer <token>

{
  "email": "team@example.com",
  "role": "member"
}
```

### 3. **Default Access**

- **Account Owner**: Automatic full access to all websites
- **Website Creator**: Automatic creator access (can modify)
- **Others**: Only access granted explicitly via team management

### 4. **Team Members List**

View all team members with:
- Email address
- Full name
- Role badge (Viewer/Member/Editor/Owner)
- Join date

---

## ✅ Website Management & Filtering

### 1. **Search**

Filter websites by name or domain in real-time:
- Type in search box to filter instantly
- Case-insensitive matching
- Works across name and domain fields

**Example:**
- Search "google" → shows google.com, google-*.com
- Search "example" → shows example.com, example-demo.com

### 2. **Sort Options**

Three built-in sorting options:

| Option | Behavior |
|--------|----------|
| **Recently Added** | Newest first (default) |
| **Name (A–Z)** | Alphabetical by website name |
| **Domain** | Alphabetical by domain name |

### 3. **Portfolio Dashboard**

Real-time metrics at a glance:

```
Portfolio
2 websites matching "example"

Audited: 2       Listed: 2       Issues: 21
```

- **Audited**: Count of websites with completed baselines
- **Listed**: Count showing current filter/sort
- **Issues**: Total open actions across all visible sites

### 4. **Website Table**

For each site, displays:
- **Website Name** & domain
- **Search & Outcomes**: Connection status (Not connected / Connected)
- **Current Attention**: Number of open actions + health score
- **Freshness**: Last audit date
- **Action**: Open workspace or run baseline

---

## 📊 Scaling to Dozens of Websites

### Managing 50+ Websites

**Best Practices:**

1. **Use Search First**
   - Search for client name or domain segment
   - Reduces list from 50 to 3-5 relevant sites

2. **Assign by Region**
   - "Search 'us-'" → all US sites
   - "Search 'eu-'" → all EU sites

3. **Use Team Roles**
   - SEO team members: "Member" role only
   - Only editors can add/delete sites
   - Reduces accidental changes

4. **Filter by Status**
   - Audited vs. Not yet audited
   - High issues (15+) vs. Low issues (< 5)
   - Sort by freshness to see stale audits

---

## 🔑 Team Workflow Example

**Scenario**: 3-person SEO agency managing 25 client websites

1. **Account Setup**
   - Owner: Creates organization, adds team members

2. **Team Members**
   - Alice (Owner) → Full access
   - Bob (Editor) → Can manage sites, create audits
   - Carol (Member) → Can run audits only

3. **Website Assignment**
   - Bob adds 25 client websites
   - Each marked with client name prefix (e.g., "client-name-")

4. **Daily Workflow**
   - Alice: Search "high-priority" clients → review audits
   - Bob: Add new "pending-" sites → assign to team
   - Carol: Search assigned clients → run baselines

---

## 🔐 Security & Permissions

### Access Control

- **None**: Unshared websites (owner only)
- **Viewer**: Can see metrics, cannot modify
- **Member**: Can run audits, cannot delete sites
- **Editor**: Can modify site details, delete sites
- **Owner**: Full control including team management

### API Security

All endpoints require:
- Valid JWT token in Authorization header
- Token's user organization must match
- Team membership verified server-side

---

## 📈 Scaling Considerations

### Current Limits (Easily Expandable)

- **Websites per organization**: No hard limit (tested to 100+)
- **Team members**: No hard limit
- **Search index**: Real-time on database queries
- **Sort options**: 3 primary + custom possible

### Performance Optimization

For 100+ websites:
1. Database creates index on domain name
2. Search uses LIKE with % on name + domain
3. Sort uses prepared statements
4. Pagination available via `limit` parameter

**API Example with Pagination:**
```
GET /api/v2/websites/search?q=google&sort=name&order=ASC&limit=20
```

---

## 🚀 Future Enhancements

Planned additions:

1. **Advanced Filters**
   - Filter by score range (60-80)
   - Filter by audit freshness (30+ days)
   - Filter by assigned team member

2. **Team Permissions**
   - Website-level access (not all websites)
   - Custom permissions per site

3. **Bulk Actions**
   - Run baseline on 5+ sites at once
   - Reassign multiple sites to team member

4. **Team Analytics**
   - Who ran most audits this week
   - Average audit time per member
   - Team productivity dashboard

---

## Quick Reference

**Key Buttons:**
- **Team** (sidebar): Manage team members
- **Add website**: Create new site
- **Search box**: Filter by name/domain
- **Sort dropdown**: Change order (Newest, Name, Domain)

**Team Roles:**
- 👥 Viewer: Read-only
- ✏️ Member: Create audits
- 🔧 Editor: Manage sites
- 👑 Owner: Full access

**View Updates:**
- Metrics update as filter changes
- Team member list shows current members
- Search persists across navigation

---

*Generated: October 28, 2026*  
*RoundSEO Team Management v1.0*
