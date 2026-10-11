import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { gunzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import sampleMd from "../../docs/authoring/sample.md?raw";
import { validateCorpus } from "../domain/validate.ts";
import type {
  BookRow,
  Choice,
  CommitResult,
  LoadReview,
  OwnResult,
  RemovedFromOwn,
  RenamedOwn,
} from "../persistence/content-store.ts";
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
        own: [
          {
            key: null,
            origin: "assorted",
            title: "Assorted Hymns",
            next: 1,
            has: {},
            adding: hymns.map((h: { number: number }) => h.number),
          },
          {
            key: null,
            origin: "own",
            title: "",
            next: 1,
            has: {},
            adding: hymns.map((h: { number: number }) => h.number),
          },
        ],
      };
    }),
    commit: vi.fn(async (_token: string, _choice?: Choice): Promise<CommitResult> => {
      return { ok: false, reason: "no-review", message: "songs are added, not loaded" };
    }),
    cancel: vi.fn(async () => true),
    removeBook: vi.fn(async () => true),
    openBook: vi.fn(async () => ({ state: "ready" as const })),
    storageMode: vi.fn(async () => "opfs" as const),
    addToOwn: vi.fn(
      async (token: string, target: { kind: string; title?: string }): Promise<OwnResult> => {
        const book = pending.get(token);
        if (!book) return { ok: false, reason: "no-review", message: "nothing pending" };
        rows = [
          ...rows,
          {
            ...shipped,
            key: "k1",
            origin: "own",
            kind: "own",
            title: target.title ?? "Assorted Hymns",
            songs: book.songs,
            language: "mul",
            script: "Zyyy",
          },
        ];
        return {
          ok: true,
          key: "k1",
          numbers: Array.from({ length: book.songs }, (_, i) => i + 1),
          already: 0,
          created: true,
        };
      },
    ),
    removeOwnSong: vi.fn(async (): Promise<RemovedFromOwn> => ({ removed: false })),
    renameOwn: vi.fn(
      async (key: string, title: string): Promise<RenamedOwn> => ({ ok: true, key, title }),
    ),
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
        userState={{
          getRecents: async () => [],
          dropRecents: async () => {},
          dropSong: async () => {},
        }}
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
  const dialog = within(await screen.findByRole("dialog", { name: "From Text" }));
  // A song may go to Assorted Hymns, the default; these tests are of a new book.
  fireEvent.click(dialog.getByRole("combobox", { name: "Add to" }));
  // hidden: a popover that is not shown (the test may stub showPopover) is not in the tree.
  fireEvent.click(dialog.getByRole("option", { name: "New book…", hidden: true }));
  return { s, dialog };
};

type Dialog = Awaited<ReturnType<typeof openSheet>>["dialog"];

/** Picks a language from the list by typing part of its name, then choosing the first row. */
const chooseLanguage = (dialog: Dialog, search: string) => {
  const box = dialog.getByRole("combobox", { name: /language/i });
  fireEvent.focus(box);
  fireEvent.input(box, { target: { value: search } });
  fireEvent.click(within(dialog.getByRole("listbox")).getAllByRole("option")[0] as HTMLElement);
};
const fill = (dialog: Dialog, over: { title?: string; language?: string } = {}) => {
  fireEvent.input(dialog.getByLabelText("Book name"), {
    target: { value: over.title ?? "Public Domain Sample" },
  });
  chooseLanguage(dialog, over.language ?? "English");
};
const type = (dialog: Dialog, label: RegExp | string, value: string) =>
  fireEvent.input(dialog.getByLabelText(label), { target: { value } });
const review = (dialog: Dialog) =>
  fireEvent.click(dialog.getByRole("button", { name: /^Review( Song| \d+ Songs)?$/ }));

describe("Library: a book from song text (ADR-0029, SDD-0004 §9)", () => {
  it("opens an empty sheet: the fields, one text area, nothing written", async () => {
    const { s, dialog } = await openSheet();
    // The name of a new book is suggested, not left blank to be required.
    expect(dialog.getByLabelText("Book name")).toHaveValue("My Songs");
    for (const label of [/language/i, "Song text"]) {
      expect(dialog.getByLabelText(label)).toHaveValue("");
    }
    expect(dialog.queryByLabelText("Id")).not.toBeInTheDocument();
    // The script is not asked for until a language says what it is.
    expect(dialog.queryByLabelText("Script code")).not.toBeInTheDocument();
    expect(dialog.queryByText(/^Script:/)).not.toBeInTheDocument();
    // There is no original-text box to check against (withdrawn, ADR-0029).
    expect(dialog.queryByLabelText(/Original text/)).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Open \.txt Files/ })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /Open a \.txt/ })).not.toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("asks for the name, language and script, never guessing them", async () => {
    const { s, dialog } = await openSheet();
    type(dialog, "Song text", SAMPLE);
    type(dialog, "Book name", "");
    review(dialog);
    expect(await dialog.findByText("Give the book a name.")).toBeInTheDocument();
    expect(dialog.getByText("Choose the song’s language.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Book name")).toBeInvalid();
    expect(dialog.getByRole("combobox", { name: /language/i })).toBeInvalid();
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

  const toReview = async () => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    type(dialog, "Song text", SAMPLE);
    review(dialog);
    const reviewDialog = within(await screen.findByRole("dialog", { name: "Add Songs" }));
    return { s, reviewDialog };
  };

  it("reviews the songs as joining a new book, with no source check row", async () => {
    const { s, reviewDialog } = await toReview();
    expect(reviewDialog.queryByText("Source check")).not.toBeInTheDocument();
    expect(reviewDialog.getByText(/^Adds/)).toHaveTextContent(
      "Adds 3 songs to Public Domain Sample",
    );
    expect(reviewDialog.getByText(/makes a new book of yours/)).toBeInTheDocument();
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("Add Songs adds them to a new book of that title; the book is listed and the text is cleared", async () => {
    const { s, reviewDialog } = await toReview();
    fireEvent.click(reviewDialog.getByRole("button", { name: "Add Songs" }));
    await waitFor(() =>
      expect(s.admin.addToOwn).toHaveBeenCalledWith(
        "t1",
        { kind: "new", title: "Public Domain Sample" },
        "en",
        "Latn",
        expect.any(Function),
      ),
    );
    expect(s.admin.commit).not.toHaveBeenCalled();
    expect(await screen.findByText("Public Domain Sample")).toBeInTheDocument();
    // The buttons stay off until the songs are written and listed.
    await waitFor(() => expect(screen.getByRole("button", { name: "From Text" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "From Text" }));
    const dialog = within(await screen.findByRole("dialog", { name: "From Text" }));
    expect(dialog.getByLabelText("Song text")).toHaveValue("");
  });

  it("Cancel in the review goes back to the text, which is kept", async () => {
    const { s, reviewDialog } = await toReview();
    fireEvent.click(reviewDialog.getByRole("button", { name: "Cancel" }));
    const dialog = within(await screen.findByRole("dialog", { name: "From Text" }));
    expect(dialog.getByLabelText("Song text")).toHaveValue(SAMPLE);
    expect(s.admin.commit).not.toHaveBeenCalled();
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t1"));
  });

  it("no song text is the Song text field's error", async () => {
    const { s, dialog } = await openSheet();
    fill(dialog);
    review(dialog);
    const list = await dialog.findByRole("alert", { name: "Parse errors" });
    expect(list).toHaveTextContent("There are no songs to add.");
    expect(dialog.getByLabelText("Song text")).toBeInvalid();
    expect(s.admin.review).not.toHaveBeenCalled();
  });
});

describe("Library: a language suggested by the text", () => {
  const ML_TEXT = "മലയാളം ഭാഷ എഴുതിയ വാക്കുകൾ ഇവിടെ";
  const language = (dialog: Dialog) => dialog.getByRole("combobox", { name: /language/i });

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
    const box = dialog.getByRole("combobox", { name: /language/i });
    fireEvent.focus(box);
    // Once under Common, once among all of them.
    expect(dialog.getAllByRole("option", { name: /മലയാളം — Malayalam/ })).toHaveLength(2);
    fireEvent.input(box, { target: { value: "tamil" } });
    expect(within(dialog.getByRole("listbox")).getAllByRole("option")).toHaveLength(2); // Tamil, and Other…
    fireEvent.input(box, { target: { value: "മല" } });
    expect(dialog.getByRole("option", { name: /Malayalam/ })).toBeInTheDocument();
    fireEvent.input(box, { target: { value: "zzzz" } });
    expect(dialog.getByText(/No language matches/)).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: "Other…" })).toBeInTheDocument();
  });

  it("derives the script from the language and shows it as a quiet line", async () => {
    const { dialog } = await openSheet();
    chooseLanguage(dialog, "Malayalam");
    expect(dialog.getByRole("combobox", { name: /language/i })).toHaveValue("മലയാളം — Malayalam");
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
    fireEvent.focus(dialog.getByRole("combobox", { name: /language/i }));
    fireEvent.click(dialog.getByRole("option", { name: "Other…" }));
    const code = dialog.getByLabelText(/language/i);
    fireEvent.input(code, { target: { value: "sd" } });
    expect(dialog.getByText(/^Script: Arabic/)).toBeInTheDocument();
    fireEvent.input(code, { target: { value: "not a code" } });
    fireEvent.input(dialog.getByLabelText("Book name"), { target: { value: "T" } });
    type(dialog, "Song text", SAMPLE);
    review(dialog);
    expect(await dialog.findByText(/isn’t a language code/)).toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("keeps the song number under Advanced, and has no id", async () => {
    const { dialog } = await openSheet();
    const summary = dialog.getByText("Advanced");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary.closest("details")).toContainElement(dialog.getByLabelText("Song number"));
    expect(dialog.queryByLabelText("Id")).not.toBeInTheDocument();
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
    const box = dialog.getByRole("combobox", { name: /language/i });
    fireEvent.focus(box);
    const names = within(dialog.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
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
    expect(within(dialog.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
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

describe("Library: the sheet keeps its size while a list or a section opens", () => {
  it("the language list floats in the top layer, out of the sheet's flow", async () => {
    const show = vi.fn();
    (HTMLElement.prototype as { showPopover?: () => void }).showPopover = show;
    try {
      const { dialog } = await openSheet();
      fireEvent.focus(dialog.getByRole("combobox", { name: /language/i }));
      const list = dialog.getByRole("listbox", { hidden: true });
      expect(list).toHaveAttribute("popover", "manual");
      await waitFor(() => expect(show).toHaveBeenCalled());
      // Placed from the field's rect, like the app's menus, not laid out under it.
      expect(list.style.top).not.toBe("");
    } finally {
      delete (HTMLElement.prototype as { showPopover?: () => void }).showPopover;
    }
  });

  it("Advanced grows its body smoothly, so the card follows instead of jumping", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    expect(css).toMatch(/\.advanced::details-content\s*{[^}]*transition:[^;}]*block-size/);
    expect(css).toMatch(/\.advanced[^{]*{[^}]*interpolate-size:\s*allow-keywords/);
  });

  it("the card has one size, whatever opens in it: a fixed height and a steady scrollbar gutter", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    expect(css).toMatch(/\.sheet\.sheet-tall:has\(\.textsheet\)\s*{[^}]*\bheight:/);
    expect(css).toMatch(/:has\(\.textsheet\) \.sheet-content\s*{[^}]*scrollbar-gutter:\s*stable/);
  });
});

describe("Library: the language list as a dropdown", () => {
  const open = async () => {
    const { dialog } = await openSheet();
    const box = dialog.getByRole("combobox", { name: /language/i });
    return { dialog, box };
  };

  it("a click on the field opens the list and a second click closes it", async () => {
    const { dialog, box } = await open();
    fireEvent.pointerDown(box);
    fireEvent.focus(box);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(dialog.getByRole("listbox", { hidden: true })).toBeInTheDocument();
    fireEvent.pointerDown(box);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(dialog.queryByRole("listbox", { hidden: true })).not.toBeInTheDocument();
    // And a third opens it again.
    fireEvent.pointerDown(box);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-expanded", "true");
  });

  it("Escape closes the list and not the sheet", async () => {
    const { dialog, box } = await open();
    fireEvent.focus(box);
    expect(box).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("dialog", { name: "From Text" })).toBeInTheDocument();
    expect(dialog.getByRole("combobox", { name: /language/i })).toBeInTheDocument();
  });

  it("keeps the active row in aria-activedescendant as the arrows move", async () => {
    const { dialog, box } = await open();
    fireEvent.focus(box);
    const first = box.getAttribute("aria-activedescendant");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const second = box.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(
      dialog.getByRole("listbox", { hidden: true }).querySelector(`#${second}`),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("fades only the edges that have more to scroll", async () => {
    const { dialog, box } = await open();
    fireEvent.focus(box);
    const list = dialog.getByRole("listbox", { hidden: true });
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade", "bottom");
    list.scrollTop = 150;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade", "both");
    list.scrollTop = 300;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-fade", "top");
  });
});
