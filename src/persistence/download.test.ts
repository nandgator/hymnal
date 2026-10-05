// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { download } from "./download.ts";

const response = (chunks: number[][], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    }),
    { headers },
  );

describe("download", () => {
  it("joins the chunks and reports the bytes against the total", async () => {
    const onProgress = vi.fn();
    const bytes = await download(response([[1, 2], [3]], { "content-length": "3" }), onProgress);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 3, total: 3 });
  });

  it("leaves the total unknown for a compressed response, whose length counts other bytes", async () => {
    const onProgress = vi.fn();
    await download(
      response([[1, 2, 3]], { "content-length": "2", "content-encoding": "gzip" }),
      onProgress,
    );
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 3, total: undefined });
  });

  it("reads plainly with no one listening", async () => {
    expect([...(await download(response([[7]])))]).toEqual([7]);
  });
});
