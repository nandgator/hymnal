import type { FlatLine, LineRange } from "../domain/sequence-engine.ts";
import type { HymnbookId, HymnNumber, PartId } from "../domain/types.ts";
import type { BandSize, Highlight, OutputCues, OutputTheme } from "../persistence/user-state.ts";
import type { PlacementReport } from "./placement.ts";

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
  /** Hold freezes the Output on what it shows, or lets it follow again; the
   * Output ignores content and settings while held (SDD-0001 §16.6). */
  | { type: "hold"; held: boolean }
  /** End Live: the Output window closes itself (SDD-0001 §16.4). A command,
   * never held or replayed, so a window opened later is not closed by it. */
  | { type: "close" }
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
  /** What is lit: the current part, or the whole song (SDD-0005 § 5). */
  highlight?: Highlight;
  bandSize: BandSize;
};

/** Whether the Output window itself is blanked: it is the source of truth,
 * and tells a reloaded Operator (SDD-0001 §16.4). */
export type OutputState = {
  blanked: boolean;
  /** Present only while held: what the Output froze on (SDD-0001 §16.6). */
  held?: HeldView;
};

/** What a held Output shows: its content (none if it showed nothing) and
 * its settings, as of the moment it was held. */
export type HeldView = {
  content?: Extract<OutputMessage, { type: "content" }>;
  presentation?: PresentationMessage;
};

/** Output → Operator: "I'm open — send me what's showing." Sent on
 * opening and in answer to a ping; each Output window has its own id. */
type HelloMessage = {
  type: "hello";
  id: string;
  /** The window is wider than tall, so Live can match it (SDD-0005 § 1). */
  landscape?: boolean;
  /** Its blank state, once an Operator has told it any; a window that has
   * not been told is new, and is told. */
  state?: OutputState;
  /** Where the window verifiably is, if it has found out (ADR-0028). */
  placement?: PlacementReport;
};

/** Output → Operator: where the window verifiably is (ADR-0028, Wayland). */
type PlacementMessage = { type: "placement" } & PlacementReport;

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

/** Output → Operator: the Output's view threw and went blank (SDD-0001 §16.9). */
type FailedMessage = { type: "failed" };

type ChannelMessage =
  | OutputMessage
  | FailedMessage
  | HelloMessage
  | ShapeMessage
  | PlacementMessage
  | ByeMessage
  | PingMessage
  | SeekMessage
  | KeyMessage;

const CHANNEL_NAME = "hymnal-output";
const stateListeners = new Set<(state: OutputState) => void>();
/** The latest state an Output reported, for a listener that comes after it. */
let reported: OutputState | undefined;

let channel: BroadcastChannel | undefined;
/** What the Output shows, and what a late window is replayed. */
let lastPublished: Extract<OutputMessage, { type: "content" | "idle" }> | undefined;
let presentation: PresentationMessage | undefined;
/** What the Operator last asked for. While held it runs ahead of what is
 * shown, and Release sends it. */
let wantedContent: typeof lastPublished;
let wantedPresentation: PresentationMessage | undefined;
let held = false;
const holdListeners = new Set<(view: HeldView | undefined) => void>();
let blanked = false;

const heldView = (): HeldView | undefined =>
  held
    ? {
        ...(lastPublished?.type === "content" ? { content: lastPublished } : {}),
        ...(presentation ? { presentation } : {}),
      }
    : undefined;
const notifyHold = () => {
  const view = heldView();
  for (const listener of [...holdListeners]) listener(view);
};
/** Held ends: what is wanted becomes what is shown, and is sent. */
function release(send: boolean): void {
  held = false;
  presentation = wantedPresentation;
  lastPublished = wantedContent;
  if (send) {
    channel?.postMessage({ type: "hold", held: false } satisfies OutputMessage);
    if (presentation) channel?.postMessage(presentation);
    if (lastPublished) channel?.postMessage(lastPublished);
  }
  notifyHold();
}

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Late join (SDD-0001 §16.1): an Output window opened mid-hymn replays
    // whatever this window last published, instead of sitting blank until
    // the next keypress. The settings and the blank state go first, then the
    // content, so a window that is blanked never paints the song and then
    // fades it.
    channel.addEventListener("message", (event: MessageEvent<ChannelMessage>) => {
      const { data } = event;
      // An Output that already holds a state is the truth (this Operator was
      // reloaded): adopt it, and do not post over it.
      if ((data.type === "hello" || data.type === "shape") && data.state) {
        blanked = data.state.blanked;
        reported = data.state;
        // The Output is the truth for Hold too: a reloaded Operator takes
        // what it froze on as what is shown, and what it publishes meanwhile
        // as only wanted.
        if (data.state.held) {
          held = true;
          lastPublished = data.state.held.content ?? { type: "idle" };
          presentation = data.state.held.presentation;
          notifyHold();
        } else if (held) release(false);
        for (const listener of [...stateListeners]) listener(data.state);
      }
      if (data.type !== "hello") return;
      if (presentation) channel?.postMessage(presentation);
      if (blanked) channel?.postMessage({ type: "blank", blanked } satisfies OutputMessage);
      if (lastPublished) channel?.postMessage(lastPublished);
      // Last, so a window applies the held content before it starts
      // ignoring any.
      if (held) channel?.postMessage({ type: "hold", held: true } satisfies OutputMessage);
    });
  }
  return channel;
}

/** Presenter calls this on every navigation, and once more with `idle` on unmount. */
/** Shows the Output's faded cues again for their fade time. */
export function revealCues(): void {
  getChannel().postMessage({ type: "reveal" } satisfies OutputMessage);
}

/** What this window itself publishes, for a view in the same window (Board
 * #41): a BroadcastChannel never delivers to its own sender. */
const localListeners = new Set<
  (message: Extract<OutputMessage, { type: "content" | "idle" }>) => void
>();

/** Calls `handler` with whatever was last published here, then with each
 * later publish. Returns an unsubscribe function. */
export function subscribeLocalOutput(
  handler: (message: Extract<OutputMessage, { type: "content" | "idle" }>) => void,
): () => void {
  localListeners.add(handler);
  if (lastPublished?.type === "content" || lastPublished?.type === "idle") handler(lastPublished);
  return () => localListeners.delete(handler);
}

export function publishOutput(message: Extract<OutputMessage, { type: "content" | "idle" }>): void {
  wantedContent = message;
  if (held) return;
  lastPublished = message;
  for (const listener of [...localListeners]) listener(message);
  getChannel().postMessage(message);
}

/** Blanks the Output, or restores it; held across navigation and hymns. */
export function setOutputBlanked(next: boolean): void {
  blanked = next;
  getChannel().postMessage({ type: "blank", blanked } satisfies OutputMessage);
}

/** Ends Live: every Output window closes itself. Not held: the next window
 * opens lit (Go Live), or blank if blank is still held. */
export function closeOutput(): void {
  // End Live cancels Hold: the next window opens on the current content.
  if (held) release(false);
  getChannel().postMessage({ type: "close" } satisfies OutputMessage);
}

/**
 * Operator: the Output's own blank state, as an Output that holds it
 * reports it (a reloaded Operator adopts them). Returns an unsubscribe
 * function.
 */
export function subscribeOutputState(handler: (state: OutputState) => void): () => void {
  getChannel();
  stateListeners.add(handler);
  if (reported) handler({ blanked });
  return () => stateListeners.delete(handler);
}

/** Sends the Output's theme, cues and band size; held and replayed to a late Output
 * like blank. */
export function setOutputPresentation(settings: Omit<PresentationMessage, "type">): void {
  wantedPresentation = { type: "presentation", ...settings };
  if (held) return;
  presentation = wantedPresentation;
  getChannel().postMessage(presentation);
}

/**
 * Hold (SDD-0001 §16.6): the Output keeps exactly what it shows, and
 * nothing the Operator does afterwards reaches it, until released, which
 * sends the Operator's current state with the usual transition.
 */
export function setOutputHeld(next: boolean): void {
  if (next === held) return;
  getChannel();
  if (!next) {
    release(true);
    return;
  }
  held = true;
  channel?.postMessage({ type: "hold", held: true } satisfies OutputMessage);
  notifyHold();
}

/**
 * Operator: what the Output is held on, or undefined when it is not held.
 * Called at once with the present state. Returns an unsubscribe function.
 */
export function subscribeHold(handler: (view: HeldView | undefined) => void): () => void {
  getChannel();
  holdListeners.add(handler);
  handler(heldView());
  return () => holdListeners.delete(handler);
}

/**
 * Output calls this once; returns an unsubscribe function for cleanup.
 * Announces itself with `hello` so an already-open Presenter replays the
 * current state.
 */
export function subscribeOutput(
  handler: (message: OutputMessage) => void,
  /** The window's blank state, once it has been told any. */
  stateOf?: () => OutputState | undefined,
  /** Where the window verifiably is, for an Operator that asks (ping). */
  placementOf?: () => PlacementReport | undefined,
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
      placement: placementOf?.(),
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
      data.type === "hold" ||
      data.type === "close" ||
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

/** Output calls this when it learns where it is (ADR-0028). */
export function reportOutputPlacement(report: PlacementReport): void {
  getChannel().postMessage({ type: "placement", ...report } satisfies PlacementMessage);
}

/** Operator: where an Output verifiably is, as it says so; returns an unsubscribe function. */
export function subscribePlacement(handler: (report: PlacementReport) => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    const { data } = event;
    if (data.type === "placement")
      handler({
        onTarget: data.onTarget,
        fullscreen: data.fullscreen,
        ...(data.refused ? { refused: true } : {}),
        ...(data.unconfirmed ? { unconfirmed: true } : {}),
      });
    else if (data.type === "hello" && data.placement) handler(data.placement);
  };
  target.addEventListener("message", listener);
  target.postMessage({ type: "ping" } satisfies PingMessage);
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

/** Output calls this when its view failed and went blank (SDD-0001 §16.9). */
export function reportOutputFailed(): void {
  getChannel().postMessage({ type: "failed" } satisfies FailedMessage);
}

/** The Operator hears that an Output went blank; returns an unsubscribe function. */
export function subscribeOutputFailed(handler: () => void): () => void {
  const target = getChannel();
  const listener = (event: MessageEvent<ChannelMessage>) => {
    if (event.data.type === "failed") handler();
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
