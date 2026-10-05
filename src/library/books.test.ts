// @vitest-environment node

import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { BookRow } from "../persistence/content-store.ts";
import { count, createBooks, languageName, problemOf, shortHash, songs } from "./books.ts";

const row = (key: string): BookRow => ({
  key,
  origin: key,
  kind: "shipped",
  file: `/${key}.sqlite3`,
  title: key,
  language: "en",
  script: "Latn",
  songs: 1,
  addedAt: 1,
  state: "ok",
});

describe("how a book is written", () => {
  it("names a language, falling back to its code", () => {
    expect(languageName("ml")).toBe("Malayalam");
    expect(languageName("en")).toBe("English");
    expect(languageName("")).toBe("");
  });

  it("writes counts with a separator, and one song in the singular", () => {
    expect(count(1631)).toBe("1,631");
    expect(count(12480)).toBe("12,480");
    expect(songs(1)).toBe("1 song");
    expect(songs(275)).toBe("275 songs");
  });

  it("shortens a hash to twelve digits in three groups", () => {
    expect(shortHash("a3f9c21e07b45d029be8")).toBe("a3f9 c21e 07b4");
  });

  it("says what a book that cannot be opened needs", () => {
    expect(problemOf("needs-reloading")).toMatchObject({
      status: "Needs reloading",
      loadAgain: true,
    });
    expect(problemOf("unreadable")).toMatchObject({ status: "Can’t be read", loadAgain: true });
    expect(problemOf("missing")).toMatchObject({ status: "File missing", loadAgain: true });
    expect(problemOf("needs-newer-app")).toMatchObject({
      status: "Needs a newer app",
      loadAgain: false,
    });
  });
});

describe("createBooks", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("lists the books held, and installs no shipped book that is held", async () => {
    const ensureInstalled = vi.fn();
    await createRoot(async (dispose) => {
      const books = createBooks({ listBooks: async () => [row("a")] }, { ensureInstalled }, ["a"]);
      await settle();
      expect(books.rows()?.map((b) => b.key)).toEqual(["a"]);
      expect(ensureInstalled).not.toHaveBeenCalled();
      dispose();
    });
  });

  it("installs a shipped book that is not held, with progress, then lists again", async () => {
    let held: BookRow[] = [];
    await createRoot(async (dispose) => {
      const seen: (number | undefined)[] = [];
      const books = createBooks(
        { listBooks: async () => held },
        {
          ensureInstalled: async (_id, onProgress) => {
            onProgress?.({ loaded: 5, total: 10 });
            seen.push(books.installing()?.loaded);
            held = [row("a")];
            return { state: "ready" };
          },
        },
        ["a"],
      );
      await settle();
      expect(seen).toEqual([5]);
      expect(books.installing()).toBeUndefined();
      expect(books.rows()?.map((b) => b.key)).toEqual(["a"]);
      dispose();
    });
  });

  it("keeps the books it could list when a shipped install fails, and says why", async () => {
    await createRoot(async (dispose) => {
      const books = createBooks(
        { listBooks: async () => [row("b")] },
        { ensureInstalled: async () => ({ state: "corrupt" }) },
        ["a"],
      );
      await settle();
      expect(books.problem()).toBe("The hymnbook file is damaged. Try reinstalling.");
      expect(books.rows()?.map((b) => b.key)).toEqual(["b"]);
      dispose();
    });
  });

  it("reports a registry that cannot be listed, and retries", async () => {
    let fail = true;
    await createRoot(async (dispose) => {
      const books = createBooks(
        {
          listBooks: async () => {
            if (fail) throw new Error("no registry");
            return [];
          },
        },
        { ensureInstalled: async () => ({ state: "ready" }) },
        [],
      );
      await settle();
      expect(books.problem()).toBe("Something went wrong listing the books.");
      fail = false;
      await books.retry();
      expect(books.problem()).toBeUndefined();
      expect(books.rows()).toEqual([]);
      dispose();
    });
  });
});
