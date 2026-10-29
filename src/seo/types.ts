/**
 * Google SEO Specification Implementation Types
 * Based on google-seo-rules.json (2026-10-28)
 */

// Page Inventory
export interface PageInventory {
  page_id: string;
  url: string;
  page_type: string;
  locale: string;
  audience_task: string;
  indexing_intent: IndexingIntent;
  intended_canonical: string;
  priority: 'high' | 'medium' | 'low';
  owner: string;
  publication_date?: string;
  substantive_update_date?: string;
  applicable_features: string[];
  /** Shared id linking locale variants of the same content (Phase 3 hreflang) */
  translation_group?: string;

  // Phase 4: Page Content and Presentation
  /** The <title> text actually served for this page */
  title?: string;
  /** The meta description text actually served for this page */
  meta_description?: string;
  /** Accountable author for editorial/article content (CONTENT-011) */
  author?: AuthorInfo;
  /** True if an AI system drafted/assisted this content (CONTENT-015) */
  ai_assisted?: boolean;
  /** When a human editor last reviewed this content; required if ai_assisted (CONTENT-015) */
  human_reviewed_at?: string;
}

export interface AuthorInfo {
  name: string;
  /** Profile/bio URL establishing accountability */
  url?: string;
  /** Short credential or role statement, e.g. "Senior SEO Analyst" */
  credential?: string;
}

export type IndexingIntent = 'index' | 'noindex' | 'private' | 'redirect' | 'gone';

// Rules
export interface Rule {
  id: string;
  category: RuleCategory;
  name: string;
  priority: RulePriority;
  evidence: EvidenceLevel;
  impact: ImpactArea;
  automation: AutomationLevel;
  scope: string;
  rule: string;
  verification: string;
  metric: RuleMetric;
  caveats: string[];
  sources: string[];
  last_verified_at: string;
}

export type RuleCategory =
  | 'overall'
  | 'technical'
  | 'on_page'
  | 'content_quality'
  | 'off_page'
  | 'linking'
  | 'experience'
  | 'structured_data'
  | 'media'
  | 'local'
  | 'additional';

export type RulePriority = 'P0' | 'P1' | 'P2';

export type EvidenceLevel =
  | 'requirement'
  | 'confirmed_mechanism'
  | 'official_recommendation'
  | 'engineering_practice'
  | 'hypothesis';

export type ImpactArea =
  | 'eligibility'
  | 'discovery'
  | 'ranking'
  | 'appearance'
  | 'quality'
  | 'trust'
  | 'authority'
  | 'relevance'
  | 'experience'
  | 'operations'
  | 'policy'
  | 'local';

export type AutomationLevel = 'automatic' | 'mixed' | 'manual';

export interface RuleMetric {
  name: string;
  unit: string;
  official_threshold: string | null;
  project_target: string | null;
}

// Audit Results
export type AuditStatus =
  | 'pass'
  | 'fail'
  | 'warning'
  | 'manual_review'
  | 'unknown'
  | 'not_applicable';

export interface AuditFinding {
  rule_id: string;
  url_or_template: string;
  applicable_scope: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: AuditStatus;
  observed_evidence: string;
  expected_behavior: string;
  source_urls: string[];
  observed_at: string;
  verification_coverage: string;
  remediation_owner: string;
}

export interface AuditReport {
  report_date: string;
  site_url: string;
  inventory_coverage: number;
  findings: AuditFinding[];
  category_summary: Record<string, number>;
  priority_summary: Record<RulePriority, number>;
  status_summary: Record<AuditStatus, number>;
}

// Diagnostic Metrics
export interface DiagnosticMetric {
  name: string;
  formula: string;
  target: string;
  caution: string;
  observed_value?: number | string;
  measured_at?: string;
}

// Phase Tracking
export interface ImplementationPhase {
  phase: number;
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  deliverables: PhaseDeliverable[];
  started_at?: string;
  completed_at?: string;
}

export interface PhaseDeliverable {
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  file_path?: string;
}

// Phase 3: Canonicalization and Architecture

/** HTTP redirect status codes Google treats as permanent or temporary signals */
export type RedirectType = 301 | 302 | 307 | 308;

export interface RedirectEntry {
  /** Source path, e.g. '/old-page' */
  from: string;
  /** Destination path or absolute URL — must be the FINAL destination, not an intermediate hop (TECH-029) */
  to: string;
  type: RedirectType;
  /** Why this redirect exists (migration, rename, merge) */
  reason: string;
  created_at: string;
  /**
   * Keep this redirect live until this date. Migration redirects should be
   * retained at least one year (TECH-030).
   */
  retain_until: string;
}

export interface HreflangAlternate {
  /** BCP 47 language tag, or 'x-default' */
  hreflang: string;
  href: string;
}

export interface PaginationSeries {
  /** series identifier, e.g. 'blog-listing' */
  series_id: string;
  /** URL template with {page} placeholder, e.g. '/blog?page={page}' */
  url_template: string;
  total_pages: number;
}

// Phase 4: Page Content and Presentation

/** A JSON-LD structured data object. Shape varies by @type (schema.org). */
export type StructuredDataObject = Record<string, unknown> & {
  '@context': 'https://schema.org';
  '@type': string;
};
