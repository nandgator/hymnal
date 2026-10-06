import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_URL } from "../config.ts";
import type { BookRow } from "../persistence/content-store.ts";
import { About, diagnostics } from "./About.tsx";

const book = (over: Partial<BookRow>): BookRow => ({
  key: "k1",
  origin: "hof",
  kind: "loaded",
  file: "/k1.sqlite3",
  title: "Hymns of Fellowship",
  language: "en",
  script: "Latn",
  songs: 275,
  addedAt: 1,
  state: "ok",
  ...over,
});

// A store with titled books, and a user state with recents, to be left out.
const admin = {
  listBooks: async () => [
    book({}),
    book({ key: "k2", title: "Secret Songbook of Grace", state: "ok" }),
    book({ key: "k3", title: "Newer Book", state: "needs-newer-app" }),
  ],
  storageMode: async () => "opfs" as const,
};
const recentLyrics = "Amazing grace how sweet the sound";
const state = (memory: boolean) => ({
  mode: () => (memory ? ("memory" as const) : ("idb" as const)),
  getRecents: async () => [{ hymnbookId: "k1", hymnNumber: 7, title: recentLyrics, viewedAt: 1 }],
});

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persisted: async () => true,
      estimate: async () => ({ usage: 5 * 1048576, quota: 100 * 1048576 }),
    },
  });
});
afterEach(() => {
  writeText.mockClear();
  vi.useRealTimers();
});

describe("About (SDD-0001 §16.10)", () => {
  it("renders each part, in order", () => {
    render(() => <About admin={admin} state={state(false)} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual([
      "About",
      "The app",
      "Privacy",
      "Your books",
      "Report a problem",
      "Credits",
    ]);
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText(/no tracking and no cookies/)).toBeInTheDocument();
    expect(screen.getByText(/you answer for having the right to use them/)).toBeInTheDocument();
    // This build has no sample (SAMPLE_FILES is empty), so none is claimed.
    expect(screen.queryByText(/sample books/)).not.toBeInTheDocument();
    for (const name of [
      "SQLite",
      "SolidJS",
      "idb",
      "Comlink",
      "fflate",
      "pdf.js",
      "fast-xml-parser",
    ])
      expect(screen.getByText(new RegExp(`^${name}, `))).toBeInTheDocument();
    expect(screen.getByText(/Hymnal Sans.*SIL OFL 1\.1/)).toBeInTheDocument();
    expect(screen.getByText(/The hymnal itself, Apache 2\.0/)).toBeInTheDocument();
  });

  it("holds every field in the diagnostics, and no title, recent or lyric", async () => {
    const text = await diagnostics({ admin, state: state(false) });
    expect(text).toContain("Build: test");
    expect(text).toContain(`User agent: ${navigator.userAgent}`);
    expect(text).toMatch(/Screen: \d+x\d+ at \d+(\.\d+)?x/);
    expect(text).toContain("Storage persisted: yes");
    expect(text).toContain("Storage estimate: 5.0 MB of 100.0 MB");
    expect(text).toContain("Store mode: opfs");
    expect(text).toContain("User state mode: idb");
    expect(text).toContain("Books: ok 2, needs-newer-app 1");
    expect(text).not.toMatch(/Fellowship|Secret|Newer Book|Amazing|grace/);
  });

  it("says memory when user state carries on in memory", async () => {
    const text = await diagnostics({ admin, state: state(true) });
    expect(text).toContain("User state mode: memory");
  });

  it("copies the diagnostics, says so, and says nothing again after 3 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(() => <About admin={admin} state={state(false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Diagnostics" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText.mock.calls[0]?.[0]).toContain("Build: test");
    vi.advanceTimersByTime(3100);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy Diagnostics" })).toBeInTheDocument(),
    );
  });

  it("opens Report a Problem in a new tab, with no query", () => {
    render(() => <About admin={admin} state={state(false)} />);
    const link = screen.getByRole("link", { name: "Report a Problem" });
    expect(link).toHaveAttribute("href", REPORT_URL);
    expect(REPORT_URL).not.toContain("?");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
