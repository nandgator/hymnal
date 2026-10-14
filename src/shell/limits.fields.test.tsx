import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Finder } from "../finder/Finder.tsx";
import { LanguagePicker } from "../library/LanguagePicker.tsx";
import { RenameSheet } from "../library/RenameSheet.tsx";
import { createTextDraft, TextSheet } from "../library/TextSheet.tsx";
import type { ContentStore } from "../persistence/content-store.ts";
import { DEFAULT_PREFERENCES, type UserState } from "../persistence/user-state.ts";
import {
  CODE_MAX,
  ECHO_MAX,
  NAME_MAX,
  NUMBER_MAX,
  SEARCH_MAX,
  TEXT_MAX,
  TEXT_TOO_LONG,
} from "./limits.ts";
import { Settings } from "./Settings.tsx";

afterEach(cleanup);

const userState = (): UserState => ({
  getLastPosition: async () => undefined,
  setLastPosition: async () => {},
  getRecents: async () => [],
  addRecent: async () => {},
  dropRecents: async () => {},
  dropSong: async () => {},
  getPreferences: async () => DEFAULT_PREFERENCES,
  setPreferences: async () => {},
});

const store = (): ContentStore =>
  ({
    ensureInstalled: async () => ({ state: "ready" }),
    listHymns: async () => [{ number: 1, title: "One" }],
    searchLyrics: async () => [],
    searchAll: async () => [],
    searchNumber: async () => [],
    searchMore: async () => ({ results: [], more: false }),
  }) as unknown as ContentStore;

const MALAYALAM = "ക്ഷമലയാളം".repeat(60);
const graphemes = (text: string) =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;

describe("a limit on every text field", () => {
  it("search fields hold SEARCH_MAX: Settings and the Finder", () => {
    render(() => <Settings userState={userState()} />);
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveAttribute(
      "maxlength",
      String(SEARCH_MAX),
    );
    cleanup();
    render(() => (
      <Finder hymnbookId="book" store={store()} userState={userState()} onSelect={vi.fn()} />
    ));
    expect(screen.getByRole("combobox", { name: "Find a song" })).toHaveAttribute(
      "maxlength",
      String(SEARCH_MAX),
    );
  });

  it("a query the Finder is opened with is cut to the limit too", () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={store()}
        userState={userState()}
        onSelect={vi.fn()}
        initialQuery={"7".repeat(500)}
      />
    ));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toHaveLength(SEARCH_MAX);
  });

  it("the language picker holds SEARCH_MAX", () => {
    render(() => <LanguagePicker id="lang" value="" onPick={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveAttribute("maxlength", String(SEARCH_MAX));
  });

  it("Rename holds NAME_MAX", () => {
    render(() => (
      <RenameSheet
        open
        book={{ key: "k", title: "My Songs" }}
        busy={false}
        placement="center"
        onCancel={() => {}}
        onRename={() => {}}
      />
    ));
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxlength", String(NAME_MAX));
  });

  function textSheet(setup?: (d: ReturnType<typeof createTextDraft>) => void) {
    render(() => {
      const draft = createTextDraft();
      draft.setLanguage("ml");
      setup?.(draft);
      return (
        <TextSheet
          open
          draft={draft}
          errors={[]}
          problems={{}}
          books={[]}
          choice="new"
          busy={false}
          placement="center"
          onCancel={() => {}}
          onReview={() => {}}
        />
      );
    });
  }

  it("From Text: the book name NAME_MAX, the song number NUMBER_MAX, the text TEXT_MAX", () => {
    textSheet();
    expect(screen.getByLabelText("Book name")).toHaveAttribute("maxlength", String(NAME_MAX));
    expect(screen.getByLabelText("Song text")).toHaveAttribute("maxlength", String(TEXT_MAX));
    expect(document.getElementById("book-number")).toHaveAttribute("maxlength", String(NUMBER_MAX));
  });

  it("From Text: the script code field holds CODE_MAX", () => {
    textSheet();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(document.getElementById("book-script")).toHaveAttribute("maxlength", String(CODE_MAX));
  });

  const pasteOf = (text: string) => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => text } });
    return paste;
  };

  it("From Text: a paste over the limit is refused with a plain message, not cut", () => {
    textSheet();
    const area = screen.getByLabelText("Song text") as HTMLTextAreaElement;
    const paste = pasteOf("a".repeat(TEXT_MAX + 1));
    area.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(area.value).toBe("");
    expect(screen.getByRole("alert")).toHaveTextContent(TEXT_TOO_LONG);
  });

  it("From Text: a paste that fits goes in untouched", () => {
    textSheet();
    const area = screen.getByLabelText("Song text") as HTMLTextAreaElement;
    const paste = pasteOf("1. Grace\n\nLine");
    area.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
    expect(screen.queryByText(TEXT_TOO_LONG)).not.toBeInTheDocument();
  });
});

describe("a query echoed in a card is clipped to one line", () => {
  it("Settings: a long Malayalam query is cut on a cluster, with an ellipsis", () => {
    render(() => <Settings userState={userState()} />);
    fireEvent.input(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: MALAYALAM },
    });
    const heading = screen.getByRole("heading", { name: /^No settings match/ });
    const echoed = /“(.*)”/.exec(heading.textContent ?? "")?.[1] ?? "";
    expect(echoed.endsWith("…")).toBe(true);
    expect(graphemes(echoed.slice(0, -1))).toBe(ECHO_MAX);
    expect(heading.className).toContain("empty-echo");
  });

  it("Settings: a short query is echoed whole", () => {
    render(() => <Settings userState={userState()} />);
    fireEvent.input(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "asdf" },
    });
    expect(screen.getByRole("heading", { name: "No settings match “asdf”" })).toBeInTheDocument();
  });

  it("the Finder: the same", async () => {
    render(() => (
      <Finder hymnbookId="book" store={store()} userState={userState()} onSelect={vi.fn()} />
    ));
    fireEvent.input(screen.getByRole("combobox"), { target: { value: `zz${"q".repeat(400)}` } });
    const heading = await screen.findByRole("heading", { name: /^No matches for/ });
    expect(heading.textContent).toBe(`No matches for “zz${"q".repeat(ECHO_MAX - 2)}…”`);
    expect(heading.className).toContain("empty-echo");
  });
});
