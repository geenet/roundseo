export type ControlStatus = 'pass' | 'fail' | 'review' | 'unknown' | 'not_applicable';
export type ControlGroup = 'Access' | 'Metadata' | 'Canonical' | 'Content' | 'Links' | 'Media' | 'International' | 'Structured data' | 'External evidence';
export interface ControlEvidence { url: string; observed: string; }
export interface AuditControl {
  id: string;
  name: string;
  group: ControlGroup;
  severity: 'critical' | 'high' | 'medium' | 'low';
  basis: 'technical' | 'recommendation' | 'project_policy' | 'manual';
  status: ControlStatus;
  passed: number;
  failed: number;
  unknown: number;
  notApplicable: number;
  denominator: number;
  evidence: ControlEvidence[];
  evidenceTruncated: boolean;
  requirement: string;
  source: string;
}
export interface AuditAssurance {
  version: string;
  scope: string;
  controls: AuditControl[];
  counts: Record<ControlStatus, number>;
  evaluatedInstances: number;
  unknownInstances: number;
  applicableInstances: number;
  coveragePercent: number | null;
  complete: boolean;
  verdict: 'blocked' | 'incomplete' | 'review_required' | 'clear';
}
