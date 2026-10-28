/**
 * SEO Service - Main entry point
 * Integrates inventory, rules, and verification
 */

import {
  pageInventory,
  getByIndexingIntent,
  getHighPriorityPages,
  validateInventory,
} from './inventory';
import { getCriticalRules, getRuleStatistics } from './rules';

// Register Phase 2 checks on module load
import './checks/phase2';

export * from './types';
export * from './inventory';
export * from './rules';
export * from './verifier';
export * from './robots';
export * from './sitemap';
export * from './metadata';

/**
 * Quick health check: are critical SEO requirements met?
 */
export function getSeoHealthStatus(): {
  inventoryValid: boolean;
  criticalRulesCount: number;
  highPriorityPages: number;
  indexablePages: number;
  errors: string[];
} {
  const { valid, errors } = validateInventory();
  const criticalRules = getCriticalRules();
  const highPriorityPages = getHighPriorityPages();
  const indexable = getByIndexingIntent('index');

  return {
    inventoryValid: valid,
    criticalRulesCount: criticalRules.length,
    highPriorityPages: highPriorityPages.length,
    indexablePages: indexable.length,
    errors,
  };
}

/**
 * Get implementation summary for Phase 1
 */
export function getPhase1Summary() {
  const health = getSeoHealthStatus();
  const ruleStats = getRuleStatistics();

  return {
    phase: 1,
    name: 'Inventory and baseline',
    inventory: {
      total_pages: pageInventory.length,
      valid: health.inventoryValid,
      indexed: health.indexablePages,
      private: getByIndexingIntent('private').length,
      noindex: getByIndexingIntent('noindex').length,
      redirects: getByIndexingIntent('redirect').length,
      gone: getByIndexingIntent('gone').length,
    },
    rules: {
      critical: health.criticalRulesCount,
      ...ruleStats,
    },
    issues: health.errors,
  };
}
