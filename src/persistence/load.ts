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
  /** Songs of this file already held in another book. */
  held: HeldElsewhere;
}

/** The choice for a same-origin verdict (§8): Keep both is the default. */
export type Choice = "keep-both" | { replace: string };

export type CommitResult =
  | {
      ok: true;
      /** `opened` and `recorded` and `loaded` and `kept-both` and `replaced`: what was done. */
      action: "opened" | "recorded" | "loaded" | "kept-both" | "replaced";
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
}

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

  async review(bytes: Uint8Array): Promise<LoadReview> {
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
    const verdict = verdictOf(
      { sourceHash: read.sourceHash, origin: hymnbook.id, songHashes: read.songHashes },
      held,
    );
    // A review that was overtaken is shown but not kept: its token is empty.
    const token = generation === this.#generation ? this.#newToken() : "";
    if (token) this.#pending = { token, read, verdict };
    return {
      token,
      sourceHash: read.sourceHash,
      title: hymnbook.title,
      language: hymnbook.language,
      script: hymnbook.script,
      origin: hymnbook.id,
      songCount: hymns.length,
      violations: [],
      verdict,
      held: heldElsewhere(read.songHashes, held),
    };
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
