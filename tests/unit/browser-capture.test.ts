import { describe, expect, it } from 'vitest';
import { captureRequestProblem, parseRenderRequest, parseScreenshotRequest } from '../../src/local/browser-capture';

describe('browser capture requests', () => {
  it('accepts a public URL with optional device and locale fields', () => {
    expect(captureRequestProblem({ url: 'https://example.com/', device: 'mobile', countryCode: 'us', languageCode: 'en-US', fullPage: false })).toBeNull();
  });

  it('refuses non-public, credentialed, and malformed input before a browser starts', () => {
    expect(captureRequestProblem({ url: 'http://127.0.0.1/' })).toMatch(/public/);
    expect(captureRequestProblem({ url: 'https://user:pass@example.com/' })).toMatch(/public/);
    expect(captureRequestProblem({ url: 'https://example.com/', device: 'watch' })).toMatch(/desktop, mobile, or tablet/);
    expect(captureRequestProblem({ url: 'https://example.com/', countryCode: 'USA' })).toMatch(/two-letter/);
    expect(captureRequestProblem({ url: 'https://example.com/', fullPage: 'yes' })).toMatch(/fullPage/);
    expect(captureRequestProblem(null)).toMatch(/JSON object/);
  });

  it('normalizes locale and defaults the device when parsing', () => {
    expect(parseRenderRequest({ url: 'https://example.com/', countryCode: 'pl', languageCode: 'PL' })).toEqual({
      url: 'https://example.com/', device: 'desktop', countryCode: 'PL', languageCode: 'pl',
    });
    expect(parseScreenshotRequest({ url: 'https://example.com/' })).toEqual({ url: 'https://example.com/', device: 'desktop', fullPage: true });
  });
});
