import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import type { LoadReview } from "../persistence/content-store.ts";
import { ReviewSheet, type ReviewSheetProps } from "./ReviewSheet.tsx";

const FILE = "mal-ymef-athmeeya-geethangal-16.hymnbook.json.gz";

const review: LoadReview = {
  token: "t",
  sourceHash: "ab12cd34ef56".padEnd(64, "0"),
  title: "",
  language: "",
  script: "",
  origin: "",
  songCount: 0,
  violations: [],
  held: { count: 0, books: [] },
};

const sheet = (props: Partial<ReviewSheetProps>) =>
  render(() => (
    <ReviewSheet
      open
      review={review}
      fileName={FILE}
      busy={false}
      placement="bottom"
      position={{ index: 3, total: 3, canBack: true, canNext: false, loaded: false }}
      onCancel={() => {}}
      onCommit={() => {}}
      onChooseAnother={() => {}}
      {...props}
    />
  ));

const timesShown = (container: HTMLElement) => (container.textContent?.split(FILE).length ?? 1) - 1;

describe("ReviewSheet", () => {
  it("names the file once while it is read: the body shows it, the pager does not", () => {
    const { container } = sheet({ reading: FILE });
    expect(timesShown(container)).toBe(1);
    expect(container.querySelector(".review-position-file")).toBeNull();
    expect(container.querySelector(".review-file")).toHaveTextContent(FILE);
  });

  it("keeps the file name in the pager when the book names itself", () => {
    const { container } = sheet({
      review: { ...review, title: "Athmeeya Geethangal", language: "ml", songCount: 3 },
    });
    expect(container.querySelector(".review-position-file")).toHaveTextContent(FILE);
  });

  it("notes a song that does not look like a song, and still offers the button (ADR-0034)", () => {
    const committed: string[] = [];
    const { container, getByRole } = sheet({
      position: undefined,
      review: {
        ...review,
        title: "Pasted",
        language: "en",
        script: "Latn",
        songCount: 1,
        verdict: { kind: "new" },
        notes: [{ number: 4, title: "Counter", message: "Lines are full of { } ; like code." }],
      },
      onCommit: () => committed.push("commit"),
    });
    const note = container.querySelector(".callout-notes");
    expect(note).toHaveTextContent("Counter");
    expect(note).toHaveTextContent("Lines are full of { } ; like code.");
    expect(container).toHaveTextContent("This may not be a song");
    expect(container).toHaveTextContent("It is added anyway.");
    const add = getByRole("button", { name: "Load Book" });
    expect(add).toBeEnabled();
    add.click();
    expect(committed).toEqual(["commit"]);
  });

  it("counts the notes past those it lists, and shows none for ordinary songs", () => {
    const base = { ...review, title: "Pasted", language: "en", script: "Latn", songCount: 40 };
    const many = sheet({
      position: undefined,
      review: {
        ...base,
        verdict: { kind: "new" },
        notes: [{ number: 1, title: "A", message: "Reads like a paragraph, not lines." }],
        moreNotes: 21,
      },
    });
    expect(many.container).toHaveTextContent("22 songs may not be songs");
    expect(many.container).toHaveTextContent("And 21 more.");
    many.unmount();
    const none = sheet({ position: undefined, review: { ...base, verdict: { kind: "new" } } });
    expect(none.container.querySelector(".callout-notes")).toBeNull();
  });

  it("shows no note on a refusal", () => {
    const { container } = sheet({
      position: undefined,
      review: {
        ...review,
        violations: [{ rule: "container", where: "file", message: "not a hymnbook container" }],
        notes: [{ number: 1, title: "A", message: "x" }],
      },
    });
    expect(container.querySelector(".callout-notes")).toBeNull();
  });
});
