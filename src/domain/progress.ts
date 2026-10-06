/**
 * Where a book load is (SDD-0004 §14). The worker reports it as it goes; the
 * Library shows the phase line and a bar, determinate when `total` is known.
 *
 * - `reading`: the file's bytes, gunzipped and parsed (no count);
 * - `checking`: each song against the format;
 * - `hashing`: each song's hash, for the verdict and the registry;
 * - `saving`: each song written to the package;
 * - `indexing`: the search index and the registry rows (no count).
 *
 * - `packing`: a backup's books, each exported and added to the file, counted
 *   in books and not in songs (SDD-0006 §2).
 *
 * The first three belong to the review, which can be cancelled; the last two
 * to the commit, which cannot.
 */
export type LoadPhase = "reading" | "checking" | "hashing" | "saving" | "indexing" | "packing";

export interface LoadProgress {
  phase: LoadPhase;
  /** Songs done in this phase; 0 where the phase has no count. */
  done: number;
  /** Songs in the book; 0 where the phase has no count. */
  total: number;
}

export type OnLoadProgress = (progress: LoadProgress) => void;

const count = (n: number) => n.toLocaleString("en-US");

/** The short line that names a phase and, where it is counted, how far it has got. */
export function phaseLine({ phase, done, total }: LoadProgress): string {
  const of = ` ${count(done)} of ${count(total)} songs`;
  switch (phase) {
    case "reading":
      return "Reading…";
    case "checking":
      return total > 0 ? `Checking${of}` : "Checking…";
    case "hashing":
      return total > 0 ? `Comparing${of}` : "Comparing…";
    case "saving":
      return total > 0 ? `Saving${of}` : "Saving…";
    case "indexing":
      return "Indexing for search…";
    case "packing":
      return total > 0 ? `Packing ${count(done)} of ${count(total)} books` : "Packing…";
  }
}

/** 0 to 1 where the phase is counted, else undefined (an indeterminate bar). */
export const fraction = ({ done, total }: LoadProgress): number | undefined =>
  total > 0 ? Math.min(1, done / total) : undefined;

/**
 * Passes a phase's first and last report, and in between at most one per
 * `ms`: a loop of thousands of songs must not flood the channel to the page.
 * The clock is a parameter so a test is deterministic.
 */
export function throttled(
  report: OnLoadProgress | undefined,
  ms = 100,
  now: () => number = () => performance.now(),
): OnLoadProgress | undefined {
  if (!report) return undefined;
  let phase: LoadPhase | undefined;
  let last = Number.NEGATIVE_INFINITY;
  return (progress) => {
    const t = now();
    const finished = progress.total > 0 && progress.done >= progress.total;
    if (progress.phase !== phase || finished || t - last >= ms) {
      phase = progress.phase;
      last = t;
      report(progress);
    }
  };
}
