import { describe, expect, it } from 'vitest';
import { matchesExpectedTarget, normalizeMonitorUrl, normalizeUrlForIdentity } from '../../src/worker/backlinks/url-identity';

describe('normalizeUrlForIdentity', () => {
  it('lowercases scheme and host but preserves path case, trailing slash, and query', () => {
    expect(normalizeUrlForIdentity('HTTPS://Example.com/Path?Q=1').normalized).toBe('https://example.com/Path?Q=1');
  });

  it('treats http and https as distinct identities', () => {
    expect(normalizeUrlForIdentity('http://example.com/page').normalized).not.toBe(normalizeUrlForIdentity('https://example.com/page').normalized);
  });

  it('treats www and bare host as distinct identities', () => {
    expect(normalizeUrlForIdentity('https://www.example.com/page').normalized).not.toBe(normalizeUrlForIdentity('https://example.com/page').normalized);
  });

  it('treats a trailing slash as a distinct identity', () => {
    expect(normalizeUrlForIdentity('https://example.com/page/').normalized).not.toBe(normalizeUrlForIdentity('https://example.com/page').normalized);
  });

  it('drops the fragment', () => {
    expect(normalizeUrlForIdentity('https://example.com/page#section').normalized).toBe('https://example.com/page');
  });

  it('rejects a non-HTTP scheme', () => {
    expect(() => normalizeUrlForIdentity('ftp://example.com/file')).toThrow();
  });
});

describe('normalizeMonitorUrl', () => {
  it('rejects a private-network URL', () => {
    expect(() => normalizeMonitorUrl('http://127.0.0.1/admin', 'Source')).toThrow(/public/i);
  });

  it('rejects an empty value with a labeled message', () => {
    expect(() => normalizeMonitorUrl('   ', 'Expected target')).toThrow(/Expected target/);
  });
});

describe('matchesExpectedTarget', () => {
  const target = normalizeUrlForIdentity('https://your-site.example/pricing');

  it('exact_page requires identical normalized identity', () => {
    expect(matchesExpectedTarget('https://your-site.example/pricing', target.normalized, target.hostname, 'exact_page')).toBe(true);
    expect(matchesExpectedTarget('https://your-site.example/pricing/', target.normalized, target.hostname, 'exact_page')).toBe(false);
    expect(matchesExpectedTarget('https://www.your-site.example/pricing', target.normalized, target.hostname, 'exact_page')).toBe(false);
  });

  it('domain_wide matches any page on the same exact hostname', () => {
    expect(matchesExpectedTarget('https://your-site.example/anything', target.normalized, target.hostname, 'domain_wide')).toBe(true);
    expect(matchesExpectedTarget('https://www.your-site.example/pricing', target.normalized, target.hostname, 'domain_wide')).toBe(false);
  });

  it('never matches an unparseable resolved URL', () => {
    expect(matchesExpectedTarget('not a url', target.normalized, target.hostname, 'exact_page')).toBe(false);
  });
});
