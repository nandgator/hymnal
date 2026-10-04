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

/** Picks a language from the list by typing part of its name, then choosing the first row. */
const chooseLanguage = (dialog: Dialog, search: string) => {
  const box = dialog.getByRole("combobox", { name: "Language" });
  fireEvent.focus(box);
  fireEvent.input(box, { target: { value: search } });
  fireEvent.click(dialog.getAllByRole("option")[0] as HTMLElement);
};
const fill = (dialog: Dialog, over: { title?: string; language?: string } = {}) => {
  fireEvent.input(dialog.getByLabelText("Title"), {
    target: { value: over.title ?? "Public Domain Sample" },
  });
  chooseLanguage(dialog, over.language ?? "English");
};
const type = (dialog: Dialog, label: RegExp | string, value: string) =>
  fireEvent.input(dialog.getByLabelText(label), { target: { value } });
const review = (dialog: Dialog) =>
  fireEvent.click(dialog.getByRole("button", { name: "Review the Book" }));

describe("Library: a book from song text (ADR-0029, SDD-0004 §9)", () => {
  it("opens an empty sheet: the fields, two text areas, nothing written", async () => {
    const { s, dialog } = await openSheet();
    for (const label of ["Title", "Language", "Id", "Song text"]) {
      expect(dialog.getByLabelText(label)).toHaveValue("");
    }
    // The script is not asked for until a language says what it is.
    expect(dialog.queryByLabelText("Script code")).not.toBeInTheDocument();
    expect(dialog.queryByText(/^Script:/)).not.toBeInTheDocument();
    expect(dialog.getByLabelText(/Original text, to check against/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Open \.txt files/ })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Open a \.txt/ })).toBeInTheDocument();
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
    expect(dialog.getByText("Choose the book’s language.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Title")).toBeInvalid();
    expect(dialog.getByRole("combobox", { name: "Language" })).toBeInvalid();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("lists parse errors with their line numbers and writes nothing", async () => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    type(dialog, "Song text", "# a comment\n0. Bad number\n\nA line\n");
    review(dialog);
    // Field errors under the field, in its own error style: no callout, no table.
    const list = await dialog.findByRole("alert", { name: "Parse errors" });
    const first = within(list).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent(/^Line 2: /);
    expect(first).toHaveClass("field-problem");
    expect(dialog.getByLabelText("Song text")).toBeInvalid();
    expect(dialog.queryByText(/in the text/)).not.toBeInTheDocument();
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
    if (source) type(dialog, /Original text, to check against/, source);
    review(dialog);
    const reviewDialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
    return { s, reviewDialog };
  };

  it("not checked against a source when none was given", async () => {
    const { s, reviewDialog } = await toReview("");
    expect(reviewDialog.getByText("Not checked against a source")).toBeInTheDocument();
    expect(reviewDialog.getByText("A new book")).toBeInTheDocument();
    expect(reviewDialog.getByText("public-domain-sample")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Load Books" })).toHaveTextContent("3 songs");
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
    // The buttons stay off until the book is written and listed.
    await waitFor(() => expect(screen.getByRole("button", { name: "From Text" })).toBeEnabled());
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

  it("no song text is the Song text field's error", async () => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    review(dialog);
    const list = await dialog.findByRole("alert", { name: "Parse errors" });
    expect(list).toHaveTextContent("There is no song text.");
    expect(dialog.getByLabelText("Song text")).toBeInvalid();
    expect(s.admin.review).not.toHaveBeenCalled();
  });
});

describe("Library: a language suggested by the text", () => {
  const ML_TEXT = "മലയാളം ഭാഷ എഴുതിയ വാക്കുകൾ ഇവിടെ";
  const language = (dialog: Dialog) => dialog.getByRole("combobox", { name: "Language" });

  it("preselects the script's language with a quiet line, and derives the script", async () => {
    const { dialog } = await openSheet();
    type(dialog, "Song text", ML_TEXT);
    await waitFor(() => expect(language(dialog)).toHaveValue("മലയാളം — Malayalam"));
    expect(dialog.getByText("Looks like Malayalam")).toBeInTheDocument();
    expect(dialog.getByText(/^Script: Malayalam/)).toBeInTheDocument();
  });

  it("suggests nothing for a script that several languages share", async () => {
    const { dialog } = await openSheet();
    type(dialog, "Song text", "Plain words written in English here");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(language(dialog)).toHaveValue("");
    expect(dialog.queryByText(/^Looks like/)).not.toBeInTheDocument();
  });

  it("never overrides a language the person chose, before or after the text", async () => {
    const { dialog } = await openSheet();
    chooseLanguage(dialog, "Tamil");
    type(dialog, "Song text", ML_TEXT);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(language(dialog)).toHaveValue("தமிழ் — Tamil");
    expect(dialog.queryByText(/^Looks like/)).not.toBeInTheDocument();
  });

  it("a language picked over a suggestion is the person's, and the line goes", async () => {
    const { dialog } = await openSheet();
    type(dialog, "Song text", ML_TEXT);
    await dialog.findByText("Looks like Malayalam");
    chooseLanguage(dialog, "Tamil");
    expect(dialog.queryByText(/^Looks like/)).not.toBeInTheDocument();
    type(dialog, "Song text", `${ML_TEXT} ${ML_TEXT}`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(language(dialog)).toHaveValue("தமிழ் — Tamil");
  });
});

describe("Library: the language of a book from text", () => {
  it("lists languages by their own name and English, searchable by either", async () => {
    const { dialog } = await openSheet();
    const box = dialog.getByRole("combobox", { name: "Language" });
    fireEvent.focus(box);
    // Once under Common, once among all of them.
    expect(dialog.getAllByRole("option", { name: /മലയാളം — Malayalam/ })).toHaveLength(2);
    fireEvent.input(box, { target: { value: "tamil" } });
    expect(dialog.getAllByRole("option")).toHaveLength(2); // Tamil, and Other…
    fireEvent.input(box, { target: { value: "മല" } });
    expect(dialog.getByRole("option", { name: /Malayalam/ })).toBeInTheDocument();
    fireEvent.input(box, { target: { value: "zzzz" } });
    expect(dialog.getByText(/No language matches/)).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: "Other…" })).toBeInTheDocument();
  });

  it("derives the script from the language and shows it as a quiet line", async () => {
    const { dialog } = await openSheet();
    chooseLanguage(dialog, "Malayalam");
    expect(dialog.getByRole("combobox", { name: "Language" })).toHaveValue("മലയാളം — Malayalam");
    expect(dialog.getByText(/^Script: Malayalam/)).toHaveTextContent("Script: Malayalam (Mlym)");
    expect(dialog.queryByLabelText("Script code")).not.toBeInTheDocument();
  });

  it("Change opens the script code; the choice of another language derives it again", async () => {
    const { dialog } = await openSheet();
    chooseLanguage(dialog, "Malayalam");
    fireEvent.click(dialog.getByRole("button", { name: "Change" }));
    const code = dialog.getByLabelText("Script code");
    expect(code).toHaveValue("Mlym");
    fireEvent.input(code, { target: { value: "Latn" } });
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    expect(dialog.getByText(/^Script: Latin/)).toBeInTheDocument();
    chooseLanguage(dialog, "Tamil");
    expect(dialog.getByText(/^Script: Tamil/)).toHaveTextContent("(Taml)");
  });

  it("Other… types a code, and a code that is no language is a field error", async () => {
    const { s, dialog } = await openSheet();
    fireEvent.focus(dialog.getByRole("combobox", { name: "Language" }));
    fireEvent.click(dialog.getByRole("option", { name: "Other…" }));
    const code = dialog.getByLabelText("Language");
    fireEvent.input(code, { target: { value: "sd" } });
    expect(dialog.getByText(/^Script: Arabic/)).toBeInTheDocument();
    fireEvent.input(code, { target: { value: "not a code" } });
    fireEvent.input(dialog.getByLabelText("Title"), { target: { value: "T" } });
    type(dialog, "Song text", SAMPLE);
    review(dialog);
    expect(await dialog.findByText(/isn’t a language code/)).toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("keeps the id under Advanced", async () => {
    const { dialog } = await openSheet();
    const summary = dialog.getByText("Advanced");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary.closest("details")).toContainElement(dialog.getByLabelText("Id"));
  });

  it("several .txt files become one song text with --- between them", async () => {
    const { dialog } = await openSheet();
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    expect(input?.multiple).toBe(true);
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          new File(["1. One\n\nLine a\n---\n"], "a.txt"),
          new File(["2. Two\n\nLine b\n"], "b.txt"),
        ],
      },
    });
    await waitFor(() =>
      expect(dialog.getByLabelText("Song text")).toHaveValue(
        "1. One\n\nLine a\n\n---\n\n2. Two\n\nLine b",
      ),
    );
  });
});

describe("Library: the text sheet's picker and errors, in view", () => {
  it("opens with Common languages first, then all of them; search covers both", async () => {
    const { dialog } = await openSheet();
    const box = dialog.getByRole("combobox", { name: "Language" });
    fireEvent.focus(box);
    const names = dialog.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.slice(0, 4)).toEqual([
      expect.stringMatching(/^English/),
      expect.stringMatching(/^മലയാളം/),
      expect.stringMatching(/^தமிழ்/),
      expect.stringMatching(/^हिन्दी/),
    ]);
    expect(dialog.getByText("Common")).toBeInTheDocument();
    expect(dialog.getByText("All languages")).toBeInTheDocument();
    // A language outside Common is only in the full list, and search finds it.
    expect(names.some((n) => n.includes("Afrikaans"))).toBe(true);
    fireEvent.input(box, { target: { value: "afri" } });
    expect(dialog.getAllByRole("option")).toHaveLength(2);
    expect(dialog.queryByText("Common")).not.toBeInTheDocument();
  });

  it("after Review with errors, scrolls the first error into the sheet's view and focuses its field", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    const { dialog } = await openSheet();
    fill(dialog);
    type(dialog, "Song text", "0. Bad number\n\nA line\n");
    review(dialog);
    const list = await dialog.findByRole("alert", { name: "Parse errors" });
    await waitFor(() => expect(scrolled).toContain(list));
    expect(dialog.getByLabelText("Song text")).toHaveFocus();
  });
});
