import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import type { Hymnbook } from "../domain/types.ts";
import type { ContentStatus, ContentStore } from "../persistence/content-store.ts";
import { Library } from "./Library.tsx";

const hymnbook: Hymnbook = {
  id: "book",
  title: "Athmeeya Geethangal",
  language: "ml",
  script: "Malayalam",
  edition: "16th",
  hymnCount: 1631,
};

function fakeStore(overrides: Partial<ContentStore> = {}): ContentStore {
  return {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => hymnbook,
    listHymns: async () => {
      throw new Error("not used");
    },
    getHymn: async () => {
      throw new Error("not used");
    },
    searchLyrics: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

describe("Library", () => {
  it("shows a loading state before the store responds", () => {
    render(() => <Library store={fakeStore()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the hymnbook once ready", async () => {
    render(() => <Library store={fakeStore()} />);
    expect(await screen.findByText("Athmeeya Geethangal")).toBeInTheDocument();
    expect(screen.getByText("1631 hymns · 16th")).toBeInTheDocument();
  });

  it.each([
    ["missing-asset", "The hymnbook file is missing. Try reloading."],
    ["corrupt", "The hymnbook file is damaged. Try reinstalling."],
  ] satisfies [ContentStatus["state"], string][])(
    "reports a %s content store as an error",
    async (state, message) => {
      render(() => <Library store={fakeStore({ ensureInstalled: async () => ({ state }) })} />);
      expect(await screen.findByText(message)).toBeInTheDocument();
    },
  );

  it("reports a schema mismatch with the found and expected versions", async () => {
    render(() => (
      <Library
        store={fakeStore({
          ensureInstalled: async () => ({ state: "schema-mismatch", found: 1, expected: 2 }),
        })}
      />
    ));
    expect(
      await screen.findByText("This hymnbook needs an app update (found schema 1, need 2)."),
    ).toBeInTheDocument();
  });

  it("retries after a failure", async () => {
    let attempt = 0;
    const store = fakeStore({
      ensureInstalled: async () =>
        ++attempt === 1 ? { state: "missing-asset" } : { state: "ready" },
    });

    render(() => <Library store={store} />);
    await screen.findByText("The hymnbook file is missing. Try reloading.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Athmeeya Geethangal")).toBeInTheDocument();
  });
});
