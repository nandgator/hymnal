// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { askPersist, commitAndPersist, removeBookAndRecents } from "./books.ts";
import type { CommitResult } from "./load.ts";

const storage = (persisted: boolean, grant: boolean | Error) => ({
  persisted: vi.fn(async () => persisted),
  persist: vi.fn(async () => {
    if (grant instanceof Error) throw grant;
    return grant;
  }),
});

describe("askPersist", () => {
  it("answers granted when the browser grants, or already did", async () => {
    expect(await askPersist(storage(false, true))).toBe("granted");
    const kept = storage(true, false);
    expect(await askPersist(kept)).toBe("granted");
    expect(kept.persist).not.toHaveBeenCalled();
  });

  it("answers refused when the browser says no", async () => {
    expect(await askPersist(storage(false, false))).toBe("refused");
  });

  it("answers unsupported with no storage manager, no persist, or an error", async () => {
    expect(await askPersist(undefined)).toBe("unsupported");
    expect(await askPersist({} as never)).toBe("unsupported");
    expect(await askPersist(storage(false, new Error("no")))).toBe("unsupported");
  });
});

describe("commitAndPersist", () => {
  const admin = (result: CommitResult) => ({ commit: vi.fn(async () => result) });

  it("asks once after a first load and hands back the answer to wait for, apart from the result", async () => {
    const persist = vi.fn(async () => "refused" as const);
    const result = await commitAndPersist(
      admin({ ok: true, action: "loaded", key: "k", firstLoad: true }),
      "t",
      undefined,
      persist,
    );
    expect(result).toMatchObject({ ok: true, key: "k" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await result.persisted).toBe("refused");
  });

  it("returns at once while the browser has not answered, and never rejects", async () => {
    const hung = await commitAndPersist(
      admin({ ok: true, action: "loaded", key: "k", firstLoad: true }),
      "t",
      undefined,
      () => new Promise(() => {}),
    );
    expect(hung).toMatchObject({ ok: true, key: "k" });
    const thrown = await commitAndPersist(
      admin({ ok: true, action: "loaded", key: "k", firstLoad: true }),
      "t",
      undefined,
      () => Promise.reject(new Error("no")),
    );
    expect(await thrown.persisted).toBe("unsupported");
  });

  it("does not ask for any other commit, or a failed one", async () => {
    const persist = vi.fn(async () => "granted" as const);
    for (const result of [
      { ok: true, action: "loaded", key: "k" },
      { ok: true, action: "opened", key: "k" },
      { ok: false, reason: "failed", message: "x" },
    ] as CommitResult[]) {
      expect(await commitAndPersist(admin(result), "t", undefined, persist)).not.toHaveProperty(
        "persisted",
      );
    }
    expect(persist).not.toHaveBeenCalled();
  });

  it("passes the token and the choice on", async () => {
    const a = admin({ ok: true, action: "replaced", key: "k" });
    await commitAndPersist(a, "tok", { replace: "k" });
    expect(a.commit).toHaveBeenCalledWith("tok", { replace: "k" }, undefined);
  });
});

describe("removeBookAndRecents", () => {
  it("drops the recents after the book goes", async () => {
    const order: string[] = [];
    await removeBookAndRecents(
      {
        removeBook: async () => {
          order.push("book");
          return true;
        },
      },
      { dropRecents: async () => void order.push("recents") },
      "k",
    );
    expect(order).toEqual(["book", "recents"]);
  });

  it("keeps the recents when the book was not removed", async () => {
    const dropRecents = vi.fn(async () => {});
    await removeBookAndRecents({ removeBook: async () => false }, { dropRecents }, "k");
    expect(dropRecents).not.toHaveBeenCalled();
  });

  it("keeps the recents when removal throws (a shipped book)", async () => {
    const dropRecents = vi.fn(async () => {});
    await expect(
      removeBookAndRecents(
        {
          removeBook: async () => {
            throw new Error("shipped");
          },
        },
        { dropRecents },
        "k",
      ),
    ).rejects.toThrow("shipped");
    expect(dropRecents).not.toHaveBeenCalled();
  });
});
