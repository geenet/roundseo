/** Brand media for a website: its favicon and a small page thumbnail. */
export type WebsiteMediaKind = 'favicon' | 'thumbnail';
export type WebsiteMediaStatus = 'available' | 'missing' | 'unavailable' | 'failed';

export interface WebsiteMediaItem {
  kind: WebsiteMediaKind;
  status: WebsiteMediaStatus;
  /** Signed, short-lived URL. Null unless the image is available. */
  url: string | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  /** Why the image is missing or unavailable, in plain language. */
  reason: string | null;
}

export interface WebsiteMedia {
  websiteId: string;
  favicon: WebsiteMediaItem | null;
  thumbnail: WebsiteMediaItem | null;
}
