import type { FlatLine, LineRange } from "../domain/sequence-engine.ts";
import type { HymnbookId, HymnNumber, PartId } from "../domain/types.ts";
import type { OutputCues, OutputTheme } from "../persistence/user-state.ts";

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
      /** What the cues need (SDD-0001 §16.1): the hymnbook's title, the
       * focused part as a congregation reads it ("Verse 2", "Refrain"), and
       * how many times in a row it's being sung. */
      hymnbookTitle?: string;
      part?: string;
      repeat?: number;
      /** The hymn's refrain, if it has one — pinned where it fits
       * (SDD-0001 §16.1). */
      refrain?: PartId;
    }
  | { type: "idle" }
  /** Hides what's presented, or shows it again — distinct from `idle`,
   * which means nothing is presented (SDD-0001 §16.5). */
  | { type: "blank"; blanked: boolean }
  /** The Operator's Presentation settings, followed live (SDD-0001 §16.1). */
  | PresentationMessage
  /** Show faded cues again for a while — a moment, never replayed. */
  | { type: "reveal" };

export type PresentationMessage = {
  type: "presentation";
  theme: OutputTheme;
  cues: OutputCues;
  pinRefrain: boolean;
};

/** Output → Presenter: "I just opened — send me what's showing." */
type HelloMessage = { type: "hello" };

/**
 * Output → Presenter, scroll sync (SDD-0001 §16.1): a person's scroll came
 * to rest with this flattened line at the reading band's centre. A request:
 * the Operator decides whether to go there.
 */
export type SeekMessage = {
  type: "seek";
  hymnbookId: HymnbookId;
  number: HymnNumber;
  line: number;
  /** The focus was a whole part when the scroll began: land on the part. */
  whole: boolean;
};

/** Output → Operator: a plain key pressed in the Output window, replayed
 * through the Operator's keymap (SDD-0001 §16.1). */
export type KeyMessage = { type: "key"; key: string; shiftKey: boolean };

type ChannelMessage = OutputMessage | HelloMessage | SeekMessage | KeyMessage;

const CHANNEL_NAME = "hymnal-output";

let channel: BroadcastChannel | undefined;
let lastPublished: OutputMessage | undefined;
let blanked = false;
let presentation: PresentationMessage | undefined;

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Late join (SDD-0001 §16.1): an Output window opened mid-hymn replays
    // whatever this window last published, instead of sitting blank until
    // the next keypress.
    channel.addEventListener("message", (event: MessageEvent<ChannelMessage>) => {
      if (event.data.type !== "hello") return;
      if (lastPublished) channel?.postMessage(lastPublished);
      if (blanked) channel?.postMessage({ type: "blank", blanked } satisfies OutputMessage);
      if (presentation) channel?.postMessage(presentation);
    });
  }
  return channel;
}

/** Presenter calls this on every navigation, and once more with `idle` on unmount. */
/** Shows the Output's faded cues again for their fade time. */
export function revealCues(): void {
  getChannel().postMessage({ type: "reveal" } satisfies OutputMessage);
}

export function publishOutput(message: Extract<OutputMessage, { type: "content" | "idle" }>): void {
  lastPublished = message;
  getChannel().postMessage(message);
}

/** Blanks the Output, or restores it; held across navigation and hymns. */
export function setOutputBlanked(next: boolean): void {
  blanked = next;
  getChannel().postMessage({ type: "blank", blanked } satisfies OutputMessage);
}

/** Sends the Output's theme and cues; held and replayed to a late Output
 * like blank. */
export function setOutputPresentation(settings: Omit<PresentationMessage, "type">): void {
  presentation = { type: "presentation", ...settings };
  getChannel().postMessage(presentation);
}

/**
 * Output calls this once; returns an unsubscribe function for cleanup.
 * Announces itself with `hello` so an already-open Presenter replays the
 * current state.
 */
export function subscribeOutput(handler: (message: OutputMessage) => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    const { data } = event;
    if (
      data.type === "content" ||
      data.type === "idle" ||
      data.type === "blank" ||
      data.type === "presentation" ||
      data.type === "reveal"
    )
      handler(data);
  };
  target.addEventListener("message", listener);
  target.postMessage({ type: "hello" } satisfies HelloMessage);
  return () => target.removeEventListener("message", listener);
}

/** Output calls this when a person's scroll comes to rest (SDD-0001 §16.1). */
export function requestSeek(seek: Omit<SeekMessage, "type">): void {
  getChannel().postMessage({ type: "seek", ...seek } satisfies SeekMessage);
}

/** Presenter listens for seeks; returns an unsubscribe function. */
export function subscribeSeek(handler: (seek: SeekMessage) => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    if (event.data.type === "seek") handler(event.data);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}

/** Output calls this for a plain key pressed in its window. */
export function forwardKey(key: Omit<KeyMessage, "type">): void {
  getChannel().postMessage({ type: "key", ...key } satisfies KeyMessage);
}

/** The Operator replays forwarded keys; returns an unsubscribe function. */
export function subscribeKeys(handler: (key: KeyMessage) => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    if (event.data.type === "key") handler(event.data);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
