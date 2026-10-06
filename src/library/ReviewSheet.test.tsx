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
});
