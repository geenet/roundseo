// Intelligent recommendations engine
import { nanoid } from 'nanoid';

export interface Recommendation {
  id: string;
  auditId: string;
  websiteId: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affectedPages: number;
  estimatedImpact: 'low' | 'medium' | 'high';
  estimatedEffort: 'quick' | 'medium' | 'hard';
  implementationSteps: string[];
  resources: { title: string; url: string }[];
  isFixed: boolean;
  fixedAt?: string;
  createdAt: string;
}

export interface ImpactScore {
  trafficGain: number; // estimated organic traffic increase %
  difficulty: number; // 1-100, effort required
  priority: number; // 1-100, overall priority
}

export async function generateSmartRecommendations(
  db: any,
  auditId: string,
  websiteId: string,
  metrics: any
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];
  const now = new Date().toISOString();

  // Check SEO score and generate recommendations
  const recommendations_list = buildRecommendationsList(metrics, auditId, websiteId);

  // Calculate impact scores and prioritize
  const prioritized = recommendations_list
    .map(rec => ({
      ...rec,
      impactScore: calculateImpactScore(rec),
    }))
    .sort((a, b) => b.impactScore.priority - a.impactScore.priority);

  // Save to database
  for (const rec of prioritized) {
    const id = `rec_${nanoid(16)}`;
    await db.prepare(`
      INSERT INTO recommendations (
        id, audit_id, website_id, category, priority, title, description,
        affected_pages, estimated_impact, estimated_effort, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auditId,
      websiteId,
      rec.category,
      rec.priority,
      rec.title,
      rec.description,
      rec.affectedPages,
      rec.estimatedImpact,
      rec.estimatedEffort,
      now
    ).run();

    recommendations.push({
      id,
      auditId,
      websiteId,
      category: rec.category,
      priority: rec.priority,
      title: rec.title,
      description: rec.description,
      affectedPages: rec.affectedPages,
      estimatedImpact: rec.estimatedImpact,
      estimatedEffort: rec.estimatedEffort,
      implementationSteps: rec.implementationSteps,
      resources: rec.resources,
      isFixed: false,
      createdAt: now,
    });
  }

  return recommendations;
}

function buildRecommendationsList(metrics: any, auditId: string, websiteId: string): Omit<Recommendation, 'id' | 'createdAt' | 'isFixed' | 'fixedAt'>[] {
  const recs: Omit<Recommendation, 'id' | 'createdAt' | 'isFixed' | 'fixedAt'>[] = [];

  // Title tag optimization
  if (metrics.pagesWithoutTitle > 0) {
    recs.push({
      auditId,
      websiteId,
      category: 'onpage',
      priority: 'high',
      title: `Fix ${metrics.pagesWithoutTitle} pages without title tags`,
      description: 'Title tags are crucial for SEO and user engagement. Each page should have a unique, descriptive title (50-60 characters).',
      affectedPages: metrics.pagesWithoutTitle,
      estimatedImpact: 'high',
      estimatedEffort: 'quick',
      implementationSteps: [
        'Identify all pages missing title tags',
        'Write unique, descriptive titles (50-60 chars) including target keyword',
        'Ensure each title is different',
        'Test in SERP preview to verify display',
      ],
      resources: [
        { title: 'Title Tag Best Practices', url: 'https://moz.com/learn/seo/title-tag' },
        { title: 'Google Title Tag Guidelines', url: 'https://support.google.com/webmasters/answer/35624' },
      ],
    });
  }

  // Meta description optimization
  if (metrics.pagesWithoutMetaDescription > 0) {
    recs.push({
      auditId,
      websiteId,
      category: 'onpage',
      priority: 'high',
      title: `Add meta descriptions to ${metrics.pagesWithoutMetaDescription} pages`,
      description: 'Meta descriptions improve click-through rates from search results. Each page needs a unique description (150-160 characters).',
      affectedPages: metrics.pagesWithoutMetaDescription,
      estimatedImpact: 'high',
      estimatedEffort: 'quick',
      implementationSteps: [
        'Identify pages missing meta descriptions',
        'Write compelling descriptions (150-160 chars)',
        'Include target keywords naturally',
        'Make each description unique',
      ],
      resources: [
        { title: 'Meta Description Guide', url: 'https://moz.com/learn/seo/meta-description' },
      ],
    });
  }

  // H1 tag optimization
  if (metrics.pagesWithMultipleH1 > 0) {
    recs.push({
      auditId,
      websiteId,
      category: 'onpage',
      priority: 'medium',
      title: `Fix ${metrics.pagesWithMultipleH1} pages with multiple H1 tags`,
      description: 'Each page should have exactly one H1 tag. Multiple H1s confuse search engines about page hierarchy.',
      affectedPages: metrics.pagesWithMultipleH1,
      estimatedImpact: 'medium',
      estimatedEffort: 'quick',
      implementationSteps: [
        'Find pages with multiple H1 tags',
        'Keep the most important H1',
        'Convert other H1s to H2 or H3',
      ],
      resources: [
        { title: 'Heading Tags Best Practices', url: 'https://moz.com/learn/seo/heading-tag' },
      ],
    });
  }

  // Indexability issues
  if (metrics.indexabilityScore < 80) {
    recs.push({
      auditId,
      websiteId,
      category: 'indexability',
      priority: 'critical',
      title: 'Fix indexability issues affecting crawlability',
      description: 'Low indexability score indicates pages are being blocked from Google search. This is a critical SEO issue.',
      affectedPages: Math.round(metrics.totalPages * (100 - metrics.indexabilityScore) / 100),
      estimatedImpact: 'high',
      estimatedEffort: 'hard',
      implementationSteps: [
        'Check Google Search Console for crawl errors',
        'Review robots.txt for blocks',
        'Check for noindex directives',
        'Fix 404s and redirects',
        'Ensure HTTPS is working',
        'Fix internal link structure',
      ],
      resources: [
        { title: 'Google Search Console', url: 'https://search.google.com/search-console' },
        { title: 'Crawl Errors Guide', url: 'https://support.google.com/webmasters/answer/7440203' },
      ],
    });
  }

  // Internal linking
  if (metrics.internalLinkingScore < 70) {
    recs.push({
      auditId,
      websiteId,
      category: 'linking',
      priority: 'medium',
      title: 'Improve internal linking structure',
      description: 'Strong internal linking helps distribute page authority and improves crawlability.',
      affectedPages: Math.round(metrics.totalPages * 0.5),
      estimatedImpact: 'medium',
      estimatedEffort: 'medium',
      implementationSteps: [
        'Map out your site structure',
        'Identify pages with few internal links',
        'Add relevant internal links with keyword anchor text',
        'Ensure every page is linked from at least 2-3 other pages',
        'Use descriptive anchor text',
      ],
      resources: [
        { title: 'Internal Linking Guide', url: 'https://moz.com/learn/seo/internal-link' },
      ],
    });
  }

  // Mobile optimization
  if (metrics.mobileScore && metrics.mobileScore < 70) {
    recs.push({
      auditId,
      websiteId,
      category: 'technical',
      priority: 'high',
      title: 'Improve mobile usability',
      description: 'With mobile-first indexing, mobile usability is critical. Fix any mobile-specific issues.',
      affectedPages: metrics.totalPages,
      estimatedImpact: 'high',
      estimatedEffort: 'hard',
      implementationSteps: [
        'Test on mobile using Google Mobile-Friendly Test',
        'Fix viewport settings',
        'Ensure clickable elements are properly sized',
        'Avoid problematic interstitials',
        'Optimize images for mobile',
      ],
      resources: [
        { title: 'Mobile-Friendly Test', url: 'https://search.google.com/test/mobile-friendly' },
        { title: 'Mobile SEO Guide', url: 'https://moz.com/learn/seo/mobile' },
      ],
    });
  }

  return recs;
}

function calculateImpactScore(rec: Omit<Recommendation, 'id' | 'createdAt' | 'isFixed' | 'fixedAt'>): ImpactScore {
  // Base traffic impact by category and priority
  const baseImpact: Record<string, Record<string, number>> = {
    'onpage': { 'critical': 30, 'high': 20, 'medium': 10, 'low': 5 },
    'technical': { 'critical': 40, 'high': 25, 'medium': 15, 'low': 5 },
    'indexability': { 'critical': 50, 'high': 30, 'medium': 15, 'low': 5 },
    'linking': { 'critical': 25, 'high': 20, 'medium': 10, 'low': 5 },
  };

  const trafficGain = baseImpact[rec.category]?.[rec.priority] || 5;

  // Effort scoring
  const effortScore: Record<string, number> = {
    'quick': 20,
    'medium': 50,
    'hard': 80,
  };

  const difficulty = effortScore[rec.estimatedEffort] || 50;

  // Priority = impact / (difficulty * time_factor) * page_impact_factor
  const pageImpactFactor = rec.affectedPages > 10 ? 1.5 : rec.affectedPages > 3 ? 1.2 : 1.0;
  const priority = (trafficGain * pageImpactFactor) / (1 + (difficulty / 50));

  return {
    trafficGain,
    difficulty,
    priority: Math.round(priority),
  };
}

export async function getRecommendationsByPriority(
  db: any,
  websiteId: string,
  limit = 10
): Promise<Recommendation[]> {
  const result = await db.prepare(`
    SELECT * FROM recommendations
    WHERE website_id = ? AND is_fixed = FALSE
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      affected_pages DESC
    LIMIT ?
  `).bind(websiteId, limit).all();

  return result.results.map(mapRecommendationRow);
}

function mapRecommendationRow(row: any): Recommendation {
  return {
    id: row.id,
    auditId: row.audit_id,
    websiteId: row.website_id,
    category: row.category,
    priority: row.priority,
    title: row.title,
    description: row.description,
    affectedPages: row.affected_pages,
    estimatedImpact: row.estimated_impact,
    estimatedEffort: row.estimated_effort,
    implementationSteps: [], // Would be parsed from DB in production
    resources: [], // Would be fetched separately
    isFixed: row.is_fixed,
    fixedAt: row.fixed_at,
    createdAt: row.created_at,
  };
}
