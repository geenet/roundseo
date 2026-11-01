/**
 * Short-lived signed URLs for stored images. Each purpose has its own signing
 * namespace, so a URL minted for one kind of asset cannot be replayed for another.
 */
export type AssetPurpose = 'intelligence-asset' | 'website-media';

export async function assetSignature(secret: string, purpose: AssetPurpose, websiteId: string, assetId: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${websiteId}:${assetId}:${expires}`));
  return [...new Uint8Array(signed)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** True only for an unexpired URL whose signature matches, compared in constant time. */
export async function verifyAssetSignature(
  secret: string,
  purpose: AssetPurpose,
  websiteId: string,
  assetId: string,
  expires: number,
  supplied: string,
  ttlSeconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!Number.isInteger(expires) || expires < now || expires > now + ttlSeconds + 30 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = await assetSignature(secret, purpose, websiteId, assetId, expires);
  return constantTimeEqual(expected, supplied);
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** Absolute URL to an asset path on the request's own origin, carrying a fresh signature. */
export async function signedAssetUrl(requestUrl: string, path: string, secret: string, purpose: AssetPurpose, websiteId: string, assetId: string, ttlSeconds: number): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await assetSignature(secret, purpose, websiteId, assetId, expires);
  const url = new URL(path, requestUrl);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('sig', signature);
  return url.href;
}
