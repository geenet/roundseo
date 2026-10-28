// RoundSEO API Contracts & Data Types

export const V2_SCHEMA_VERSION = 2 as const;

// Auth Types
export type AuthMethod = 'google_oauth' | 'email_password';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  authMethod: AuthMethod;
  createdAt: string;
  lastLoginAt: string;
}

// Organization & Team
export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  billingEmail: string;
  plan: 'starter' | 'professional' | 'enterprise';
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  members: TeamMember[];
  createdAt: string;
}

export type TeamRole = 'admin' | 'manager' | 'analyst' | 'client';

export interface TeamMember {
  userId: string;
  role: TeamRole;
  joinedAt: string;
}

// Website Management
export interface Website {
  id: string;
  organizationId: string;
  name: string;
  domain: string;
  url: string;
  createdAt: string;
  lastCrawledAt?: string;
  crawlSchedule: 'daily' | 'weekly' | 'monthly' | 'never';
  crawlDelay: number; // in seconds
  isActive: boolean;
}

// SEO Audit Results
export interface AuditResult {
  id: string;
  websiteId: string;
  auditType: 'on_demand' | 'scheduled';
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  crawlData: CrawlData;
  metrics: SEOMetrics;
  recommendations: Recommendation[];
  reportUrl?: string;
}

export interface CrawlData {
  totalPages: number;
  crawledPages: number;
  errors: CrawlError[];
  pages: PageData[];
}

export interface CrawlError {
  url: string;
  errorCode: number;
  errorMessage: string;
}

export interface PageData {
  url: string;
  statusCode: number;
  title?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  robots?: string;
  h1?: string;
  headings: HeadingData[];
  links: LinkData[];
  images: ImageData[];
  wordCount: number;
  readabilityScore?: number;
  loadTimeMs?: number;
  mobileScore?: number;
  desktopScore?: number;
  coreWebVitals?: CoreWebVitals;
}

export interface HeadingData {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  count: number;
}

export interface LinkData {
  url: string;
  isInternal: boolean;
  isNofollow: boolean;
  anchorText?: string;
}

export interface ImageData {
  src: string;
  alt?: string;
  hasAlt: boolean;
  title?: string;
}

export interface CoreWebVitals {
  lcp?: number; // Largest Contentful Paint (ms)
  fid?: number; // First Input Delay (ms)
  cls?: number; // Cumulative Layout Shift
  inp?: number; // Interaction to Next Paint (ms)
}

// SEO Metrics
export interface SEOMetrics {
  indexability: IndexabilityMetrics;
  onPage: OnPageMetrics;
  technicalSEO: TechnicalSEOMetrics;
  internalLinking: InternalLinkingMetrics;
  performance: PerformanceMetrics;
  mobileUsability: MobileMetrics;
  overallScore: number; // 0-100
}

export interface IndexabilityMetrics {
  crawlablePages: number;
  notFoundPages: number;
  redirectPages: number;
  pagesWithRobots: number;
  pagesWithNoindex: number;
  missingRobotsTxt: boolean;
  missingSitemap: boolean;
}

export interface OnPageMetrics {
  pagesWithTitleTag: number;
  pagesWithMissingTitle: number;
  pagesWithDuplicateTitle: number;
  pagesWithMetaDescription: number;
  pagesWithMissingMetaDescription: number;
  pagesWithMissingH1: number;
  pagesWithMultipleH1: number;
  averageWordCount: number;
  pagesWithKeywordInTitle: number;
  pagesWithKeywordInDescription: number;
}

export interface TechnicalSEOMetrics {
  mobileOptimized: boolean;
  mobileReadable: boolean;
  hasSSL: boolean;
  httpToHttpsRedirect: boolean;
  averageLoadTimeMs: number;
  pagesWithImageAlt: number;
  pagesWithoutAlt: number;
  hasStructuredData: boolean;
  crawlErrors: number;
  brokenLinks: number;
}

export interface InternalLinkingMetrics {
  totalInternalLinks: number;
  internalLinkDensity: number;
  orphanedPages: number;
  deeplyNestedPages: number;
  pagesWithoutInternalLinks: number;
}

export interface PerformanceMetrics {
  averageLCP: number;
  averageFID?: number;
  averageINP: number;
  averageCLS: number;
  fastLoadingPages: number;
  slowLoadingPages: number;
}

export interface MobileMetrics {
  mobileViewportConfigured: boolean;
  textSizeReadable: boolean;
  clickableElementsProper: boolean;
  noFlashContent: boolean;
}

// Recommendations
export interface Recommendation {
  id: string;
  category: 'on_page' | 'technical' | 'off_page' | 'content' | 'performance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedPages: number;
  impact: string; // Expected impact on rankings/traffic
  actionItems: string[];
  resources?: string[]; // Links to guides or tools
  estimatedEffort: 'quick_win' | 'medium' | 'complex';
}

// Keyword Rankings
export interface KeywordRanking {
  id: string;
  websiteId: string;
  keyword: string;
  currentRank?: number;
  previousRank?: number;
  estimatedTraffic: number;
  volume: number;
  difficulty: number; // 0-100
  trend: 'up' | 'down' | 'stable';
  trackingStartDate: string;
  lastCheckedAt: string;
}

// Reports
export interface Report {
  id: string;
  auditId: string;
  websiteId: string;
  type: 'full' | 'executive' | 'technical';
  generatedAt: string;
  expiresAt?: string;
  shareToken?: string;
  shareEmail?: string;
  includeRecommendations: boolean;
  includePreviousComparison: boolean;
}

// API Responses
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}
