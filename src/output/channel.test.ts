import { describe, expect, it } from "vitest";
import { publishOutput, subscribeOutput } from "./channel.ts";

const CHANNEL_NAME = "hymnal-output";

// A BroadcastChannel never delivers to itself — only to *other* instances of
// the same name, which is exactly the Presenter-window/Output-window split
// this module exists for. `publishOutput`/`subscribeOutput` share one
// module-level singleton, so exercising real delivery needs a second, raw
// channel standing in for "the other window."
function nextMessage(channel: BroadcastChannel): Promise<unknown> {
  return new Promise((resolve) => {
    channel.addEventListener("message", (event) => resolve(event.data), { once: true });
  });
}

describe("output channel", () => {
  it("delivers a published message to another window's channel", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const pending = nextMessage(otherWindow);

    publishOutput({
      hymnbookId: "book",
      number: 1,
      title: "Test Hymn",
      lines: [{ text: "Line 1", partId: "s1", isPartStart: true }],
      focus: { start: 0, end: 1 },
      type: "content",
    });

    expect(await pending).toMatchObject({
      type: "content",
      title: "Test Hymn",
      focus: { start: 0, end: 1 },
    });
    otherWindow.close();
  });

  it("delivers an idle message", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const pending = nextMessage(otherWindow);

    publishOutput({ type: "idle" });

    expect(await pending).toEqual({ type: "idle" });
    otherWindow.close();
  });

  it("subscribeOutput receives what another window publishes, until unsubscribed", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const seen: unknown[] = [];
    const unsubscribe = subscribeOutput((message) => seen.push(message));

    otherWindow.postMessage({ type: "idle" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([{ type: "idle" }]);

    unsubscribe();
    otherWindow.postMessage({ type: "idle" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([{ type: "idle" }]); // unchanged — no second delivery

    otherWindow.close();
  });

  it("replays the last published message to an Output window that joins late", async () => {
    publishOutput({ type: "idle" });
    const lateWindow = new BroadcastChannel(CHANNEL_NAME);
    const pending = nextMessage(lateWindow);

    lateWindow.postMessage({ type: "hello" });

    expect(await pending).toEqual({ type: "idle" });
    lateWindow.close();
  });

  it("subscribeOutput announces itself with hello, and doesn't hand hello to its handler", async () => {
    const presenterWindow = new BroadcastChannel(CHANNEL_NAME);
    const pending = nextMessage(presenterWindow);
    const seen: unknown[] = [];
    const unsubscribe = subscribeOutput((message) => seen.push(message));

    expect(await pending).toEqual({ type: "hello" });

    presenterWindow.postMessage({ type: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual([]);

    unsubscribe();
    presenterWindow.close();
  });
});
