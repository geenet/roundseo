/**
 * SEO Service - Main entry point
 * Integrates inventory, rules, and verification
 */

export * from './types';
export * from './inventory';
export * from './rules';
export * from './verifier';

// Convenience exports
export {
  getAllRules,
  getRule,
  getRulesByCategory,
  getRulesByPriority,
  getCriticalRules,
  getRuleStatistics,
} from './rules';

export {
  pageInventory,
  getByIndexingIntent,
  getHighPriorityPages,
  shouldBeIndexed,
  validateInventory,
} from './inventory';

export { runChecks, generateAuditReport, registerCheck } from './verifier';

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
      total: ruleStats.total,
      critical: health.criticalRulesCount,
      ...ruleStats,
    },
    issues: health.errors,
  };
}
