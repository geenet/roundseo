import type { AnswerEngine, CitationEvidence } from '../../shared/intelligence';
import { IntelligenceError } from './errors';
import { absoluteHttpUrl, domainOf, collapseWhitespace } from './html';
import { fetchProviderJson, type IntelligenceFetch } from './http';

export const ANSWER_METHOD = 'answer-engine-api-v1';
export const DEFAULT_ENGINE_MODELS: Record<AnswerEngine, string> = {
  claude: 'claude-sonnet-5-5',
  chatgpt: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
  perplexity: 'sonar',
};

const MAX_PROMPT_CHARACTERS = 2_000;
const MAX_OUTPUT_TOKENS = 2_048;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export interface AnswerRequest {
  engine: AnswerEngine;
  model: string;
  prompt: string;
  systemInstruction?: string;
  maximumOutputTokens: number;
  useWeb: boolean;
}

export interface AnswerObservation {
  engine: AnswerEngine;
  model: string;
  responseText: string | null;
  webSearchUsed: boolean;
  citations: CitationEvidence[];
  observedAt: string;
}

const ENGINE_HOSTS: Record<AnswerEngine, string> = {
  claude: 'api.anthropic.com',
  chatgpt: 'api.openai.com',
  gemini: 'generativelanguage.googleapis.com',
  perplexity: 'api.perplexity.ai',
};

/** Ask one answer engine through its official API and parse text plus citations. */
export async function askAnswerEngine(
  request: AnswerRequest,
  apiKey: string,
  options: { fetcher?: IntelligenceFetch; now?: () => Date } = {},
): Promise<AnswerObservation> {
  const model = request.model.trim();
  if (!MODEL_NAME.test(model)) throw new IntelligenceError('Enter a valid model name for this answer engine.', { status: 400, code: 'INVALID_MODEL' });
  const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARACTERS);
  if (!prompt) throw new IntelligenceError('Enter a prompt to sample.', { status: 400, code: 'INVALID_PROMPT' });
  const maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(64, request.maximumOutputTokens));
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const call = (url: string, init: RequestInit) => fetchProviderJson(url, init, { fetcher: options.fetcher, allowedHosts: [ENGINE_HOSTS[request.engine]] });

  switch (request.engine) {
    case 'claude': {
      const body = {
        model,
        max_tokens: maxTokens,
        ...(request.systemInstruction ? { system: request.systemInstruction.slice(0, 1_000) } : {}),
        messages: [{ role: 'user', content: prompt }],
        ...(request.useWeb ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}),
      };
      const response = await call(`https://${ENGINE_HOSTS.claude}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assertOk(response.status);
      return { engine: 'claude', model, ...parseClaude(response.body, request.useWeb), observedAt };
    }
    case 'chatgpt': {
      const body = {
        model,
        input: prompt,
        ...(request.systemInstruction ? { instructions: request.systemInstruction.slice(0, 1_000) } : {}),
        max_output_tokens: maxTokens,
        ...(request.useWeb ? { tools: [{ type: 'web_search' }] } : {}),
      };
      const response = await call(`https://${ENGINE_HOSTS.chatgpt}/v1/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assertOk(response.status);
      return { engine: 'chatgpt', model, ...parseOpenAi(response.body, request.useWeb), observedAt };
    }
    case 'gemini': {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(request.systemInstruction ? { systemInstruction: { parts: [{ text: request.systemInstruction.slice(0, 1_000) }] } } : {}),
        generationConfig: { maxOutputTokens: maxTokens },
        ...(request.useWeb ? { tools: [{ google_search: {} }] } : {}),
      };
      const response = await call(`https://${ENGINE_HOSTS.gemini}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assertOk(response.status);
      return { engine: 'gemini', model, ...parseGemini(response.body, request.useWeb), observedAt };
    }
    case 'perplexity': {
      const messages = [
        ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction.slice(0, 1_000) }] : []),
        { role: 'user', content: prompt },
      ];
      const response = await call(`https://${ENGINE_HOSTS.perplexity}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      });
      assertOk(response.status);
      return { engine: 'perplexity', model, ...parsePerplexity(response.body), observedAt };
    }
  }
}

export function defaultModelFor(engine: AnswerEngine): string {
  return DEFAULT_ENGINE_MODELS[engine];
}

function assertOk(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 429) throw new IntelligenceError('The answer engine is rate-limiting requests. Try again later.', { status: 429, code: 'ANSWER_ENGINE_RATE_LIMITED' });
  if (status === 401 || status === 403) throw new IntelligenceError('The answer engine rejected the configured credentials.', { status: 502, code: 'ANSWER_ENGINE_REJECTED' });
  throw new IntelligenceError('The answer engine did not return an answer for this prompt.', { status: 502, code: 'ANSWER_ENGINE_UNAVAILABLE' });
}

type Json = Record<string, unknown>;
function obj(value: unknown): Json { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {}; }
function list(value: unknown): Json[] { return Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null) : []; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }

function citationFrom(url: unknown, title: unknown): CitationEvidence | null {
  const safe = absoluteHttpUrl(text(url));
  if (!safe) return null;
  const label = text(title);
  return { url: safe, domain: domainOf(safe), title: label };
}

function uniqueCitations(items: Array<CitationEvidence | null>): CitationEvidence[] {
  const seen = new Set<string>();
  const output: CitationEvidence[] = [];
  for (const item of items) {
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
    if (output.length >= 50) break;
  }
  return output;
}

function parseClaude(body: unknown, useWeb: boolean): { responseText: string | null; webSearchUsed: boolean; citations: CitationEvidence[] } {
  const blocks = list(obj(body).content);
  const responseText = collapseWhitespace(blocks.filter(block => block.type === 'text').map(block => text(block.text) || '').join('\n\n')) || null;
  const citations = uniqueCitations([
    ...blocks.filter(block => block.type === 'text').flatMap(block => list(block.citations).map(citation => citationFrom(citation.url, citation.title))),
    ...blocks.filter(block => block.type === 'web_search_tool_result').flatMap(block => list(block.content).map(result => citationFrom(result.url, result.title))),
  ]);
  return { responseText, webSearchUsed: useWeb && blocks.some(block => block.type === 'web_search_tool_result' || block.type === 'server_tool_use'), citations };
}

function parseOpenAi(body: unknown, useWeb: boolean): { responseText: string | null; webSearchUsed: boolean; citations: CitationEvidence[] } {
  const root = obj(body);
  const output = list(root.output);
  const messages = output.filter(item => item.type === 'message');
  const parts = messages.flatMap(message => list(message.content));
  const fromParts = parts.filter(part => part.type === 'output_text').map(part => text(part.text) || '').join('\n\n');
  const responseText = collapseWhitespace(text(root.output_text) || fromParts) || null;
  const citations = uniqueCitations(parts.flatMap(part => list(part.annotations).filter(annotation => annotation.type === 'url_citation').map(annotation => citationFrom(annotation.url, annotation.title))));
  return { responseText, webSearchUsed: useWeb && output.some(item => item.type === 'web_search_call'), citations };
}

function parseGemini(body: unknown, useWeb: boolean): { responseText: string | null; webSearchUsed: boolean; citations: CitationEvidence[] } {
  const candidate = list(obj(body).candidates)[0] || {};
  const parts = list(obj(candidate.content).parts);
  const responseText = collapseWhitespace(parts.map(part => text(part.text) || '').join('\n\n')) || null;
  const grounding = obj(candidate.groundingMetadata);
  const citations = uniqueCitations(list(grounding.groundingChunks).map(chunk => {
    const web = obj(chunk.web);
    return citationFrom(web.uri, web.title);
  }));
  const searches = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [];
  return { responseText, webSearchUsed: useWeb && searches.length > 0, citations };
}

function parsePerplexity(body: unknown): { responseText: string | null; webSearchUsed: boolean; citations: CitationEvidence[] } {
  const root = obj(body);
  const message = obj(list(root.choices)[0]?.message);
  const responseText = collapseWhitespace(text(message.content) || '') || null;
  const fromUrls = Array.isArray(root.citations) ? root.citations.map(url => citationFrom(url, null)) : [];
  const fromResults = list(root.search_results).map(result => citationFrom(result.url, result.title));
  return { responseText, webSearchUsed: true, citations: uniqueCitations([...fromUrls, ...fromResults]) };
}
