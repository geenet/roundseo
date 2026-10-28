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
