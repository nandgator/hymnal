import type { FlatLine, LineRange } from "../domain/sequence-engine.ts";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";

/**
 * Presenter → Output, one browser, two windows (Board #11, SDD-0001 §16.1).
 * A module-level singleton, not App-level Solid state — the channel has no
 * reason to be a component, same shape as the `userState`/`getContentStore`
 * singletons in `src/persistence/`.
 */
export type OutputMessage =
  | {
      type: "content";
      hymnbookId: HymnbookId;
      number: HymnNumber;
      title: string;
      lines: FlatLine[];
      focus: LineRange;
    }
  | { type: "idle" };

/** Output → Presenter: "I just opened — send me what's showing." */
type HelloMessage = { type: "hello" };

const CHANNEL_NAME = "hymnal-output";

let channel: BroadcastChannel | undefined;
let lastPublished: OutputMessage | undefined;

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Late join (SDD-0001 §16.1): an Output window opened mid-hymn replays
    // whatever this window last published, instead of sitting blank until
    // the next keypress.
    channel.addEventListener("message", (event: MessageEvent<OutputMessage | HelloMessage>) => {
      if (event.data.type === "hello" && lastPublished) channel?.postMessage(lastPublished);
    });
  }
  return channel;
}

/** Presenter calls this on every navigation, and once more with `idle` on unmount. */
export function publishOutput(message: OutputMessage): void {
  lastPublished = message;
  getChannel().postMessage(message);
}

/**
 * Output calls this once; returns an unsubscribe function for cleanup.
 * Announces itself with `hello` so an already-open Presenter replays the
 * current state.
 */
export function subscribeOutput(handler: (message: OutputMessage) => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<OutputMessage | HelloMessage>) => {
    if (event.data.type !== "hello") handler(event.data);
  };
  target.addEventListener("message", listener);
  target.postMessage({ type: "hello" } satisfies HelloMessage);
  return () => target.removeEventListener("message", listener);
}
