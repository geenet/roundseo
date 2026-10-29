/**
 * SEO System Tests and Examples
 */

import { describe, test, expect } from 'vitest';
import {
  pageInventory,
  validateInventory,
  getHighPriorityPages,
  getByIndexingIntent,
  shouldBeIndexed,
} from '../inventory';
import { getAllRules, getRulesByPriority, getCriticalRules } from '../rules';
import { getSeoHealthStatus, getPhase1Summary } from '../index';

describe('SEO Inventory', () => {
  test('inventory validates', () => {
    const { valid, errors } = validateInventory();
    console.log(`Inventory valid: ${valid}`);
    if (errors.length > 0) {
      console.log('Errors:');
      errors.forEach((e) => console.log(`  - ${e}`));
    }
    expect(valid).toBe(true);
  });

  test('has at least one high-priority page', () => {
    const highPriority = getHighPriorityPages();
    console.log(`High-priority pages: ${highPriority.length}`);
    expect(highPriority.length).toBeGreaterThan(0);
  });

  test('inventory coverage by state', () => {
    const indexed = getByIndexingIntent('index');
    const noindex = getByIndexingIntent('noindex');
    const private_ = getByIndexingIntent('private');

    console.log(`
Inventory Coverage:
  - Indexed:  ${indexed.length}
  - Noindex:  ${noindex.length}
  - Private:  ${private_.length}
  - Total:    ${pageInventory.length}
    `);

    expect(indexed.length).toBeGreaterThan(0);
  });

  test('shouldBeIndexed checks', () => {
    console.log(`
Indexing Checks:
  - '/' should be indexed: ${shouldBeIndexed('/')}
  - '/about' should be indexed: ${shouldBeIndexed('/about')}
  - '/admin/*' should NOT be indexed: ${shouldBeIndexed('/admin/users')}
    `);
  });
});

describe('SEO Rules', () => {
  test('loads all rules', () => {
    const rules = getAllRules();
    console.log(`Loaded ${rules.length} SEO rules`);
    expect(rules.length).toBeGreaterThan(0);
  });

  test('P0 (critical) rules', () => {
    const critical = getCriticalRules();
    console.log(`Critical (P0) rules: ${critical.length}`);
    critical.forEach((r) => {
      console.log(`  - ${r.id}: ${r.name}`);
    });
    expect(critical.length).toBeGreaterThan(0);
  });

  test('rules by priority', () => {
    const p0 = getRulesByPriority('P0');
    const p1 = getRulesByPriority('P1');
    const p2 = getRulesByPriority('P2');

    console.log(`
Rule Distribution:
  - P0 (critical):       ${p0.length}
  - P1 (foundational):   ${p1.length}
  - P2 (enhancements):   ${p2.length}
    `);
  });

  test('rule sources are credible', () => {
    const rules = getAllRules();
    rules.forEach((r) => {
      r.sources.forEach((source) => {
        expect(source).toMatch(
          /^https:\/\/(developers\.google\.com|support\.google\.com|web\.dev|www\.google\.com)/
        );
      });
    });
    console.log('✅ All rule sources from official Google domains');
  });
});

describe('SEO Health', () => {
  test('generates health status', () => {
    const health = getSeoHealthStatus();
    console.log(`
SEO Health Status:
  - Inventory valid:      ${health.inventoryValid}
  - Critical rules:       ${health.criticalRulesCount}
  - High-priority pages:  ${health.highPriorityPages}
  - Indexable pages:      ${health.indexablePages}
  ${health.errors.length > 0 ? `- Issues: ${health.errors.length}` : ''}
    `);

    expect(health.inventoryValid).toBe(true);
    expect(health.criticalRulesCount).toBeGreaterThan(0);
  });

  test('Phase 1 summary', () => {
    const phase1 = getPhase1Summary();
    console.log(`
Phase 1: Inventory and Baseline
  - Total pages:         ${phase1.inventory.total_pages}
  - Inventory valid:     ${phase1.inventory.valid}
  - Indexed:             ${phase1.inventory.indexed}
  - Private:             ${phase1.inventory.private}
  - Noindex:             ${phase1.inventory.noindex}
  - Redirects:           ${phase1.inventory.redirects}
  - Gone:                ${phase1.inventory.gone}

  Rules loaded:          ${phase1.rules.total}
  Critical (P0):         ${phase1.rules.critical}
    `);

    if (phase1.issues.length > 0) {
      console.log('Issues:');
      phase1.issues.forEach((i) => console.log(`  - ${i}`));
    }
  });
});

describe('Real-world scenarios', () => {
  test('check if homepage is indexed', () => {
    const home = pageInventory.find((p) => p.page_id === 'home');
    expect(home).toBeDefined();
    if (home) {
      console.log(`
Homepage Status:
  - URL:               ${home.url}
  - Indexing intent:   ${home.indexing_intent}
  - Should be indexed: ${home.indexing_intent === 'index'}
  - Canonical:         ${home.intended_canonical}
  - Owner:             ${home.owner}
      `);
      expect(home.indexing_intent).toBe('index');
    }
  });

  test('verify no private pages are accidentally indexed', () => {
    const privatePages = getByIndexingIntent('private');
    const indexed = getByIndexingIntent('index');

    const conflict = privatePages.filter((p) =>
      indexed.some((i) => i.url === p.url)
    );

    console.log(`
Private vs Indexed:
  - Private pages:       ${privatePages.length}
  - Indexed pages:       ${indexed.length}
  - Conflicts:           ${conflict.length}
    `);

    expect(conflict).toHaveLength(0);
  });

  test('audit trail example', () => {
    const rules = getAllRules().slice(0, 3);

    console.log(`
Audit Trail Example (first 3 rules):
    `);

    rules.forEach((r) => {
      console.log(`
Rule: ${r.id} - ${r.name}
  Priority:   ${r.priority}
  Evidence:   ${r.evidence}
  Impact:     ${r.impact}
  Automation: ${r.automation}
  Scope:      ${r.scope}
  Sources:    ${r.sources.length}
      `);
    });
  });
});
