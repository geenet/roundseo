/**
 * E-E-A-T Signals: Authorship, Freshness, and AI-Content Review
 * Rules: CONTENT-011 (accountable authorship), CONTENT-012 (update when topic
 *        changes), CONTENT-013 (keep dates honest), CONTENT-015 (review
 *        AI-generated content).
 *
 * These signals come from genuine editorial work, not automation — the
 * checks here only verify that the required bookkeeping exists (an author
 * is recorded, a human reviewed AI-assisted copy, dates are coherent), never
 * that the content itself is trustworthy.
 */

import type { PageInventory } from './types';

const ARTICLE_FEATURES = new Set(['Article', 'NewsArticle']);

/**
 * CONTENT-011: Article-type content intended for indexing should carry an
 * accountable author (a name, ideally with a profile URL).
 */
export function validateAuthorship(page: PageInventory): string[] {
  const issues: string[] = [];

  const isArticle = page.applicable_features.some((f) => ARTICLE_FEATURES.has(f));
  if (!isArticle || page.indexing_intent !== 'index') return issues;

  if (!page.author?.name) {
    issues.push(`CONTENT-011: ${page.url} is an article with no accountable author recorded.`);
    return issues;
  }

  if (!page.author.url && !page.author.credential) {
    issues.push(
      `CONTENT-011: ${page.url} has an author name but no profile URL or credential to establish accountability.`
    );
  }

  return issues;
}

/**
 * CONTENT-013: Dates must be internally coherent. A substantive update
 * can't predate original publication, and neither date can be in the future.
 */
export function validateDateHonesty(page: PageInventory): string[] {
  const issues: string[] = [];

  if (!page.publication_date) return issues;

  const published = new Date(page.publication_date).getTime();
  const now = Date.now();

  if (isNaN(published)) {
    issues.push(`CONTENT-013: ${page.url} has an unparseable publication_date "${page.publication_date}".`);
    return issues;
  }

  if (published > now) {
    issues.push(`CONTENT-013: ${page.url} has a publication_date in the future.`);
  }

  if (page.substantive_update_date) {
    const updated = new Date(page.substantive_update_date).getTime();
    if (isNaN(updated)) {
      issues.push(`CONTENT-013: ${page.url} has an unparseable substantive_update_date.`);
    } else {
      if (updated < published) {
        issues.push(`CONTENT-013: ${page.url} substantive_update_date predates its publication_date.`);
      }
      if (updated > now) {
        issues.push(`CONTENT-013: ${page.url} has a substantive_update_date in the future.`);
      }
    }
  }

  return issues;
}

/**
 * CONTENT-012: Flag high-priority indexable content that hasn't been
 * substantively reviewed in a long time, so an editor can decide whether
 * the topic has moved on. This is a diagnostic prompt, not a Google ranking
 * signal — there is no official "freshness" threshold.
 */
export function checkFreshness(page: PageInventory, maxAgeDays = 365): string[] {
  const issues: string[] = [];

  if (page.indexing_intent !== 'index' || page.priority !== 'high') return issues;

  const lastTouched = page.substantive_update_date ?? page.publication_date;
  if (!lastTouched) return issues;

  const lastTouchedMs = new Date(lastTouched).getTime();
  if (isNaN(lastTouchedMs)) return issues;

  const ageDays = (Date.now() - lastTouchedMs) / (1000 * 60 * 60 * 24);
  if (ageDays > maxAgeDays) {
    issues.push(
      `CONTENT-012: ${page.url} has not been substantively updated in ${Math.floor(ageDays)} days (threshold: ${maxAgeDays}). Review whether the topic has changed.`
    );
  }

  return issues;
}

/**
 * CONTENT-015: AI-assisted content must have a recorded human review before
 * (or as part of) publication.
 */
export function validateAiContentReview(page: PageInventory): string[] {
  const issues: string[] = [];

  if (!page.ai_assisted) return issues;

  if (!page.human_reviewed_at) {
    issues.push(
      `CONTENT-015: ${page.url} is AI-assisted but has no recorded human_reviewed_at. AI-generated content requires editorial review before publishing.`
    );
    return issues;
  }

  if (page.publication_date) {
    const reviewed = new Date(page.human_reviewed_at).getTime();
    const published = new Date(page.publication_date).getTime();
    if (!isNaN(reviewed) && !isNaN(published) && reviewed > published) {
      // Reviewed after publishing isn't necessarily wrong (a later audit),
      // but it means the content went live before review — flag it.
      issues.push(
        `CONTENT-015: ${page.url} was published on ${page.publication_date} before its recorded human review on ${page.human_reviewed_at}.`
      );
    }
  }

  return issues;
}

/**
 * Run all E-E-A-T checks for a single page.
 */
export function validatePageEEAT(page: PageInventory, maxFreshnessDays = 365): string[] {
  return [
    ...validateAuthorship(page),
    ...validateDateHonesty(page),
    ...checkFreshness(page, maxFreshnessDays),
    ...validateAiContentReview(page),
  ];
}
