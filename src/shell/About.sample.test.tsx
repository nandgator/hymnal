import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_RIGHTS_URL } from "../config.ts";
import { About } from "./About.tsx";

// A build the deploy gave the sample (Board #43).
vi.mock("../config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.ts")>()),
  SAMPLE_FILES: ["otterbein-hymnal-sample.hymnbook.json.gz"],
}));

describe("About, in a build with the sample", () => {
  it("says the sample is public domain and links each song's record", async () => {
    render(() => (
      <About
        admin={{ listBooks: async () => [], storageMode: async () => "opfs" as const }}
        state={{ mode: () => "idb" as const }}
      />
    ));
    expect(await screen.findByText(/sample books offered in the Library/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The sample’s rights" })).toHaveAttribute(
      "href",
      SAMPLE_RIGHTS_URL,
    );
  });
});
