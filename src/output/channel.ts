import type { FlatLine, LineRange } from "../domain/sequence-engine.ts";
import type { HymnbookId, HymnNumber, PartId } from "../domain/types.ts";
import type { BandSize, Highlight, OutputCues, OutputTheme } from "../persistence/user-state.ts";

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
       * focused part as a congregation reads it ("Verse 2", "Chorus"), and
       * how many times in a row it's being sung. */
      hymnbookTitle?: string;
      part?: string;
      repeat?: number;
      /** The hymn's chorus, if it has one — pinned where it fits
       * (SDD-0001 §16.1). */
      chorus?: PartId;
      /** The hymn's parts in printed order, each once, for the whole-song
       * layout (SDD-0005). Without it the Output scrolls. */
      parts?: { id: PartId; lines: string[]; marker?: string }[];
    }
  | { type: "idle" }
  /** Hides what's presented, or shows it again — distinct from `idle`,
   * which means nothing is presented (SDD-0001 §16.5). */
  | { type: "blank"; blanked: boolean }
  /** End Live, or Go Live again: the window stays open and goes dark, held
   * apart from blank (which it leaves as it was), so it resumes in place
   * without the window being opened again (SDD-0001 §16.4). */
  | { type: "ended"; ended: boolean }
  /** The Operator's Presentation settings, followed live (SDD-0001 §16.1). */
  | PresentationMessage
  /** Show faded cues again for a while — a moment, never replayed. */
  | { type: "reveal" };

export type PresentationMessage = {
  type: "presentation";
  theme: OutputTheme;
  cues: OutputCues;
  pinChorus: boolean;
  /** The whole song at once on a landscape screen (SDD-0005). */
  wholeSong?: boolean;
  /** Mark each part in that layout with its verse number or kind; absent
   * means on (SDD-0005 § 1). */
  partLabels?: boolean;
  /** What is lit: the current part, or the whole song (SDD-0005 § 5). */
  highlight?: Highlight;
  bandSize: BandSize;
};

/** What the Output window itself is showing of the dark states: it is the
 * source of truth, and tells a reloaded Operator (SDD-0001 §16.4). */
export type OutputState = { blanked: boolean; ended: boolean };

/** Output → Operator: "I'm open — send me what's showing." Sent on
 * opening and in answer to a ping; each Output window has its own id. */
type HelloMessage = {
  type: "hello";
  id: string;
  /** The window is wider than tall, so Live can match it (SDD-0005 § 1). */
  landscape?: boolean;
  /** Its dark states, once an Operator has told it any; a window that has
   * not been told is new, and is told. */
  state?: OutputState;
};

/** Output → Operator: the window's shape changed (resized, rotated). */
type ShapeMessage = { type: "shape"; id: string; landscape: boolean; state?: OutputState };

/** Output → Operator: the window is closing (SDD-0001 §16.4, On air). */
type ByeMessage = { type: "bye"; id: string };

/** Operator → Output: "who's open?" — a reloaded Operator asking. */
type PingMessage = { type: "ping" };

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
export type KeyMessage = {
  type: "key";
  key: string;
  shiftKey: boolean;
  /** Held down, auto-repeating: R and U ignore it (SDD-0001 §16.5). */
  repeat?: boolean;
};

type ChannelMessage =
  | OutputMessage
  | HelloMessage
  | ShapeMessage
  | ByeMessage
  | PingMessage
  | SeekMessage
  | KeyMessage;

const CHANNEL_NAME = "hymnal-output";
const stateListeners = new Set<(state: OutputState) => void>();
/** The latest state an Output reported, for a listener that comes after it. */
let reported: OutputState | undefined;

let channel: BroadcastChannel | undefined;
let lastPublished: OutputMessage | undefined;
let blanked = false;
let ended = false;
let presentation: PresentationMessage | undefined;

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Late join (SDD-0001 §16.1): an Output window opened mid-hymn replays
    // whatever this window last published, instead of sitting blank until
    // the next keypress. The settings and the dark states go first, then the
    // content, so a window that is blanked or ended never paints the song
    // and then fades it.
    channel.addEventListener("message", (event: MessageEvent<ChannelMessage>) => {
      const { data } = event;
      // An Output that already holds a state is the truth (this Operator was
      // reloaded): adopt it, and do not post over it.
      if ((data.type === "hello" || data.type === "shape") && data.state) {
        blanked = data.state.blanked;
        ended = data.state.ended;
        reported = data.state;
        for (const listener of [...stateListeners]) listener(data.state);
      }
      if (data.type !== "hello") return;
      if (presentation) channel?.postMessage(presentation);
      if (blanked) channel?.postMessage({ type: "blank", blanked } satisfies OutputMessage);
      if (ended) channel?.postMessage({ type: "ended", ended } satisfies OutputMessage);
      if (lastPublished) channel?.postMessage(lastPublished);
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

/** Ends Live (the Output goes dark, its window stays) or resumes it; held and
 * replayed to a late Output like blank. */
export function setOutputEnded(next: boolean): void {
  ended = next;
  getChannel().postMessage({ type: "ended", ended } satisfies OutputMessage);
}

/** The window it was held for closed: the next one opens lit. Nothing is
 * posted. */
export function forgetOutputEnded(): void {
  ended = false;
  reported = undefined;
}

/**
 * Operator: the Output's own dark states, as an Output that holds them
 * reports them (a reloaded Operator adopts them). Returns an unsubscribe
 * function.
 */
export function subscribeOutputState(handler: (state: OutputState) => void): () => void {
  getChannel();
  stateListeners.add(handler);
  if (reported) handler({ blanked, ended });
  return () => stateListeners.delete(handler);
}

/** Sends the Output's theme, cues and band size; held and replayed to a late Output
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
export function subscribeOutput(
  handler: (message: OutputMessage) => void,
  /** The window's dark states, once it has been told any. */
  stateOf?: () => OutputState | undefined,
): () => void {
  const target = getChannel();
  const id = crypto.randomUUID();
  const landscape = () => window.innerWidth >= window.innerHeight;
  let wasLandscape = landscape();
  const hello = () =>
    target.postMessage({
      type: "hello",
      id,
      landscape: landscape(),
      state: stateOf?.(),
    } satisfies HelloMessage);
  const onResize = () => {
    if (landscape() === wasLandscape) return;
    wasLandscape = landscape();
    target.postMessage({
      type: "shape",
      id,
      landscape: wasLandscape,
      state: stateOf?.(),
    } satisfies ShapeMessage);
  };
  window.addEventListener("resize", onResize);
  const bye = () => target.postMessage({ type: "bye", id } satisfies ByeMessage);
  const listener = (event: MessageEvent<ChannelMessage>) => {
    const { data } = event;
    if (data.type === "ping") {
      hello();
      return;
    }
    if (
      data.type === "content" ||
      data.type === "idle" ||
      data.type === "blank" ||
      data.type === "ended" ||
      data.type === "presentation" ||
      data.type === "reveal"
    )
      handler(data);
  };
  target.addEventListener("message", listener);
  window.addEventListener("pagehide", bye);
  hello();
  return () => {
    bye();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", bye);
    target.removeEventListener("message", listener);
  };
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

/**
 * Operator: whether any Output window is open, for "On air" and the
 * Live dot (SDD-0001 §16.4). Tracks each window's hello and bye by id, and
 * pings once so an Operator opened (or reloaded) after its Output still
 * finds it. Returns an unsubscribe function.
 */
export function subscribePresence(handler: (open: boolean) => void): () => void {
  const target = getChannel();
  const open = new Set<string>();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    const { data } = event;
    if (data.type === "hello") open.add(data.id);
    else if (data.type === "bye") open.delete(data.id);
    else return;
    handler(open.size > 0);
  };
  target.addEventListener("message", listener);
  target.postMessage({ type: "ping" } satisfies PingMessage);
  return () => target.removeEventListener("message", listener);
}

/**
 * Operator: whether the open Output window is wider than tall (the latest to
 * say so, with several), or undefined when none is open or it has not said.
 * Live follows it, so a portrait Output shows its scroll in Live too.
 */
export function subscribeOutputShape(
  handler: (landscape: boolean | undefined) => void,
): () => void {
  const target = getChannel();
  const shapes = new Map<string, boolean | undefined>();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    const { data } = event;
    if (data.type === "hello" || data.type === "shape") {
      // Deleted first, so the window that spoke last is last.
      shapes.delete(data.id);
      shapes.set(data.id, data.landscape);
    } else if (data.type === "bye") shapes.delete(data.id);
    else return;
    handler([...shapes.values()].at(-1));
  };
  target.addEventListener("message", listener);
  target.postMessage({ type: "ping" } satisfies PingMessage);
  return () => target.removeEventListener("message", listener);
}
