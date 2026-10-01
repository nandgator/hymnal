/**
 * How long ago something was opened, for the Recents list (Board #33): which
 * calendar day it falls on, and how to say when. Pure, no UI — the list
 * decides how each looks.
 *
 * Days are the user's own, in local time: 11:50pm last night is "Yesterday"
 * at 12:10am, though it's 20 minutes ago. A "day" is counted by the calendar,
 * never as 24 hours, so a daylight-saving change (a 23- or 25-hour day)
 * moves nothing.
 */

/** Under this, "Just now". */
export const JUST_NOW_MS = 60_000;

/** Under this (and past "Just now"), "Minutes ago"; beyond it today's
 * entries read as the time of day. */
export const MINUTES_AGO_MS = 10 * 60_000;

/** Today's relative words, so the list can show them and tests can name them. */
export const JUST_NOW_LABEL = "Just now";
export const MINUTES_AGO_LABEL = "Minutes ago";

export type RecencyGroup = "today" | "yesterday" | "before";

/** Display order, newest first. */
export const RECENCY_GROUPS: readonly RecencyGroup[] = ["today", "yesterday", "before"];

export const RECENCY_GROUP_TITLES: Record<RecencyGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  before: "Before",
};

/** Calendar days between the local day of `at` and of `now`: 0 is today, 1
 * yesterday. Negative when `at` is ahead of `now` (a clock set back). Counted
 * from the date's own year, month and day, not by dividing milliseconds, so
 * a 23- or 25-hour day still counts as one. */
export function calendarDaysAgo(at: number, now: number): number {
  const a = new Date(at);
  const n = new Date(now);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(n) - day(a)) / 86_400_000);
}

/** Today, yesterday, or before. An entry ahead of `now` counts as today. */
export function recencyGroupOf(at: number, now: number): RecencyGroup {
  const days = calendarDaysAgo(at, now);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : "before";
}

/** Entries split by group, each group in the order given, empty groups kept
 * (so the caller can skip them). */
export function groupByRecency<T extends { viewedAt: number }>(
  entries: readonly T[],
  now: number,
): Record<RecencyGroup, T[]> {
  const groups: Record<RecencyGroup, T[]> = { today: [], yesterday: [], before: [] };
  for (const entry of entries) groups[recencyGroupOf(entry.viewedAt, now)].push(entry);
  return groups;
}

/** When, as the row says it, under its group's heading: today's very recent
 * ones in words ("Just now", "Minutes ago"), the rest of today and all
 * of yesterday by the time ("9:41 AM"), older ones by the day and date
 * ("Sun, Sep 27"; the year too when it isn't this one). `locale` defaults to
 * the user's. */
export function whenLabel(at: number, now: number, locale?: string | string[]): string {
  const date = new Date(at);
  const group = recencyGroupOf(at, now);
  if (group === "today") {
    const age = now - at;
    if (age < JUST_NOW_MS) return JUST_NOW_LABEL;
    if (age < MINUTES_AGO_MS) return MINUTES_AGO_LABEL;
  }
  if (group !== "before") {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  // The weekday apart from the date, so the shape is one in every locale,
  // year or none: "Tue, 29 Sep", "Wed, 27 Aug 2025" (Intl itself puts a comma
  // after the weekday in some forms and not others).
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const weekday = date.toLocaleDateString(locale, { weekday: "short" });
  const dayMonth = date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${weekday}, ${dayMonth}`;
}
