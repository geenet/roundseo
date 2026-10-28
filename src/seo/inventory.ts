/**
 * Page Inventory Management
 * Declarative source of truth for all indexable and non-indexable URLs
 */

import { PageInventory, IndexingIntent } from './types';

/**
 * Central page inventory: define which URLs should appear in Search,
 * their purpose, and their intended state
 */
export const pageInventory: PageInventory[] = [
  {
    page_id: 'home',
    url: '/',
    page_type: 'home',
    locale: 'en',
    audience_task: 'Understand the site purpose and navigate to main sections',
    indexing_intent: 'index',
    intended_canonical: 'https://example.com/',
    priority: 'high',
    owner: 'content-team',
    publication_date: '2026-01-01',
    applicable_features: ['Article', 'Organization'],
  },
  {
    page_id: 'about',
    url: '/about',
    page_type: 'article',
    locale: 'en',
    audience_task: 'Learn about the organization and mission',
    indexing_intent: 'index',
    intended_canonical: 'https://example.com/about',
    priority: 'high',
    owner: 'marketing',
    publication_date: '2026-01-01',
    applicable_features: ['Article', 'Organization'],
  },
  {
    page_id: 'contact',
    url: '/contact',
    page_type: 'form',
    locale: 'en',
    audience_task: 'Contact the organization',
    indexing_intent: 'index',
    intended_canonical: 'https://example.com/contact',
    priority: 'medium',
    owner: 'support',
    applicable_features: ['ContactPage'],
  },
  {
    page_id: 'auth-login',
    url: '/auth/login',
    page_type: 'form',
    locale: 'en',
    audience_task: 'Authenticate access to member area',
    indexing_intent: 'private',
    intended_canonical: 'https://example.com/auth/login',
    priority: 'low',
    owner: 'platform',
    applicable_features: [],
  },
  {
    page_id: 'admin-panel',
    url: '/admin/*',
    page_type: 'application',
    locale: 'en',
    audience_task: 'Administrative dashboard',
    indexing_intent: 'private',
    intended_canonical: 'https://example.com/admin/',
    priority: 'low',
    owner: 'platform',
    applicable_features: [],
  },
];

/**
 * Helper: Get inventory entries by indexing intent
 */
export function getByIndexingIntent(intent: IndexingIntent): PageInventory[] {
  return pageInventory.filter((p) => p.indexing_intent === intent);
}

/**
 * Helper: Get high-priority pages
 */
export function getHighPriorityPages(): PageInventory[] {
  return pageInventory.filter((p) => p.priority === 'high');
}

/**
 * Helper: Check if URL should be indexed
 */
export function shouldBeIndexed(url: string): boolean {
  const entry = pageInventory.find((p) => p.url === url || p.url.endsWith('*'));
  return entry ? entry.indexing_intent === 'index' : false;
}

/**
 * Inventory validation: ensure consistency
 */
export function validateInventory(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const seenUrls = new Set<string>();

  pageInventory.forEach((page, idx) => {
    if (!page.page_id) errors.push(`Page ${idx}: missing page_id`);
    if (!page.url) errors.push(`Page ${idx}: missing url`);
    if (!page.indexing_intent) errors.push(`Page ${idx}: missing indexing_intent`);
    if (!page.owner) errors.push(`Page ${idx}: missing owner`);

    if (seenUrls.has(page.url)) {
      errors.push(`Duplicate URL: ${page.url}`);
    }
    seenUrls.add(page.url);

    const validIntents: IndexingIntent[] = [
      'index',
      'noindex',
      'private',
      'redirect',
      'gone',
    ];
    if (!validIntents.includes(page.indexing_intent)) {
      errors.push(
        `Page ${page.page_id}: invalid indexing_intent: ${page.indexing_intent}`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
