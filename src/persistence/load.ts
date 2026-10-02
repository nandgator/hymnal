import { type ContainerRead, readContainer } from "../domain/container.ts";
import {
  type HeldElsewhere,
  heldElsewhere,
  sameVerdict,
  type Verdict,
  verdict as verdictOf,
} from "../domain/duplicates.ts";
import { uuidv7 } from "../domain/key.ts";
import type { Violation } from "../domain/validate.ts";
import {
  addBook,
  heldBooks,
  listBooks,
  type RegistryContext,
  recordSource,
  replaceBook,
} from "./registry.ts";

/** What loading a read file shows before anything is written (SDD-0004 §3, ADR-0027). */
export interface LoadReview {
  /** Names the pending review; empty when the file was rejected, since nothing is pending. */
  token: string;
  sourceHash: string;
  title: string;
  language: string;
  script: string;
  origin: string;
  songCount: number;
  /** Non-empty: rejected whole, nothing repaired, and no verdict. */
  violations: Violation[];
  verdict?: Verdict;
  /**
   * Set when the review was aimed at a held book (Load Again, SDD-0004 §9): the
   * file will replace that book under its key, so its recents come back. There
   * is no verdict then; a title that differs is only a warning.
   */
  restore?: {
    key: string;
    /** The title the registry holds: the key itself when the book could not say. */
    title: string;
    state: string;
    /** Undefined when the held book has no title to compare. */
    titleMatches?: boolean;
  };
  /** Songs of this file already held in another book. */
  held: HeldElsewhere;
}

/** The choice for a same-origin verdict (§8): Keep both is the default. */
export type Choice = "keep-both" | { replace: string };

export type CommitResult =
  | {
      ok: true;
      /** What was done; `restored` is a Replace aimed at a book that could not be opened. */
      action: "opened" | "recorded" | "loaded" | "kept-both" | "replaced" | "restored";
      key: string;
      /**
       * This was the first load: no loaded book was held before it. The caller
       * asks for persistent storage then (SDD-0004 §9), because
       * `navigator.storage.persist()` is for a window, not a worker.
       */
      firstLoad?: true;
    }
  | {
      ok: false;
      reason: "no-review" | "stale" | "not-offered" | "failed";
      message: string;
    };

interface Pending {
  token: string;
  read: Extract<ContainerRead, { ok: true }>;
  verdict: Verdict;
  /**
   * The held book this file restores (Load Again), as the registry had it at
   * review: the commit holds to that exact row (same file, still not readable,
   * or its file gone), so a file is never written over a book that has since
   * become good or been replaced.
   */
  target?: { key: string; file: string; state: string };
}

const same = (a: string, b: string) =>
  a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

const NONE: HeldElsewhere = { count: 0, books: [] };

/**
 * Review, commit and cancel (SDD-0004 §3, §8, §10): one review is pending at a
 * time and a second pick replaces it. Nothing is written until `commit`, and
 * `commit` writes only what the verdict allows, judged again against the
 * registry as it is then. No step makes a request (§11).
 */
export class LoadSession {
  #pending: Pending | undefined;
  #generation = 0;
  #tail: Promise<unknown> = Promise.resolve();
  readonly #registry: () => Promise<RegistryContext>;
  readonly #newKey: () => string;
  readonly #newToken: () => string;

  constructor(
    registry: () => Promise<RegistryContext>,
    newKey: () => string = uuidv7,
    newToken: () => string = () => crypto.randomUUID(),
  ) {
    this.#registry = registry;
    this.#newKey = newKey;
    this.#newToken = newToken;
  }

  /**
   * `target` aims the review at a held, loaded book (Load Again on a book that
   * could not be opened): committing then replaces that book under its key,
   * whatever the file's origin, and the duplicate verdict is not asked.
   */
  async review(bytes: Uint8Array, target?: string): Promise<LoadReview> {
    // A second pick replaces the first at once, and only the latest review to
    // be asked for may become pending, whatever order they finish in.
    const generation = ++this.#generation;
    this.#pending = undefined;
    const ctx = await this.#registry();
    const read = await readContainer(bytes);
    if (!read.ok) {
      return {
        token: "",
        sourceHash: read.sourceHash,
        title: "",
        language: "",
        script: "",
        origin: "",
        songCount: 0,
        violations: read.violations,
        held: NONE,
      };
    }
    const { hymnbook, hymns } = read.book;
    const held = heldBooks(ctx);
    const row = target === undefined ? undefined : listBooks(ctx).find((b) => b.key === target);
    if (target !== undefined && (!row || row.kind === "shipped")) {
      throw new Error(`${target} is not a loaded book that is held`);
    }
    // A newer app is what it needs, not another file (§9): refused here too.
    if (row?.state === "needs-newer-app") {
      throw new Error(`${target} needs a newer app, and a file does not restore it`);
    }
    const verdict = verdictOf(
      { sourceHash: read.sourceHash, origin: hymnbook.id, songHashes: read.songHashes },
      held,
    );
    // A review that was overtaken is shown but not kept: its token is empty.
    const token = generation === this.#generation ? this.#newToken() : "";
    if (token) {
      this.#pending = {
        token,
        read,
        verdict,
        ...(row ? { target: { key: row.key, file: row.file, state: row.state } } : {}),
      };
    }
    return {
      token,
      sourceHash: read.sourceHash,
      title: hymnbook.title,
      language: hymnbook.language,
      script: hymnbook.script,
      origin: hymnbook.id,
      songCount: hymns.length,
      violations: [],
      ...(row
        ? {
            restore: {
              key: row.key,
              title: row.title,
              state: row.state,
              ...(row.title === row.key ? {} : { titleMatches: same(row.title, hymnbook.title) }),
            },
          }
        : { verdict }),
      held: heldElsewhere(
        read.songHashes,
        held.filter((b) => b.key !== target),
      ),
    };
  }

  /** Throws away any pending review (the store is being let go). Nothing is written. */
  discard(): void {
    this.#generation++;
    this.#pending = undefined;
  }

  /** Throws away the parsed book. */
  cancel(token: string): boolean {
    if (this.#pending?.token !== token) return false;
    this.#pending = undefined;
    return true;
  }

  /**
   * The review is taken before the first await, so a second commit of one
   * token finds none; writes run one at a time, so two reviews committed
   * together never race for a file name; and a commit that finishes late
   * never touches a review begun while it wrote.
   */
  commit(token: string, choice: Choice = "keep-both"): Promise<CommitResult> {
    const pending = this.#pending;
    if (!pending || pending.token !== token) {
      return Promise.resolve({
        ok: false,
        reason: "no-review",
        message: "no review is pending under that token (or it is being committed)",
      });
    }
    this.#pending = undefined;
    const generation = this.#generation;
    const run = this.#tail.then(() => this.#commit(pending, choice, generation));
    this.#tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async #commit(pending: Pending, choice: Choice, generation: number): Promise<CommitResult> {
    const ctx = await this.#registry();
    const { read } = pending;
    const { hymnbook } = read.book;
    // Nothing was committed on a refusal or a failure: the review comes back, so the
    // same or another choice can be tried, unless a newer review has begun.
    const keep = () => {
      if (generation === this.#generation && !this.#pending) this.#pending = pending;
    };
    if (pending.target !== undefined) return this.#restore(ctx, pending, keep);
    // The registry may have changed since the review (another tab, a removal).
    const now = verdictOf(
      { sourceHash: read.sourceHash, origin: hymnbook.id, songHashes: read.songHashes },
      heldBooks(ctx),
    );
    if (!sameVerdict(now, pending.verdict)) {
      return { ok: false, reason: "stale", message: "the books held changed; read the file again" };
    }
    if (typeof choice === "object" && now.kind !== "same-origin") {
      keep();
      return {
        ok: false,
        reason: "not-offered",
        message: `Replace is not offered for ${choice.replace}: the verdict is ${now.kind}`,
      };
    }
    try {
      switch (now.kind) {
        case "same-file":
          return { ok: true, action: "opened", key: now.book.key };
        case "same-songs":
          recordSource(ctx, now.book.key, read.sourceHash);
          return { ok: true, action: "recorded", key: now.book.key };
        case "same-origin": {
          if (typeof choice === "object") {
            const target = now.books.find((b) => b.key === choice.replace && b.replaceable);
            if (!target) {
              keep();
              return {
                ok: false,
                reason: "not-offered",
                message: `Replace is not offered for ${choice.replace}`,
              };
            }
            const row = await replaceBook(ctx, target.key, read);
            return { ok: true, action: "replaced", key: row.key };
          }
          return await this.#load(ctx, read, "kept-both");
        }
        case "new":
          return await this.#load(ctx, read, "loaded");
      }
    } catch (error) {
      keep();
      return {
        ok: false,
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Load Again: the file replaces the held book under its key (SDD-0004 §9). */
  async #restore(ctx: RegistryContext, pending: Pending, keep: () => void): Promise<CommitResult> {
    const pinned = pending.target as NonNullable<Pending["target"]>;
    const key = pinned.key;
    const row = listBooks(ctx).find((b) => b.key === key);
    if (!row || row.kind === "shipped") {
      return { ok: false, reason: "stale", message: "the books held changed; read the file again" };
    }
    // The book as it was reviewed: the same file, and still one that cannot be
    // read (or whose file is gone). Anything else is a different book now.
    const gone = !ctx.files.list().includes(row.file);
    if (
      row.file !== pinned.file ||
      row.state === "needs-newer-app" ||
      (row.state === "ok" && !gone)
    ) {
      return { ok: false, reason: "stale", message: "the book changed since the file was read" };
    }
    try {
      const written = await replaceBook(ctx, key, pending.read, { restore: true });
      return { ok: true, action: row.state === "ok" ? "replaced" : "restored", key: written.key };
    } catch (error) {
      keep();
      return {
        ok: false,
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #load(
    ctx: RegistryContext,
    read: Pending["read"],
    action: "loaded" | "kept-both",
  ): Promise<CommitResult> {
    const first = !listBooks(ctx).some((b) => b.kind === "loaded");
    const row = await addBook(ctx, this.#newKey(), read);
    return { ok: true, action, key: row.key, ...(first ? { firstLoad: true as const } : {}) };
  }
}
