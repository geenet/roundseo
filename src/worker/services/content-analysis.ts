// Content analysis service
export interface ContentMetrics {
  pageUrl: string;
  titleLength?: number;
  contentLength: number;
  wordCount: number;
  readingTimeMinutes: number;
  readabilityScore: number; // 0-100
  keywordDensity: number; // percentage
  uniqueWords: number;
  sentenceCount: number;
  averageWordLength: number;
  h1Count: number;
  h2Count: number;
  heading1Count: number;
  heading2Count: number;
  listCount: number;
  linkCount: number;
  suggestions: ContentSuggestion[];
}

export interface ContentSuggestion {
  type: 'coverage' | 'readability' | 'structure' | 'images';
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  actionItems: string[];
}

export function analyzePageContent(
  pageUrl: string,
  html: string,
  title?: string,
  targetKeyword?: string
): ContentMetrics {
  // Extract text content
  const textContent = extractTextContent(html);
  const words = textContent.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Calculate metrics
  const contentLength = textContent.length;
  const readingTimeMinutes = Math.ceil(wordCount / 200);
  const readabilityScore = calculateReadabilityScore(textContent);
  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  const sentenceCount = textContent.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const averageWordLength = wordCount > 0 ? contentLength / wordCount : 0;

  // Count elements
  const heading1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  const heading2Count = (html.match(/<h2[^>]*>/gi) || []).length;
  const listCount = (html.match(/<[ou]l[^>]*>/gi) || []).length;
  const linkCount = (html.match(/<a[^>]*>/gi) || []).length;

  // Keyword analysis
  const keywordDensity = targetKeyword
    ? calculateKeywordDensity(textContent, targetKeyword)
    : 0;

  // Generate suggestions
  const suggestions = generateContentSuggestions(
    wordCount,
    readabilityScore,
    keywordDensity,
    heading1Count,
    heading2Count,
    listCount,
    uniqueWords,
    sentenceCount,
    targetKeyword
  );

  return {
    pageUrl,
    titleLength: title?.trim().length,
    contentLength,
    wordCount,
    readingTimeMinutes,
    readabilityScore,
    keywordDensity,
    uniqueWords,
    sentenceCount,
    averageWordLength: Math.round(averageWordLength * 10) / 10,
    h1Count: heading1Count,
    h2Count: heading2Count,
    heading1Count,
    heading2Count,
    listCount,
    linkCount,
    suggestions,
  };
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateReadabilityScore(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/);
  const syllables = countSyllables(text);

  if (sentences.length === 0 || words.length === 0) return 0;

  // Flesch Reading Ease formula
  const score = 206.835 -
    1.015 * (words.length / sentences.length) -
    84.6 * (syllables / words.length);

  // Convert to 0-100 scale
  return Math.max(0, Math.min(100, Math.round(score / 10) * 10));
}

function countSyllables(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let syllableCount = 0;

  for (const word of words) {
    syllableCount += estimateSyllables(word);
  }

  return Math.max(1, syllableCount);
}

function estimateSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;

  let syllables = 0;
  let vowels = false;

  for (const char of word) {
    const isVowel = 'aeiouy'.includes(char);

    if (isVowel && !vowels) {
      syllables++;
    }

    vowels = isVowel;
  }

  if (word.endsWith('e')) syllables--;
  if (word.endsWith('le') && word.length > 2) syllables++;

  return Math.max(1, syllables);
}

function calculateKeywordDensity(text: string, keyword: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const keywordLower = keyword.toLowerCase();
  const keywordCount = words.filter(w => w === keywordLower).length;

  return words.length > 0 ? (keywordCount / words.length) * 100 : 0;
}

function generateContentSuggestions(
  wordCount: number,
  readabilityScore: number,
  keywordDensity: number,
  heading1Count: number,
  heading2Count: number,
  listCount: number,
  uniqueWords: number,
  sentenceCount: number,
  targetKeyword?: string
): ContentSuggestion[] {
  const suggestions: ContentSuggestion[] = [];

  // A short page can be perfectly useful (for example, a tool, login screen or
  // product selector). This is deliberately a review prompt, never a minimum
  // word-count rule or a content-quality score.
  if (wordCount < 120) {
    suggestions.push({
      type: 'coverage',
      priority: 'medium',
      title: 'Review whether the page gives visitors enough context',
      description: `The extracted primary text is short (${wordCount} words). That is not a ranking failure: confirm the page still explains the offer or enables the visitor’s task.`,
      actionItems: [
        'Identify the decision or task the page supports',
        'Add only the missing explanation, proof, examples, or interactive help that task needs',
      ],
    });
  }

  // Readability suggestions
  if (readabilityScore < 50) {
    suggestions.push({
      type: 'readability',
      priority: 'high',
      title: 'Content Readability is Poor',
      description: 'Reading score of ' + readabilityScore + ' indicates complex text.',
      actionItems: [
        'Use shorter sentences (15-20 words average)',
        'Break into smaller paragraphs',
        'Use simple, everyday language',
      ],
    });
  } else if (readabilityScore < 70) {
    suggestions.push({
      type: 'readability',
      priority: 'medium',
      title: 'Improve Readability',
      description: 'Reading score can be improved for better user engagement.',
      actionItems: [
        'Simplify complex sentences',
        'Use bullet points and lists',
      ],
    });
  }

  // Keyword density is not a target. Only unusually repetitive phrasing is a
  // useful human review prompt, and it is not expressed as a ranking penalty.
  if (targetKeyword && keywordDensity > 6) {
    suggestions.push({
      type: 'coverage',
      priority: 'medium',
      title: 'Review unusually repeated phrasing',
      description: 'The supplied phrase appears often in the extracted text. Confirm every repetition helps the reader rather than making the copy feel forced.',
      actionItems: [
        'Remove repetitions that add no new meaning',
        'Use precise supporting language, examples, and definitions where they improve clarity',
      ],
    });
  }

  // Structure suggestions
  if (heading1Count === 0) {
    suggestions.push({
      type: 'structure',
      priority: 'high',
      title: 'Missing H1 Tag',
      description: 'Page needs an H1 heading for proper semantic structure.',
      actionItems: [
        'Add one H1 tag at the top of content',
        'H1 should include the main topic/keyword',
      ],
    });
  }

  if (heading1Count > 1) {
    suggestions.push({
      type: 'structure',
      priority: 'low',
      title: 'Review competing main headings',
      description: 'Multiple H1 elements are not automatically an SEO error. Check that they do not introduce competing page purposes.',
      actionItems: [
        'Keep one clear page purpose when the headings represent separate topics',
        'Use supporting headings to organize sections beneath that purpose',
      ],
    });
  }

  if (wordCount > 350 && heading2Count === 0) {
    suggestions.push({
      type: 'structure',
      priority: 'medium',
      title: 'Long content has no supporting sections',
      description: 'A longer page is easier to scan when the main ideas are grouped under descriptive H2 headings.',
      actionItems: [
        'Group related ideas under descriptive H2 headings',
        'Use headings to make the page’s answer easy to scan',
      ],
    });
  }

  if (wordCount > 500 && listCount === 0 && sentenceCount > 15) {
    suggestions.push({
      type: 'structure',
      priority: 'low',
      title: 'Dense content could be easier to scan',
      description: 'The page has several sentences but no list structure for steps, comparisons, or key takeaways.',
      actionItems: [
        'Use a short list where it genuinely clarifies a process or comparison',
        'Keep paragraphs focused on one idea',
      ],
    });
  }

  if (wordCount > 300 && uniqueWords / wordCount < 0.24) {
    suggestions.push({
      type: 'readability',
      priority: 'low',
      title: 'Language is unusually repetitive',
      description: 'The page repeats a small set of words often enough that the copy may feel thin or templated.',
      actionItems: [
        'Replace repeated filler with concrete detail, examples, or definitions',
        'Use precise language rather than repeating the same phrase',
      ],
    });
  }

  return suggestions;
}

/** @deprecated A fabricated content-quality score is intentionally unavailable. */
export function generateContentScore(_metrics: ContentMetrics): null { return null; }
