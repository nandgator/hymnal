import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { gunzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import sampleMd from "../../docs/authoring/sample.md?raw";
import { validateCorpus } from "../domain/validate.ts";
import type { BookRow, Choice, CommitResult, LoadReview } from "../persistence/content-store.ts";
import { createBooks, type LibraryAdmin } from "./books.ts";
import { Library } from "./Library.tsx";

/** The first ```text block of the public-domain sample: three hymns. */
const SAMPLE = /```text\n([\s\S]*?)```/.exec(sampleMd)?.[1] ?? "";

const shipped: BookRow = {
  key: "mal",
  origin: "mal",
  kind: "shipped",
  file: "/mal.sqlite3",
  title: "Athmeeya Geethangal",
  language: "ml",
  script: "Mlym",
  songs: 1631,
  addedAt: 1,
  state: "ok",
};

/** The file's bytes (jsdom's Blob has no arrayBuffer or stream, so the worker's reader can't run here). */
const bytesOf = (file: File) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

/**
 * A fake registry that really opens the file it is given: gunzip, parse and
 * validate as the worker's reader does, so the in-memory container is a good one.
 */
function setup() {
  let rows: BookRow[] = [shipped];
  const pending = new Map<string, { title: string; id: string; songs: number }>();
  const admin = {
    listBooks: vi.fn(async () => rows),
    review: vi.fn(async (file: File, _target?: string): Promise<LoadReview> => {
      const doc = JSON.parse(new TextDecoder().decode(gunzipSync(await bytesOf(file))));
      const files = doc.hymns.map((hymn: { number: number }) => ({
        file: `${String(hymn.number).padStart(4, "0")}.json`,
        hymn,
      }));
      const violations = validateCorpus(doc.hymnbook, files);
      const read = { sourceHash: "ab12cd34ef56".padEnd(64, "0"), book: doc };
      if (violations.length > 0) {
        return {
          token: "",
          sourceHash: read.sourceHash,
          title: "",
          language: "",
          script: "",
          origin: "",
          songCount: 0,
          violations,
          held: { count: 0, books: [] },
        };
      }
      const { hymnbook, hymns } = read.book;
      pending.set("t1", { title: hymnbook.title, id: hymnbook.id, songs: hymns.length });
      return {
        token: "t1",
        sourceHash: read.sourceHash,
        title: hymnbook.title,
        language: hymnbook.language,
        script: hymnbook.script,
        origin: hymnbook.id,
        songCount: hymns.length,
        violations: [],
        verdict: { kind: "new" },
        held: { count: 0, books: [] },
      };
    }),
    commit: vi.fn(async (token: string, _choice?: Choice): Promise<CommitResult> => {
      const book = pending.get(token);
      if (!book) return { ok: false, reason: "no-review", message: "nothing pending" };
      rows = [
        ...rows,
        {
          ...shipped,
          key: "k1",
          origin: book.id,
          kind: "loaded",
          title: book.title,
          songs: book.songs,
          language: "en",
          script: "Latn",
        },
      ];
      return { ok: true, action: "loaded", key: "k1" };
    }),
    cancel: vi.fn(async () => true),
    removeBook: vi.fn(async () => true),
    openBook: vi.fn(async () => ({ state: "ready" as const })),
  } satisfies LibraryAdmin;
  const store = { ensureInstalled: vi.fn(async () => ({ state: "ready" as const })) };
  const persist = vi.fn(async () => "granted" as const);
  render(() => {
    const books = createBooks(admin, store, ["mal"]);
    return (
      <Library
        books={books}
        currentKey="mal"
        onChoose={() => {}}
        admin={admin}
        userState={{ getRecents: async () => [], dropRecents: async () => {} }}
        persist={persist}
      />
    );
  });
  return { admin };
}

const openSheet = async () => {
  const s = setup();
  await screen.findByRole("list", { name: "Books" });
  fireEvent.click(screen.getByRole("button", { name: "From Text" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Book from Text" }));
  return { s, dialog };
};

type Dialog = Awaited<ReturnType<typeof openSheet>>["dialog"];

const fill = (
  dialog: Dialog,
  over: { title?: string; language?: string; script?: string } = {},
) => {
  const set = (label: string, value: string) =>
    fireEvent.input(dialog.getByLabelText(label), { target: { value } });
  set("Title", over.title ?? "Public Domain Sample");
  set("Language", over.language ?? "en");
  set("Script", over.script ?? "Latn");
};
const type = (dialog: Dialog, label: RegExp | string, value: string) =>
  fireEvent.input(dialog.getByLabelText(label), { target: { value } });
const review = (dialog: Dialog) =>
  fireEvent.click(dialog.getByRole("button", { name: "Review the Book" }));

describe("Library: a book from song text (ADR-0029, SDD-0004 §9)", () => {
  it("opens an empty sheet: the fields, two text areas, nothing written", async () => {
    const { s, dialog } = await openSheet();
    for (const label of ["Title", "Language", "Script", "Id", "Song text"]) {
      expect(dialog.getByLabelText(label)).toHaveValue("");
    }
    expect(dialog.getByLabelText(/Source text/)).toBeInTheDocument();
    expect(dialog.getAllByRole("button", { name: /Open a \.txt/ })).toHaveLength(2);
    expect(s.admin.review).not.toHaveBeenCalled();
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("derives the id from the title until it is edited by hand", async () => {
    const { dialog } = await openSheet();
    type(dialog, "Title", "Hymns of Fellowship, 2nd ed.");
    expect(dialog.getByLabelText("Id")).toHaveValue("hymns-of-fellowship-2nd-ed");
    type(dialog, "Id", "hof");
    type(dialog, "Title", "Hymns of Fellowship");
    expect(dialog.getByLabelText("Id")).toHaveValue("hof");
  });

  it("asks for the title, language and script, never guessing them", async () => {
    const { s, dialog } = await openSheet();
    type(dialog, "Song text", SAMPLE);
    review(dialog);
    expect(await dialog.findByText("Give the book a title.")).toBeInTheDocument();
    expect(dialog.getByText(/Give the language code/)).toBeInTheDocument();
    expect(dialog.getByText(/Give the script code/)).toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("lists parse errors with their line numbers and writes nothing", async () => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    type(dialog, "Song text", "# a comment\n0. Bad number\n\nA line\n");
    review(dialog);
    const list = await dialog.findByRole("list", { name: "Parse errors" });
    expect(dialog.getByText(/in the text/)).toBeInTheDocument();
    const first = within(list).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent(/^Line 2/);
    expect(s.admin.review).not.toHaveBeenCalled();
    expect(s.admin.commit).not.toHaveBeenCalled();
    // The text is kept to fix.
    expect(dialog.getByLabelText("Song text")).toHaveValue(
      "# a comment\n0. Bad number\n\nA line\n",
    );
  });

  const toReview = async (source: string) => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    type(dialog, "Song text", SAMPLE);
    if (source) type(dialog, /Source text/, source);
    review(dialog);
    const reviewDialog = within(await screen.findByRole("dialog", { name: "Load a Book" }));
    return { s, reviewDialog };
  };

  it("not checked against a source when none was given", async () => {
    const { s, reviewDialog } = await toReview("");
    expect(reviewDialog.getByText("Not checked against a source")).toBeInTheDocument();
    expect(reviewDialog.getByText("A new book")).toBeInTheDocument();
    expect(reviewDialog.getByText("public-domain-sample")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Load a Book" })).toHaveTextContent("3 songs");
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("checked against a source: no differences", async () => {
    const { reviewDialog } = await toReview(SAMPLE);
    expect(reviewDialog.getByText("Checked against a source: no differences")).toBeInTheDocument();
    expect(reviewDialog.queryByLabelText("Source check")).not.toBeInTheDocument();
  });

  it("lists the lines the book added or dropped against its source", async () => {
    const source = `${SAMPLE.replace(
      "That saved a wretch like me!",
      "That saved a soul like me!",
    ).replace("Holy, holy, holy! Lord God Almighty!\nEarly", "Early")}\nAn extra source line\n`;
    const { reviewDialog } = await toReview(source);
    const diffs = within(reviewDialog.getByLabelText("Source check"));
    expect(diffs.getByText("Added or altered", { exact: false })).toBeInTheDocument();
    expect(diffs.getByText("That saved a wretch like me!")).toBeInTheDocument();
    expect(diffs.getByText("An extra source line")).toBeInTheDocument();
    expect(diffs.getByText("That saved a soul like me!")).toBeInTheDocument();
    expect(diffs.getAllByText(/^Source line \d+$/).length).toBeGreaterThan(0);
    expect(reviewDialog.getByText(/Checked: \d+ to look at/)).toBeInTheDocument();
  });

  it("commits through the same button; the new book is listed and the text is cleared", async () => {
    const { s, reviewDialog } = await toReview("");
    fireEvent.click(reviewDialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both"));
    expect(await screen.findByText("Public Domain Sample")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "From Text" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Book from Text" }));
    expect(dialog.getByLabelText("Song text")).toHaveValue("");
  });

  it("Cancel in the review goes back to the text, which is kept", async () => {
    const { s, reviewDialog } = await toReview("");
    fireEvent.click(reviewDialog.getByRole("button", { name: "Cancel" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Book from Text" }));
    expect(dialog.getByLabelText("Song text")).toHaveValue(SAMPLE);
    expect(s.admin.commit).not.toHaveBeenCalled();
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t1"));
  });
});
