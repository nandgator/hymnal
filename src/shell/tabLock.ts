/**
 * One tab owns the content store (SDD-0001 §10.4): the OPFS pool allows one
 * connection, so the tab that holds the store holds an exclusive Web Lock for
 * its life. Another tab says so, and its "Use here" asks the holder over a
 * channel to let go. The holder lets go unless it is live (an Output is open:
 * it is presenting), in which case it refuses. Pure of the DOM: the locks and
 * the channel are passed in, so the protocol is tested with fakes.
 */

export const TAB_LOCK_NAME = "hymnal-store";
export const TAB_CHANNEL_NAME = "hymnal-tabs";

export type TabState =
  /** Asking for the lock; nothing is shown yet. */
  | "checking"
  /** This tab holds the store. */
  | "owner"
  /** Another tab holds it (or this one let it go): the note and "Use here". */
  | "other"
  /** "Use here" is pressed and the holder has not answered. */
  | "asking"
  /** The holder refused: it is presenting. */
  | "presenting"
  /** The holder refused: it is saving a book. */
  | "saving"
  /** The holder did not answer in time: the request is withdrawn. */
  | "silent";

export interface LockLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

export type TabMessage =
  | { type: "release-request"; from: string }
  /** The holder heard the request and is letting go. */
  | { type: "release-ack"; to: string }
  | { type: "release-refused"; to: string; reason: "presenting" | "saving" };

export interface TabChannel {
  post(message: TabMessage): void;
  listen(handler: (message: TabMessage) => void): () => void;
  /** The tab ends: the channel is closed. */
  close?(): void;
}

/** How long "Use here" waits for the holder to answer. */
export const ANSWER_TIMEOUT_MS = 5000;

export interface TabLockOptions {
  locks: LockLike;
  channel: TabChannel;
  /** The holder is presenting: an Output is open (or not yet known not to be). */
  isLive: () => boolean;
  /** The holder is writing (saving, replacing or removing a book): it is never
   * let go mid-write. */
  isBusy?: () => boolean | Promise<boolean>;
  /** How long "Use here" waits for an answer. */
  timeoutMs?: number;
  /** Closes the store, so the next holder can open it; resolves when it has. */
  release: () => Promise<void>;
  id?: string;
}

export interface TabLock {
  state(): TabState;
  onChange(handler: (state: TabState) => void): () => void;
  /** Asks for the lock; says which state it landed in first. */
  start(): void;
  /** "Use here": waits for the lock and asks the holder to let go. */
  useHere(): void;
  /** The tab ends: a held lock goes, a waiting request is withdrawn. */
  dispose(): void;
}

export function createTabLock(options: TabLockOptions): TabLock {
  const { locks, channel, isLive, release, isBusy } = options;
  const timeoutMs = options.timeoutMs ?? ANSWER_TIMEOUT_MS;
  const id = options.id ?? Math.random().toString(36).slice(2);
  let state: TabState = "checking";
  let letGo: (() => void) | undefined;
  let waiting: AbortController | undefined;
  let releasing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopListening: (() => void) | undefined;
  const handlers = new Set<(state: TabState) => void>();

  const set = (next: TabState) => {
    if (next === state) return;
    state = next;
    for (const handler of handlers) handler(state);
  };

  const acquire = (lockOptions: { ifAvailable?: boolean; signal?: AbortSignal }) =>
    locks
      .request(TAB_LOCK_NAME, lockOptions, async (lock) => {
        if (!lock) {
          set("other");
          return;
        }
        waiting = undefined;
        set("owner");
        // Held until released: the lock is the store's life.
        await new Promise<void>((resolve) => {
          letGo = resolve;
        });
        letGo = undefined;
      })
      .catch(() => {
        // A withdrawn request rejects; nothing else to do.
      });

  const onMessage = async (message: TabMessage) => {
    if (message.type === "release-request") {
      if (state !== "owner" || releasing) return;
      if (isLive()) {
        channel.post({ type: "release-refused", to: message.from, reason: "presenting" });
        return;
      }
      releasing = true;
      try {
        if (await isBusy?.()) {
          channel.post({ type: "release-refused", to: message.from, reason: "saving" });
          return;
        }
        channel.post({ type: "release-ack", to: message.from });
        await release();
        set("other");
        letGo?.();
      } finally {
        releasing = false;
      }
    } else if (message.to === id && state === "asking") {
      if (message.type === "release-ack") {
        // It is letting go: the lock follows, however long closing takes.
        clearTimeout(timer);
        return;
      }
      clearTimeout(timer);
      waiting?.abort();
      waiting = undefined;
      set(message.reason);
    }
  };

  return {
    state: () => state,
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    start() {
      stopListening ??= channel.listen((message) => void onMessage(message));
      void acquire({ ifAvailable: true });
    },
    useHere() {
      if (state === "owner" || state === "asking") return;
      waiting = new AbortController();
      set("asking");
      // Queued before the request is sent, so the holder's release cannot slip past it.
      void acquire({ signal: waiting.signal });
      channel.post({ type: "release-request", from: id });
      // A holder that never answers is frozen or gone: stop waiting, and
      // withdraw the request so it cannot take the lock later.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (state !== "asking") return;
        waiting?.abort();
        waiting = undefined;
        set("silent");
      }, timeoutMs);
    },
    dispose() {
      clearTimeout(timer);
      waiting?.abort();
      channel.close?.();
      stopListening?.();
      stopListening = undefined;
      letGo?.();
      handlers.clear();
    },
  };
}

/** The real thing, or undefined where the browser has no Web Locks (today's behaviour). */
export function browserTabLock(
  isLive: () => boolean,
  release: () => Promise<void>,
  isBusy?: () => boolean | Promise<boolean>,
): TabLock | undefined {
  if (
    typeof navigator === "undefined" ||
    !navigator.locks ||
    typeof BroadcastChannel === "undefined"
  )
    return undefined;
  const broadcast = new BroadcastChannel(TAB_CHANNEL_NAME);
  return createTabLock({
    isBusy,
    locks: navigator.locks as unknown as LockLike,
    channel: {
      post: (message) => broadcast.postMessage(message),
      close: () => broadcast.close(),
      listen(handler) {
        const listener = (event: MessageEvent<TabMessage>) => handler(event.data);
        broadcast.addEventListener("message", listener);
        return () => broadcast.removeEventListener("message", listener);
      },
    },
    isLive,
    release,
  });
}
