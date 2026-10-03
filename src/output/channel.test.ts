import { describe, expect, it } from "vitest";
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

    expect(await pending).toEqual({
      type: "hello",
      id: expect.any(String),
      landscape: expect.any(Boolean),
    });

    presenterWindow.postMessage({ type: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    // b has not said, then is gone, so a's shape stands until a leaves.
    expect(seen).toEqual([false, true, undefined, true, undefined]);

    // The window that spoke last wins, not the one that spoke first.
    seen.length = 0;
    outputWindow.postMessage({ type: "hello", id: "x", landscape: true });
    outputWindow.postMessage({ type: "hello", id: "y", landscape: false });
    outputWindow.postMessage({ type: "shape", id: "x", landscape: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    otherWindow.onmessage = (event) => seen.push(event.data);
    otherWindow.postMessage({ type: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toContainEqual({ type: "blank", blanked: true });

    setOutputBlanked(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen.at(-1)).toEqual({ type: "blank", blanked: false });
    otherWindow.close();
  });

  it("sends End Live and Go Live, and replays a held end to a late Output", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    const ended = nextMessage(otherWindow);
    setOutputEnded(true);
    expect(await ended).toEqual({ type: "ended", ended: true });

    const seen: unknown[] = [];
    otherWindow.onmessage = (event) => seen.push(event.data);
    otherWindow.postMessage({ type: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toContainEqual({ type: "ended", ended: true });

    setOutputEnded(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen.at(-1)).toEqual({ type: "ended", ended: false });
    otherWindow.close();
  });

  it("replays the settings and the dark states before the content, so a dark window never paints the song", async () => {
    const otherWindow = new BroadcastChannel(CHANNEL_NAME);
    setOutputPresentation({ theme: "warm", cues: {}, pinChorus: false, bandSize: "part" });
    setOutputBlanked(true);
    setOutputEnded(true);
    publishOutput({ type: "idle" });
    await new Promise((resolve) => setTimeout(resolve, 20)); // what was posted live
    const seen: string[] = [];
    otherWindow.onmessage = (event) => seen.push(event.data.type);
    otherWindow.postMessage({ type: "hello", id: "late" });
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    otherWindow.onmessage = (event) => seen.push(event.data);
    // A reloaded Operator knows nothing; the Output says it is ended.
    otherWindow.postMessage({
      type: "hello",
      id: "held",
      state: { blanked: false, ended: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(states).toEqual([{ blanked: false, ended: true }]);
    expect(seen).toContainEqual({ type: "ended", ended: true });
    expect(seen).not.toContainEqual({ type: "ended", ended: false });
    // A window with no state is new: it is told, not adopted from.
    seen.length = 0;
    otherWindow.postMessage({ type: "hello", id: "new" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(states).toHaveLength(1);
    expect(seen).toContainEqual({ type: "ended", ended: true });
    // A closed window's end is forgotten without a word.
    seen.length = 0;
    forgetOutputEnded();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([]);
    unsubscribe();
    otherWindow.close();
  });

  it("an Output reports its dark states in hello and shape once told, none before", async () => {
    const operator = new BroadcastChannel(CHANNEL_NAME);
    const seen: { type: string; state?: unknown }[] = [];
    operator.onmessage = (event) => seen.push(event.data);
    let state: { blanked: boolean; ended: boolean } | undefined;
    const unsubscribe = subscribeOutput(
      () => {},
      () => state,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen.find((m) => m.type === "hello")?.state).toBeUndefined();
    state = { blanked: true, ended: false };
    operator.postMessage({ type: "ping" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen.filter((m) => m.type === "hello").at(-1)?.state).toEqual(state);
    unsubscribe();
    operator.close();
  });

  it("delivers an end to the Output's handler", async () => {
    const operator = new BroadcastChannel(CHANNEL_NAME);
    const seen: unknown[] = [];
    const unsubscribe = subscribeOutput((message) => seen.push(message));
    operator.postMessage({ type: "ended", ended: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    otherWindow.onmessage = (event) => seen.push(event.data);
    otherWindow.postMessage({ type: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    await new Promise((resolve) => setTimeout(resolve, 10));

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
