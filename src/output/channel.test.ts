import { describe, expect, it, vi } from "vitest";
import {
  forgetOutputEnded,
  publishOutput,
  requestSeek,
  setOutputBlanked,
  setOutputEnded,
  setOutputPresentation,
  subscribeOutput,
  subscribeOutputShape,
  subscribeOutputState,
  subscribePresence,
  subscribeSeek,
} from "./channel.ts";

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

// Nothing here waits a fixed time for a message to cross: how long delivery
// takes depends on the machine's load. A message reaches another channel in
// the order it was posted, so a fence (a seek nothing else reads) posted after
// the traffic under test, and seen to arrive, proves that traffic was
// delivered. settle() fences both ways: the module has handled what `other`
// posted, and `other` has received what the module answered.
const FENCE = { hymnbookId: "fence", number: 0, line: 0 };
const isFence = (data: unknown) =>
  (data as { type?: string; hymnbookId?: string }).type === "seek" &&
  (data as { hymnbookId?: string }).hymnbookId === FENCE.hymnbookId;
const record = (into: unknown[]) => (event: MessageEvent) => {
  if (!isFence(event.data)) into.push(event.data);
};
async function settle(other: BroadcastChannel): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsubscribe = subscribeSeek((seek) => {
      if (seek.hymnbookId !== FENCE.hymnbookId) return;
      unsubscribe();
      resolve();
    });
    other.postMessage({ type: "seek", ...FENCE });
  });
  await new Promise<void>((resolve) => {
    const arrived = (event: MessageEvent) => {
      if (!isFence(event.data)) return;
      other.removeEventListener("message", arrived);
      resolve();
    };
    other.addEventListener("message", arrived);
    requestSeek({ ...FENCE, whole: false });
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
    await settle(otherWindow);
    expect(seen).toEqual([{ type: "idle" }]);

    unsubscribe();
    otherWindow.postMessage({ type: "idle" });
    await settle(otherWindow);
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

    expect(await pending).toEqual({
      type: "hello",
      id: expect.any(String),
      landscape: expect.any(Boolean),
    });

    presenterWindow.postMessage({ type: "hello" });
    await settle(presenterWindow);
    expect(seen).toEqual([]);

    unsubscribe();
    presenterWindow.close();
  });

  it("tells the Operator the Output's shape: from hello, then as it turns, none after bye", async () => {
    const outputWindow = new BroadcastChannel(CHANNEL_NAME);
    const seen: (boolean | undefined)[] = [];
    const unsubscribe = subscribeOutputShape((landscape) => seen.push(landscape));
    outputWindow.postMessage({ type: "hello", id: "a", landscape: false });
    outputWindow.postMessage({ type: "shape", id: "a", landscape: true });
    outputWindow.postMessage({ type: "hello", id: "b" });
    outputWindow.postMessage({ type: "bye", id: "b" });
    outputWindow.postMessage({ type: "bye", id: "a" });
    await settle(outputWindow);
    // b has not said, then is gone, so a's shape stands until a leaves.
    expect(seen).toEqual([false, true, undefined, true, undefined]);

    // The window that spoke last wins, not the one that spoke first.
    seen.length = 0;
    outputWindow.postMessage({ type: "hello", id: "x", landscape: true });
    outputWindow.postMessage({ type: "hello", id: "y", landscape: false });
    outputWindow.postMessage({ type: "shape", id: "x", landscape: true });
    await settle(outputWindow);
    expect(seen).toEqual([true, false, true]);

    unsubscribe();
    outputWindow.close();
  });

  it("tracks whether an Output is open: pinged hello, hello, bye (On air)", async () => {
    const outputWindow = new BroadcastChannel(CHANNEL_NAME);
    const ping = nextMessage(outputWindow);
    const seen: boolean[] = [];
    const unsubscribe = subscribePresence((open) => seen.push(open));
    // A reloaded Operator asks who's open.
    expect(await ping).toEqual({ type: "ping" });

    outputWindow.postMessage({ type: "hello", id: "a" });
    outputWindow.postMessage({ type: "hello", id: "b" });
    outputWindow.postMessage({ type: "bye", id: "a" });
    outputWindow.postMessage({ type: "bye", id: "b" });
    await settle(outputWindow);
    expect(seen).toEqual([true, true, true, false]);

    unsubscribe();
    outputWindow.close();
  });

  it("sends blank and restore, and replays a held blank to a late Output", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const blank = nextMessage(otherWindow);
    setOutputBlanked(true);
    expect(await blank).toEqual({ type: "blank", blanked: true });

    const seen: unknown[] = [];
    otherWindow.onmessage = record(seen);
    otherWindow.postMessage({ type: "hello" });
    await settle(otherWindow);
    expect(seen).toContainEqual({ type: "blank", blanked: true });

    setOutputBlanked(false);
    await settle(otherWindow);
    expect(seen.at(-1)).toEqual({ type: "blank", blanked: false });
    otherWindow.close();
  });

  it("sends End Live and Go Live, and replays a held end to a late Output", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const ended = nextMessage(otherWindow);
    setOutputEnded(true);
    expect(await ended).toEqual({ type: "ended", ended: true });

    const seen: unknown[] = [];
    otherWindow.onmessage = record(seen);
    otherWindow.postMessage({ type: "hello" });
    await settle(otherWindow);
    expect(seen).toContainEqual({ type: "ended", ended: true });

    setOutputEnded(false);
    await settle(otherWindow);
    expect(seen.at(-1)).toEqual({ type: "ended", ended: false });
    otherWindow.close();
  });

  it("replays the settings and the dark states before the content, so a dark window never paints the song", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    setOutputPresentation({ theme: "warm", cues: {}, pinChorus: false, bandSize: "part" });
    setOutputBlanked(true);
    setOutputEnded(true);
    publishOutput({ type: "idle" });
    await settle(otherWindow);
    const seen: string[] = [];
    otherWindow.onmessage = (event) => {
      if (!isFence(event.data)) seen.push(event.data.type);
    };
    otherWindow.postMessage({ type: "hello", id: "late" });
    await settle(otherWindow);
    expect(seen).toEqual(["presentation", "blank", "ended", "idle"]);
    setOutputBlanked(false);
    setOutputEnded(false);
    otherWindow.close();
  });

  it("adopts the dark state a reporting Output holds, and never posts a lit one over it", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const states: unknown[] = [];
    const unsubscribe = subscribeOutputState((state) => states.push(state));
    const seen: unknown[] = [];
    otherWindow.onmessage = record(seen);
    // A reloaded Operator knows nothing; the Output says it is ended.
    otherWindow.postMessage({
      type: "hello",
      id: "held",
      state: { blanked: false, ended: true },
    });
    await settle(otherWindow);
    expect(states).toEqual([{ blanked: false, ended: true }]);
    expect(seen).toContainEqual({ type: "ended", ended: true });
    expect(seen).not.toContainEqual({ type: "ended", ended: false });
    // A window with no state is new: it is told, not adopted from.
    seen.length = 0;
    otherWindow.postMessage({ type: "hello", id: "new" });
    await settle(otherWindow);
    expect(states).toHaveLength(1);
    expect(seen).toContainEqual({ type: "ended", ended: true });
    // A closed window's end is forgotten without a word.
    seen.length = 0;
    forgetOutputEnded();
    await settle(otherWindow);
    expect(seen).toEqual([]);
    unsubscribe();
    otherWindow.close();
  });

  it("an Output reports its dark states in hello and shape once told, none before", async () => {
    const operator = new BroadcastChannel(CHANNEL_NAME);
    const seen: { type: string; state?: unknown }[] = [];
    operator.onmessage = record(seen);
    let state: { blanked: boolean; ended: boolean } | undefined;
    const unsubscribe = subscribeOutput(
      () => {},
      () => state,
    );
    await settle(operator);
    expect(seen.find((m) => m.type === "hello")?.state).toBeUndefined();
    state = { blanked: true, ended: false };
    operator.postMessage({ type: "ping" });
    await settle(operator);
    expect(seen.filter((m) => m.type === "hello").at(-1)?.state).toEqual(state);
    unsubscribe();
    operator.close();
  });

  it("delivers an end to the Output's handler", async () => {
    const operator = new BroadcastChannel(CHANNEL_NAME);
    const seen: unknown[] = [];
    const unsubscribe = subscribeOutput((message) => seen.push(message));
    operator.postMessage({ type: "ended", ended: true });
    await settle(operator);
    expect(seen).toContainEqual({ type: "ended", ended: true });
    unsubscribe();
    operator.close();
  });

  it("sends the Output theme, and replays it to a late Output", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const sent = nextMessage(otherWindow);
    setOutputPresentation({
      theme: "warm",
      cues: { part: true },
      pinChorus: true,
      bandSize: "line",
    });
    expect(await sent).toEqual({
      type: "presentation",
      theme: "warm",
      cues: { part: true },
      pinChorus: true,
      bandSize: "line",
    });

    const seen: unknown[] = [];
    otherWindow.onmessage = record(seen);
    otherWindow.postMessage({ type: "hello" });
    await settle(otherWindow);
    expect(seen).toContainEqual({
      type: "presentation",
      theme: "warm",
      cues: { part: true },
      pinChorus: true,
      bandSize: "line",
    });
    otherWindow.close();
  });

  it("carries a seek from the Output to the Presenter's subscribeSeek, never to subscribeOutput", async () => {
    const seeks: unknown[] = [];
    const outputs: unknown[] = [];
    const stopSeeks = subscribeSeek((seek) => seeks.push(seek));
    const stopOutputs = subscribeOutput((message) => outputs.push(message));
    const outputWindow = new BroadcastChannel(CHANNEL_NAME);

    outputWindow.postMessage({ type: "seek", hymnbookId: "book", number: 7, line: 3 });
    // Both listeners sit on one channel, so by the time the seek is in, the
    // same event has been through the other.
    await vi.waitFor(() => expect(seeks).toHaveLength(1));

    expect(seeks).toEqual([{ type: "seek", hymnbookId: "book", number: 7, line: 3 }]);
    expect(outputs.some((message) => (message as { type: string }).type === "seek")).toBe(false);
    stopSeeks();
    stopOutputs();
    outputWindow.close();
  });

  it("requestSeek posts a seek other windows receive", async () => {
    const presenterWindow = new BroadcastChannel(CHANNEL_NAME);
    const pending = nextMessage(presenterWindow);
    requestSeek({ hymnbookId: "book", number: 7, line: 2, whole: false });
    expect(await pending).toEqual({
      type: "seek",
      hymnbookId: "book",
      number: 7,
      line: 2,
      whole: false,
    });
    presenterWindow.close();
  });
});
