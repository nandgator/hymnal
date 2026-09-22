import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { ContentStore } from "./persistence/content-store.ts";

vi.mock("./persistence/content-store.ts", () => {
  const store: ContentStore = {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => ({
      id: "mal-ymef-athmeeya-geethangal-16",
      title: "Mocked Hymnbook",
      language: "ml",
      script: "Malayalam",
      hymnCount: 1,
    }),
    listHymns: async () => [],
    getHymn: async () => {
      throw new Error("not used");
    },
    searchLyrics: async () => [],
  };
  return { getContentStore: () => store };
});

describe("App", () => {
  it("renders the Library, wired to the default content store", async () => {
    render(() => <App />);
    expect(await screen.findByText("Mocked Hymnbook")).toBeInTheDocument();
  });
});
