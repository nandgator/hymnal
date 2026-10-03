import { type Accessor, createSignal } from "solid-js";
import { SHIPPED_BOOK_IDS } from "../config.ts";
import type {
  BookRow,
  ContentAdmin,
  ContentStatus,
  ContentStore,
} from "../persistence/content-store.ts";
import type { InstallProgress } from "../persistence/download.ts";

/** What the Library asks of the worker (SDD-0004 §10): a subset of {@link ContentAdmin}. */
export type LibraryAdmin = Pick<
  ContentAdmin,
  "listBooks" | "review" | "commit" | "cancel" | "removeBook" | "openBook"
>;

/** What a row can say beyond the registry's own state: its file went missing (evicted). */
export type RowState = BookRow["state"] | "missing";

/** The language's name in English (`ml` is Malayalam), or the code if the runtime has no name. */
export function languageName(code: string): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A file's hash, shortened for the eye: twelve hex digits in groups of four. */
export const shortHash = (hash: string) => (hash.slice(0, 12).match(/.{1,4}/g) ?? []).join(" ");

/** 1,631: counts are written with a separator, and set in tabular numbers. */
export const count = (n: number) => n.toLocaleString("en-US");

export const songs = (n: number) => `${count(n)} ${n === 1 ? "song" : "songs"}`;

/** Why a book's row says what it says (SDD-0004 §9), and whether loading its file can fix it. */
export function problemOf(state: RowState): {
  status: string;
  note: string;
  loadAgain: boolean;
} {
  switch (state) {
    case "needs-newer-app":
      return {
        status: "Needs a newer app",
        note: "Made for a later format than this version reads. Update Hymnal to open it; the book is kept.",
        loadAgain: false,
      };
    case "needs-reloading":
      return {
        status: "Needs reloading",
        note: "This book can’t be opened as it is stored. Load its file again to bring it back.",
        loadAgain: true,
      };
    case "missing":
      return {
        status: "File missing",
        note: "The browser no longer has this book’s file. Load it again to bring it back.",
        loadAgain: true,
      };
    default:
      return {
        status: "Can’t be read",
        note: "The stored file is damaged. It is kept until you remove it.",
        loadAgain: true,
      };
  }
}

export function describeStatus(status: Exclude<ContentStatus, { state: "ready" }>): string {
  switch (status.state) {
    case "missing-asset":
      return "The hymnbook file is missing. Try reloading.";
    case "corrupt":
      return "The hymnbook file is damaged. Try reinstalling.";
    case "schema-mismatch":
      return `This songbook needs an app update (found schema ${status.found}, need ${status.expected}).`;
    case "unreadable":
      return "This songbook can’t be opened.";
  }
}

export interface Books {
  /** The books held, shipped first as added; undefined until the first list. */
  rows: Accessor<BookRow[] | undefined>;
  /** A shipped book being copied to this device for the first time. */
  installing: Accessor<InstallProgress | undefined>;
  /** Why the list could not be made, in words. */
  problem: Accessor<string | undefined>;
  /** Reads the registry again (after a load, a replace, a removal). */
  refresh: () => Promise<void>;
  /** Tries again after a problem. */
  retry: () => Promise<void>;
}

/**
 * The books held (SDD-0004 §9, §10). Lists the registry. A shipped book that is
 * not held would be installed first, but nothing ships (ADR-0026), so
 * `SHIPPED_BOOK_IDS` is empty and the first run is the empty Library.
 */
export function createBooks(
  admin: Pick<LibraryAdmin, "listBooks">,
  store: Pick<ContentStore, "ensureInstalled">,
  shipped: readonly string[] = SHIPPED_BOOK_IDS,
): Books {
  const [rows, setRows] = createSignal<BookRow[]>();
  const [installing, setInstalling] = createSignal<InstallProgress>();
  const [problem, setProblem] = createSignal<string>();

  const refresh = async () => {
    setRows(await admin.listBooks());
  };
  const start = async () => {
    setProblem(undefined);
    try {
      let held = await admin.listBooks();
      for (const id of shipped) {
        if (held.some((book) => book.key === id && book.state === "ok")) continue;
        const status = await store.ensureInstalled(id, (next) => setInstalling(next));
        setInstalling(undefined);
        if (status.state !== "ready") {
          setProblem(describeStatus(status));
          break;
        }
        held = await admin.listBooks();
      }
      setRows(held);
    } catch {
      setInstalling(undefined);
      setProblem("Something went wrong listing the books.");
    }
  };
  void start();
  return { rows, installing, problem, refresh, retry: start };
}
