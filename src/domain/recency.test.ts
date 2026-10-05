// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  calendarDaysAgo,
  groupByRecency,
  JUST_NOW_LABEL,
  JUST_NOW_MS,
  MINUTES_AGO_LABEL,
  MINUTES_AGO_MS,
  recencyGroupOf,
  whenLabel,
} from "./recency.ts";

const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s).getTime();

// Local time is the point, so the zone is pinned to one with daylight saving
// (Intl caches the zone, so it is set once, before any date is formatted;
// each test file runs in its own worker).
vi.stubEnv("TZ", "America/New_York");

describe("whenLabel", () => {
  const now = local(2026, 9, 30, 15, 0);

  it("says 'Just now' under a minute, then 'Minutes ago'", () => {
    expect(whenLabel(now, now, "en-US")).toBe(JUST_NOW_LABEL);
    expect(whenLabel(now - (JUST_NOW_MS - 1), now, "en-US")).toBe(JUST_NOW_LABEL);
    expect(whenLabel(now - JUST_NOW_MS, now, "en-US")).toBe(MINUTES_AGO_LABEL);
    expect(whenLabel(now - (MINUTES_AGO_MS - 1), now, "en-US")).toBe(MINUTES_AGO_LABEL);
  });

  it("gives the time of day once past minutes, today and yesterday", () => {
    expect(whenLabel(now - MINUTES_AGO_MS, now, "en-US")).toBe("2:50 PM");
    expect(whenLabel(local(2026, 9, 30, 9, 41), now, "en-US")).toBe("9:41 AM");
    expect(whenLabel(local(2026, 9, 29, 23, 5), now, "en-US")).toBe("11:05 PM");
  });

  it("gives the day and date before yesterday, with the year only when it differs", () => {
    expect(whenLabel(local(2026, 9, 27, 12), now, "en-US")).toBe("Sun, Sep 27");
    expect(whenLabel(local(2025, 12, 25, 12), now, "en-US")).toBe("Thu, Dec 25, 2025");
  });

  it("is one shape, a comma after the weekday, with or without the year", () => {
    for (const locale of ["en-US", "en-GB"]) {
      for (const at of [local(2026, 9, 27, 12), local(2025, 8, 27, 12)]) {
        expect(whenLabel(at, now, locale)).toMatch(/^[A-Za-z]{3}, /);
      }
    }
    expect(whenLabel(local(2026, 9, 27, 12), now, "en-GB")).toBe("Sun, 27 Sept");
    expect(whenLabel(local(2025, 8, 27, 12), now, "en-GB")).toBe("Wed, 27 Aug 2025");
  });

  it("calls a time ahead of now 'Just now' rather than negative", () => {
    expect(whenLabel(now + 5 * 60_000, now, "en-US")).toBe(JUST_NOW_LABEL);
  });

  it("gives the time, not 'minutes ago', across midnight", () => {
    // 11:55pm seen at 12:05am: ten minutes ago, but yesterday.
    const after = local(2026, 10, 1, 0, 5);
    expect(whenLabel(local(2026, 9, 30, 23, 55), after, "en-US")).toBe("11:55 PM");
  });
});

describe("recencyGroupOf", () => {
  it("splits by calendar day, at midnight", () => {
    const now = local(2026, 9, 30, 0, 0, 1);
    expect(recencyGroupOf(local(2026, 9, 30, 0, 0, 0), now)).toBe("today");
    expect(recencyGroupOf(local(2026, 9, 29, 23, 59, 59), now)).toBe("yesterday");
    expect(recencyGroupOf(local(2026, 9, 29, 0, 0, 0), now)).toBe("yesterday");
    expect(recencyGroupOf(local(2026, 9, 28, 23, 59, 59), now)).toBe("before");
  });

  it("counts across months and years", () => {
    expect(recencyGroupOf(local(2026, 8, 31, 22), local(2026, 9, 1, 8))).toBe("yesterday");
    expect(recencyGroupOf(local(2025, 12, 31, 22), local(2026, 1, 1, 8))).toBe("yesterday");
    expect(recencyGroupOf(local(2025, 12, 30, 22), local(2026, 1, 1, 8))).toBe("before");
  });

  it("puts a time ahead of now in today", () => {
    const now = local(2026, 9, 30, 12);
    expect(recencyGroupOf(now + 3 * 86_400_000, now)).toBe("today");
  });

  it("holds across the spring-forward day (a 23-hour day)", () => {
    // New York, 2026-03-08: 2:00am becomes 3:00am.
    const now = local(2026, 3, 9, 0, 30);
    expect(now - local(2026, 3, 8, 0, 30)).toBe(23 * 3_600_000);
    expect(recencyGroupOf(local(2026, 3, 8, 0, 30), now)).toBe("yesterday");
    expect(recencyGroupOf(local(2026, 3, 8, 23, 59), now)).toBe("yesterday");
    expect(recencyGroupOf(local(2026, 3, 7, 23, 30), now)).toBe("before");
    expect(calendarDaysAgo(local(2026, 3, 7, 23, 30), local(2026, 3, 8, 3, 30))).toBe(1);
  });

  it("holds across the fall-back day (a 25-hour day)", () => {
    // New York, 2026-11-01: 2:00am becomes 1:00am.
    const now = local(2026, 11, 2, 0, 30);
    expect(now - local(2026, 11, 1, 0, 30)).toBe(25 * 3_600_000);
    expect(recencyGroupOf(local(2026, 11, 1, 0, 30), now)).toBe("yesterday");
    expect(recencyGroupOf(local(2026, 10, 31, 23, 30), now)).toBe("before");
    // 24 hours back from 12:30am is still yesterday, 11:30pm of Oct 31 is not.
    expect(recencyGroupOf(now - 24 * 3_600_000, now)).toBe("yesterday");
  });
});

describe("groupByRecency", () => {
  it("splits newest-first entries, keeping their order and empty groups", () => {
    const now = local(2026, 9, 30, 15);
    const a = { viewedAt: local(2026, 9, 30, 14) };
    const b = { viewedAt: local(2026, 9, 30, 9) };
    const c = { viewedAt: local(2026, 9, 29, 20) };
    expect(groupByRecency([a, b, c], now)).toEqual({
      today: [a, b],
      yesterday: [c],
      before: [],
    });
  });
});
