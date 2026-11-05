// Reporting windows for Search Console. All dates are UTC calendar days, YYYY-MM-DD.

/** Search Console reports data a few days late and revises the most recent days, so the newest complete day is this many days back. */
export const REPORTING_LAG_DAYS = 3;
/** Length of the current and previous comparison windows. */
export const WINDOW_DAYS = 28;
/** Search Console keeps about 16 months of data. */
export const DAILY_HISTORY_DAYS = 486;
/** Rows requested per Search Console call. The API maximum is 25,000. */
export const API_ROW_LIMIT = 25_000;
/** Pages fetched per dimension at most, so one sync stays bounded. */
export const MAX_API_PAGES = 4;
/** Breakdown rows stored per dimension and period, kept by impressions. */
export const BREAKDOWN_ROW_LIMIT = 500;

export interface DayRange { start: string; end: string }

export interface SyncWindows {
  /** The newest day included in every window. */
  end: string;
  current: DayRange;
  previous: DayRange;
  daily: DayRange;
}

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function syncWindows(now: Date): SyncWindows {
  const end = addDays(startOfUtcDay(now), -REPORTING_LAG_DAYS);
  const currentStart = addDays(end, -(WINDOW_DAYS - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(WINDOW_DAYS - 1));
  const dailyStart = addDays(end, -(DAILY_HISTORY_DAYS - 1));
  return {
    end: isoDay(end),
    current: { start: isoDay(currentStart), end: isoDay(end) },
    previous: { start: isoDay(previousStart), end: isoDay(previousEnd) },
    daily: { start: isoDay(dailyStart), end: isoDay(end) },
  };
}
